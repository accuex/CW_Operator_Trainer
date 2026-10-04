<?php

declare(strict_types=1);

namespace Cwot\Api\Controllers;

use Cwot\Api\Http\JsonResponse;
use Cwot\Api\Http\RequestBody;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;

final class SyncController
{
    public function __construct(private readonly PDO $db)
    {
    }

    public function get(Request $request, Response $response): Response
    {
        $userId = (int) $request->getAttribute('userId');
        $params = $request->getQueryParams();
        $includeAnswers = filter_var($params['answers'] ?? '0', FILTER_VALIDATE_BOOL);
        $includeSessions = filter_var($params['sessions'] ?? '0', FILTER_VALIDATE_BOOL);
        $since = isset($params['since']) ? (int) $params['since'] : null;

        $state = $this->loadState($userId);
        if ($state === null) {
            return JsonResponse::error($response, 'not_found', 'Sync state not found', 404);
        }

        $payload = [
            'schemaVersion' => (int) $state['schema_version'],
            'revision' => (int) $state['revision'],
            'updatedAt' => $state['updated_at'],
            'profile' => $this->decodeJson($state['profile_json']),
            'settings' => $this->decodeJson($state['settings_json']),
        ];

        if ($includeAnswers) {
            $payload['answers'] = $this->loadAnswers($userId, $since);
        }
        if ($includeSessions) {
            $payload['sessions'] = $this->loadSessions($userId, $since);
        }

        return JsonResponse::write($response, $payload);
    }

    public function putState(Request $request, Response $response): Response
    {
        $userId = (int) $request->getAttribute('userId');
        $body = RequestBody::json($request);

        if (!array_key_exists('profile', $body) || !array_key_exists('settings', $body)) {
            return JsonResponse::error($response, 'validation_error', 'profile and settings are required', 422);
        }

        $clientRevision = isset($body['revision']) ? (int) $body['revision'] : null;
        $schemaVersion = isset($body['schemaVersion']) ? (int) $body['schemaVersion'] : 1;
        $profileJson = json_encode($body['profile'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $settingsJson = json_encode($body['settings'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if ($profileJson === false || $settingsJson === false) {
            return JsonResponse::error($response, 'validation_error', 'Invalid JSON payload', 422);
        }

        $current = $this->loadState($userId);
        if ($current === null) {
            return JsonResponse::error($response, 'not_found', 'Sync state not found', 404);
        }

        $serverRevision = (int) $current['revision'];
        if ($clientRevision !== null && $clientRevision !== $serverRevision) {
            return JsonResponse::error($response, 'conflict', 'Revision mismatch', 409, [
                'serverRevision' => $serverRevision,
                'serverUpdatedAt' => $current['updated_at'],
            ]);
        }

        $nextRevision = $serverRevision + 1;
        $update = $this->db->prepare(
            'UPDATE user_blobs
             SET profile_json = :profile,
                 settings_json = :settings,
                 schema_version = :schema_version,
                 revision = :revision
             WHERE user_id = :user_id AND revision = :prev_revision',
        );
        $update->execute([
            'profile' => $profileJson,
            'settings' => $settingsJson,
            'schema_version' => $schemaVersion,
            'revision' => $nextRevision,
            'user_id' => $userId,
            'prev_revision' => $serverRevision,
        ]);

        if ($update->rowCount() === 0) {
            $fresh = $this->loadState($userId);
            return JsonResponse::error($response, 'conflict', 'Revision mismatch', 409, [
                'serverRevision' => (int) ($fresh['revision'] ?? $serverRevision),
                'serverUpdatedAt' => $fresh['updated_at'] ?? $current['updated_at'],
            ]);
        }

        $fresh = $this->loadState($userId);
        return JsonResponse::write($response, [
            'schemaVersion' => (int) ($fresh['schema_version'] ?? $schemaVersion),
            'revision' => (int) ($fresh['revision'] ?? $nextRevision),
            'updatedAt' => $fresh['updated_at'] ?? null,
        ]);
    }

    public function postAnswers(Request $request, Response $response): Response
    {
        $userId = (int) $request->getAttribute('userId');
        $body = RequestBody::json($request);
        $items = $body['items'] ?? null;
        if (!is_array($items)) {
            return JsonResponse::error($response, 'validation_error', 'items array is required', 422);
        }

        $upsert = $this->db->prepare(
            'INSERT INTO answers (user_id, answer_id, payload_json, occurred_at)
             VALUES (:user_id, :answer_id, :payload, :occurred_at)
             ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), occurred_at = VALUES(occurred_at)',
        );

        $accepted = 0;
        $skipped = 0;
        foreach ($items as $item) {
            if (!is_array($item)) {
                $skipped += 1;
                continue;
            }
            $id = (string) ($item['id'] ?? '');
            if ($id === '' || strlen($id) > 64) {
                $skipped += 1;
                continue;
            }
            $occurredAt = (int) ($item['timestamp'] ?? 0);
            $payload = json_encode($item, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($payload === false) {
                $skipped += 1;
                continue;
            }
            $upsert->execute([
                'user_id' => $userId,
                'answer_id' => $id,
                'payload' => $payload,
                'occurred_at' => $occurredAt,
            ]);
            $accepted += 1;
        }

        return JsonResponse::write($response, [
            'accepted' => $accepted,
            'skipped' => $skipped,
        ]);
    }

    public function postSessions(Request $request, Response $response): Response
    {
        $userId = (int) $request->getAttribute('userId');
        $body = RequestBody::json($request);
        $items = $body['items'] ?? null;
        if (!is_array($items)) {
            return JsonResponse::error($response, 'validation_error', 'items array is required', 422);
        }

        $upsert = $this->db->prepare(
            'INSERT INTO sessions (user_id, session_id, payload_json, started_at)
             VALUES (:user_id, :session_id, :payload, :started_at)
             ON DUPLICATE KEY UPDATE payload_json = VALUES(payload_json), started_at = VALUES(started_at)',
        );

        $accepted = 0;
        $skipped = 0;
        foreach ($items as $item) {
            if (!is_array($item)) {
                $skipped += 1;
                continue;
            }
            $id = (string) ($item['id'] ?? '');
            if ($id === '' || strlen($id) > 64) {
                $skipped += 1;
                continue;
            }
            $startedAt = (int) ($item['startedAt'] ?? 0);
            $payload = json_encode($item, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            if ($payload === false) {
                $skipped += 1;
                continue;
            }
            $upsert->execute([
                'user_id' => $userId,
                'session_id' => $id,
                'payload' => $payload,
                'started_at' => $startedAt,
            ]);
            $accepted += 1;
        }

        return JsonResponse::write($response, [
            'accepted' => $accepted,
            'skipped' => $skipped,
        ]);
    }

    /** @return array<string, mixed>|null */
    private function loadState(int $userId): ?array
    {
        $stmt = $this->db->prepare(
            'SELECT profile_json, settings_json, schema_version, revision, updated_at
             FROM user_blobs WHERE user_id = :user_id LIMIT 1',
        );
        $stmt->execute(['user_id' => $userId]);
        $row = $stmt->fetch();
        return $row === false ? null : $row;
    }

    /** @return list<array<string, mixed>> */
    private function loadAnswers(int $userId, ?int $since): array
    {
        if ($since !== null) {
            $stmt = $this->db->prepare(
                'SELECT payload_json FROM answers
                 WHERE user_id = :user_id AND occurred_at >= :since
                 ORDER BY occurred_at ASC',
            );
            $stmt->execute(['user_id' => $userId, 'since' => $since]);
        } else {
            $stmt = $this->db->prepare(
                'SELECT payload_json FROM answers WHERE user_id = :user_id ORDER BY occurred_at ASC',
            );
            $stmt->execute(['user_id' => $userId]);
        }

        $items = [];
        while ($row = $stmt->fetch()) {
            $decoded = $this->decodeJson($row['payload_json']);
            if (is_array($decoded)) {
                $items[] = $decoded;
            }
        }
        return $items;
    }

    /** @return list<array<string, mixed>> */
    private function loadSessions(int $userId, ?int $since): array
    {
        if ($since !== null) {
            $stmt = $this->db->prepare(
                'SELECT payload_json FROM sessions
                 WHERE user_id = :user_id AND started_at >= :since
                 ORDER BY started_at ASC',
            );
            $stmt->execute(['user_id' => $userId, 'since' => $since]);
        } else {
            $stmt = $this->db->prepare(
                'SELECT payload_json FROM sessions WHERE user_id = :user_id ORDER BY started_at ASC',
            );
            $stmt->execute(['user_id' => $userId]);
        }

        $items = [];
        while ($row = $stmt->fetch()) {
            $decoded = $this->decodeJson($row['payload_json']);
            if (is_array($decoded)) {
                $items[] = $decoded;
            }
        }
        return $items;
    }

    private function decodeJson(mixed $value): mixed
    {
        if (is_array($value)) {
            return $value;
        }
        if (!is_string($value) || $value === '') {
            return new \stdClass();
        }
        return json_decode($value, true) ?? new \stdClass();
    }
}
