'use client';

import type { ContestCause, ContestFailure } from '@/lib/types';
import { TIER_LABEL, badgeById } from '@/lib/radio/badges';
import { CONTEST_CAUSES, type CharSlip, type ContestAnalysis, type ContestMistake } from '@/lib/radio/contest/analysis';
import { contestLevel, type ContestLevelId } from '@/lib/radio/contest/levels';
import { describeMove, type Axis } from '@/lib/radio/difficulty';
import { Icon } from '@/app/components/icons';
import type { RunSaved } from './RunDesk';
import { ourNr } from '@/lib/radio/contest/esm';
import type { CheckVerdict } from '@/lib/radio/contest/log';
import { rateOver, type ContestReview as ContestReviewData, type LeftLine, type ReviewLine, type StoredRules, type TheirOnlyLine } from '@/lib/radio/contest/review';

/**
 * After QRT: our log checked against every station's. Nothing here is known on the
 * desk while we run — the desk has our own log only (DUPE, the claimed score); BUST,
 * NIL and the lines only they have come from the stations' logs.
 */

export const VERDICT_LABEL: Record<CheckVerdict, string> = {
  ok: '正しい', 'bust-call': 'BUST CALL', 'bust-nr': 'BUST NR', nil: 'NIL', dupe: 'DUPE',
};

const LEFT_LABEL: Record<LeftLine['reason'], string> = {
  patience: '待ちきれず QRT',
  waited: '長く待って離脱',
  timeout: '応答がなく離脱',
  dropped: '交信が途切れた',
  'ignored-correction': '訂正が届かず離脱',
  'never-called': '呼ぶ前に離脱',
  incomplete: '交換の前に終わった',
};

export const CONTEST_CAUSE_LABEL: Record<ContestCause, string> = {
  reception: '受信（聞き取り）',
  weak: '弱い信号',
  environment: 'QRM・QSB・QRN',
  overlap: '他局との重なり',
  doubling: 'ダブり（自局が重ねた）',
  similar: '似たコール',
  interference: '割り込み（eager / lid）',
  procedure: '手順・タイミング',
  logging: '記入ミス',
  dupe: 'DUPE の扱い',
  dropped: '交換後に記入せず',
};

const FAILURE_LABEL: Record<ContestFailure, string> = {
  'bust-call': 'BUST CALL',
  'bust-nr': 'BUST NR',
  'first-call': '最初に送ったコール違い（あとで訂正）',
  nil: 'NIL',
  dupe: 'DUPE を記入',
  dropped: '交換後に記入せず',
  unmatched: '自局ログに対応なし',
  doubled: 'ダブり',
  abandoned: '交換の前に終わった',
};

const ENV_LABEL = { qrm: 'QRM', qsb: 'QSB', qrn: 'QRN' } as const;

/** Copy causes: the ones that are the ear's (おまかせ and the weak-character analysis read only these). */
const COPY_CAUSES: ReadonlySet<ContestCause> = new Set(['reception', 'weak', 'environment', 'overlap']);

const penaltyText = (points: number) => (points ? `無効・${points} 点減` : '無効・減点なし');

/** Why a line got its verdict, in the log checker's words. */
function explain(line: ReviewLine, rules: StoredRules) {
  const their = line.their;
  switch (line.verdict) {
    case 'ok':
      return their?.station && line.theyBustedUs
        ? `一致。相手は自局の番号を ${their.copied === null ? '記入せず' : ourNr(their.copied)} と記入（相手側の誤り。自局の得点はそのまま）`
        : '相手のログにも同じ時間帯にあり、番号も一致';
    case 'bust-nr':
      return `相手が送った番号は ${their ? ourNr(their.sent) : '—'}。記入 ${line.nr || '（空）'} と違うため${penaltyText(rules.bustNrPenalty)}`;
    case 'bust-call':
      return `${line.call} はこの交信を記録していません。近いコール ${their?.station ?? ''} が記録しているのでコールの写し違い（${penaltyText(rules.bustCallPenalty)}）`;
    case 'nil':
      return `この時間帯に自局を記録した局がありません（Not In Log: ${penaltyText(rules.nilPenalty)}）`;
    case 'dupe':
      return `${line.call} は先に記入済み。重複は得点なし・減点なし${their ? '（相手もこの交信を記録）' : ''}`;
  }
}

function explainTheirs(line: TheirOnlyLine) {
  if (line.kind === 'dropped') {
    return `交換は成立（${line.exchange ? `自局は「${line.exchange}」を送り、` : ''}相手は ${ourNr(line.sent)} を送って記入）しましたが、自局は記入せずに次へ進みました。相手のログにだけ残るため、相手から見ると NIL。自局は 1 交信を失いましたが減点はありません`;
  }
  return `相手は自局を記録していますが、自局のログには対応する行がありません（${line.exchange ? `近いコールに「${line.exchange}」を送っています。` : ''}照合の時間内に対応する記入なし）。減点はありません`;
}

const clockOf = (seconds: number) => {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export interface ContestReviewProps {
  review: ContestReviewData;
  level: string;
  /** A stored record: when it was run. */
  stored?: { at: number };
  /** What storing it did (おまかせ, badges); null when nothing was saved. */
  saved?: RunSaved | null;
  /** The causes (null for a record saved before they were kept). */
  analysis?: ContestAnalysis | null;
  auto?: boolean;
  onRestart?: () => void;
  onClose?: () => void;
}

export function ContestReview({ review, level, stored, saved, analysis, auto, onRestart, onClose }: ContestReviewProps) {
  const moves = (Object.entries(saved?.moved ?? {}) as [Axis, number][]).map(([axis, delta]) => describeMove(axis, delta));
  const { counts, rates, rules } = review;
  const levelLabel = contestLevel(level as ContestLevelId)?.label ?? level;
  const peak = Math.max(1, ...rates.blocks.map((block) => block.logged));
  const firstMinutes = Math.min(5, rates.perMinute.logged.length);
  const split = review.seconds >= 600
    ? { first: rateOver(rates.perMinute.logged, 0, firstMinutes), rest: rateOver(rates.perMinute.logged, firstMinutes, rates.perMinute.logged.length) }
    : null;
  const dropped = review.theirOnly.filter((line) => line.kind === 'dropped').length;
  return (
    <div className="panel panel-pad contest-review">
      <div className="qso-panel-head">
        <h2>{stored ? `コンテストの記録（${levelLabel}・${new Date(stored.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}）` : `照合結果（${levelLabel}）`}</h2>
        <small>{rules.label}</small>
        {onClose && <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>一覧に戻る</button>}
      </div>
      <p className="qso-note">
        QRT 後に、自局のログを各局のログと突き合わせた結果です。運用中の画面に出ていたのは自局のログから分かること（DUPE・申告の得点）だけで、
        BUST・NIL・相手ログのみはここで初めて分かります。
      </p>

      {saved && saved.earned.length > 0 && (
        <div className="qso-review-earned" role="status">
          {saved.earned.map(({ id, tier }) => (
            <span key={id} className={`qso-badge-chip tier-${tier}`}><Icon name="trophy" size={14} />{badgeById(id)?.title} {TIER_LABEL[tier]}</span>
          ))}
        </div>
      )}

      <dl className="contest-hud contest-review-hud">
        <div><dt>時間</dt><dd>{clockOf(review.seconds)}</dd></div>
        <div><dt>QSO</dt><dd>{review.lines.length}</dd></div>
        <div><dt>RATE</dt><dd>{rates.average}<small>/h</small></dd></div>
        <div><dt>BEST</dt><dd>{rates.best}<small>/h</small></dd></div>
        <div><dt>申告</dt><dd>{review.claimed.total}<small> {review.claimed.qsos}×{review.claimed.mults}</small></dd></div>
        <div><dt>照合後</dt><dd>{review.checked.total}<small> {review.checked.points}×{review.checked.mults}</small></dd></div>
        <div><dt>MULT</dt><dd>{review.checked.mults}<small> / {review.claimed.mults}</small></dd></div>
        <div><dt>ダブり</dt><dd>{review.doublings.total}</dd></div>
      </dl>

      <ul className="contest-counts" aria-label="照合の内訳">
        {(['ok', 'bust-call', 'bust-nr', 'nil', 'dupe'] as CheckVerdict[]).map((verdict) => (
          <li key={verdict} className={`verdict-${verdict}`}><b>{counts[verdict]}</b>{VERDICT_LABEL[verdict]}</li>
        ))}
        <li className="their-only"><b>{review.theirOnly.length}</b>相手ログのみ</li>
        <li><b>{review.missed.length}</b>逃した局</li>
        <li><b>{review.abandoned.length}</b>交換前に終了</li>
      </ul>

      {rates.blocks.length > 0 && (
        <section className="contest-rate" aria-label="時間ごとのレート">
          <h3>時間ごとの交信 <small>{rates.block / 60} 分ごと・濃い色が照合で正しかった交信</small></h3>
          <ol className="contest-rate-bars">
            {rates.blocks.map((block) => (
              <li key={block.from} title={`${clockOf(block.from)}–${clockOf(block.to)}: 記入 ${block.logged}・正しい ${block.good}`}>
                <span className="bar" style={{ height: `${(block.logged / peak) * 100}%` }}>
                  <span className="good" style={{ height: block.logged ? `${(block.good / block.logged) * 100}%` : 0 }} />
                </span>
                <small>{block.logged}</small>
              </li>
            ))}
          </ol>
          {split && <p className="qso-note">最初の {firstMinutes} 分 {split.first}/h・それ以降 {split.rest}/h</p>}
        </section>
      )}

      {analysis ? <Causes analysis={analysis} /> : stored && <p className="qso-note">この記録は原因分類を保存する前のものです。</p>}

      <section aria-label="交信ごとの照合">
        <h3>交信ごとの照合 <small>自局ログ ⇔ 相手局ログ</small></h3>
        {review.lines.length ? (
          <ol className="contest-check">
            {review.lines.map((line) => (
              <li key={line.id} className={`verdict-${line.verdict}`}>
                <div className="contest-check-head">
                  <time>{clockOf(line.at)}</time>
                  <em>{VERDICT_LABEL[line.verdict]}</em>
                </div>
                <div className="contest-check-sides">
                  <div>
                    <span>自局ログ</span>
                    <b>{line.call}</b> {line.rst} <b>{line.nr || '—'}</b>
                    <small>送 {ourNr(line.sentNr)}</small>
                  </div>
                  <div>
                    <span>相手局ログ</span>
                    {line.their ? (
                      <>
                        <b className={line.their.station !== line.call ? 'diff' : ''}>{line.their.station}</b> 送 <b className={line.verdict === 'bust-nr' ? 'diff' : ''}>{ourNr(line.their.sent)}</b>
                        <small className={line.theyBustedUs ? 'diff' : ''}>受 {line.their.copied === null ? '—' : ourNr(line.their.copied)}</small>
                      </>
                    ) : <i>記録なし</i>}
                  </div>
                </div>
                <p>{explain(line, rules)}</p>
              </li>
            ))}
          </ol>
        ) : <p className="qso-note">記入した交信はありません。</p>}
      </section>

      {review.theirOnly.length > 0 && (
        <section aria-label="相手ログのみ">
          <h3>相手ログのみ <small>{review.theirOnly.length} 件{dropped ? `（うち交換後に記入せず ${dropped}）` : ''}</small></h3>
          <ol className="contest-check">
            {review.theirOnly.map((line, index) => (
              <li key={`${line.station}-${index}`} className="their-only">
                <div className="contest-check-head">
                  <time>{clockOf(line.at)}</time>
                  <em>{line.kind === 'dropped' ? '交換後に記入せず' : '自局ログに対応なし'}</em>
                </div>
                <div className="contest-check-sides">
                  <div><span>自局ログ</span><i>記入なし</i></div>
                  <div>
                    <span>相手局ログ</span>
                    <b>{line.station}</b> 送 <b>{ourNr(line.sent)}</b>
                    <small>受 {line.copied === null ? '—' : ourNr(line.copied)}</small>
                  </div>
                </div>
                <p>{explainTheirs(line)}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {(review.missed.length > 0 || review.abandoned.length > 0) && (
        <section aria-label="交信にならなかった局">
          <h3>交信にならなかった局</h3>
          <ul className="contest-left">
            {review.abandoned.map((line, index) => (
              <li key={`a-${index}`}><b>{line.call}</b> {LEFT_LABEL[line.reason]}<small>（自局がコールを送った回数 {line.calls}）</small></li>
            ))}
            {review.missed.map((line, index) => (
              <li key={`m-${index}`}><b>{line.call}</b> {LEFT_LABEL[line.reason]}<small>（呼んだ回数 {line.calls}）</small></li>
            ))}
          </ul>
        </section>
      )}

      {review.doublings.contacts.length > 0 && (
        <p className="qso-note">ダブり（自局と相手の送信が重なった）: {review.doublings.contacts.map((item) => `${item.call} ${item.count} 回`).join('・')}</p>
      )}

      {!stored && (
        <p className="qso-note">
          {saved ? 'この結果を保存しました。詳しい記録はこの端末に、クラウドには件数・得点・原因の件数の要約だけを残します。' : '交信もログもなかったので、記録・調整はしていません。'}
          {saved && (!auto ? ' おまかせ調整はオフです。' : moves.length ? ` 次のコンテストから: ${moves.join('、')}` : ' 難易度はそのまま（もう少し様子を見ます）。')}
        </p>
      )}
      {stored && moves.length > 0 && <p className="qso-note">このあとの調整: {moves.join('、')}</p>}
      <div className="run-control-row">
        {onRestart && <button type="button" className="btn btn-primary btn-sm" onClick={onRestart}>新しいコンテスト</button>}
        {onClose && <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>記録の一覧に戻る</button>}
      </div>
    </div>
  );
}

const pct = (tally: { total: number; correct: number }) => (tally.total ? `${Math.round((tally.correct / tally.total) * 100)}%（${tally.correct}/${tally.total}）` : '—');

/** Why each miss happened: the primary cause (what おまかせ reads) and what else was going on. */
function Causes({ analysis }: { analysis: ContestAnalysis }) {
  const counted = CONTEST_CAUSES.filter((cause) => analysis.causes[cause]);
  const slips = analysis.mistakes.flatMap((mistake) => (COPY_CAUSES.has(mistake.cause) ? mistake.slips ?? [] : []));
  return (
    <section className="run-missed contest-causes" aria-label="ミスの原因">
      <h3>ミスの原因 <small>主な原因で数えます（補助の要因は一覧に）</small></h3>
      {counted.length ? (
        <ul className="pileup-cause-list">
          {counted.map((cause) => <li key={cause} className={COPY_CAUSES.has(cause) ? 'copy' : ''}><b>{CONTEST_CAUSE_LABEL[cause]}</b> {analysis.causes[cause]}</li>)}
        </ul>
      ) : <p className="qso-note">原因に分けるほどのミスはありませんでした。</p>}
      <dl className="run-numbers contest-tallies">
        <div><dt>最初のコール（はっきり聞こえた）</dt><dd>{pct(analysis.copy)}</dd></div>
        <div><dt>番号（はっきり聞こえた）</dt><dd>{pct(analysis.serial)}</dd></div>
        <div><dt>2 局以上が呼んでいた中のコール</dt><dd>{pct(analysis.crowded)}</dd></div>
        <div><dt>似たコールがいた交信</dt><dd>{analysis.similarMet ? `${analysis.similarRight}/${analysis.similarMet} 正しく` : '—'}</dd></div>
        <div><dt>eager / lid の応答</dt><dd>{analysis.eager} / {analysis.lid}</dd></div>
        <div><dt>ミスなく続いた最長</dt><dd>{analysis.streak}<small> 局</small></dd></div>
      </dl>
      {slips.length > 0 && (
        <p className="qso-note contest-slips">
          取り違えた文字（受信が原因のもの）：{slips.map((slip, index) => <span key={index} className="chip">{slipText(slip)}</span>)}
        </p>
      )}
      {analysis.mistakes.length > 0 && (
        <details className="pileup-mistakes">
          <summary>ミスの一覧 {analysis.mistakes.length}</summary>
          <ol>{analysis.mistakes.map((mistake, index) => <li key={index}>{mistakeLine(mistake)}</li>)}</ol>
        </details>
      )}
      <p className="qso-note">
        おまかせ調整と苦手文字の分析には「受信」「弱い信号」「QRM・QSB・QRN」「重なり」だけを使います。似たコール・割り込み・ダブり・手順・記入・DUPE・交換後の破棄は、聞き取りの力とは別に数えます。
        カット数字（T=0、N=9 など）は番号として比べ、文字の取り違えには数えません。
      </p>
    </section>
  );
}

function slipText(slip: CharSlip) {
  const where = slip.field === 'nr' ? 'NR' : 'CALL';
  return `${where} ${slip.expected}→${slip.input || '（抜け）'}`;
}

function mistakeLine(mistake: ContestMistake) {
  const got = mistake.got !== undefined && mistake.expected !== undefined ? `（${mistake.got || '空'} → 正しくは ${mistake.expected}）` : '';
  const other = mistake.with ? ` ← ${mistake.with}${mistake.interferer ? `（${mistake.interferer === 'eager' ? 'eager' : 'lid'}）` : ''}` : '';
  const env = mistake.env ? `・${ENV_LABEL[mistake.env]}` : '';
  const aux = mistake.aux.length ? `　補助: ${mistake.aux.map((cause) => CONTEST_CAUSE_LABEL[cause]).join('・')}` : '';
  const count = mistake.count && mistake.count > 1 ? ` ×${mistake.count}` : '';
  return (
    <>
      <time>{clockOf(mistake.at)}</time> <span className="chip">{CONTEST_CAUSE_LABEL[mistake.cause]}{env}</span> <b>{mistake.call}</b>
      {' '}{FAILURE_LABEL[mistake.failure]}{count}{got}{other}<small>{aux}</small>
    </>
  );
}
