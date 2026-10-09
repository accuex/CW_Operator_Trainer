'use client';

import { useEffect, useRef, useState } from 'react';
import { ProgressBar, Segmented } from '@/app/components/ui';
import { KAKOMON_ATTRIBUTION, KAKOMON_NOTICE, KAKOMON_NOTICE_VERSION } from '@/lib/houki/kakomon/notice';
import { shippedExams } from '@/lib/houki/kakomon/shipped';
import { groupSittings, orderOfRun, parseScopeKey, sittingLabel, sittingShort } from '@/lib/houki/kakomon/sittings';
import { answerHistory, applyMastery, assessRun, answerReady, commitAnswer, discardRun, finishDrill, gradeQuestion, hasAnswers, lapsOf, moveCursor, questionsForDrill, RANK_LABEL, RANK_MAX, rankOf, readProgress, saveProgress, scopeKey, showNext, startDrill, type DrillOrder, type KakomonProgress, type KakomonRun, type Rank, type Response } from '@/lib/houki/kakomon/loop';
import type { Block, ExamSet, Inline, Question } from '@/lib/houki/kakomon/types';

type Move = { before: Rank; after: Rank; fresh: boolean };
type LapResult = { run: KakomonRun; moves: Record<string, Move>; laps: number };

const FORMAT_LABEL = { single: '単一選択', combination: '字句の組合せ', judge: '正誤', wordBank: '語群から選ぶ' } as const;
const ORDER_CHOICE: [DrillOrder, string][] = [['seq', '順番'], ['random', 'ランダム'], ['weak', '苦手順']];
const ORDER_HINT: Record<DrillOrder, string> = {
  seq: '古い回から、A問題のあとにB問題。',
  random: '始めたときに混ぜた順で、1周のあいだ固定。',
  weak: 'ランクの低い問から。同じなら直近の×が多い問から。',
};
const MEDAL_SRC = ['', '/assets/achievement_level/R1.png', '/assets/achievement_level/R2.png', '/assets/achievement_level/R3.png', '/assets/achievement_level/R4.png', '/assets/achievement_level/R5.png', '/assets/achievement_level/R6.png', '/assets/achievement_level/R7.png'];

export function KakomonPrototype({ onBack, onOpenHouki }: { onBack: () => void; onOpenHouki?: () => void }) {
  const exams = shippedExams;
  const allQuestions = exams.flatMap((exam) => exam.questions);
  const [boot] = useState(() => bootState(exams));
  const [yearIds, setYearIds] = useState<string[]>(boot.scope.examIds);
  const [sections, setSections] = useState<Array<'A' | 'B'>>(boot.scope.sections);
  const [order, setOrder] = useState<DrillOrder>(boot.scope.order);
  const [excludeTop, setExcludeTop] = useState(Boolean(boot.progress?.settings.excludeMastered.drill));
  const [progress, setProgress] = useState<KakomonProgress | null>(boot.progress);
  const [saveWarning, setSaveWarning] = useState('');
  const [screen, setScreen] = useState<'lobby' | 'drill'>('lobby');
  const [draft, setDraft] = useState<Response | undefined>();
  const [moves, setMoves] = useState<Record<string, Move>>({});
  const [result, setResult] = useState<LapResult | null>(null);
  const [confirmQuit, setConfirmQuit] = useState(false);
  const top = useRef<HTMLElement>(null);
  const questionHead = useRef<HTMLHeadingElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);

  /** Every change goes through here, so the browser copy never lags behind the screen. */
  const update = (next: KakomonProgress) => {
    setProgress(next);
    if (boot.writable && !saveProgress(next, localStorage)) setSaveWarning('このブラウザに保存できません。この画面を開いている間だけ記録します。');
  };

  const adoptScope = (run: KakomonRun) => {
    const scope = scopeOfRun(run, exams);
    if (!scope) return;
    setYearIds(scope.examIds);
    setSections(scope.sections);
    setOrder(scope.order);
  };

  const run = progress?.active ?? null;
  const health = run ? assessRun(run, exams) : null;
  const drilling = screen === 'drill' && !result && Boolean(run && health === 'ok');
  const byId = new Map(exams.flatMap((item) => item.questions.map((question) => [question.id, { exam: item, question }])));
  const located = drilling && run ? byId.get(run.questions[run.cursor]?.id) : undefined;
  const question = located?.question;
  const recorded = question && run ? run.answers[question.id] : undefined;
  const revealed = recorded !== undefined;

  const commit = () => {
    if (!progress || !question || !located || !answerReady(question, draft)) return;
    const digest = located.exam.questionRevisions.find((item) => item.questionId === question.id && item.revision === question.revision)?.answerDigest ?? '';
    const fresh = !hasAnswers(progress, question.id);
    const committed = commitAnswer(progress, question, draft!, digest);
    update(committed.progress);
    setMoves((current) => ({ ...current, [question.id]: { before: committed.before, after: committed.after, fresh } }));
    setDraft(undefined);
  };

  const goTo = (cursor: number) => {
    if (!progress) return;
    update(moveCursor(progress, cursor));
    setDraft(undefined);
    setConfirmQuit(false);
  };

  const next = () => {
    if (!progress || !run || !question || !revealed) return;
    if (run.cursor === run.questions.length - 1) {
      const done = finishDrill(progress);
      if (!done.finished) return;
      update(done.progress);
      setResult({ run, moves, laps: lapsOf(done.progress, run.setKey) });
      adoptScope(run);
      setScreen('lobby');
      return;
    }
    update(showNext(progress));
    setDraft(undefined);
    setConfirmQuit(false);
  };

  // Number keys pick a choice, Enter answers or moves on. Same guards as LearnView.
  useEffect(() => {
    if (!drilling || !question) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === 'Enter') {
        if (target?.tagName === 'BUTTON' && !target.dataset.kakomonPick) return;
        event.preventDefault();
        if (revealed) next();
        else commit();
        return;
      }
      if (revealed || !/^[1-9]$/.test(event.key)) return;
      const value = Number(event.key);
      if (question.format === 'single' && question.choices.some((choice) => choice.no === value)) { event.preventDefault(); setDraft(value); }
      if (question.format === 'combination' && question.rows.some((row) => row.no === value)) { event.preventDefault(); setDraft(value); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const cursorKey = drilling && run ? `${run.id}:${run.cursor}` : '';
  useEffect(() => {
    if (!cursorKey) return;
    const head = questionHead.current;
    if (!head) return;
    head.focus({ preventScroll: true });
    if (head.getBoundingClientRect().top < 80) head.scrollIntoView({ block: 'start' });
  }, [cursorKey]);

  useEffect(() => {
    if (revealed) nextButton.current?.focus({ preventScroll: true });
  }, [revealed, cursorKey]);

  useEffect(() => {
    top.current?.scrollIntoView({ block: 'start' });
  }, [screen, result]);

  const back = <button type="button" id="kakomon-back" className="btn btn-secondary" onClick={onBack}>一総通へ戻る</button>;

  if (!exams.length) return <main className="kakomon page-pad"><p>過去問のセットがこのビルドに入っていません。</p>{back}</main>;
  if (!progress) return <main className="kakomon page-pad"><p role="status">過去問を読み込んでいます…</p></main>;

  const acknowledged = progress.settings.noticeAcknowledged >= KAKOMON_NOTICE_VERSION;
  const acknowledge = () => update({ ...progress, settings: { ...progress.settings, noticeAcknowledged: KAKOMON_NOTICE_VERSION } });
  const warning = boot.notice || saveWarning;

  const begin = (pick?: { examIds: string[]; sections: Array<'A' | 'B'>; order: DrillOrder }) => {
    const chosenExams = exams.filter((item) => (pick?.examIds ?? yearIds).includes(item.id));
    const drillOrder = pick?.order ?? order;
    const seed = drillOrder === 'random' ? (Date.now() >>> 0) || 1 : undefined;
    const started = startDrill(progress, chosenExams, { order: drillOrder, sections: pick?.sections ?? sections, excludeMastered: excludeTop, seed });
    if (started.empty) return;
    update(started.progress);
    setDraft(undefined);
    setMoves({});
    setResult(null);
    setConfirmQuit(false);
    setScreen('drill');
  };

  const quit = () => {
    update(discardRun(progress));
    setMoves({});
    setConfirmQuit(false);
    setScreen('lobby');
  };

  return <main className="kakomon page-pad" ref={top}>
    {drilling && run && question && located
      ? <Drill
          run={run} progress={progress} question={question} exam={located.exam} byId={byId} allQuestions={allQuestions}
          draft={draft} recorded={recorded} move={moves[question.id]} confirmQuit={confirmQuit}
          headRef={questionHead} nextRef={nextButton}
          onPick={setDraft} onCommit={commit} onNext={next} onGo={goTo}
          onLobby={() => { setScreen('lobby'); setConfirmQuit(false); }}
          onQuit={() => (confirmQuit ? quit() : setConfirmQuit(true))} onKeep={() => setConfirmQuit(false)}
        />
      : <>
        <header className="kakomon-head">
          <div>
            <p className="section-kicker">一総通 · 法規 · 過去問</p>
            <h1 tabIndex={-1}>過去問を周回する</h1>
            <p>回とA・Bを選んで1周。正解でランクが1段上がり、外すと1段下がります。</p>
          </div>
          {back}
        </header>
        {warning && <p className="kakomon-warn" role="status">{warning}</p>}
        {!acknowledged && <section className="kakomon-ack panel" aria-labelledby="kakomon-ack-title">
          <h2 id="kakomon-ack-title">はじめる前に：法令改正について</h2>
          {KAKOMON_NOTICE.split('\n\n').map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
          <p className="kakomon-draft-note">問題文の起こしは確認中の下書きです。誤記に気づいたら原本で確かめてください。</p>
          <button type="button" className="btn btn-primary" onClick={acknowledge}>確認しました</button>
        </section>}
        {result
          ? <LapSummary result={result} progress={progress} byId={byId} allQuestions={allQuestions} onAgain={() => { const scope = parseScopeKey(result.run.setKey); if (scope) begin({ ...scope, order: orderOfRun(result.run.setDefinitionDigest) }); }} onLobby={() => setResult(null)} />
          : <Lobby
              exams={exams} progress={progress} run={run} health={health}
              yearIds={yearIds} sections={sections} order={order} excludeTop={excludeTop} acknowledged={acknowledged}
              setYearIds={setYearIds} setSections={setSections} setOrder={setOrder} setExcludeTop={setExcludeTop}
              onBegin={() => begin()} onResume={() => { if (run) adoptScope(run); setScreen('drill'); }} onDiscard={quit}
            />}
      </>}
    <footer className="kakomon-foot">
      {acknowledged && <details>
        <summary>法令改正と得点・ランクの扱い</summary>
        {KAKOMON_NOTICE.split('\n\n').map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        <p>問題文の起こしは確認中の下書きです。周回の記録はこのブラウザだけに残り、法規トレーナーの記録とは別です。</p>
      </details>}
      <p className="kakomon-attribution">{KAKOMON_ATTRIBUTION}</p>
      {onOpenHouki && <p><button type="button" className="kakomon-link" onClick={onOpenHouki}>法規トレーナー（参考書・赤シート）へ →</button></p>}
    </footer>
  </main>;
}

function scopeOfRun(run: KakomonRun, exams: ExamSet[]) {
  const scope = parseScopeKey(run.setKey);
  const known = scope?.examIds.filter((id) => exams.some((exam) => exam.id === id)) ?? [];
  if (!scope || !known.length) return null;
  return { examIds: known, sections: scope.sections, order: orderOfRun(run.setDefinitionDigest) };
}

/** Reads the browser copy once, before the first render. The view is only mounted on the client. */
function bootState(exams: ExamSet[]) {
  const latest = { examIds: exams.length ? [exams.at(-1)!.id] : [], sections: ['A', 'B'] as Array<'A' | 'B'>, order: 'seq' as DrillOrder };
  if (typeof window === 'undefined') return { progress: null, writable: false, notice: '', scope: latest };
  const loaded = readProgress(localStorage);
  const progress = applyMastery(loaded.progress, exams.flatMap((exam) => exam.questions));
  const scope = progress.active ? scopeOfRun(progress.active, exams) ?? latest : latest;
  return { progress, writable: loaded.writable, notice: loaded.notice, scope };
}

/* ───────── Lobby ───────── */

function Lobby({ exams, progress, run, health, yearIds, sections, order, excludeTop, acknowledged, setYearIds, setSections, setOrder, setExcludeTop, onBegin, onResume, onDiscard }: {
  exams: ExamSet[]; progress: KakomonProgress; run: KakomonRun | null; health: 'ok' | 'missing' | 'revision' | null;
  yearIds: string[]; sections: Array<'A' | 'B'>; order: DrillOrder; excludeTop: boolean; acknowledged: boolean;
  setYearIds: (ids: string[]) => void; setSections: (sections: Array<'A' | 'B'>) => void; setOrder: (order: DrillOrder) => void; setExcludeTop: (value: boolean) => void;
  onBegin: () => void; onResume: () => void; onDiscard: () => void;
}) {
  const chosen = exams.filter((item) => yearIds.includes(item.id));
  const inScope = questionsForDrill(chosen, progress, { order: 'seq', sections, excludeMastered: false });
  const queued = excludeTop ? inScope.filter((question) => rankOf(progress, question.id) < RANK_MAX) : inScope;
  const laps = lapsOf(progress, scopeKey(yearIds, sections));
  const reiwa = exams.filter((exam) => exam.exam.year > 2019 || (exam.exam.year === 2019 && exam.exam.month >= 5)).map((exam) => exam.id);
  const presets: [string, string[]][] = [
    ['最新回', exams.slice(-1).map((exam) => exam.id)],
    ['直近1年', exams.slice(-2).map((exam) => exam.id)],
    ['直近3年', exams.slice(-6).map((exam) => exam.id)],
    ['令和', reiwa],
    ['平成', exams.filter((exam) => !reiwa.includes(exam.id)).map((exam) => exam.id)],
    ['すべて', exams.map((exam) => exam.id)],
  ];
  const same = (ids: string[]) => ids.length === yearIds.length && ids.every((id) => yearIds.includes(id));
  const toggleYear = (id: string) => setYearIds(yearIds.includes(id) ? yearIds.filter((item) => item !== id) : [...yearIds, id]);
  const toggleSection = (section: 'A' | 'B') => setSections(sections.includes(section) ? sections.filter((item) => item !== section) : [...sections, section].sort() as Array<'A' | 'B'>);
  const countIn = (section: 'A' | 'B') => chosen.reduce((sum, exam) => sum + exam.questions.filter((item) => item.section === section).length, 0);
  const answered = run ? Object.keys(run.answers).length : 0;
  const runLabel = run ? scopeTitle(run.setKey, exams) : '';
  const scopeName = chosen.length === 0 ? '回が未選択' : chosen.length === 1 ? sittingLabel(chosen[0].exam) : `${chosen.length}回分`;

  return <>
    {run && health === 'ok' && <section className="kakomon-resume panel" aria-labelledby="kakomon-resume-title">
      <div>
        <p className="section-kicker">途中の周回</p>
        <h2 id="kakomon-resume-title">{runLabel}</h2>
        <p>{answered} / {run.questions.length} 問まで解答済み</p>
        <ProgressBar value={answered / run.questions.length} tone="gold" label="途中の周回の進み" />
      </div>
      <div className="kakomon-resume-actions">
        <button type="button" className="btn btn-primary" onClick={onResume}>続きから解く</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDiscard}>この周回をやめる</button>
      </div>
    </section>}
    {run && health && health !== 'ok' && <section className="kakomon-resume panel">
      <div><h2>途中の周回は続けられません</h2><p>問題の版が更新されたため、途中の周回と合わなくなりました。解いた分のランクは残っています。</p></div>
      <div className="kakomon-resume-actions"><button type="button" className="btn btn-secondary" onClick={onDiscard}>この周回を片づける</button></div>
    </section>}

    <form className="kakomon-scope panel" onSubmit={(event) => { event.preventDefault(); onBegin(); }}>
      <section className="kakomon-step" aria-labelledby="kakomon-step-years">
        <div className="kakomon-step-head">
          <h2 id="kakomon-step-years"><span>1</span>回を選ぶ</h2>
          <small>{chosen.length} / {exams.length} 回を選択中</small>
        </div>
        <div className="kakomon-presets" role="group" aria-label="まとめて選ぶ">
          {presets.map(([label, ids]) => <button key={label} type="button" className="kakomon-chip" aria-pressed={same(ids)} onClick={() => setYearIds(ids)}>{label}</button>)}
          <button type="button" className="kakomon-chip" disabled={!yearIds.length} onClick={() => setYearIds([])}>選択を外す</button>
        </div>
        <div className="kakomon-years">
          {groupSittings(exams).map((group) => <div key={group.year} className="kakomon-year">
            <span className="kakomon-year-label"><b>{group.year}</b><small>{group.eraLabel}</small></span>
            {[group.march, group.september].map((exam, index) => exam
              ? <SittingButton key={exam.id} exam={exam} progress={progress} selected={yearIds.includes(exam.id)} onToggle={() => toggleYear(exam.id)} />
              : <span key={index} className="kakomon-sitting is-missing">{index === 0 ? '3月期' : '9月期'}<small>未収録</small></span>)}
          </div>)}
        </div>
      </section>

      <section className="kakomon-step" aria-labelledby="kakomon-step-how">
        <div className="kakomon-step-head"><h2 id="kakomon-step-how"><span>2</span>問題と並び</h2></div>
        <div className="kakomon-options">
          <div className="kakomon-option">
            <span className="kakomon-option-label">問題</span>
            <div className="kakomon-presets" role="group" aria-label="問題の区分">
              {(['A', 'B'] as const).map((section) => <button key={section} type="button" className="kakomon-chip" aria-pressed={sections.includes(section)} onClick={() => toggleSection(section)}>{section}問題 <small>{countIn(section)}問</small></button>)}
            </div>
          </div>
          <div className="kakomon-option">
            <span className="kakomon-option-label">並び</span>
            <div><Segmented value={order} options={ORDER_CHOICE} onChange={(value) => setOrder(value as DrillOrder)} label="並び" /><small className="kakomon-hint">{ORDER_HINT[order]}</small></div>
          </div>
          <label className="kakomon-option kakomon-toggle">
            <input type="checkbox" checked={excludeTop} onChange={() => setExcludeTop(!excludeTop)} />
            <span>最高位<Medal rank={7} />ヒヒイロカネの問を除く</span>
          </label>
        </div>
      </section>

      <div className="kakomon-start">
        <div className="kakomon-start-summary">
          <strong>{scopeName} · {queued.length}問</strong>
          <small>A {inScope.filter((item) => item.section === 'A').length} · B {inScope.filter((item) => item.section === 'B').length}{excludeTop && queued.length !== inScope.length ? ` · ヒヒイロカネ ${inScope.length - queued.length}問を除く` : ''}{laps ? ` · この範囲は通算${laps}周` : ''}</small>
          <RankStack questions={inScope} progress={progress} />
        </div>
        <div className="kakomon-start-action">
          {run && health === 'ok' && <small>始めると、途中の周回は数えずに終わります。</small>}
          {!acknowledged && <small>上の注意を確認すると始められます。</small>}
          <button type="submit" className="btn btn-primary btn-lg" disabled={queued.length === 0 || !acknowledged}>この範囲を1周する</button>
        </div>
      </div>
    </form>
  </>;
}

function SittingButton({ exam, progress, selected, onToggle }: { exam: ExamSet; progress: KakomonProgress; selected: boolean; onToggle: () => void }) {
  const laps = lapsOf(progress, exam.id);
  const tried = exam.questions.filter((question) => hasAnswers(progress, question.id)).length;
  const label = sittingLabel(exam.exam);
  return <button type="button" className="kakomon-sitting" aria-pressed={selected} onClick={onToggle} aria-label={`${label}。${tried ? `${exam.questions.length}問中${tried}問を解答済み` : '未解答'}${laps ? `、${laps}周` : ''}`}>
    <span className="kakomon-sitting-top"><span>{exam.exam.month}月期</span>{laps > 0 && <em>{laps}周</em>}</span>
    <RankStack questions={exam.questions} progress={progress} thin />
  </button>;
}

/** One bar for a set of questions: unanswered, fallen to 未習得, then each medal rank. */
function RankStack({ questions, progress, thin = false }: { questions: Question[]; progress: KakomonProgress; thin?: boolean }) {
  const counts = rankCounts(questions, progress);
  const total = questions.length || 1;
  const parts: [string, number, string][] = [
    ...RANK_LABEL.map((label, rank) => [rank === 0 ? '未習得' : label, counts.ranks[rank], `is-rank-${rank}`] as [string, number, string]).reverse(),
    ['未解答', counts.fresh, 'is-fresh'],
  ];
  const text = parts.filter(([, count]) => count > 0).map(([label, count]) => `${label}${count}`).join('、');
  return <div className={thin ? 'kakomon-stack is-thin' : 'kakomon-stack'}>
    <div className="kakomon-stack-bar" role="img" aria-label={text || '問題なし'}>{parts.map(([label, count, className]) => count > 0 && <i key={label} className={className} style={{ width: `${(count / total) * 100}%` }} />)}</div>
    {!thin && <ul className="kakomon-stack-legend">{parts.filter(([, count]) => count > 0).map(([label, count, className]) => <li key={label} className={className}><i />{label} <b>{count}</b></li>)}</ul>}
  </div>;
}

function rankCounts(questions: Question[], progress: KakomonProgress) {
  const ranks = [0, 0, 0, 0, 0, 0, 0, 0];
  let fresh = 0;
  for (const question of questions) {
    if (!hasAnswers(progress, question.id)) fresh += 1;
    else ranks[rankOf(progress, question.id)] += 1;
  }
  return { ranks, fresh };
}

function scopeTitle(key: string, exams: ExamSet[]) {
  const scope = parseScopeKey(key);
  if (!scope) return '過去問';
  const found = exams.filter((exam) => scope.examIds.includes(exam.id));
  const part = scope.sections.length === 2 ? '' : ` · ${scope.sections[0]}問題`;
  if (found.length === 1) return `${sittingLabel(found[0].exam)}${part}`;
  const sorted = [...found].sort((left, right) => left.exam.year - right.exam.year || left.exam.month - right.exam.month);
  if (!sorted.length) return '過去問';
  return `${sittingShort(sorted[0].exam)}〜${sittingShort(sorted.at(-1)!.exam)}の${found.length}回${part}`;
}

/* ───────── Drill ───────── */

function Drill({ run, progress, question, exam, byId, allQuestions, draft, recorded, move, confirmQuit, headRef, nextRef, onPick, onCommit, onNext, onGo, onLobby, onQuit, onKeep }: {
  run: KakomonRun; progress: KakomonProgress; question: Question; exam: ExamSet;
  byId: Map<string, { exam: ExamSet; question: Question }>; allQuestions: Question[];
  draft: Response | undefined; recorded: Response | undefined; move: Move | undefined; confirmQuit: boolean;
  headRef: React.RefObject<HTMLHeadingElement | null>; nextRef: React.RefObject<HTMLButtonElement | null>;
  onPick: (pick: Response) => void; onCommit: () => void; onNext: () => void; onGo: (cursor: number) => void;
  onLobby: () => void; onQuit: () => void; onKeep: () => void;
}) {
  const revealed = recorded !== undefined;
  const pick = revealed ? recorded : draft;
  const verdict = revealed ? gradeQuestion(question, recorded) : null;
  const total = run.questions.length;
  const answered = Object.keys(run.answers).length;
  const results = run.questions.map((item) => {
    const response = run.answers[item.id];
    const source = byId.get(item.id);
    return response === undefined || !source ? null : gradeQuestion(source.question, response).ok;
  });
  const okCount = results.filter((item) => item === true).length;
  const ngCount = results.filter((item) => item === false).length;
  const open = run.questions.findIndex((item) => !(item.id in run.answers));
  const limit = open < 0 ? total - 1 : open;
  const manyExams = new Set(run.questions.map((item) => byId.get(item.id)?.exam.id)).size > 1;
  const rank = rankOf(progress, question.id);
  const tried = hasAnswers(progress, question.id);
  const history = answerHistory(progress, question.id, allQuestions);
  const last = run.cursor === total - 1;
  const keyHint = question.format === 'single' || question.format === 'combination';
  const verdictRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (revealed) verdictRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [revealed, question.id]);

  return <div className="kakomon-drill">
    <div className="kakomon-drillbar">
      <button type="button" className="btn btn-ghost btn-sm" onClick={onLobby}>← 範囲選択</button>
      <div className="kakomon-drillbar-title">
        <strong>{scopeTitle(run.setKey, [...new Set([...byId.values()].map((item) => item.exam))])}</strong>
        <small>{run.cursor + 1} / {total} 問目 · <span className="kakomon-ok">○{okCount}</span> <span className="kakomon-ng">×{ngCount}</span></small>
      </div>
      {confirmQuit
        ? <span className="kakomon-quit"><small>解いた分のランクは残ります。</small><button type="button" className="btn btn-danger btn-sm" onClick={onQuit}>やめる</button><button type="button" className="btn btn-secondary btn-sm" onClick={onKeep}>続ける</button></span>
        : <button type="button" className="btn btn-ghost btn-sm" onClick={onQuit}>この周回をやめる</button>}
    </div>
    <ProgressBar value={answered / total} tone="gold" label={`この周の進み ${answered} / ${total}`} />
    <nav className="kakomon-nav" aria-label="この周の問題">
      <ol>{run.questions.map((item, index) => {
        const source = byId.get(item.id);
        const state = results[index] === true ? 'is-ok' : results[index] === false ? 'is-ng' : '';
        const name = source ? `${manyExams ? `${sittingShort(source.exam.exam)} ` : ''}${mark(source.question)}` : item.id;
        const status = results[index] === true ? '正解' : results[index] === false ? '不正解' : index > limit ? 'まだ開けません' : '未解答';
        return <li key={item.id}><button type="button" className={`${state} ${index === run.cursor ? 'is-current' : ''}`} disabled={index > limit} aria-current={index === run.cursor ? 'step' : undefined} aria-label={`${index + 1}問目 ${name} ${status}`} title={name} onClick={() => onGo(index)}>{index + 1}</button></li>;
      })}</ol>
    </nav>

    <article className="kakomon-question panel" key={`${run.id}-${question.id}`}>
      <header className="kakomon-question-head">
        <div>
          <p className="section-kicker">{sittingLabel(exam.exam)} · {question.section}問題 第{question.number}問</p>
          <h2 ref={headRef} tabIndex={-1}>{mark(question)}<span>{FORMAT_LABEL[question.format]}{question.format === 'single' && question.polarity === 'negative' ? '・当てはまらないものを選ぶ' : ''}</span></h2>
        </div>
        <div className="kakomon-standing">
          <span className={`kakomon-rank is-rank-${rank}`}><Medal rank={rank} attempted={tried} />{tried ? RANK_LABEL[rank] : '初めての問'}</span>
          {history.length > 0 && <AnswerMarks marks={history} />}
        </div>
      </header>
      <p className="kakomon-lead"><Inlines items={question.lead} /></p>
      <Blocks blocks={question.body} />
      <AnswerForm question={question} pick={pick} revealed={revealed} onPick={onPick} />
      {verdict && <section ref={verdictRef} className={`kakomon-verdict ${verdict.ok ? 'is-ok' : 'is-ng'}`} role="status" aria-live="polite">
        <p className="kakomon-verdict-title"><b aria-hidden="true">{verdict.ok ? '○' : '×'}</b>{verdict.ok ? '正解' : '不正解'}</p>
        <p>{verdict.detail}</p>
        {move && <p className="kakomon-move"><Medal rank={move.before} attempted={!move.fresh} /><span aria-hidden="true">→</span><Medal rank={move.after} attempted />{moveText(move)}</p>}
      </section>}
      <div className="kakomon-bar">
        <button type="button" className="btn btn-secondary" disabled={run.cursor === 0} onClick={() => onGo(run.cursor - 1)}>← 前の問</button>
        {!revealed && <span className="kakomon-keys" aria-hidden="true">{keyHint ? <><span className="kbd">1</span>〜<span className="kbd">{question.format === 'single' ? question.choices.length : question.format === 'combination' ? question.rows.length : 5}</span>で選択 · </> : null}<span className="kbd">Enter</span>で解答</span>}
        {!revealed
          ? <button type="button" className="btn btn-primary" disabled={!answerReady(question, draft)} onClick={onCommit}>解答する</button>
          : <button type="button" className="btn btn-primary" ref={nextRef} onClick={onNext}>{last ? '1周を終える' : '次の問 →'}</button>}
      </div>
    </article>
    <p className="kakomon-source">出典：{exam.attribution.organization} {exam.attribution.qualificationLabel}「{exam.attribution.subjectLabel}」{sittingLabel(exam.exam)}</p>
  </div>;
}

/* ───────── Lap result ───────── */

function LapSummary({ result, progress, byId, allQuestions, onAgain, onLobby }: {
  result: LapResult; progress: KakomonProgress; byId: Map<string, { exam: ExamSet; question: Question }>; allQuestions: Question[];
  onAgain: () => void; onLobby: () => void;
}) {
  const rows = result.run.questions.flatMap((item) => {
    const source = byId.get(item.id);
    const response = result.run.answers[item.id];
    if (!source || response === undefined) return [];
    return [{ ...source, ok: gradeQuestion(source.question, response).ok, move: result.moves[item.id] }];
  });
  const ok = rows.filter((row) => row.ok).length;
  const up = rows.filter((row) => row.move && row.move.after > row.move.before).length;
  const down = rows.filter((row) => row.move && row.move.after < row.move.before).length;
  const misses = rows.filter((row) => !row.ok);
  const manyExams = new Set(rows.map((row) => row.exam.id)).size > 1;
  return <section className="kakomon-result panel" aria-labelledby="kakomon-result-title">
    <p className="section-kicker">1周しました · 通算{result.laps}周</p>
    <h2 id="kakomon-result-title" tabIndex={-1}>{scopeTitle(result.run.setKey, [...new Set(rows.map((row) => row.exam))])}</h2>
    <div className="kakomon-result-score">
      <p><strong>{ok}</strong><span>/ {rows.length} 問 正解</span></p>
      <ul>
        <li className="kakomon-ok">ランクが上がった <b>{up}</b></li>
        <li className="kakomon-ng">下がった <b>{down}</b></li>
      </ul>
    </div>
    <RankStack questions={rows.map((row) => row.question)} progress={progress} />
    {misses.length > 0 && <>
      <h3>外した問（{misses.length}）</h3>
      <ul className="kakomon-misses">{misses.map((row) => {
        const rank = rankOf(progress, row.question.id);
        return <li key={row.question.id}>
          <Medal rank={rank} attempted />
          <span><b>{manyExams ? `${sittingShort(row.exam.exam)} ` : ''}{mark(row.question)}</b> <span className="kakomon-miss-lead"><Inlines items={row.question.lead} /></span></span>
          <AnswerMarks marks={answerHistory(progress, row.question.id, allQuestions)} />
        </li>;
      })}</ul>
      <p className="kakomon-hint">「苦手順」で同じ範囲を回すと、外した問から出ます。</p>
    </>}
    {misses.length === 0 && <p>全問正解です。</p>}
    <div className="kakomon-actions">
      <button type="button" className="btn btn-primary" onClick={onAgain}>同じ条件でもう1周</button>
      <button type="button" className="btn btn-secondary" onClick={onLobby}>範囲を選び直す</button>
    </div>
  </section>;
}

/* ───────── Pieces ───────── */

function AnswerMarks({ marks }: { marks: boolean[] }) {
  const text = marks.map((ok) => (ok ? '○' : '×')).join(' ');
  return <span className="kakomon-marks" title={`直近${marks.length}回（古い順）`} aria-label={`直近${marks.length}回、古い順に${text}`}>
    {marks.map((ok, index) => <span key={`${index}-${ok}`} className={ok ? 'is-ok' : 'is-ng'} aria-hidden="true">{ok ? '○' : '×'}</span>)}
  </span>;
}

function Medal({ rank, attempted = false }: { rank: Rank; attempted?: boolean }) {
  if (rank === 0) return <span className={`kakomon-medal ${attempted ? 'is-fallen' : 'is-empty'}`} role="img" aria-label={attempted ? '未習得' : '未解答'} />;
  return <img className="kakomon-medal" src={MEDAL_SRC[rank]} alt={RANK_LABEL[rank]} />;
}

function moveText({ before, after, fresh }: Move) {
  if (before === after) return before === RANK_MAX ? 'ヒヒイロカネのまま' : `${fresh ? '初回' : '未習得のまま'}。次に正解すると銅`;
  return `${fresh ? '未解答' : RANK_LABEL[before]} → ${RANK_LABEL[after]}`;
}

function AnswerForm({ question, pick, revealed, onPick }: { question: Question; pick: Response | undefined; revealed: boolean; onPick: (pick: Response) => void }) {
  if (question.format === 'single') {
    const selected = typeof pick === 'number' ? pick : 0;
    return <div className="kakomon-choices" role="group" aria-label="選択肢">{question.choices.map((choice) => {
      const state = !revealed ? '' : choice.no === question.answer ? 'is-answer' : choice.no === selected ? 'is-wrong' : 'is-dim';
      return <button key={choice.no} type="button" data-kakomon-pick="1" className={`kakomon-choice ${state}`} aria-pressed={selected === choice.no} disabled={revealed} onClick={() => onPick(choice.no)}>
        <span className="kakomon-choice-no">{choice.no}</span>
        <span className="kakomon-choice-body"><Blocks blocks={choice.body} phrasing /></span>
        {revealed && (choice.no === question.answer ? <span className="kakomon-choice-tag">正答</span> : choice.no === selected ? <span className="kakomon-choice-tag">あなたの解答</span> : null)}
      </button>;
    })}</div>;
  }
  if (question.format === 'combination') {
    const selected = typeof pick === 'number' ? pick : 0;
    return <div className="kakomon-table-wrap"><table className="kakomon-table">
      <thead><tr><th scope="col" aria-label="番号" />{question.columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>{question.rows.map((row) => {
        const state = !revealed ? '' : row.no === question.answer ? 'is-answer' : row.no === selected ? 'is-wrong' : 'is-dim';
        return <tr key={row.no} className={`${state} ${selected === row.no ? 'is-picked' : ''}`} onClick={() => { if (!revealed) onPick(row.no); }}>
          <th scope="row"><button type="button" data-kakomon-pick="1" className="kakomon-choice-no" aria-pressed={selected === row.no} aria-label={`${row.no}を選ぶ`} disabled={revealed} onClick={(event) => { event.stopPropagation(); onPick(row.no); }}>{row.no}</button></th>
          {row.cells.map((cell, cellIndex) => <td key={question.columns[cellIndex]} data-label={question.columns[cellIndex]}><Inlines items={cell} /></td>)}
        </tr>;
      })}</tbody>
    </table></div>;
  }
  const selected = pick && typeof pick === 'object' ? pick : {};
  const choose = (label: string, value: number) => onPick({ ...selected, [label]: value });
  if (question.format === 'judge') {
    return <><p className="kakomon-legend">{([1, 2] as const).map((value) => <span key={value}><b>{value}</b>{question.labels[String(value) as '1' | '2']}</span>)}</p><ol className="kakomon-items">{question.items.map((item) => {
      const state = !revealed ? '' : selected[item.label] === item.answer ? 'is-hit' : 'is-miss';
      return <li key={item.id} className={state}>
        <div className="kakomon-item-text"><b>{item.label}</b><Blocks blocks={item.body} /></div>
        <div className="kakomon-pair" role="group" aria-label={`${item.label}の正誤`}>
          {([1, 2] as const).map((value) => <button key={value} type="button" data-kakomon-pick="1" className={revealed && value === item.answer ? 'is-answer' : ''} aria-pressed={selected[item.label] === value} disabled={revealed} aria-label={`${value} ${question.labels[String(value) as '1' | '2']}`} onClick={() => choose(item.label, value)}>{value}</button>)}
        </div>
      </li>;
    })}</ol></>;
  }
  const picked = (no: number | undefined) => {
    const entry = question.bank.find((candidate) => candidate.no === no);
    return entry ? <Inlines items={entry.body} /> : null;
  };
  return <div className="kakomon-wordbank">
    <ol className="kakomon-bank" aria-label="語群">{question.bank.map((entry) => <li key={entry.no}><b>{entry.no}</b><span><Inlines items={entry.body} /></span></li>)}</ol>
    <ol className="kakomon-items">{question.items.map((item) => {
      const state = !revealed ? '' : selected[item.label] === item.answer ? 'is-hit' : 'is-miss';
      return <li key={item.id} className={state}>
        <div className="kakomon-item-text"><b>{item.label}</b><span className="kakomon-picked">{picked(selected[item.label]) ?? <span className="kakomon-unpicked">未選択</span>}</span>{revealed && selected[item.label] !== item.answer && <small>正答 {item.answer}：{picked(item.answer)}</small>}</div>
        <div className="kakomon-numbers" role="group" aria-label={`${item.label}に入る語`}>
          {question.bank.map((entry) => <button key={entry.no} type="button" data-kakomon-pick="1" className={revealed && entry.no === item.answer ? 'is-answer' : ''} aria-pressed={selected[item.label] === entry.no} disabled={revealed} onClick={() => choose(item.label, entry.no)}>{entry.no}</button>)}
        </div>
      </li>;
    })}</ol>
  </div>;
}

/** `phrasing` renders spans so the blocks can sit inside a button. */
function Blocks({ blocks, phrasing = false }: { blocks: Block[]; phrasing?: boolean }) {
  if (!blocks?.length) return null;
  const Box = phrasing ? 'span' : 'div';
  const Para = phrasing ? 'span' : 'p';
  return <Box className="kakomon-body">{blocks.map((block, index) => {
    if (block.t === 'item') return <Box key={index} className="kakomon-item"><b>{block.marker}</b><span><Inlines items={block.body} />{block.children && <Blocks blocks={block.children} phrasing={phrasing} />}</span></Box>;
    if (block.t === 'note') return <Para key={index} className="kakomon-note"><b>{block.marker}</b> <Inlines items={block.body} /></Para>;
    return <Para key={index} className="kakomon-p"><Inlines items={block.body} /></Para>;
  })}</Box>;
}

function Inlines({ items }: { items: Inline[] }) {
  return <>{items.map((item, index) => {
    if (item.t === 'blank') return <span key={index} className="kakomon-blank">{item.label}</span>;
    if (item.t === 'ruby') return <ruby key={index}>{item.base}<rt>{item.reading}</rt></ruby>;
    return <span key={index}>{item.v}</span>;
  })}</>;
}

function mark(question: Question) {
  return `${question.section}-${question.number}`;
}
