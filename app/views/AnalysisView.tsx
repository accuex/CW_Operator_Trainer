'use client';

import { Fragment, useState, type CSSProperties } from 'react';
import { confusionMatrix, forWeakAnalysis, qsoConditionBreakdown, summary, weakPairs } from '@/lib/analytics';
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
  const hiddenQso = scoped.length - forWeakAnalysis(scoped).length;
  const stats = summary(filtered);
  const matrix = confusionMatrix(filtered);
  const pairs = weakPairs(filtered);
  const allSymbols = [...new Set(matrix.flatMap((cell) => [cell.correct, cell.input]))];
  const symbols = allSymbols.slice(0, 8);
  const queueSessions = sessions.filter((session) => session.queue);
  const stable = queueSessions.length ? queueSessions.reduce((sum, session) => sum + (session.queue?.stableDepth ?? 0), 0) / queueSessions.length : 0;
  const medals = ['gold', 'silver', 'bronze'];
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
      {qsoRows.length > 0 && <QsoConditionPanel rows={qsoRows} />}
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
  clean: '通常', weak: '弱信号', qsb: 'QSB', qrn: 'QRN', qrm: 'QRM', detuned: '同調ずれ', muted: '送信中・電源オフ', unheard: '未受信',
};
const CONDITION_ORDER = Object.keys(CONDITION_LABEL);

/** QSO copy by reception condition: "clean is fine, QRM is not" shows up here. */
function QsoConditionPanel({ rows }: { rows: { condition: string; answers: number; accuracy: number }[] }) {
  const sorted = [...rows].sort((a, b) => CONDITION_ORDER.indexOf(a.condition) - CONDITION_ORDER.indexOf(b.condition));
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
    </div>
  );
}
