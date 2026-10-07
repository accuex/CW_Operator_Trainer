'use client';
import { useEffect, useMemo, useState } from 'react';
import { loadHoukiMaster, type Bundle, type HoukiItem, type HoukiMaster } from '@/lib/houki/data';
import { emptyProgress, readProgress, rememberAttempt, saveProgress, toggleHeld, type HoukiProgress } from '@/lib/houki/progress';
import { buildBlock, optionOrder, scoreBlock } from '@/lib/houki/session';

const articleLabel = (article: string) => `第${article.includes('の') ? article.replace('の', '条の') : `${article}条`}`;

function Clause({ item }: { item: HoukiItem }) {
  const basis = item.legalBasis;
  return <><p className="houki-answer">{item.learningClause}</p>
    <p className="houki-correction">{item.correction}</p>
    <p className="houki-source"><a href={basis.url} target="_blank" rel="noreferrer">{basis.law} {articleLabel(basis.article)} 第{basis.paragraph}項{basis.item ? ` 第${basis.item}号` : ''}</a></p>
    <details><summary>出典と確認根拠</summary>
      {item.sourceEvidence.map(s => <p key={s.legacyId}>{s.sourceExam.exam} {s.sourceExam.question} · 当時の判定: {s.sourceJudgement}</p>)}
      <p>過去問の判定とは別に、現行の一次資料から自作した学習句です。</p>
      <p>{item.verification.evidence}</p>{item.verification.additionalEvidence.map(e => <p key={e}>{e}</p>)}
    </details></>;
}
export default function HoukiView({ onBack }: { onBack: () => void }) {
  const [master, setMaster] = useState<HoukiMaster>();
  const [progress, setProgress] = useState<HoukiProgress>(emptyProgress);
  const [writable, setWritable] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showAnswer, setShowAnswer] = useState(false);
  useEffect(() => {
    let active = true;
    loadHoukiMaster().then(data => {
      if (!active) return;
      setMaster(data);
      try {
        const saved = readProgress(window.localStorage, data.items);
        setProgress(saved.progress); setWritable(saved.writable); setNotice(saved.notice);
      } catch { setNotice('ブラウザに保存できません。この画面の間だけ記録します。'); }
    }).catch(e => { if (active) setError(String(e.message)); });
    return () => { active = false; };
  }, []);
  const bundle = progress.last.bundle;
  const items = useMemo(() => master ? master.items.filter(i => bundle === 'all' || i.bundle === bundle) : [], [master, bundle]);
  const reading = items.find(i => i.id === progress.last.item) ?? items[0];
  const readingIndex = items.findIndex(i => i === reading);
  const active = progress.active;
  const block = active && master ? active.itemIds.map(id => master.items.find(i => i.id === id)!) : [];
  const current = active ? block[active.cursor] : undefined;
  const result = active?.graded ? scoreBlock(block, active.answers) : undefined;
  function update(next: HoukiProgress) {
    setProgress(next);
    if (!writable) return;
    try { if (!saveProgress(next, window.localStorage)) { setWritable(false); setNotice('保存できません。この画面の間だけ記録します。'); } }
    catch { setWritable(false); setNotice('保存できません。この画面の間だけ記録します。'); }
  }
  function openRead(id = reading?.id ?? '', area: Bundle | 'all' = bundle, reveal = false) {
    setShowAnswer(reveal); update({ ...progress, screen: 'read', last: { bundle: area, item: id } });
  }
  function startDrill() {
    if (!master) return;
    const seed = Date.now();
    const next = buildBlock(master.items, progress.held, seed, active?.itemIds ?? progress.attempts.at(-1)?.itemIds ?? []);
    update({ ...progress, screen: 'drill', active: { id: `set-${seed}-${progress.attempts.length}`, seed, at: new Date().toISOString(), itemIds: next.map(i => i.id), cursor: 0, answers: {}, graded: false, wrongItems: [] } });
  }
  function submitDrill() {
    if (!active || active.graded || block.some(i => !active.answers[i.id])) return;
    const scored = scoreBlock(block, active.answers);
    const next = rememberAttempt(progress, { id: active.id, at: new Date().toISOString(), score: scored.points, total: scored.total, itemIds: active.itemIds, answers: active.answers });
    update({ ...next, screen: 'result', active: { ...active, graded: true, wrongItems: scored.misses } });
  }
  const screen = progress.screen;
  return <section className="houki-view page-pad">
    <header className="houki-heading"><div><p className="section-kicker">一総通 · 法規</p><h1>番号ではなく、法規の句で覚える。</h1><p>主体・条件・例外を、正しい句で確かめます。</p></div>
      <button id="houki-back" className="btn btn-secondary" onClick={onBack}>一総通へ戻る</button></header>
    {notice && <p role="status" className="houki-notice">{notice}</p>}
    {error && <p role="alert">{error}</p>}
    {!master && !error && <p role="status">法規の教材を読み込んでいます…</p>}
    {master && <p className="houki-source">法令確認基準日: 2026年10月7日 · {master.items.length}句。法改正により内容が変わる場合があります。</p>}
    {master && screen === 'home' && <div className="houki-home"><div className="houki-stats">
      <p><strong>{Object.keys(progress.held).length}</strong> / {master.items.length}<small>正しい句を言えた</small></p>
      <p><strong>{progress.attempts.length}</strong><small>記録したセット（直近20件）</small></p>
      <p><strong>{progress.attempts.at(-1) ? `${progress.attempts.at(-1)!.score} / 25` : '—'}</strong><small>直前のセット</small></p></div>
      <p className="houki-lead">1点の適否5問と、5点の空欄4問で25点。この練習セットを答えを見る前に埋めた結果を記録します。本試験の得点・合否を表すものではありません。</p>
      <div className="houki-home-actions">
        {active && <button className="btn btn-primary" onClick={() => update({ ...progress, screen: active.graded ? 'result' : 'drill' })}>{active.graded ? '前の結果を開く' : '途中のセットを再開'}</button>}
        <button id="houki-start" className="btn btn-primary" onClick={startDrill}>新しい25点セット</button><button id="houki-read" className="btn btn-secondary" onClick={() => openRead()}>句を読む</button></div></div>}
    {master && screen === 'read' && <div className="houki-workspace"><div className="houki-side panel">
      <button className="btn btn-secondary" onClick={() => update({ ...progress, screen: 'home' })}>入口へ</button>
      {active && <button className="btn btn-secondary" onClick={() => update({ ...progress, screen: active.graded ? 'result' : 'drill' })}>{active.graded ? '結果へ戻る' : 'セットを再開'}</button>}
      <div className="houki-bundles" role="group" aria-label="条文の束">
        <button aria-pressed={bundle === 'all'} className="btn btn-secondary" onClick={() => openRead('', 'all')}>すべて</button>
        {master.groups.map(g => <button key={g.id} aria-pressed={bundle === g.id} className="btn btn-secondary" onClick={() => openRead('', g.id)}>{g.title}</button>)}</div>
      <nav className="houki-list" aria-label="句">{items.map(i => <button key={i.id} aria-current={reading === i ? 'true' : undefined} onClick={() => openRead(i.id)}><span>{i.title}</span><small>{i.law}{progress.held[i.id] ? ' · 言えた' : ''}</small></button>)}</nav></div>
      {reading && <article className="houki-detail panel"><p className="section-kicker">{master.groups.find(g => g.id === reading.bundle)?.title}</p><h2>{reading.title}</h2>
        <button id="houki-reveal" className="btn btn-secondary" aria-expanded={showAnswer} onClick={() => setShowAnswer(v => !v)}>{showAnswer ? '句を隠す' : '句を見る'}</button>
        {showAnswer ? <Clause item={reading} /> : <p>正しい主体・条件を思い浮かべてから開いてください。</p>}
        <div className="houki-actions"><button className="btn btn-secondary" disabled={readingIndex <= 0} onClick={() => openRead(items[readingIndex - 1].id)}>前へ</button>
          <button id="houki-held" className="btn btn-primary" disabled={!showAnswer} aria-pressed={!!progress.held[reading.id]} onClick={() => update(toggleHeld(progress, reading.id))}>{progress.held[reading.id] ? '言えた · 取り消す' : '正しい句を言えた'}</button>
          <button className="btn btn-secondary" disabled={readingIndex >= items.length - 1} onClick={() => openRead(items[readingIndex + 1].id)}>次へ</button></div></article>}</div>}
    {master && screen === 'drill' && current && active && <div className="houki-drill panel"><p className="section-kicker">{active.cursor + 1} / {block.length} · このセットは25点 · {current.points}点</p>
      <h2>{current.kind === 'judge' ? 'この確認文は規定に適合しますか。' : '空欄に入る正しい句を選んでください。'}</h2><p className="houki-source">{current.law} {articleLabel(current.legalBasis.article)} 第{current.legalBasis.paragraph}項</p><p className="houki-statement">{current.prompt}</p>
      <div className="houki-options" role="group" aria-label="句を選ぶ">{optionOrder(current).map(option => <button key={option} className={`btn houki-option ${active.answers[current.id] === option ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={active.answers[current.id] === option} onClick={() => update({ ...progress, active: { ...active, answers: { ...active.answers, [current.id]: option } } })}>{option}</button>)}</div>
      <div className="houki-actions"><button className="btn btn-secondary" disabled={active.cursor <= 0} onClick={() => update({ ...progress, active: { ...active, cursor: active.cursor - 1 } })}>前の句</button>
        {active.cursor < block.length - 1 ? <button id="houki-next" className="btn btn-primary" disabled={!active.answers[current.id]} onClick={() => update({ ...progress, active: { ...active, cursor: active.cursor + 1 } })}>次の句</button> : <button id="houki-submit" className="btn btn-primary" disabled={block.some(i => !active.answers[i.id])} onClick={submitDrill}>このセットを採点する</button>}
        <button className="btn btn-secondary" onClick={() => update({ ...progress, screen: 'home' })}>中断して入口へ</button></div></div>}
    {master && screen === 'result' && result && <div className="houki-result panel"><p className="section-kicker">答えを見る前に埋めた、この練習セットの点数</p><p className="houki-score"><strong>{result.points}</strong> / {result.total}</p>
      <p>このセットの6割は{result.line}点です。本試験の得点・合否へ換算しません。</p>
      {!result.misses.length && <p>すべて正解でした。</p>}
      {!!result.misses.length && <ul className="houki-misses">{result.misses.map(id => { const i = master.items.find(item => item.id === id)!; return <li key={id}><p>{i.title}</p><p>選んだ句: {active?.answers[id]}</p><Clause item={i}/><button className="btn btn-secondary" onClick={() => openRead(i.id, i.bundle, true)}>この句を読む</button></li>; })}</ul>}
      <div className="houki-actions"><button className="btn btn-primary" onClick={startDrill}>もう1セット</button><button className="btn btn-secondary" onClick={() => update({ ...progress, screen: 'home' })}>入口へ</button></div></div>}
  </section>;
}
