<?php
// Isolated in-memory DB; no production API, credentials or real users involved.
declare(strict_types=1);
require dirname(__DIR__) . '/vendor/autoload.php';
use Cwot\Api\Services\ActivityService;
$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC]);
$db->exec('CREATE TABLE activity_publishers (token_hash TEXT PRIMARY KEY, public_id TEXT UNIQUE, nickname TEXT, avatar_id TEXT, sharing INTEGER, started_at INTEGER DEFAULT 0, event_revision INTEGER DEFAULT 0, updated_at INTEGER)');
$db->exec('CREATE TABLE activity_events (id TEXT PRIMARY KEY, publisher_hash TEXT, event_key TEXT, kind TEXT, detail TEXT, created_at INTEGER, UNIQUE(publisher_hash, event_key))');
$db->exec('CREATE TABLE activity_rate_limits (bucket TEXT PRIMARY KEY, hits INTEGER DEFAULT 0, expires_at INTEGER)');
$catalog = json_decode(file_get_contents(dirname(__DIR__) . '/data/activity-catalog.json'), true);
$service = new ActivityService($db, $catalog);
function check(bool $ok, string $label): void { if (!$ok) throw new RuntimeException($label); echo "PASS $label\n"; }
$token = str_repeat('a', 64); $other = str_repeat('b', 64); $now = 1791600000;
check(!$service->publish($token, 'started', 'learn', $now), 'no opt-in, no public event');
$result = $service->settings($token, true, '', 'miori-radio', $now, 0);
check(strlen($result['publicId']) === 24, 'anonymous unique public ID');
check($service->publish($token, 'started', 'learn', $now), 'opted-in start accepted');
check(!$service->publish($token, 'started', 'train', $now + 1), 'start cooldown');
check($service->publish($token, 'achievement', 'latin-starter', $now), 'achievement in same second as start is retained');
check($service->publish($token, 'achievement', 'koch-awakening', $now), 'multiple new achievements retained');
check(!$service->publish($token, 'achievement', 'latin-starter', $now + 1), 'achievement deduplicated');
check(!$service->publish($other, 'started', 'train', $now), 'another token cannot use publisher');
$feed = $service->feed($now);
check(count($feed) === 3 && $feed[0]['nickname'] === '学習者-' . $result['publicId'], 'feed uses fallback ID');
check(!str_contains(json_encode($feed), $token) && !str_contains(json_encode($feed), 'token_hash'), 'feed contains no publisher secret');
$service->settings($token, true, 'みおり好き', 'penguin', $now + 2, $service->consent($token)['revision']);
check($service->feed($now)[0]['nickname'] === 'みおり好き' && $service->feed($now)[0]['avatarId'] === 'penguin', 'name and avatar update existing feed');
try { $service->publish($token, 'achievement', 'invented', $now); throw new RuntimeException('invalid accepted'); } catch (InvalidArgumentException $e) { check(true, 'unknown achievements rejected'); }
try { $service->settings($token, true, str_repeat('あ', 25), null, $now, 0); throw new RuntimeException('invalid accepted'); } catch (InvalidArgumentException $e) { check(true, 'name length validated'); }
$service->settings($other, true, '仲間', null, $now, 0);
$service->publish($other, 'started', 'houki', $now);
$service->settings($token, false, '', null, $now + 3);
check(count($service->feed($now)) === 1 && $service->feed($now)[0]['nickname'] === '仲間', 'opt-out removes only own events');
check(!$service->publish($token, 'achievement', 'latin-master', $now + 4), 'no publish after opt-out');
check(count($service->feed($now + 31 * 86400)) === 0, 'retention expires after 30 days');
for ($i = 0; $i < 120; $i++) $service->rateLimit('test-ip', $now);
try { $service->rateLimit('test-ip', $now); throw new LogicException('rate limit missing'); } catch (RuntimeException $e) { check($e->getMessage() === 'rate_limited', 'write rate limit'); }

$stale = $service->consent($token)['revision'];
$service->settings($token, false, '', null, $now + 5);
try { $service->settings($token, true, '古いON', null, $now + 6, $stale); throw new LogicException('stale consent accepted'); } catch (RuntimeException $e) { check($e->getMessage() === 'consent_conflict', 'stale ON rejected after OFF'); }
$service->profile($token, '古い名前', 'penguin', $now + 7);
check(!$service->consent($token)['sharing'] && !$service->publish($token,'started','learn',$now+8), 'delayed avatar/profile cannot re-enable sharing');
$fresh = str_repeat('c',64);
$service->settings($fresh,false,'',null,$now);
try { $service->settings($fresh,true,'初回遅延',null,$now+1,0); throw new LogicException('first ON accepted'); } catch (RuntimeException $e) { check($e->getMessage() === 'consent_conflict','OFF before first ON retains tombstone'); }
$service->settings($fresh,true,'明示ON',null,$now+2,$service->consent($fresh)['revision']);
check($service->consent($fresh)['sharing'],'explicit new ON with fresh revision accepted');
try { $service->settings($fresh,true,'旧クライアント',null,$now+3); throw new LogicException('legacy ON accepted'); } catch (RuntimeException $e) { check($e->getMessage()==='consent_conflict','legacy unversioned ON rejected'); }
$service->profile($other,'他人は無変更',null,$now);
check($service->consent($token)['sharing']===false,'profile update cannot change another owner consent');
for ($i=0;$i<120;$i++) $service->rateLimit('read-test',$now,'read');
try { $service->rateLimit('read-test',$now,'read'); throw new LogicException('read limit missing'); } catch (RuntimeException $e) { check($e->getMessage()==='rate_limited','read requests limited independently'); }
$service->rateLimit('test-ip',$now,'withdraw'); check(true,'withdrawal has separate budget after write budget exhausted');
$before = $db->query('SELECT COUNT(*) FROM activity_events')->fetchColumn();
$service->feed($now + 91*86400);
check($db->query('SELECT COUNT(*) FROM activity_events')->fetchColumn()===$before,'GET feed does not delete expired events');
$service->cleanup($now + 91*86400);
check((int)$db->query('SELECT COUNT(*) FROM activity_events')->fetchColumn()===0,'maintenance expires stored events');
check((int)$db->query("SELECT COUNT(*) FROM activity_publishers WHERE nickname <> '' OR avatar_id IS NOT NULL OR sharing = 1")->fetchColumn()===0,'inactive publisher identifying profile cleared');
check($service->consent($fresh)['revision']>0 && !$service->consent($fresh)['sharing'],'cleanup preserves OFF revision tombstone');
