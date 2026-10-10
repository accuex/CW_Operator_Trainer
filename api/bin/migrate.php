#!/usr/bin/env php
<?php

declare(strict_types=1);
use Cwot\Api\Config;
use Cwot\Api\Database;
use Cwot\Api\Services\MigrationRunner;
use Dotenv\Dotenv;

$root = dirname(__DIR__);
require $root . '/vendor/autoload.php';
try {
    $options = array_slice($argv, 1);
    if (array_diff($options, ['--dry-run'])) throw new RuntimeException('Usage: php bin/migrate.php [--dry-run]');
    if (!is_readable($root . '/.env')) throw new RuntimeException('Existing server api/.env is required; defaults are not used for migrations');
    Dotenv::createImmutable($root)->load();
    foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'] as $key) {
        if (!array_key_exists($key, $_ENV) && !array_key_exists($key, $_SERVER)) throw new RuntimeException('Missing DB configuration: ' . $key);
    }
    $config = Config::fromEnv();
    echo 'Migration target DB: ' . $config->dbName . PHP_EOL;
    $runner = new MigrationRunner(Database::connection($config));
    $runner->run($root . '/sql', in_array('--dry-run', $options, true), static fn($text) => print($text . PHP_EOL));
} catch (Throwable $error) {
    // Do not expose DSNs, passwords or driver exceptions in deployment logs.
    $safePrefixes = ['Usage:', 'Missing migration:', 'Applied migration was modified:', 'Unregistered SQL migration:', 'Unsupported SQL:', 'Could not acquire DB migration lock', 'Existing server api/.env is required', 'Missing DB configuration:'];
    $message = 'Check configuration, schema and migration history on the server.';
    foreach ($safePrefixes as $prefix) if (str_starts_with($error->getMessage(), $prefix)) $message = $error->getMessage();
    fwrite(STDERR, 'Migration failed: ' . $message . PHP_EOL);
    exit(1);
}
