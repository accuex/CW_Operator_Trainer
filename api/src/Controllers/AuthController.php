<?php

declare(strict_types=1);

namespace Cwot\Api\Controllers;

use Cwot\Api\Http\JsonResponse;
use Cwot\Api\Http\RequestBody;
use Cwot\Api\Services\JwtService;
use PDO;
use PDOException;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use RuntimeException;

final class AuthController
{
    public function __construct(
        private readonly PDO $db,
        private readonly JwtService $jwt,
    ) {
    }

    public function register(Request $request, Response $response): Response
    {
        $body = RequestBody::json($request);
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');

        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return JsonResponse::error($response, 'validation_error', 'Valid email is required', 422);
        }
        if (strlen($password) < 8) {
            return JsonResponse::error($response, 'validation_error', 'Password must be at least 8 characters', 422);
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        try {
            $this->db->beginTransaction();
            $insert = $this->db->prepare('INSERT INTO users (email, password_hash) VALUES (:email, :hash)');
            $insert->execute(['email' => $email, 'hash' => $hash]);
            $userId = (int) $this->db->lastInsertId();

            $blob = $this->db->prepare(
                'INSERT INTO user_blobs (user_id, profile_json, settings_json, schema_version, revision)
                 VALUES (:user_id, :profile, :settings, 1, 1)',
            );
            $blob->execute([
                'user_id' => $userId,
                'profile' => '{}',
                'settings' => '{}',
            ]);
            $this->db->commit();
        } catch (PDOException $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            if ((int) ($error->errorInfo[1] ?? 0) === 1062) {
                return JsonResponse::error($response, 'conflict', 'Email already registered', 409);
            }
            throw $error;
        }

        $tokens = $this->jwt->issuePair($userId, $email);
        return JsonResponse::write($response, [
            'user' => ['id' => $userId, 'email' => $email],
            ...$tokens,
        ], 201);
    }

    public function login(Request $request, Response $response): Response
    {
        $body = RequestBody::json($request);
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        $password = (string) ($body['password'] ?? '');

        $stmt = $this->db->prepare('SELECT id, email, password_hash FROM users WHERE email = :email LIMIT 1');
        $stmt->execute(['email' => $email]);
        $row = $stmt->fetch();
        if (!$row || !password_verify($password, (string) $row['password_hash'])) {
            return JsonResponse::error($response, 'unauthorized', 'Invalid email or password', 401);
        }

        $userId = (int) $row['id'];
        $tokens = $this->jwt->issuePair($userId, (string) $row['email']);
        return JsonResponse::write($response, [
            'user' => ['id' => $userId, 'email' => (string) $row['email']],
            ...$tokens,
        ]);
    }

    public function refresh(Request $request, Response $response): Response
    {
        $body = RequestBody::json($request);
        $refreshToken = (string) ($body['refreshToken'] ?? '');
        if ($refreshToken === '') {
            return JsonResponse::error($response, 'validation_error', 'refreshToken is required', 422);
        }

        try {
            $claims = $this->jwt->parse($refreshToken, 'refresh');
        } catch (RuntimeException) {
            return JsonResponse::error($response, 'unauthorized', 'Invalid or expired refresh token', 401);
        }

        $stmt = $this->db->prepare('SELECT id, email FROM users WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $claims['userId']]);
        $row = $stmt->fetch();
        if (!$row) {
            return JsonResponse::error($response, 'unauthorized', 'User not found', 401);
        }

        $tokens = $this->jwt->issuePair((int) $row['id'], (string) $row['email']);
        return JsonResponse::write($response, [
            'user' => ['id' => (int) $row['id'], 'email' => (string) $row['email']],
            ...$tokens,
        ]);
    }
}
