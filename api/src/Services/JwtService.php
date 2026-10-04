<?php

declare(strict_types=1);

namespace Cwot\Api\Services;

use Cwot\Api\Config;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use RuntimeException;
use Throwable;

final class JwtService
{
    public function __construct(private readonly Config $config)
    {
        if ($this->config->jwtSecret === '' || $this->config->jwtSecret === 'change-me-to-a-long-random-secret') {
            if ($this->config->appEnv !== 'local') {
                throw new RuntimeException('JWT_SECRET must be set for non-local environments');
            }
        }
    }

    /**
     * @return array{
     *   accessToken: string,
     *   refreshToken: string,
     *   tokenType: string,
     *   expiresIn: int,
     *   expiresAt: int
     * }
     */
    public function issuePair(int $userId, string $email): array
    {
        $now = time();
        $expiresAt = $now + $this->config->jwtAccessTtl;
        $access = $this->encode([
            'sub' => (string) $userId,
            'email' => $email,
            'typ' => 'access',
            'iat' => $now,
            'nbf' => $now,
            'exp' => $expiresAt,
            'iss' => $this->config->jwtIssuer,
        ]);
        $refresh = $this->encode([
            'sub' => (string) $userId,
            'email' => $email,
            'typ' => 'refresh',
            'iat' => $now,
            'nbf' => $now,
            'exp' => $now + $this->config->jwtRefreshTtl,
            'iss' => $this->config->jwtIssuer,
        ]);

        return [
            'accessToken' => $access,
            'refreshToken' => $refresh,
            'tokenType' => 'Bearer',
            'expiresIn' => $this->config->jwtAccessTtl,
            'expiresAt' => $expiresAt,
        ];
    }

    /** @return array{userId: int, email: string, typ: string} */
    public function parse(string $token, string $expectedType = 'access'): array
    {
        try {
            $decoded = JWT::decode($token, new Key($this->secret(), 'HS256'));
        } catch (Throwable $error) {
            throw new RuntimeException('Invalid token', 0, $error);
        }

        $typ = (string) ($decoded->typ ?? '');
        if ($typ !== $expectedType) {
            throw new RuntimeException('Unexpected token type');
        }
        if (($decoded->iss ?? '') !== $this->config->jwtIssuer) {
            throw new RuntimeException('Invalid token issuer');
        }

        $userId = (int) ($decoded->sub ?? 0);
        $email = (string) ($decoded->email ?? '');
        if ($userId <= 0 || $email === '') {
            throw new RuntimeException('Invalid token subject');
        }

        return [
            'userId' => $userId,
            'email' => $email,
            'typ' => $typ,
        ];
    }

    /** @param array<string, mixed> $payload */
    private function encode(array $payload): string
    {
        return JWT::encode($payload, $this->secret(), 'HS256');
    }

    private function secret(): string
    {
        $secret = $this->config->jwtSecret;
        return $secret !== '' ? $secret : 'local-dev-only-insecure-secret';
    }
}
