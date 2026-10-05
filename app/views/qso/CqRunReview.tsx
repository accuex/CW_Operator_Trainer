import type { CopySituation, QsoCause } from '@/lib/types';
import { formatFrequency } from '@/lib/radio/band';
import type { GoneReason } from '@/lib/radio/agents/types';
import { TIER_LABEL, badgeById } from '@/lib/radio/badges';
import { describeMove, type Axis, type CallTally } from '@/lib/radio/difficulty';
import type { ExchangePreset } from '@/lib/radio/exchange';
import { QRL_LISTEN, type ContactOutcome, type FrequencyUse, type MissedCaller, type RunResult } from '@/lib/radio/modes/cqRun';
import type { RunScore } from '@/lib/radio/runReview';
import { Icon } from '@/app/components/icons';
import { FieldCells, SITUATION_LABEL } from './FieldCells';
import type { RunSaved } from './CqRunDesk';

export interface RunReviewData {
  result: RunResult;
  score: RunScore;
  /** Receive filter at QRT, Hz (to say who was outside it). */
  filter: number;
  wpmOf: Record<number, number>;
  /** What storing it did (null: nothing was stored — no contact, no log). */
  saved: RunSaved | null;
  /** Opened from the device's records rather than just finished. */
  stored?: { at: number };
}

const CAUSE_LABEL: Record<Exclude<QsoCause, 'ok'>, string> = {
  copy: '受信ミス', environment: '悪条件', doubling: 'ダブり', tuning: '同調', timing: '聴き逃し',
};

/** "通常 8/9・QRM 1/2・ダブり 0/1" for a call tally, clean first. */
function tallyLine(tally: CallTally | undefined) {
  const entries = (Object.entries(tally ?? {}) as [CopySituation, { total: number; correct: number }][])
    .filter(([, bucket]) => bucket.total > 0)
    .sort(([a], [b]) => (a === 'clean' ? -1 : b === 'clean' ? 1 : 0));
  return entries.map(([situation, bucket]) => `${SITUATION_LABEL[situation]} ${bucket.correct}/${bucket.total}`).join('・');
}

const OUTCOME_LABEL: Record<ContactOutcome, string> = {
  complete: '完了', 'no-closing': '締めなし', incomplete: '未成立', bust: 'コール違い',
};
const GONE_LABEL: Record<GoneReason, string> = {
  patience: '呼び疲れて去った',
  waited: '待ちくたびれて去った',
  timeout: '応答がなく去った',
  dropped: '途中で去った',
  'ignored-correction': '訂正が通らず去った',
  'never-called': '呼ぶ前に去った',
};

const strengthLabel = (strength: number) => (strength < 0.18 ? '弱信号' : strength < 0.45 ? '中くらいの信号' : '強い信号');

export function missedLine(caller: MissedCaller, filter: number) {
  const offset = `${caller.offsetHz > 0 ? '+' : ''}${caller.offsetHz} Hz`;
  const outside = Math.abs(caller.offsetHz) > filter / 2 ? `（${filter} Hz フィルタの外）` : '';
  return `${strengthLabel(caller.strength)}・${caller.wpm} WPM・${offset}${outside}・${caller.calls} 回呼んで${GONE_LABEL[caller.reason]}`;
}

function frequencyLine(use: FrequencyUse) {
  const listened = use.qrlListen === null ? '' : use.qrlListen < QRL_LISTEN ? `（聴いたのは ${use.qrlListen.toFixed(1)} 秒）` : `（${Math.round(use.qrlListen)} 秒聴いて）`;
  const check = use.qrlFirst ? `QRL? で確かめて${listened}から CQ` : 'QRL? なしで CQ';
  const asked = use.qsyAsked ? `・QSY を ${use.qsyAsked} 回求められた` : '';
  return use.busyCqs ? `${check}・使用中に ${use.busyCqs} 回 CQ${asked}` : `${check}・空いていました${asked}`;
}

const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;

/** After QRT: the run's numbers, every contact character by character, and who we never picked up. */
export function CqRunReview({ review, preset, onRestart, onClose }: { review: RunReviewData; preset: ExchangePreset; onRestart?: () => void; onClose?: () => void }) {
  const { result, score, filter, wpmOf, saved, stored } = review;
  const { stats } = result;
  const { evidence } = score;
  const clean = evidence.clean.total ? Math.round((evidence.clean.correct / evidence.clean.total) * 100) : null;
  const breakdown: [string, number, string][] = [
    ['部分コール', stats.partials, ''],
    ['訂正された', stats.corrections, 'cause-copy'],
    ['コール違い', stats.busts, 'cause-copy'],
    ['NIL（交信していない局のログ）', stats.nil, 'cause-procedure'],
    ['ログ漏れ', stats.unlogged, 'cause-procedure'],
    ['重複ログ', stats.dupes, 'cause-procedure'],
    ['ダブり', stats.doublings, 'cause-doubling'],
    ['使用中の周波数で CQ', stats.busyCqs, 'cause-procedure'],
    ['QRL? のあと聴かずに CQ', stats.qrlNoListen, 'cause-procedure'],
    ['拾えなかった局', result.missed.length, 'cause-timing'],
  ];
  const good: [string, number][] = [
    [`QRL? のあと聴いて確かめてから CQ`, stats.frequencyChecks ?? 0],
    ['使用中と分かって CQ を控えた', stats.busyAvoided ?? 0],
  ];
  const causes = (Object.keys(CAUSE_LABEL) as (keyof typeof CAUSE_LABEL)[]).filter((cause) => (evidence.causes[cause] ?? 0) > 0);
  const moves = (Object.entries(saved?.moved ?? {}) as [Axis, number][]).map(([axis, delta]) => describeMove(axis, delta));
  const firstCalls = tallyLine(evidence.calls?.first);
  const loggedCalls = tallyLine(evidence.calls?.log);
  const nil = result.log.filter((entry) => entry.verdict === 'nil');
  const fieldsOf = (contactId: string) => score.contacts.find((item) => item.contactId === contactId)?.fields ?? null;
  const loggedCall = (contactId: string) => result.log.find((entry) => entry.contactId === contactId && entry.verdict === 'ok')?.fields.call;

  return (
    <div className="panel panel-pad qso-review run-review">
      <div className="qso-panel-head">
        <h2>{stored ? `ランの記録（${new Date(stored.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）` : 'ランの振り返り'}</h2>
        <small>{clean !== null ? `通常条件での受信 ${clean}%` : '通常条件の文字はありませんでした'}</small>
      </div>

      <dl className="run-numbers">
        <div><dt>交信</dt><dd>{stats.contacts}</dd></div>
        <div><dt>レート</dt><dd>{Math.round(stats.rate)}<small>/h</small></dd></div>
        <div><dt>時間</dt><dd>{formatDuration(stats.seconds)}</dd></div>
        <div><dt>初回コール正答</dt><dd>{stats.firstCallAccuracy === null ? '—' : `${Math.round(stats.firstCallAccuracy * 100)}%`}</dd></div>
      </dl>

      <div className="qso-review-causes">
        {breakdown.filter(([, count]) => count > 0).map(([label, count, tone]) => (
          <span key={label} className={`chip ${tone}`}>{label} {count}</span>
        ))}
        {breakdown.every(([, count]) => count === 0) && <span className="chip mint">ノーミス</span>}
        {good.filter(([, count]) => count > 0).map(([label, count]) => <span key={label} className="chip mint">{label} {count}</span>)}
      </div>

      {(causes.length > 0 || firstCalls || loggedCalls) && (
        <div className="run-copy">
          {causes.length > 0 && (
            <p><b>ログの文字ミスの原因</b>{causes.map((cause) => <span key={cause} className={`chip cause-${cause}`}>{CAUSE_LABEL[cause]} {evidence.causes[cause]}</span>)}</p>
          )}
          {firstCalls && <p><b>最初に送り返したコール</b>{firstCalls}</p>}
          {loggedCalls && <p><b>ログしたコール</b>{loggedCalls}</p>}
          <small>コールは、その字が受けた条件のうち一番きびしいもので分けています。通常条件のコールだけがコール取得スキルの本体で、QRM・ダブりなどのコールは別に記録します。</small>
        </div>
      )}

      {saved && (saved.earned.length > 0 || saved.marked.length > 0) && (
        <div className="qso-review-earned" role="status">
          {saved.earned.map(({ id, tier }) => (
            <span key={id} className={`qso-badge-chip tier-${tier}`}><Icon name="trophy" size={14} />{badgeById(id)?.title} {TIER_LABEL[tier]}</span>
          ))}
          {saved.marked.length > 0 && <span className="qso-badge-chip mark"><Icon name="bolt" size={14} />実戦マーク {saved.marked.join(' ')}</span>}
        </div>
      )}

      {result.contacts.length ? (
        <ol className="run-contacts">
          {result.contacts.map((contact) => {
            const fields = fieldsOf(contact.id);
            const logged = loggedCall(contact.id);
            const firstSent = contact.sentCalls[0];
            const first = score.contacts.find((item) => item.contactId === contact.id)?.firstCall;
            const firstNote = first && first.situation !== 'clean' ? `（${SITUATION_LABEL[first.situation]}）` : '';
            return (
              <li key={contact.id} className={`outcome-${contact.outcome}`}>
                <div className="run-contact-head">
                  <b>{contact.truth.call}</b>
                  <span className={`chip ${contact.outcome === 'complete' ? 'mint' : contact.outcome === 'bust' ? 'cause-copy' : ''}`}>{OUTCOME_LABEL[contact.outcome]}</span>
                  <small>
                    {wpmOf[contact.stationId] ? `${wpmOf[contact.stationId]} WPM` : ''}
                    {firstSent && firstSent !== contact.truth.call ? `・最初に ${firstSent} と送信${firstNote}` : ''}
                    {contact.doublings ? `・ダブり ${contact.doublings}` : ''}
                    {contact.partials ? `・部分コール ${contact.partials}` : ''}
                    {contact.asks ? `・聞き返し ${contact.asks}` : ''}
                  </small>
                </div>
                {fields ? (
                  <div className="qso-review-fields">
                    {fields.map((field) => (
                      <div key={field.key} className="qso-review-row">
                        <span>{field.label}</span>
                        <FieldCells field={field} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="qso-note">{contact.outcome === 'incomplete' ? '交換まで進みませんでした。' : `ログに記入されていません（${preset.fields.map((field) => field.label).join('・')}）。`}</p>
                )}
                {logged && logged !== contact.truth.call && !fields && <p className="qso-note">ログのコール: {logged}</p>}
              </li>
            );
          })}
        </ol>
      ) : <p className="qso-note">交信は成立しませんでした。CQ のあと、呼んでくる局のコールを聴き取って F2 で交換を送りましょう。</p>}

      {result.frequencies.length > 0 && (
        <div className="run-missed">
          <h3>周波数の確認</h3>
          <ul>{result.frequencies.map((use) => {
            const { main, sub } = formatFrequency(use.rf);
            return <li key={use.rf}><b>{main}.{sub}</b> — {frequencyLine(use)}</li>;
          })}</ul>
        </div>
      )}

      {nil.length > 0 && (
        <div className="run-missed">
          <h3>交信していない局のログ（NIL）</h3>
          <ul>{nil.map((entry) => <li key={entry.id}><b>{entry.fields.call}</b> — 該当する交信がありません</li>)}</ul>
        </div>
      )}

      {result.missed.length > 0 && (
        <div className="run-missed">
          <h3>拾えなかった局</h3>
          <ul>{result.missed.map((caller) => <li key={caller.stationId}><b>{caller.call}</b> — {missedLine(caller, filter)}</li>)}</ul>
        </div>
      )}

      <p className="qso-note">
        {stored ? '' : !saved ? '交信もログもなかったので、記録・調整はしていません。'
          : !saved.auto ? 'おまかせ調整はオフです。'
            : moves.length ? `次のランから: ${moves.join('、')}`
              : '難易度はそのまま（もう少し様子を見ます）。'}
        {' '}悪条件やダブりで落とした文字は苦手分析に入りません（分析画面のスイッチで表示できます）。
      </p>
      {onRestart && <button type="button" className="btn btn-success btn-block" onClick={onRestart}>もう一度 CQ を出す</button>}
      {onClose && <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>記録の一覧に戻る</button>}
    </div>
  );
}
