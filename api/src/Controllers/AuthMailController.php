<?php

declare(strict_types=1);

namespace Cwot\Api\Controllers;

use Cwot\Api\Config;
use Cwot\Api\Http\Base64Url;
use Cwot\Api\Http\JsonResponse;
use Cwot\Api\Http\RequestBody;
use Cwot\Api\Services\JwtService;
use Cwot\Api\Services\MailService;
use PDO;
use PDOException;
use Psr\Http\Message\ResponseInterface as Response;
use Psr\Http\Message\ServerRequestInterface as Request;
use RuntimeException;
use Throwable;

final class AuthMailController
{
    private const TOKEN_TTL_SECONDS = 3600;

    public function __construct(
        private readonly PDO $db,
        private readonly Config $config,
        private readonly MailService $mail,
        private readonly JwtService $jwt,
    ) {
    }

    /** Always 200 — does not reveal whether the email exists. */
    public function forgotPassword(Request $request, Response $response): Response
    {
        $body = RequestBody::json($request);
        $email = strtolower(trim((string) ($body['email'] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            return JsonResponse::error($response, 'validation_error', 'Valid email is required', 422);
        }

        $stmt = $this->db->prepare('SELECT id, email FROM users WHERE email = :email LIMIT 1');
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();
        if ($user) {
            try {
                $raw = $this->issueToken((int) $user['id'], 'password_reset', null);
                $url = $this->config->frontendUrl . '/account?reset=' . rawurlencode($raw);
                $this->mail->sendPasswordReset((string) $user['email'], $url);
            } catch (Throwable $error) {
                if ($this->config->debug) {
                    throw $error;
                }
                // Still return generic OK to avoid account enumeration via mail failures.
            }
        }

        return JsonResponse::write($response, [
            'ok' => true,
            'message' => 'If the account exists, a reset email has been sent.',
        ]);
    }

    public function resetPassword(Request $request, Response $response): Response
    {
        $body = RequestBody::json($request);
        $token = trim((string) ($body['token'] ?? ''));
        $password = (string) ($body['password'] ?? '');
        if ($token === '') {
            return JsonResponse::error($response, 'validation_error', 'token is required', 422);
        }
        if (strlen($password) < 8) {
            return JsonResponse::error($response, 'validation_error', 'Password must be at least 8 characters', 422);
        }

        $row = $this->consumeToken($token, 'password_reset');
        if ($row === null) {
            return JsonResponse::error($response, 'invalid_token', 'Reset link is invalid or expired', 400);
        }

        $hash = password_hash($password, PASSWORD_DEFAULT);
        $update = $this->db->prepare('UPDATE users SET password_hash = :hash WHERE id = :id');
        $update->execute(['hash' => $hash, 'id' => $row['user_id']]);

        return JsonResponse::write($response, ['ok' => true, 'message' => 'Password updated']);
    }

    /** Authenticated: request email change (confirm mail goes to the new address). */
    public function requestEmailChange(Request $request, Response $response): Response
    {
        $userId = (int) $request->getAttribute('userId');
        $body = RequestBody::json($request);
        $newEmail = strtolower(trim((string) ($body['newEmail'] ?? '')));
        $password = (string) ($body['password'] ?? '');

        if (!filter_var($newEmail, FILTER_VALIDATE_EMAIL)) {
            return JsonResponse::error($response, 'validation_error', 'Valid newEmail is required', 422);
        }
        if ($password === '') {
            return JsonResponse::error($response, 'validation_error', 'password is required', 422);
        }

        $stmt = $this->db->prepare('SELECT id, email, password_hash FROM users WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $userId]);
        $user = $stmt->fetch();
        if (!$user || !password_verify($password, (string) $user['password_hash'])) {
            return JsonResponse::error($response, 'unauthorized', 'Invalid password', 401);
        }

        $current = strtolower((string) $user['email']);
        if ($newEmail === $current) {
            return JsonResponse::error($response, 'validation_error', 'newEmail is the same as current email', 422);
        }

        $exists = $this->db->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
        $exists->execute(['email' => $newEmail]);
        if ($exists->fetch()) {
            return JsonResponse::error($response, 'conflict', 'Email already registered', 409);
        }

        try {
            $raw = $this->issueToken($userId, 'email_change', $newEmail);
            $url = $this->config->frontendUrl . '/account?emailConfirm=' . rawurlencode($raw);
            $this->mail->sendEmailChangeConfirm($newEmail, $url, $current);
        } catch (Throwable $error) {
            return JsonResponse::error(
                $response,
                'mail_error',
                $this->config->debug ? $error->getMessage() : 'Failed to send confirmation email',
                503,
            );
        }

        return JsonResponse::write($response, [
            'ok' => true,
            'message' => 'Confirmation email sent to the new address.',
        ]);
    }

    /** Public: confirm email change with token from mail. */
    public function confirmEmailChange(Request $request, Response $response): Response
    {
        $body = RequestBody::json($request);
        $token = trim((string) ($body['token'] ?? ''));
        if ($token === '') {
            return JsonResponse::error($response, 'validation_error', 'token is required', 422);
        }

        $row = $this->consumeToken($token, 'email_change');
        if ($row === null || empty($row['new_email'])) {
            return JsonResponse::error($response, 'invalid_token', 'Confirmation link is invalid or expired', 400);
        }

        $newEmail = strtolower((string) $row['new_email']);
        try {
            $update = $this->db->prepare('UPDATE users SET email = :email WHERE id = :id');
            $update->execute(['email' => $newEmail, 'id' => $row['user_id']]);
        } catch (PDOException $error) {
            if ((int) ($error->errorInfo[1] ?? 0) === 1062) {
                return JsonResponse::error($response, 'conflict', 'Email already registered', 409);
            }
            throw $error;
        }

        $tokens = $this->jwt->issuePair((int) $row['user_id'], $newEmail);
        return JsonResponse::write($response, [
            'ok' => true,
            'user' => ['id' => (int) $row['user_id'], 'email' => $newEmail],
            ...$tokens,
        ]);
    }

    private function issueToken(int $userId, string $purpose, ?string $newEmail): string
    {
        $this->db->prepare(
            'UPDATE auth_mail_tokens
             SET used_at = CURRENT_TIMESTAMP(3)
             WHERE user_id = :user_id AND purpose = :purpose AND used_at IS NULL',
        )->execute(['user_id' => $userId, 'purpose' => $purpose]);

        $raw = Base64Url::encode(random_bytes(32));
        $hash = hash('sha256', $raw);
        $expires = (new \DateTimeImmutable('now'))->modify('+' . self::TOKEN_TTL_SECONDS . ' seconds');

        $insert = $this->db->prepare(
            'INSERT INTO auth_mail_tokens (user_id, purpose, token_hash, new_email, expires_at)
             VALUES (:user_id, :purpose, :token_hash, :new_email, :expires_at)',
        );
        $insert->execute([
            'user_id' => $userId,
            'purpose' => $purpose,
            'token_hash' => $hash,
            'new_email' => $newEmail,
            'expires_at' => $expires->format('Y-m-d H:i:s.v'),
        ]);

        return $raw;
    }

    /** @return array{user_id:int,new_email:?string}|null */
    private function consumeToken(string $rawToken, string $purpose): ?array
    {
        $hash = hash('sha256', $rawToken);
        $this->db->beginTransaction();
        try {
            $stmt = $this->db->prepare(
                'SELECT id, user_id, new_email, expires_at, used_at
                 FROM auth_mail_tokens
                 WHERE token_hash = :hash AND purpose = :purpose
                 LIMIT 1
                 FOR UPDATE',
            );
            $stmt->execute(['hash' => $hash, 'purpose' => $purpose]);
            $row = $stmt->fetch();
            if (!$row || $row['used_at'] !== null) {
                $this->db->rollBack();
                return null;
            }
            $expires = new \DateTimeImmutable((string) $row['expires_at']);
            if ($expires < new \DateTimeImmutable('now')) {
                $this->db->rollBack();
                return null;
            }

            $mark = $this->db->prepare(
                'UPDATE auth_mail_tokens SET used_at = CURRENT_TIMESTAMP(3) WHERE id = :id AND used_at IS NULL',
            );
            $mark->execute(['id' => $row['id']]);
            if ($mark->rowCount() === 0) {
                $this->db->rollBack();
                return null;
            }
            $this->db->commit();
            return [
                'user_id' => (int) $row['user_id'],
                'new_email' => $row['new_email'] !== null ? (string) $row['new_email'] : null,
            ];
        } catch (Throwable $error) {
            if ($this->db->inTransaction()) {
                $this->db->rollBack();
            }
            throw $error instanceof RuntimeException ? $error : new RuntimeException($error->getMessage(), 0, $error);
        }
    }
}
