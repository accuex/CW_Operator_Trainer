<?php

declare(strict_types=1);

namespace Cwot\Api\Controllers;

use Cwot\Api\Config;
use Cwot\Api\Http\Base64Url;
use Cwot\Api\Http\JsonResponse;
use Cwot\Api\Http\RequestBody;
use Cwot\Api\Services\JwtService;
use lbuchs\WebAuthn\WebAuthn;
use lbuchs\WebAuthn\WebAuthnException;
use PDO;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use Throwable;

final class PasskeyController
{
    public function __construct(
        private readonly PDO $db,
        private readonly Config $config,
        private readonly JwtService $jwt,
    ) {
    }

    public function registerOptions(Request $request, Response $response): Response
    {
        $userId = (int) $request->getAttribute('userId');
        $email = (string) $request->getAttribute('userEmail');
        $webauthn = $this->webauthn();

        $exclude = [];
        foreach ($this->credentialsForUser($userId) as $row) {
            $exclude[] = Base64Url::decode((string) $row['credential_id_b64']);
        }

        $userHandle = pack('J', $userId);
        $args = $webauthn->getCreateArgs(
            $userHandle,
            $email,
            $email,
            60,
            true, // resident key for discoverable login
            'preferred',
            null,
            $exclude,
        );

        $challengeId = $this->storeChallenge('register', Base64Url::encode($webauthn->getChallenge()->getBinaryString()), $userId);

        return JsonResponse::write($response, [
            'challengeId' => $challengeId,
            'publicKey' => $args->publicKey,
        ]);
    }

    public function registerVerify(Request $request, Response $response): Response
    {
        $userId = (int) $request->getAttribute('userId');
        $body = RequestBody::json($request);
        $challengeId = (string) ($body['challengeId'] ?? '');
        $name = trim((string) ($body['name'] ?? 'Passkey'));
        if ($name === '') {
            $name = 'Passkey';
        }
        $credential = $body['credential'] ?? null;
        if (!is_array($credential)) {
            return JsonResponse::error($response, 'validation_error', 'credential is required', 422);
        }

        $challenge = $this->takeChallenge($challengeId, 'register', $userId);
        if ($challenge === null) {
            return JsonResponse::error($response, 'validation_error', 'Challenge expired or invalid', 422);
        }

        try {
            $clientDataJSON = Base64Url::decode((string) ($credential['response']['clientDataJSON'] ?? ''));
            $attestationObject = Base64Url::decode((string) ($credential['response']['attestationObject'] ?? ''));
            $webauthn = $this->webauthn();
            $data = $webauthn->processCreate(
                $clientDataJSON,
                $attestationObject,
                Base64Url::decode($challenge),
                false,
                true,
                false,
            );
        } catch (Throwable $error) {
            return JsonResponse::error($response, 'webauthn_error', $error->getMessage(), 400);
        }

        $credentialIdB64 = Base64Url::encode((string) $data->credentialId);
        $transports = $credential['response']['transports'] ?? ($credential['transports'] ?? []);
        $transportsJson = json_encode(is_array($transports) ? $transports : [], JSON_UNESCAPED_UNICODE);

        try {
            $insert = $this->db->prepare(
                'INSERT INTO webauthn_credentials
                  (user_id, credential_id_b64, public_key_pem, sign_count, transports_json, name)
                 VALUES
                  (:user_id, :credential_id_b64, :public_key_pem, :sign_count, :transports, :name)',
            );
            $insert->execute([
                'user_id' => $userId,
                'credential_id_b64' => $credentialIdB64,
                'public_key_pem' => (string) $data->credentialPublicKey,
                'sign_count' => (int) ($data->signatureCounter ?? 0),
                'transports' => $transportsJson ?: '[]',
                'name' => mb_substr($name, 0, 128),
            ]);
        } catch (Throwable) {
            return JsonResponse::error($response, 'conflict', 'Passkey already registered', 409);
        }

        return JsonResponse::write($response, [
            'ok' => true,
            'passkey' => [
                'id' => (int) $this->db->lastInsertId(),
                'name' => mb_substr($name, 0, 128),
                'createdAt' => gmdate('c'),
            ],
        ], 201);
    }

    public function loginOptions(Request $request, Response $response): Response
    {
        $body = RequestBody::json($request);
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $webauthn = $this->webauthn();

        $credentialIds = [];
        $userId = null;
        if ($email !== '') {
            $stmt = $this->db->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
            $stmt->execute(['email' => $email]);
            $user = $stmt->fetch();
            if ($user) {
                $userId = (int) $user['id'];
                foreach ($this->credentialsForUser($userId) as $row) {
                    $credentialIds[] = Base64Url::decode((string) $row['credential_id_b64']);
                }
            }
        }

        $args = $webauthn->getGetArgs($credentialIds, 60, true, true, true, true, true, 'preferred');
        $challengeId = $this->storeChallenge('login', Base64Url::encode($webauthn->getChallenge()->getBinaryString()), $userId);

        return JsonResponse::write($response, [
            'challengeId' => $challengeId,
            'publicKey' => $args->publicKey,
        ]);
    }

    public function loginVerify(Request $request, Response $response): Response
    {
        $body = RequestBody::json($request);
        $challengeId = (string) ($body['challengeId'] ?? '');
        $credential = $body['credential'] ?? null;
        if (!is_array($credential)) {
            return JsonResponse::error($response, 'validation_error', 'credential is required', 422);
        }

        $challengeRow = $this->takeChallengeRow($challengeId, 'login');
        if ($challengeRow === null) {
            return JsonResponse::error($response, 'validation_error', 'Challenge expired or invalid', 422);
        }

        $credentialIdB64 = (string) ($credential['id'] ?? '');
        if ($credentialIdB64 === '') {
            return JsonResponse::error($response, 'validation_error', 'credential.id is required', 422);
        }

        $stmt = $this->db->prepare(
            'SELECT c.*, u.email
             FROM webauthn_credentials c
             INNER JOIN users u ON u.id = c.user_id
             WHERE c.credential_id_b64 = :credential_id_b64
             LIMIT 1',
        );
        $stmt->execute(['credential_id_b64' => $credentialIdB64]);
        $row = $stmt->fetch();
        if (!$row) {
            return JsonResponse::error($response, 'unauthorized', 'Unknown passkey', 401);
        }

        if ($challengeRow['user_id'] !== null && (int) $challengeRow['user_id'] !== (int) $row['user_id']) {
            return JsonResponse::error($response, 'unauthorized', 'Passkey does not match challenge user', 401);
        }

        try {
            $clientDataJSON = Base64Url::decode((string) ($credential['response']['clientDataJSON'] ?? ''));
            $authenticatorData = Base64Url::decode((string) ($credential['response']['authenticatorData'] ?? ''));
            $signature = Base64Url::decode((string) ($credential['response']['signature'] ?? ''));
            $webauthn = $this->webauthn();
            $webauthn->processGet(
                $clientDataJSON,
                $authenticatorData,
                $signature,
                (string) $row['public_key_pem'],
                Base64Url::decode((string) $challengeRow['challenge_b64']),
                (int) $row['sign_count'],
                false,
                true,
            );
            $newCount = $webauthn->getSignatureCounter();
        } catch (WebAuthnException $error) {
            return JsonResponse::error($response, 'webauthn_error', $error->getMessage(), 401);
        } catch (Throwable $error) {
            return JsonResponse::error($response, 'webauthn_error', $error->getMessage(), 401);
        }

        $update = $this->db->prepare(
            'UPDATE webauthn_credentials
             SET sign_count = :sign_count, last_used_at = CURRENT_TIMESTAMP(3)
             WHERE id = :id',
        );
        $update->execute([
            'sign_count' => is_int($newCount) && $newCount > 0 ? $newCount : (int) $row['sign_count'],
            'id' => (int) $row['id'],
        ]);

        $userId = (int) $row['user_id'];
        $email = (string) $row['email'];
        $tokens = $this->jwt->issuePair($userId, $email);

        return JsonResponse::write($response, [
            'user' => ['id' => $userId, 'email' => $email],
            ...$tokens,
        ]);
    }

    public function listPasskeys(Request $request, Response $response): Response
    {
        $userId = (int) $request->getAttribute('userId');
        $items = [];
        foreach ($this->credentialsForUser($userId) as $row) {
            $items[] = [
                'id' => (int) $row['id'],
                'name' => (string) $row['name'],
                'createdAt' => (string) $row['created_at'],
                'lastUsedAt' => $row['last_used_at'],
            ];
        }
        return JsonResponse::write($response, ['items' => $items]);
    }

    public function deletePasskey(Request $request, Response $response, array $args): Response
    {
        $userId = (int) $request->getAttribute('userId');
        $id = (int) ($args['id'] ?? 0);
        if ($id <= 0) {
            return JsonResponse::error($response, 'validation_error', 'Invalid passkey id', 422);
        }
        $delete = $this->db->prepare('DELETE FROM webauthn_credentials WHERE id = :id AND user_id = :user_id');
        $delete->execute(['id' => $id, 'user_id' => $userId]);
        if ($delete->rowCount() === 0) {
            return JsonResponse::error($response, 'not_found', 'Passkey not found', 404);
        }
        return JsonResponse::write($response, ['ok' => true]);
    }

    public function me(Request $request, Response $response): Response
    {
        $userId = (int) $request->getAttribute('userId');
        $email = (string) $request->getAttribute('userEmail');
        $count = $this->db->prepare('SELECT COUNT(*) FROM webauthn_credentials WHERE user_id = :user_id');
        $count->execute(['user_id' => $userId]);
        return JsonResponse::write($response, [
            'user' => ['id' => $userId, 'email' => $email],
            'passkeyCount' => (int) $count->fetchColumn(),
        ]);
    }

    private function webauthn(): WebAuthn
    {
        return new WebAuthn(
            $this->config->webauthnRpName,
            $this->config->webauthnRpId,
            ['none', 'packed', 'apple', 'android-key'],
            true,
        );
    }

    /** @return list<array<string, mixed>> */
    private function credentialsForUser(int $userId): array
    {
        $stmt = $this->db->prepare(
            'SELECT id, credential_id_b64, name, created_at, last_used_at
             FROM webauthn_credentials
             WHERE user_id = :user_id
             ORDER BY created_at DESC',
        );
        $stmt->execute(['user_id' => $userId]);
        return $stmt->fetchAll() ?: [];
    }

    private function storeChallenge(string $purpose, string $challengeB64, ?int $userId): string
    {
        $this->db->exec('DELETE FROM webauthn_challenges WHERE expires_at < CURRENT_TIMESTAMP(3)');
        $id = bin2hex(random_bytes(16));
        $stmt = $this->db->prepare(
            'INSERT INTO webauthn_challenges (id, user_id, purpose, challenge_b64, expires_at)
             VALUES (:id, :user_id, :purpose, :challenge_b64, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 5 MINUTE))',
        );
        $stmt->execute([
            'id' => $id,
            'user_id' => $userId,
            'purpose' => $purpose,
            'challenge_b64' => $challengeB64,
        ]);
        return $id;
    }

    private function takeChallenge(string $id, string $purpose, int $userId): ?string
    {
        $row = $this->takeChallengeRow($id, $purpose);
        if ($row === null) {
            return null;
        }
        if ((int) $row['user_id'] !== $userId) {
            return null;
        }
        return (string) $row['challenge_b64'];
    }

    /** @return array<string, mixed>|null */
    private function takeChallengeRow(string $id, string $purpose): ?array
    {
        if ($id === '') {
            return null;
        }
        $stmt = $this->db->prepare(
            'SELECT id, user_id, challenge_b64
             FROM webauthn_challenges
             WHERE id = :id AND purpose = :purpose AND expires_at >= CURRENT_TIMESTAMP(3)
             LIMIT 1',
        );
        $stmt->execute(['id' => $id, 'purpose' => $purpose]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        $delete = $this->db->prepare('DELETE FROM webauthn_challenges WHERE id = :id');
        $delete->execute(['id' => $id]);
        return $row;
    }
}
