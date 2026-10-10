<?php
// Pure runner tests using a PDO test double; never opens a database connection.
declare(strict_types=1);
require dirname(__DIR__) . '/vendor/autoload.php';
use Cwot\Api\Services\MigrationRunner;
final class TestStatement extends PDOStatement
{
    public function __construct(private mixed $result, private mixed $onExecute = null) {}
    public function fetchColumn(int $column = 0): mixed { return $this->result; }
    public function fetchAll(int $mode = PDO::FETCH_DEFAULT, mixed ...$args): array { return $this->result; }
    public function execute(?array $params = null): bool { if ($this->onExecute) ($this->onExecute)($params); return true; }
}
final class TestDatabase extends PDO
{
    public array $history = [];
    public array $ddl = [];
    public bool $exists = false;
    public bool $released = false;
    public function __construct() {}
    public function query(string $query, ?int $fetchMode = null, mixed ...$fetchModeArgs): PDOStatement|false {
        if (str_contains($query, 'information_schema.tables')) return new TestStatement($this->exists ? 1 : 0);
        if (str_contains($query, 'GET_LOCK')) return new TestStatement(1);
        if (str_contains($query, 'RELEASE_LOCK')) { $this->released = true; return new TestStatement(1); }
        if (str_starts_with($query, 'SELECT migration_id')) return new TestStatement($this->history);
        throw new RuntimeException('Unexpected query in test');
    }
    public function exec(string $statement): int|false {
        $this->ddl[] = $statement;
        if (str_contains($statement, 'CREATE TABLE IF NOT EXISTS cwot_schema_migrations')) $this->exists = true;
        return 0;
    }
    public function prepare(string $query, array $options = []): PDOStatement|false {
        return new TestStatement(null, function ($params) { $this->history[$params[0]] = $params[1]; });
    }
}
function ensure(bool $value, string $label): void { if (!$value) throw new RuntimeException($label); echo 'PASS ' . $label . PHP_EOL; }
$path = dirname(__DIR__) . '/sql';
$db = new TestDatabase(); $runner = new MigrationRunner($db); $logs = [];
$log = function ($text) use (&$logs) { $logs[] = $text; };
$runner->run($path, true, $log);
ensure(count($db->ddl) === 0 && count($db->history) === 0, 'dry-run changes neither schema nor history');
ensure(count($logs) === 4, 'four pending migration records');
$runner->run($path, false, $log);
ensure(count($db->history) === 4 && $db->released, 'registered migrations applied and lock released');
$count = count($db->ddl);
$runner->run($path, false, $log);
ensure(count($db->ddl) === $count + 1 && count($db->history) === 4, 'second run skips all applied SQL');
$db->history['004_activity'] = str_repeat('0', 64);
$count = count($db->ddl);
try { $runner->run($path, false, $log); throw new LogicException('modified migration accepted'); }
catch (RuntimeException $e) { ensure(str_contains($e->getMessage(), 'modified') && count($db->ddl) === $count, 'hash mismatch stops before DDL'); }
try { MigrationRunner::statements('DROP TABLE users;'); throw new LogicException('destructive SQL accepted'); }
catch (RuntimeException $e) { ensure(true, 'unsupported destructive SQL rejected'); }
