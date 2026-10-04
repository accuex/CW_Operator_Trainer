<?php

declare(strict_types=1);

namespace Cwot\Api;

final class Config
{
    public function __construct(
        public readonly string $appEnv,
        public readonly bool $debug,
        public readonly string $dbHost,
        public readonly int $dbPort,
        public readonly string $dbName,
        public readonly string $dbUser,
        public readonly string $dbPass,
        public readonly string $jwtSecret,
        public readonly string $jwtIssuer,
        public readonly int $jwtAccessTtl,
        public readonly int $jwtRefreshTtl,
        public readonly string $corsOrigin,
        public readonly string $webauthnRpId,
        public readonly string $webauthnRpName,
        public readonly string $webauthnOrigin,
        public readonly string $frontendUrl,
        public readonly string $mailFrom,
        public readonly string $mailFromName,
        public readonly string $smtpHost,
        public readonly int $smtpPort,
        public readonly string $smtpUser,
        public readonly string $smtpPass,
        public readonly string $smtpEncryption,
    ) {
    }

    public static function fromEnv(): self
    {
        return new self(
            appEnv: self::env('APP_ENV', 'local'),
            debug: filter_var(self::env('APP_DEBUG', '0'), FILTER_VALIDATE_BOOL),
            dbHost: self::env('DB_HOST', '127.0.0.1'),
            dbPort: (int) self::env('DB_PORT', '3306'),
            dbName: self::env('DB_NAME', 'cwot'),
            dbUser: self::env('DB_USER', 'cwot'),
            dbPass: self::env('DB_PASS', ''),
            jwtSecret: self::env('JWT_SECRET', ''),
            jwtIssuer: self::env('JWT_ISSUER', 'cwot-api'),
            jwtAccessTtl: (int) self::env('JWT_ACCESS_TTL', '3600'),
            jwtRefreshTtl: (int) self::env('JWT_REFRESH_TTL', '2592000'),
            corsOrigin: self::env('CORS_ORIGIN', '*'),
            webauthnRpId: self::env('WEBAUTHN_RP_ID', 'localhost'),
            webauthnRpName: self::env('WEBAUTHN_RP_NAME', 'CW Operator Trainer'),
            webauthnOrigin: self::env('WEBAUTHN_ORIGIN', 'http://localhost:3000'),
            frontendUrl: rtrim(self::env('FRONTEND_URL', self::env('WEBAUTHN_ORIGIN', 'http://localhost:3000')), '/'),
            mailFrom: self::env('MAIL_FROM', 'noreply@localhost'),
            mailFromName: self::env('MAIL_FROM_NAME', 'CW Operator Trainer'),
            smtpHost: self::envFirst(['SMTP_HOST', 'MAIL_HOST'], ''),
            smtpPort: (int) self::envFirst(['SMTP_PORT', 'MAIL_PORT'], '587'),
            smtpUser: self::envFirst(['SMTP_USER', 'MAIL_USERNAME'], ''),
            smtpPass: self::envFirst(['SMTP_PASS', 'MAIL_PASSWORD'], ''),
            smtpEncryption: strtolower(self::envFirst(['SMTP_ENCRYPTION', 'MAIL_ENCRYPTION'], 'tls')),
        );
    }

    public function dsn(): string
    {
        return sprintf(
            'mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4',
            $this->dbHost,
            $this->dbPort,
            $this->dbName,
        );
    }

    /** @param list<string> $keys */
    private static function envFirst(array $keys, string $default): string
    {
        foreach ($keys as $key) {
            if (self::hasEnv($key)) {
                return self::env($key, $default);
            }
        }
        return $default;
    }

    private static function hasEnv(string $key): bool
    {
        if (array_key_exists($key, $_ENV)) {
            return true;
        }
        if (array_key_exists($key, $_SERVER) && is_scalar($_SERVER[$key])) {
            return true;
        }
        return getenv($key) !== false;
    }

    /**
     * phpdotenv loads into $_ENV / $_SERVER; getenv() is often empty when putenv is disabled.
     */
    private static function env(string $key, string $default): string
    {
        if (array_key_exists($key, $_ENV)) {
            return (string) $_ENV[$key];
        }
        if (array_key_exists($key, $_SERVER) && is_scalar($_SERVER[$key])) {
            return (string) $_SERVER[$key];
        }
        $value = getenv($key);
        if ($value === false) {
            return $default;
        }
        return (string) $value;
    }
}
