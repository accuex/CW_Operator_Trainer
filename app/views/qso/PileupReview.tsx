'use client';

import type { PileupCause, PileupCrowd } from '@/lib/types';
import { pileupLevel } from '@/lib/radio/modes/pileupLevels';
import type { GoneReason } from '@/lib/radio/agents/types';
import { TIER_LABEL, badgeById } from '@/lib/radio/badges';
import { describeMove, type Axis } from '@/lib/radio/difficulty';
import type { MistakeNote, PileupMistake } from '@/lib/radio/pileup/analysis';
import { Icon } from '@/app/components/icons';
import { fitting, nextPractice, pickGroups, responderRole, reviewStats, type DeskStep, type GroupOutcome, type PickGroup, type ResponderRole } from '@/lib/radio/pileup/review';
import type { PileupReviewData } from './PileupDesk';
import { decodeNote } from '@/lib/radio/decode/assist';

/**
 * After QRT: the answers. Each pick shows what we sent, who was really calling then,
 * who fit each partial and who answered — how we narrowed the pile against the truth.
 */

const OUTCOME: Record<GroupOutcome, string> = {
  complete: '完了',
  'no-closing': 'TU 前に終了',
  incomplete: '交換が途中',
  bust: 'BUST（コール違い）',
  dropped: '途中で離脱',
  nothing: '—',
};

const ROLE: Record<ResponderRole, string> = {
  match: '一致',
  partner: '相手',
  near: '似たコール',
  off: '無関係（lid）',
  call: '呼出',
};

const GONE: Record<GoneReason, string> = {
  patience: '待ちきれず QRT',
  waited: '長く待って離脱',
  timeout: '応答がなく離脱',
  dropped: '交信が途切れた',
  'ignored-correction': '訂正が届かず離脱',
  'never-called': '呼ぶ前に離脱',
  b4: '交信済み（QSO B4）',
};

export const CAUSE_LABEL: Record<PileupCause, string> = {
  reception: '受信（聞き違い）',
  overlap: '重なり',
  weak: '弱い信号',
  environment: 'QRM・QSB・QRN',
  doubling: 'ダブり',
  similar: '似たコール',
  interference: 'eager / lid の割り込み',
  procedure: '手順・タイミング',
  logging: 'ログ',
};
const CAUSE_ORDER: PileupCause[] = ['reception', 'overlap', 'weak', 'environment', 'similar', 'interference', 'doubling', 'procedure', 'logging'];

const NOTE: Record<MistakeNote, string> = {
  'first-call': '最初に送ったコールが違った',
  bust: 'BUST（違うコールのまま記入）',
  nil: 'NIL',
  doubled: '相手が送信中で届かなかった',
  dupe: '重複記入',
  report: 'RST の記入違い',
  'no-closing': 'TU を送らずに終了',
  unlogged: '交信したが記入なし',
  dropped: '割り込みで選局を断念',
};

export const CROWD_LABEL: Record<PileupCrowd, string> = { '1': '1 局だけ', '2': '2 局', '3+': '3 局以上' };

const signed = (hz: number) => `${hz > 0 ? '+' : ''}${hz} Hz`;
const pct = (value: number | null) => (value === null ? '—' : `${Math.round(value * 100)}%`);

export function PileupReview({ review, auto, onRestart, onClose }: { review: PileupReviewData; auto: boolean; onRestart?: () => void; onClose?: () => void }) {
  const { result, steps, level, analysis, saved, stored } = review;
  const moves = (Object.entries(saved?.moved ?? {}) as [Axis, number][]).map(([axis, delta]) => describeMove(axis, delta));
  const groups = pickGroups(steps, result);
  const stats = reviewStats(groups, result);
  const shown = groups.filter((group) => group.outcome !== 'nothing');
  const overlapped = steps.filter((step) => step.responders.length >= 2);
  const unlogged = result.log.filter((entry) => entry.verdict !== 'ok');

  return (
    <div className="panel panel-pad run-review pileup-review">
      <div className="qso-panel-head">
        <h2>{stored ? `パイルアップの記録（${pileupLevel(level).label}・${new Date(stored.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）` : `振り返り（パイルアップ・${pileupLevel(level).label}）`}</h2>
        {onRestart && <button type="button" className="btn btn-primary btn-sm" onClick={onRestart}>新しいラン</button>}
        {onClose && <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>一覧に戻る</button>}
      </div>

      {saved?.assist && <p className="qso-note decode-note">{decodeNote(saved.assist)}</p>}
      {saved && saved.earned.length > 0 && (
        <div className="qso-review-earned" role="status">
          {saved.earned.map(({ id, tier }) => (
            <span key={id} className={`qso-badge-chip tier-${tier}`}><Icon name="trophy" size={14} />{badgeById(id)?.title} {TIER_LABEL[tier]}</span>
          ))}
        </div>
      )}

      <dl className="run-numbers">
        <div><dt>交信</dt><dd>{stats.contacts}</dd></div>
        <div><dt>レート</dt><dd>{Math.round(stats.rate)}<small>/h</small></dd></div>
        <div><dt>BUST / NIL</dt><dd>{stats.busts} / {stats.nil}</dd></div>
        <div><dt>選局</dt><dd>{stats.picks}</dd></div>
        <div><dt>選局までの手数</dt><dd>{stats.movesPerPick === null ? '—' : stats.movesPerPick.toFixed(1)}</dd></div>
        <div><dt>選局までの時間</dt><dd>{stats.secondsToPick === null ? '—' : Math.round(stats.secondsToPick)}<small> 秒</small></dd></div>
        <div><dt>partial を使った選局</dt><dd>{pct(stats.partialShare)}</dd></div>
        <div><dt>乗っ取り</dt><dd>{stats.hijacks}</dd></div>
        <div><dt>ダブりで届かなかったコール</dt><dd>{stats.doubledPicks}</dd></div>
      </dl>

      <p className="qso-hint pileup-advice"><b>次の練習：</b>{nextPractice(stats, level)}</p>

      {analysis && <Causes analysis={analysis} />}

      <h3 className="pileup-review-head">選局ごとのタイムライン</h3>
      {shown.length ? (
        <ol className="run-contacts pileup-groups">
          {shown.map((group, index) => <GroupItem key={index} group={group} logLine={(id) => result.log.find((entry) => entry.id === id)} />)}
        </ol>
      ) : <p className="qso-note">選局はありませんでした。</p>}

      {unlogged.length > 0 && (
        <div className="run-missed">
          <h3>ログの指摘</h3>
          <ul>{unlogged.map((entry) => <li key={entry.id}><b>{entry.fields.call}</b> {entry.fields.rst} — {entry.verdict === 'nil' ? 'NIL（その局とは交信していません）' : '重複'}</li>)}</ul>
        </div>
      )}

      <div className="run-missed">
        <h3>取りこぼした局 <small>{result.missed.length}</small></h3>
        {result.missed.length ? (
          <ul>
            {result.missed.map((caller) => {
              const db = Math.round(20 * Math.log10(Math.max(1e-6, caller.strength)));
              const notes = [db >= -6 ? '強い' : db <= -16 ? '弱い' : '', Math.abs(caller.offsetHz) >= 150 ? 'ずれていた' : '', caller.wpm >= 30 ? '速い' : ''].filter(Boolean);
              return (
                <li key={caller.stationId}>
                  <b>{caller.call}</b> {signed(caller.offsetHz)}・{db} dB・{caller.wpm} WPM・{caller.calls} 回呼出{notes.length ? `（${notes.join('・')}）` : ''} — {GONE[caller.reason]}
                </li>
              );
            })}
          </ul>
        ) : <p className="qso-note">呼んできた局は全部拾えました。</p>}
      </div>

      <div className="run-missed">
        <h3>重なり</h3>
        <p className="qso-note">
          応答が 2 局以上重なった送信：{overlapped.length} 回（うち partial {overlapped.filter((step) => step.kind === 'partial').length} 回）。
          誰にも当てはまらない partial {stats.emptyPartials} 回・複数局が当てはまる partial {stats.crowdedPartials} 回（partial 計 {stats.partials} 回）。
        </p>
      </div>

      <p className="qso-note">
        {stored ? '' : !saved ? '交信もログもなかったので、記録・調整はしていません。'
          : !auto ? '結果で自動調整はオフです。'
            : moves.length ? `次のランから: ${moves.join('、')}`
              : '難易度はそのまま（もう少し様子を見ます）。'}
        {' '}似たコール・割り込み・ダブり・記入ミスで落とした文字は、受信の苦手分析に入りません。
      </p>
      {onClose && <button type="button" className="btn btn-ghost btn-block" onClick={onClose}>記録の一覧に戻る</button>}
    </div>
  );
}

/** Why each miss happened, and first-call copy by how many answered at once. */
function Causes({ analysis }: { analysis: NonNullable<PileupReviewData['analysis']> }) {
  const { summary, copy, mistakes } = analysis;
  const counted = CAUSE_ORDER.filter((cause) => summary.causes[cause]);
  const rate = (tally?: { total: number; correct: number }) => (tally?.total ? `${Math.round((tally.correct / tally.total) * 100)}%（${tally.correct}/${tally.total}）` : '—');
  return (
    <div className="run-missed pileup-causes">
      <h3>ミスの原因</h3>
      {counted.length ? (
        <ul className="pileup-cause-list">
          {counted.map((cause) => <li key={cause}><b>{CAUSE_LABEL[cause]}</b> {summary.causes[cause]}</li>)}
        </ul>
      ) : <p className="qso-note">原因に分けるほどのミスはありませんでした。</p>}
      <dl className="run-numbers pileup-crowd">
        <div><dt>最初のコール（はっきり聞こえた）</dt><dd>{rate(copy)}</dd></div>
        {(['1', '2', '3+'] as const).map((crowd) => <div key={crowd}><dt>応答 {CROWD_LABEL[crowd]}</dt><dd>{rate(summary.firstCall[crowd])}</dd></div>)}
        <div><dt>似たコールがいた交信</dt><dd>{summary.similarMet ? `${summary.similarRight}/${summary.similarMet} 正しく` : '—'}</dd></div>
        <div><dt>partial からの絞り込み</dt><dd>{summary.narrowings ? `${summary.narrowed}/${summary.narrowings}` : '—'}</dd></div>
        <div><dt>eager / lid の応答</dt><dd>{summary.eager} / {summary.lid}</dd></div>
      </dl>
      {mistakes.length > 0 && (
        <details className="pileup-mistakes">
          <summary>ミスの一覧 {mistakes.length}</summary>
          <ol>{mistakes.map((mistake, index) => <li key={index}>{mistakeLine(mistake)}</li>)}</ol>
        </details>
      )}
    </div>
  );
}

function mistakeLine(mistake: PileupMistake) {
  const sent = mistake.sent ? `（${mistake.sent}）` : '';
  const other = mistake.with ? ` ← ${mistake.with} と取り違え` : '';
  return <><span className="chip">{CAUSE_LABEL[mistake.cause]}</span> <b>{mistake.call}</b>{sent} — {NOTE[mistake.note]}{other}</>;
}

function GroupItem({ group, logLine }: { group: PickGroup; logLine: (id: string) => { fields: { call: string; rst: string } } | undefined }) {
  const truth = group.contacts.map((contact) => contact.truth.call);
  const logged = group.contacts.flatMap((contact) => contact.logIds.map(logLine)).filter(Boolean);
  return (
    <li className={`outcome-${group.outcome}`}>
      <div className="run-contact-head">
        <b>{truth.length ? truth.join(' / ') : '—'}</b>
        <span className="chip">{OUTCOME[group.outcome]}</span>
        <small>
          {group.partials ? `partial ${group.partials} 回・` : ''}
          {group.toPick !== null ? `選局まで ${Math.round(group.toPick)} 秒` : ''}
          {logged.length ? `・ログ ${logged.map((entry) => `${entry!.fields.call} ${entry!.fields.rst}`).join(', ')}` : ''}
        </small>
      </div>
      <p className="pileup-chain">{group.steps.map((step) => step.text).join(' → ')}</p>
      <ol className="pileup-steps">
        {group.steps.map((step, index) => <StepItem key={index} step={step} before={group.steps.slice(0, index)} />)}
      </ol>
    </li>
  );
}

function StepItem({ step, before }: { step: DeskStep; before: readonly DeskStep[] }) {
  const fit = fitting(step);
  const fitIds = new Set(fit?.map((caller) => caller.id));
  return (
    <li>
      <div className="pileup-step-head">
        <code>{step.text}</code>
        {fit && <small>{fit.length ? `当てはまる局 ${fit.length}/${step.callers.length}: ${fit.map((caller) => caller.call).join(', ')}` : `当てはまる局なし（${step.callers.length} 局中）`}</small>}
      </div>
      {step.over && step.over.length > 0 && (
        <div className="pileup-responders pileup-over">
          重なり（この送信を聞けていません）：
          {step.over.map((tx) => (
            <span key={tx.id} className={`pileup-role ${tx.call === step.subject ? 'role-partner' : 'role-call'}`} title={tx.text}>
              {tx.call}<small>{tx.call === step.subject ? 'ダブり（呼んだ相手）' : 'ダブり'}</small>
            </span>
          ))}
        </div>
      )}
      {step.responders.length > 0 && (
        <div className="pileup-responders">
          応答：
          {step.responders.map((responder) => {
            const role = responderRole(step, responder.call, responder.id, before);
            const label = role === 'near' ? (step.kind === 'partial' ? '似たコール（eager）' : '似たコール（訂正か乗っ取り）') : ROLE[role];
            return <span key={responder.id} className={`pileup-role role-${role}`} title={responder.text}>{responder.call}<small>{label}</small></span>;
          })}
        </div>
      )}
      {step.callers.length > 0 && (
        <details className="pileup-callers">
          <summary>このとき呼んでいた局 {step.callers.length}</summary>
          <table>
            <thead><tr><th>コール</th><th>ずれ</th><th>強さ</th><th>WPM</th><th>送り方</th><th>癖</th></tr></thead>
            <tbody>
              {step.callers.map((caller) => (
                <tr key={caller.id} className={fitIds.has(caller.id) ? 'fit' : ''}>
                  <td><b>{caller.call}</b></td><td>{signed(caller.offsetHz)}</td><td>{caller.db} dB</td><td>{caller.wpm}</td><td>{caller.style}</td><td>{caller.traits.join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </li>
  );
}
