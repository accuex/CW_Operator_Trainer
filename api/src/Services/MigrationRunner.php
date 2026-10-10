<?php

declare(strict_types=1);
namespace Cwot\Api\Services;
use PDO;
use RuntimeException;

/** Ordered, immutable SQL migrations. MariaDB DDL is not transactional. */
final class MigrationRunner
{
    private const PLAN = ['001_base' => 'schema.sql', '002_passkeys' => 'schema_passkeys.sql', '003_auth_mail' => 'schema_auth_mail.sql', '004_activity' => 'schema_activity.sql'];
    public function __construct(private readonly PDO $db) {}

    public static function files(string $directory): array
    {
        $known = array_values(self::PLAN);
        $found = array_map('basename', glob($directory . '/*.sql') ?: []);
        if (array_diff($found, $known)) throw new RuntimeException('Unregistered SQL migration: add it explicitly to MigrationRunner::PLAN');
        $result = [];
        foreach (self::PLAN as $id => $name) {
            $path = $directory . '/' . $name;
            if (!is_file($path)) throw new RuntimeException('Missing migration: ' . $name);
            $text = file_get_contents($path);
            $result[$id] = ['name' => $name, 'hash' => hash('sha256', $text), 'sql' => $text];
        }
        return $result;
    }

    public static function statements(string $sql): array
    {
        // This initial set contains only simple CREATE TABLEs. Future complex SQL
        // (routines, delimiters, data patches) must not be split heuristically.
        $sql = preg_replace('/^\s*--[^\n]*$/m', '', $sql);
        $parts = array_values(array_filter(array_map('trim', explode(';', $sql)), static fn($s) => $s !== ''));
        foreach ($parts as $part) {
            if (!preg_match('/^CREATE TABLE IF NOT EXISTS\b/i', $part)) throw new RuntimeException('Unsupported SQL: initial migrations must be additive CREATE TABLE IF NOT EXISTS');
        }
        return $parts;
    }

    public function run(string $directory, bool $dryRun, callable $log): void
    {
        $plan = self::files($directory);
        // Preflight every file before any DDL.
        foreach ($plan as $item) self::statements($item['sql']);
        $exists = $this->db->query("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'cwot_schema_migrations'")->fetchColumn();
        $history = $exists ? $this->db->query('SELECT migration_id, source_hash FROM cwot_schema_migrations')->fetchAll(PDO::FETCH_KEY_PAIR) : [];
        foreach ($plan as $id => $item) if (isset($history[$id]) && $history[$id] !== $item['hash']) throw new RuntimeException('Applied migration was modified: ' . $item['name']);
        if ($dryRun) {
            foreach ($plan as $id => $item) $log((isset($history[$id]) ? 'APPLIED ' : 'PENDING ') . $id . ' ' . $item['name']);
            return;
        }
        $locked = $this->db->query("SELECT GET_LOCK('cwot_schema_migrations', 30)")->fetchColumn();
        if ((int)$locked !== 1) throw new RuntimeException('Could not acquire DB migration lock');
        try {
            $this->db->exec('CREATE TABLE IF NOT EXISTS cwot_schema_migrations (migration_id VARCHAR(80) PRIMARY KEY, source_hash CHAR(64) NOT NULL, applied_at VARCHAR(40) NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
            // Re-read after locking: another deploy may have finished meanwhile.
            $history = $this->db->query('SELECT migration_id, source_hash FROM cwot_schema_migrations')->fetchAll(PDO::FETCH_KEY_PAIR);
            foreach ($plan as $id => $item) {
                if (isset($history[$id])) {
                    if ($history[$id] !== $item['hash']) throw new RuntimeException('Applied migration was modified: ' . $item['name']);
                    $log('SKIP ' . $id); continue;
                }
                foreach (self::statements($item['sql']) as $statement) $this->db->exec($statement);
                $q = $this->db->prepare('INSERT INTO cwot_schema_migrations (migration_id, source_hash, applied_at) VALUES (?, ?, ?)');
                $q->execute([$id, $item['hash'], gmdate('c')]);
                $log('APPLIED ' . $id . ' ' . $item['name']);
            }
        } finally { $this->db->query("SELECT RELEASE_LOCK('cwot_schema_migrations')"); }
    }
}
