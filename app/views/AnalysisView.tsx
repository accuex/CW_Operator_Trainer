'use client';

import { Fragment, useState, type CSSProperties } from 'react';
import { conditionContrast, confusionMatrix, forWeakAnalysis, hiddenByCondition, pileupBreakdown, qsoConditionBreakdown, summary, weakPairs, type ConditionContrast, type ConditionRow, type PileupBreakdown, type PileupFinding } from '@/lib/analytics';
import { CAUSE_LABEL, CROWD_LABEL } from './qso/PileupReview';
import type { AlphabetType, AnswerLog, SessionRecord } from '@/lib/types';
import { type View, pct, fmtLatency } from '@/app/trainer/shared';
import { Metric, EmptyState, Segmented } from '@/app/components/ui';
import { Icon } from '@/app/components/icons';

export function AnalysisView({ answers, sessions, onNavigate }: { answers: AnswerLog[]; sessions: SessionRecord[]; onNavigate: (view: View) => void }) {
  const [alphabet, setAlphabet] = useState<'all' | AlphabetType>('all');
  const [queue, setQueue] = useState<'all' | '0' | '1' | '2' | '3'>('all');
  const [qsoEnv, setQsoEnv] = useState<'off' | 'on'>('off');
  const scoped = answers.filter((answer) => (alphabet === 'all' || answer.alphabetType === alphabet) && (queue === 'all' || answer.queueTarget === Number(queue)));
  // QSO characters missed under QRM / QSB / QRN etc. are kept but left out unless asked for.
  const filtered = forWeakAnalysis(scoped, qsoEnv === 'on');
  const qsoRows = qsoConditionBreakdown(scoped);
  const callRows = qsoConditionBreakdown(scoped, 'call');
  const contrast = conditionContrast(scoped.filter((answer) => answer.qso));
  const hiddenQso = hiddenByCondition(scoped);
  const stats = summary(filtered);
  const matrix = confusionMatrix(filtered);
  const pairs = weakPairs(filtered);
  const allSymbols = [...new Set(matrix.flatMap((cell) => [cell.correct, cell.input]))];
  const symbols = allSymbols.slice(0, 8);
  const queueSessions = sessions.filter((session) => session.queue);
  const stable = queueSessions.length ? queueSessions.reduce((sum, session) => sum + (session.queue?.stableDepth ?? 0), 0) / queueSessions.length : 0;
  const medals = ['gold', 'silver', 'bronze'];
  const pileup = pileupBreakdown(sessions);
  return (
    <section className="page-pad analysis-page">
      <div className="page-title">
        <div>
          <p className="section-kicker">ANALYSIS</p>
          <h1>どの音と、どの音を取り違えてる？</h1>
          <p>正解の文字と、入力した文字。遅れ受信（Queue）ごとに、聞き分けと記憶のつまずきを分けて見ます。</p>
        </div>
        <div className="analysis-filters">
          <Segmented
            label="文字の種類"
            value={alphabet}
            onChange={(value) => setAlphabet(value as typeof alphabet)}
            options={[['all', 'すべて'], ['international', '欧文'], ['wabun', '和文']]}
          />
          <Segmented
            label="遅れ受信"
            value={queue}
            onChange={(value) => setQueue(value as typeof queue)}
            options={[['all', 'すべて'], ['0', 'Queue 0'], ['1', 'Queue 1'], ['2', 'Queue 2'], ['3', 'Queue 3']]}
          />
          {qsoRows.length > 0 && (
            <Segmented
              label="QSO の悪条件下のミス"
              value={qsoEnv}
              onChange={(value) => setQsoEnv(value as typeof qsoEnv)}
              options={[['off', '含めない'], ['on', `含める（${hiddenQso}字）`]]}
            />
          )}
        </div>
      </div>
      <div className="analysis-kpis">
        <Metric label="正解率" value={pct(stats.accuracy)} />
        <Metric label="反応の中央値" value={fmtLatency(stats.medianLatency)} />
        <Metric label="安定した遅れ" value={stable ? stable.toFixed(1) : '—'} />
        <Metric label="回答数" value={String(stats.answers)} />
      </div>
      <div className="analysis-grid">
        <div className="panel matrix-panel">
          <div className="panel-head">
            <div>
              <p className="section-kicker">CONFUSION</p>
              <h2>取り違えマップ</h2>
              <small>縦が正解、横が入力。色が濃いほど多いです。</small>
            </div>
            <span className={matrix.length ? 'chip coral' : 'chip'}>{matrix.length} 通り</span>
          </div>
          {matrix.length ? (
            <>
              <div className="matrix-scroll">
                <div className="matrix" style={{ gridTemplateColumns: `44px repeat(${symbols.length}, minmax(44px, 1fr))` }}>
                <span className="matrix-corner" aria-hidden="true" />
                {symbols.map((symbol) => <b key={`h-${symbol}`} className="matrix-col">{symbol}</b>)}
                {symbols.map((row) => (
                  <Fragment key={`row-${row}`}>
                    <b className="matrix-row">{row}</b>
                    {symbols.map((column) => {
                      const cell = matrix.find((item) => item.correct === row && item.input === column);
                      return (
                        <i
                          key={`${row}-${column}`}
                          className={cell ? 'hot' : ''}
                          style={{ '--heat': cell ? Math.min(1, cell.rate * 4) : 0 } as CSSProperties}
                          title={cell ? `正解 ${row} を ${column} と入力 · ${cell.count}回` : `正解 ${row} / 入力 ${column}`}
                        >
                          {cell?.count ?? 0}
                        </i>
                      );
                    })}
                  </Fragment>
                  ))}
                </div>
              </div>
              {allSymbols.length > 8 && <p className="matrix-note">混同の多い8文字だけ表示しています。</p>}
            </>
          ) : (
            <EmptyState title="まだ混同データがありません" body="聴きとるか遅れ受信で回答すると、実データだけでこの表ができます。" action="練習をはじめる" onClick={() => onNavigate('train')} icon="analysis" />
          )}
        </div>
        <aside className="panel weak-panel">
          <div className="panel-head">
            <div>
              <p className="section-kicker">WEAK PAIRS</p>
              <h2>混同しやすいペア</h2>
              <small>両方向のミスをまとめています</small>
            </div>
          </div>
          {pairs.length ? (
            <ol className="weak-list">
              {pairs.slice(0, 6).map((pair, index) => (
                <li className="weak-card" key={`${pair.a}-${pair.b}`}>
                  <span className={`weak-rank ${medals[index] ?? ''}`}>{index + 1}</span>
                  <strong className="weak-pair">{pair.a}<i>⇄</i>{pair.b}</strong>
                  <div className="weak-counts">
                    <b>{pair.total}</b>
                    <small>{pair.a}→{pair.b} {pair.count} / {pair.b}→{pair.a} {pair.reverse}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted-copy">まだペアはありません。答えるほど、ここに並びます。</p>
          )}
          <button type="button" className="btn btn-ghost btn-block" onClick={() => onNavigate('train')}>
            混同ペアを練習する
            <Icon name="chevron-right" size={16} />
          </button>
        </aside>
      </div>
      {qsoRows.length > 0 && <QsoConditionPanel rows={qsoRows} callRows={callRows} contrast={contrast} />}
      {pileup && <PileupPanel data={pileup} />}
      <div className="insight-band">
        <div className="insight-copy">
          <p className="section-kicker">NEXT ACTION</p>
          <p>{pairs[0] ? `${pairs[0].a} と ${pairs[0].b} を、いつもの文字に40%混ぜて練習するのがおすすめです。` : 'まずは10問聞いてみて。反応時間と、どの音を取り違えたかが分かります。'}</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => onNavigate(pairs[0] ? 'train' : 'learn')}>
          {pairs[0] ? '10分練習する' : 'まずは聞いてみる'}
          <Icon name="chevron-right" size={16} />
        </button>
      </div>
    </section>
  );
}

const CONDITION_LABEL: Record<string, string> = {
  clean: '通常', weak: '弱信号', qsb: 'QSB', qrn: 'QRN', qrm: 'QRM', overlap: '重なり', detuned: '同調ずれ', doubled: 'ダブり', unheard: '未受信',
};
const CONDITION_ORDER = Object.keys(CONDITION_LABEL);
const bySituation = (rows: ConditionRow[]) => [...rows].sort((a, b) => CONDITION_ORDER.indexOf(a.condition) - CONDITION_ORDER.indexOf(b.condition));

/** QSO copy by situation: "clean is fine, QRM is not" shows up here, per character and for calls. */
function QsoConditionPanel({ rows, callRows, contrast }: { rows: ConditionRow[]; callRows: ConditionRow[]; contrast: ConditionContrast[] }) {
  const sorted = bySituation(rows);
  return (
    <div className="panel panel-pad qso-condition-panel">
      <div className="panel-head">
        <div>
          <p className="section-kicker">QSO CONDITIONS</p>
          <h2>受信環境ごとの QSO ログ正解率</h2>
          <small>苦手分析は「通常」だけを使います。悪条件のミスは上のスイッチで含められます。</small>
        </div>
      </div>
      <ul>
        {sorted.map((row) => (
          <li key={row.condition} className={row.condition === 'clean' ? 'clean' : ''}>
            <span>{CONDITION_LABEL[row.condition] ?? row.condition}</span>
            <i><b style={{ width: `${Math.round(row.accuracy * 100)}%` }} /></i>
            <strong>{pct(row.accuracy)}</strong>
            <small>{row.answers}字</small>
          </li>
        ))}
      </ul>
      {callRows.length > 0 && (
        <>
          <h3>コールサインの字</h3>
          <ul>
            {bySituation(callRows).map((row) => (
              <li key={row.condition} className={row.condition === 'clean' ? 'clean' : ''}>
                <span>{CONDITION_LABEL[row.condition] ?? row.condition}</span>
                <i><b style={{ width: `${Math.round(row.accuracy * 100)}%` }} /></i>
                <strong>{pct(row.accuracy)}</strong>
                <small>{row.answers}字</small>
              </li>
            ))}
          </ul>
        </>
      )}
      {contrast.length > 0 && (
        <>
          <h3>通常は取れるのに、悪条件で落ちる字</h3>
          <ul className="qso-contrast">
            {contrast.slice(0, 6).map((item) => (
              <li key={item.symbol}>
                <b>{item.symbol}</b>
                <span>通常 {pct(item.clean)} → {CONDITION_LABEL[item.situation] ?? item.situation} {pct(item.accuracy)}</span>
                <small>{item.answers}字</small>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const FINDING: Record<PileupFinding, string> = {
  'crowd-weak': '1 局だけのときより、3 局以上が同時に応答したときの最初のコールが大きく落ちています。partial で 1 局に絞ってから呼ぶ練習を。',
  'similar-mixups': '似たコールの局との取り違えが続いています。違う 1 文字に注意して、コールを確かめてから 5NN を。',
  'doubling-often': '相手がまだ送信しているうちに送り出してダブることが多めです。応答が終わるのを聞いてから送りましょう。',
  'narrowing-weak': 'partial から始めた選局が、当てはまる局にたどり着かないことが多めです。断片は確実に聞こえた文字だけで。',
};

/** Pileup runs added up: first calls by how many answered at once, look-alikes, doublings, causes. */
function PileupPanel({ data }: { data: PileupBreakdown }) {
  const causes = (Object.entries(data.causes) as [keyof typeof CAUSE_LABEL, number][]).filter(([, count]) => count).sort((a, b) => b[1] - a[1]);
  const rate = (tally: { total: number; correct: number }) => (tally.total ? tally.correct / tally.total : 0);
  return (
    <div className="panel panel-pad qso-condition-panel pileup-analysis-panel">
      <div className="panel-head">
        <div>
          <p className="section-kicker">PILEUP</p>
          <h2>パイルアップの最初のコール</h2>
          <small>{data.runs} ラン・選局 {data.picks} 回（うちダブり {data.doubledPicks}）。似たコール・割り込み・ダブりのミスは受信の苦手分析に入れていません。</small>
        </div>
      </div>
      <ul>
        {(['1', '2', '3+'] as const).filter((crowd) => data.firstCall[crowd].total).map((crowd) => (
          <li key={crowd} className={crowd === '1' ? 'clean' : ''}>
            <span>応答 {CROWD_LABEL[crowd]}</span>
            <i><b style={{ width: `${Math.round(rate(data.firstCall[crowd]) * 100)}%` }} /></i>
            <strong>{pct(rate(data.firstCall[crowd]))}</strong>
            <small>{data.firstCall[crowd].total}回</small>
          </li>
        ))}
        {data.similarMet > 0 && (
          <li>
            <span>似たコールがいた</span>
            <i><b style={{ width: `${Math.round((data.similarRight / data.similarMet) * 100)}%` }} /></i>
            <strong>{pct(data.similarRight / data.similarMet)}</strong>
            <small>{data.similarMet}交信</small>
          </li>
        )}
      </ul>
      {causes.length > 0 && <p className="muted-copy">ミスの原因：{causes.map(([cause, count]) => `${CAUSE_LABEL[cause]} ${count}`).join('・')}</p>}
      {data.findings.map((finding) => <p key={finding} className="qso-hint">{FINDING[finding]}</p>)}
    </div>
  );
}
