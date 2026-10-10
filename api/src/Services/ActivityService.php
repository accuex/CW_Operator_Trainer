<?php

declare(strict_types=1);
namespace Cwot\Api\Services;

use PDO;
use InvalidArgumentException;
use RuntimeException;

/** Opt-in public events. Never reads account email, answers or sync blobs. */
final class ActivityService
{
    public function __construct(private readonly PDO $db, private readonly array $catalog) {}

    private function owner(string $token): string
    {
        if (!preg_match('/^[a-f0-9]{64}$/D', $token)) throw new InvalidArgumentException('Invalid publisher token');
        return hash('sha256', $token);
    }

    public function rateLimit(string $ip, int $now, string $scope = 'write'): void
    {
        $window = $scope === 'write' ? 3600 : 60;
        $limit = $scope === 'write' ? 120 : ($scope === 'withdraw' ? 30 : 120);
        $bucket = hash('sha256', $scope . ':' . $ip . ':' . intdiv($now, $window));
        $sqlite = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite';
        $sql = $sqlite
            ? 'INSERT INTO activity_rate_limits (bucket,hits,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits = MIN(hits + 1, ' . ($limit + 1) . ')'
            : 'INSERT INTO activity_rate_limits (bucket,hits,expires_at) VALUES (?,1,?) ON DUPLICATE KEY UPDATE hits = LEAST(hits + 1, ' . ($limit + 1) . ')';
        $q = $this->db->prepare($sql); $q->execute([$bucket, $now + 2 * $window]);
        $q = $this->db->prepare('SELECT hits FROM activity_rate_limits WHERE bucket = ?'); $q->execute([$bucket]);
        if ((int)$q->fetchColumn() > $limit) throw new RuntimeException('rate_limited');
    }

    private function ensurePublisher(string $owner, int $now): void
    {
        $prefix = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
        $q = $this->db->prepare($prefix . ' INTO activity_publishers (token_hash,public_id,nickname,sharing,updated_at) VALUES (?,?,?,0,?)');
        $q->execute([$owner, bin2hex(random_bytes(12)), '', $now]);
    }

    public function consent(string $token): array
    {
        $q = $this->db->prepare('SELECT public_id,sharing,event_revision FROM activity_publishers WHERE token_hash = ?');
        $q->execute([$this->owner($token)]); $r = $q->fetch();
        return ['publicId' => $r ? $r['public_id'] : null, 'sharing' => $r ? (bool)$r['sharing'] : false, 'revision' => $r ? (int)$r['event_revision'] : 0];
    }

    private function validateProfile(string $nickname, ?string $avatarId): void
    {
        if (mb_strlen($nickname) > 24 || preg_match('/[\p{C}<>]/u', $nickname)) throw new InvalidArgumentException('ニックネームは24文字以内の一行で入力してください');
        if ($avatarId !== null && !in_array($avatarId, $this->catalog['avatars'], true)) throw new InvalidArgumentException('Invalid avatar');
    }

    public function settings(string $token, bool $sharing, string $nickname, ?string $avatarId, int $now, ?int $revision = null): array
    {
        $owner = $this->owner($token);
        $this->validateProfile(trim($nickname), $avatarId);
        if ($sharing && $revision === null) throw new RuntimeException('consent_conflict');
        $this->db->beginTransaction();
        try {
            // OFF creates a tombstone even if a delayed first ON has not arrived.
            $this->ensurePublisher($owner, $now);
            if ($sharing) {
                $q = $this->db->prepare('UPDATE activity_publishers SET sharing = 1, nickname = ?, avatar_id = ?, updated_at = ?, event_revision = event_revision + 1 WHERE token_hash = ? AND event_revision = ?');
                $q->execute([trim($nickname), $avatarId, $now, $owner, $revision]);
                if ($q->rowCount() !== 1) throw new RuntimeException('consent_conflict');
            } else {
                $q = $this->db->prepare("UPDATE activity_publishers SET sharing = 0, nickname = '', avatar_id = NULL, started_at = 0, updated_at = ?, event_revision = event_revision + 1 WHERE token_hash = ?");
                $q->execute([$now, $owner]);
                $q = $this->db->prepare('DELETE FROM activity_events WHERE publisher_hash = ?'); $q->execute([$owner]);
            }
            $this->db->commit();
            return $this->consent($token);
        } catch (\Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }

    public function profile(string $token, string $nickname, ?string $avatarId, int $now): array
    {
        $this->validateProfile(trim($nickname), $avatarId);
        // A profile update can never grant consent or modify an OFF tombstone.
        $q = $this->db->prepare('UPDATE activity_publishers SET nickname = ?, avatar_id = ?, updated_at = ? WHERE token_hash = ? AND sharing = 1');
        $q->execute([trim($nickname), $avatarId, $now, $this->owner($token)]);
        return $this->consent($token);
    }

    public function cleanup(int $now): void
    {
        $prefix = $this->db->getAttribute(PDO::ATTR_DRIVER_NAME) === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
        $q = $this->db->prepare($prefix . ' INTO activity_rate_limits (bucket,hits,expires_at) VALUES (?,1,?)');
        $q->execute([hash('sha256', 'cleanup:' . intdiv($now,3600)), $now + 7200]);
        if ($q->rowCount() !== 1) return;
        $q = $this->db->prepare('DELETE FROM activity_events WHERE created_at < ?'); $q->execute([$now - 30 * 86400]);
        // Keep only a non-public consent tombstone, so old ON requests stay invalid.
        $q = $this->db->prepare("UPDATE activity_publishers SET nickname = '', avatar_id = NULL, sharing = 0, started_at = 0, event_revision = event_revision + 1 WHERE updated_at < ? AND (sharing = 1 OR nickname <> '' OR avatar_id IS NOT NULL)");
        $q->execute([$now - 90 * 86400]);
        $q = $this->db->prepare('DELETE FROM activity_rate_limits WHERE expires_at < ?'); $q->execute([$now]);
    }

    public function publish(string $token, string $kind, string $detail, int $now): bool
    {
        $owner = $this->owner($token);
        $allowed = $kind === 'started' ? $this->catalog['subjects'] : ($kind === 'achievement' ? $this->catalog['achievements'] : []);
        if (!in_array($detail, $allowed, true)) throw new InvalidArgumentException('Invalid event');
        $this->db->beginTransaction();
        try {
            // Conditional update serializes concurrent publishes and consent changes.
            $sql = $kind === 'started'
                ? 'UPDATE activity_publishers SET event_revision = event_revision + 1, started_at = ?, updated_at = ? WHERE token_hash = ? AND sharing = 1 AND started_at <= ?'
                : 'UPDATE activity_publishers SET event_revision = event_revision + 1, updated_at = ? WHERE token_hash = ? AND sharing = 1';
            $q = $this->db->prepare($sql);
            $q->execute($kind === 'started' ? [$now, $now, $owner, $now - 1800] : [$now, $owner]);
            if ($q->rowCount() === 0) { $this->db->commit(); return false; }
            $key = $kind === 'started' ? 'start:' . intdiv($now, 1800) : 'achievement:' . $detail;
            $q = $this->db->prepare('SELECT id FROM activity_events WHERE publisher_hash = ? AND event_key = ?'); $q->execute([$owner, $key]);
            if ($q->fetchColumn() !== false) { $this->db->commit(); return false; }
            $q = $this->db->prepare('INSERT INTO activity_events (id, publisher_hash, event_key, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)');
            $q->execute([bin2hex(random_bytes(16)), $owner, $key, $kind, $detail, $now]);
            $this->db->commit(); return true;
        } catch (\Throwable $e) { if ($this->db->inTransaction()) $this->db->rollBack(); throw $e; }
    }

    public function feed(int $now): array
    {
        $q = $this->db->prepare('SELECT e.id, e.kind, e.detail, e.created_at, p.public_id, p.nickname, p.avatar_id FROM activity_events e JOIN activity_publishers p ON p.token_hash = e.publisher_hash WHERE p.sharing = 1 AND e.created_at >= ? ORDER BY e.created_at DESC, e.id DESC LIMIT 100');
        $q->execute([$now - 30 * 86400]);
        return array_map(static fn(array $r) => [
            'id' => $r['id'], 'kind' => $r['kind'], 'detail' => $r['detail'], 'createdAt' => (int)$r['created_at'] * 1000,
            'publicId' => $r['public_id'], 'nickname' => $r['nickname'] ?: '学習者-' . $r['public_id'], 'avatarId' => $r['avatar_id'],
        ], $q->fetchAll());
    }
}
