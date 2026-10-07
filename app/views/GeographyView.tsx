'use client';
import {validConfig} from '@/lib/geography/config';
import { useEffect, useMemo, useRef, useState } from 'react';
import { loadGeography } from '@/lib/geography/data';
import { materialize } from '@/lib/geography/engine/stage13-core.js';
import { SCOPES, selectedEntities, sortEntities, drillPool, nameMatches, toleranceFor, judge, createSession, nextSession, recordSession, sessionSummary } from '@/lib/geography/engine/stage14-core.js';
import { openStore, status, choose, record, result, validActive, validate } from '@/lib/geography/engine/stage15-core.js';
import type { Config, Dataset, Entity, Grade, Outcome, Point, Session, Store, Progress } from '@/lib/geography/types';
import GeographyMap from './geography/GeographyMap';
import GeographyExplorer from './geography/GeographyExplorer';
const initial: Config = { area: 'japan', scope: 'A', direction: 'name', size: '10', period: 'all', from: '2015-01', to: '2025-12' };
interface Running {
    sessionID: string;
    session: Session;
    snapshot: Config;
    pool: Entity[];
    currentID: string | null;
    solved: boolean;
    grade: Grade | null;
    answerPoint: Point | null;
}
const frequency = (e: Entity) => e.choiceCount === null ? `OCR参考 ${e.provisionalChoiceCount ?? 0}回` : `選択肢登場 ${e.choiceCount}回`;
export default function GeographyView({ onBack }: {
    onBack: () => void;
}) {
    const [mode, setMode] = useState<'learn' | 'map'>('learn');
    const [data, setData] = useState<Dataset | null>(null), [error, setError] = useState(''), [config, setConfig] = useState<Config>(initial), [selected, setSelected] = useState<string | null>(null), [sort, setSort] = useState('priority'), [labels, setLabels] = useState('on'), [running, setRunning] = useState<Running | null>(null), [answer, setAnswer] = useState(''), [revision, setRevision] = useState(0), [notice, setNotice] = useState(''), [confirm, setConfirm] = useState<'area' | 'all' | 'import' | null>(null);
    const store = useRef<Store | null>(null), pendingImport = useRef<Progress | null>(null), dialog = useRef<HTMLDialogElement>(null), cancel = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null), next = useRef<HTMLButtonElement>(null), summary = useRef<HTMLElement>(null), list = useRef<HTMLDivElement>(null), periodCache = useRef(new Map<string, Entity[]>());
    useEffect(() => { let alive = true; loadGeography().then(d => { if (!alive)
        return; let storage: Pick<Storage, 'getItem' | 'setItem'>; try {
        storage = localStorage;
    }
    catch {
        storage = { getItem() { throw Error('unavailable'); }, setItem() { throw Error('unavailable'); } };
    } store.current = openStore(storage); setData(d); setNotice(store.current.warning); }).catch(() => { if (alive)
        setError('地図を読み込めませんでした。再読み込みしてください。'); }); return () => { alive = false; store.current?.save(); }; }, []);
    useEffect(() => { const save = () => store.current?.save(); window.addEventListener('pagehide', save); return () => window.removeEventListener('pagehide', save); }, []);
    useEffect(() => { if (confirm) {
        dialog.current?.showModal();
        cancel.current?.focus();
    } }, [confirm]);
    useEffect(() => { if (running?.currentID && !running.solved) {
        if (running.snapshot.direction === 'name')
            input.current?.focus({ preventScroll: true });
        else
            document.getElementById('geo-map')?.focus({ preventScroll: true });
    }
    else if (running?.solved)
        next.current?.focus({ preventScroll: true });
    else if (running)
        summary.current?.focus({ preventScroll: true }); }, [running]);
    const periodRows = useMemo(() => { if (!data)
        return []; if (config.period !== 'custom')
        return data.periods[config.period]; const k = config.from + '|' + config.to; if (!periodCache.current.has(k))
        periodCache.current.set(k, materialize(data.seed, data.db, data.keys, data.groups, data.model, data.signals, { period: 'custom', from: config.from, to: config.to })); return periodCache.current.get(k)!; }, [data, config.period, config.from, config.to]);
    const rows = useMemo(() => data ? sortEntities(selectedEntities(data.master, periodRows, config.area, config.scope), sort) : [], [data, periodRows, config.area, config.scope, sort]);
    const pool = useMemo(() => drillPool(rows), [rows]);
    function save() { store.current?.save(); setNotice(store.current?.warning ?? ''); setRevision(r => r + 1); }
    function persist(r: Running) { if (!store.current)
        return; if (r.currentID)
        store.current.data.active = { sessionID: r.sessionID, session: r.session, snapshot: r.snapshot, currentID: r.currentID, solved: r.solved, grade: r.grade, answerPoint: r.answerPoint }; save(); }
    function move(r: Running) { const s = structuredClone(r.session), id = nextSession(s), n = { ...r, session: s, currentID: id, solved: false, grade: null, answerPoint: null }; setAnswer(''); if (!id && store.current) {
        const stats = result(s);
        store.current.data.active = null;
        store.current.data.completed.push({ sessionID: r.sessionID, area: r.snapshot.area, ...stats, at: new Date().toISOString() });
        store.current.data.completed = store.current.data.completed.slice(-20);
        save();
    }
    else
        persist(n); setRunning(n); }
    function start(ids?: string[], snapshot?: Config) { if (!data || !store.current)
        return; const c = snapshot ?? config, available = snapshot ? drillPool(selectedEntities(data.master, periodRows, c.area, c.scope)) : pool, chosen = choose(ids ? available.filter(e => ids.includes(e.learningEntityId)) : available, store.current.data, ids ? 'all' : c.size); if (!chosen.length)
        return; const r: Running = { sessionID: crypto.randomUUID(), session: createSession(chosen.map(e => e.learningEntityId)), snapshot: { ...c }, pool: chosen, currentID: null, solved: false, grade: null, answerPoint: null }; r.session.area = c.area; r.session.scope = c.scope; r.session.direction = c.direction; store.current.data.last = { ...c }; setConfig(c); move(r); }
    function respond(grade: Grade, point: Point | null = null) { if (!running?.currentID || running.solved || !store.current)
        return; const s = structuredClone(running.session), id = running.currentID; recordSession(s, id, grade); record(store.current.data, id, grade, { area: running.snapshot.area, scope: running.snapshot.scope, mode: running.snapshot.direction }, running.sessionID); const r = { ...running, session: s, solved: true, grade, answerPoint: point }; persist(r); setRunning(r); }
    function resume() { const a = store.current?.data.active; if (!a || !data || (!validActive(a, data.master) || !validConfig(a.snapshot, data.master)))
        return; const source = a.snapshot.period === 'custom' ? materialize(data.seed, data.db, data.keys, data.groups, data.model, data.signals, { period: 'custom', from: a.snapshot.from, to: a.snapshot.to }) : data.periods[a.snapshot.period]; const resumedRows = selectedEntities(data.master, source, a.snapshot.area, a.snapshot.scope); setConfig({ ...a.snapshot }); setRunning({ ...a, session: structuredClone(a.session), pool: data.master.entities.filter(e => a.session.eligible.includes(e.learningEntityId)).map(e => resumedRows.find(r => r.learningEntityId === e.learningEntityId) ?? e) }); setAnswer(''); }
    function stop() { setRunning(null); setAnswer(''); }
    function select(id: string, fromMap = false) { setSelected(id); if (fromMap)
        requestAnimationFrame(() => list.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest' })); }
    function change<K extends keyof Config>(k: K, v: Config[K]) { setConfig(c => ({ ...c, [k]: v })); setSelected(null); }
    function resetOrImport() { if (!store.current)
        return; if (confirm === 'import' && pendingImport.current)
        store.current.replace(pendingImport.current);
    else
        store.current.reset(confirm === 'area' ? config.area : null); setRunning(null); closeDialog(); save(); }
    function closeDialog() { dialog.current?.close(); setConfirm(null); }
    function exportProgress() { if (!store.current)
        return; const u = URL.createObjectURL(new Blob([JSON.stringify(store.current.data, null, 2)], { type: 'application/json' })), a = document.createElement('a'); a.href = u; a.download = 'geography-progress.json'; a.click(); URL.revokeObjectURL(u); }
    async function importProgress(file?: File) { if (!file)
        return; try {
        if (file.size > 2000000)
            throw Error('large');
        pendingImport.current = validate(JSON.parse(await file.text()));
        setConfirm('import');
    }
    catch {
        setNotice('地理履歴として読み込めませんでした。現在の履歴は変更していません。');
    } }
    if (error)
        return <section className="page-pad geography-page"><button className="btn" onClick={onBack}>一総通へ戻る</button><p role="alert">{error}</p></section>;
    if (!data || !store.current)
        return <section className="page-pad geography-page"><p role="status">地理教材を読み込んでいます…</p></section>;
    const progress = store.current.data, area = data.master.areas.find(a => a.areaId === config.area) ?? data.master.areas[0], e = rows.find(e => e.learningEntityId === selected), current = running?.pool.find(e => e.learningEntityId === running.currentID) ?? null, done = running && !running.currentID, stats: Outcome | null = done ? result(running.session) : null, practiced = rows.filter(e => progress.entities[e.learningEntityId]?.attempts).length, recent = progress.recent.filter(r => r.area === config.area && rows.some(e => e.learningEntityId === r.learningEntityId)).slice(-10), weak = choose(pool, progress, 'all', true), invalid = Boolean(config.period === 'custom' && config.from && config.to && config.from > config.to), last = validConfig(progress.last, data.master) ? progress.last : null, s = running ? sessionSummary(running.session) : null;
    const modeTabs = <nav className="geo-mode-tabs" aria-label="地理の表示モード"><button id="geo-mode-learn" className="btn" aria-pressed={mode === 'learn'} onClick={() => setMode('learn')}>学習</button><button id="geo-mode-map" className="btn" aria-pressed={mode === 'map'} onClick={() => setMode('map')}>マップ</button></nav>;
    if (mode === 'map') return <section className="page-pad geography-page geo-explorer-page"><div className="page-title"><div><p className="section-kicker">Geography · Map Explorer</p><h1>一総通 地理 · マップ</h1><p>全体を眺める · 位置関係を理解する · 頻度を見る</p></div><button id="geo-back" className="btn btn-ghost" onClick={onBack}>一総通へ戻る</button></div>{modeTabs}<GeographyExplorer data={data} periodRows={periodRows} config={config} onPeriodChange={(key, value) => change(key, value)} /></section>;
    return <section className={'page-pad geography-page' + (running ? ' geo-drilling' : '')} data-revision={revision}>
 <div className="page-title"><div><p className="section-kicker">Geography</p><h1>一総通 地理 · 地図で覚える</h1><p>エリアを選ぶ → 範囲を選ぶ → 地図で覚える → 練習する</p></div><button id="geo-back" className="btn btn-ghost" onClick={onBack}>一総通へ戻る</button></div>
 {modeTabs}
 {notice && <p id="geo-notice" role="status">{notice}</p>}
 {!running && <><section className="panel geo-controls" aria-label="学習条件"><label>今日はどのエリア？<select id="geo-area" value={config.area} onChange={ev => change('area', ev.target.value)}>{data.master.areas.map(a => <option key={a.areaId} value={a.areaId}>{a.areaName}</option>)}</select></label><fieldset><legend>覚える範囲</legend><div className="geo-scopes">{(Object.keys(SCOPES) as Config['scope'][]).map(scope => <button key={scope} className="btn" data-scope={scope} aria-pressed={config.scope === scope} onClick={() => change('scope', scope)}>{SCOPES[scope]}<small>{area.cumulative[scope]}地点</small></button>)}</div></fieldset><details className="geo-period"><summary>登場回数の集計期間</summary><label>集計期間<select id="geo-period" value={config.period} onChange={ev => change('period', ev.target.value as Config['period'])}><option value="all">全期間</option><option value="10">最近10回</option><option value="5">最近5回</option><option value="custom">任意期間</option></select></label>{config.period === 'custom' && <div><label>開始<input id="geo-from" type="month" value={config.from} onChange={ev => change('from', ev.target.value)}/></label><label>終了<input id="geo-to" type="month" value={config.to} onChange={ev => change('to', ev.target.value)}/></label></div>}<p>覚える範囲は維持し、回数と強調・順番を更新します。</p></details></section>
 {invalid && <p role="alert">開始年月は終了年月以前にしてください。</p>}
 <p id="geo-scope-info"><strong>{area.areaName} · {SCOPES[config.scope]} {rows.length}地点</strong> — 過去問の正解・不正解を問わず、選択肢に登場した頻度をもとに優先度を付けています。{area.status !== 'USABLE' && '一部は過去問OCR集計による暫定データです。'}</p>
 {(last || (validActive(progress.active, data.master) && validConfig(progress.active?.snapshot, data.master))) && <div className="panel geo-resume"><p>前回：{data.master.areas.find(a => a.areaId === last?.area)?.areaName} / {last ? SCOPES[last.scope] : ''} / {last?.size === 'all' ? '全問' : last?.size + '問'}</p>{(validActive(progress.active, data.master) && validConfig(progress.active?.snapshot, data.master)) && <button id="geo-resume" className="btn btn-primary" onClick={resume}>前回の続き</button>}{last && <button id="geo-restore" className="btn" onClick={() => { setConfig({ ...last }); setSelected(null); }}>前回の条件で地図を見る</button>}</div>}
 <p id="geo-progress-summary" aria-live="polite">練習済み {practiced} / {rows.length}地点 · 未練習 {rows.length - practiced} · 最近の回答 {recent.filter(r => ['correct', 'sufficient'].includes(r.grade)).length}/{recent.length}正解（再出題を含む）。地図記号 ✓ 最近正解 / ! 練習中。</p></>}
 <div className="geo-workspace"><section className="panel geo-map-card"><div className="geo-map-heading"><h2>{area.areaName}</h2>{!running && <label>地名<select id="geo-labels" value={labels} onChange={ev => setLabels(ev.target.value)}><option value="on">表示</option><option value="off">隠す</option><option value="selected">選択中のみ</option></select></label>}</div>
 <GeographyMap key={config.area + '|' + (running?.currentID ?? 'browse')} data={data} area={area} rows={done ? [] : rows} selected={selected} onSelect={id => select(id, true)} current={current} solved={running?.solved ?? false} answerPoint={running?.answerPoint ?? null} positionMode={running?.snapshot.direction === 'position'} progress={progress} labelMode={labels} onAnswer={pt => { if (current)
        respond(judge(current, pt, toleranceFor(current, data.db, data.model, data.master.areas)).grade, pt); }}/>
 {!running && <><p className="geo-legend">◎ まず覚える · ◆ 標準へ · ● しっかり · ■ さらに</p><div className="geo-practice"><label>練習方法<select id="geo-direction" value={config.direction} onChange={ev => change('direction', ev.target.value as Config['direction'])}><option value="name">点を見て名称を答える</option><option value="position">名称から位置を選ぶ</option></select></label><label>1回の練習<select id="geo-size" value={config.size} onChange={ev => change('size', ev.target.value as Config['size'])}><option value="10">10問</option><option value="20">20問</option><option value="all">全問</option></select></label><button id="geo-start" className="btn btn-primary" disabled={invalid || !pool.length} onClick={() => start()}>{config.size === 'all' ? '全問' : config.size + '問'}で始める</button><button id="geo-weak" className="btn" disabled={!weak.length} onClick={() => start(weak.map(e => e.learningEntityId))}>最近間違えた地点を練習</button></div><p id="geo-pool-note">{pool.length ? `この範囲の${rows.length}地点から、点の位置が確認された${pool.length}地点を練習します。` : 'この範囲では地物の形を見て覚え、点の位置を練習するときは範囲を広げてください。'}</p></>}
 {running && current && <section id="geo-training" aria-label="白地図練習"><div className="geo-sessionbar"><strong id="geo-progress" aria-live="polite">{area.areaName} · {SCOPES[config.scope]} · 確認した {s?.mastered}/{s?.total} · 残り {s?.remaining} · 復習待ち {running.session.retries.length}</strong><button id="geo-stop" className="btn" onClick={stop}>地図に戻る</button></div><h2 id="geo-question">{running.snapshot.direction === 'name' ? '強調された地点の名称は？' : `「${current.displayName}」の位置を選んでください。`}</h2>{running.snapshot.direction === 'name' ? <form onSubmit={ev => { ev.preventDefault(); respond(nameMatches(current, answer) ? 'correct' : 'incorrect'); }}><label>地点の名称<input id="geo-answer" ref={input} required autoComplete="off" disabled={running.solved} value={answer} onChange={ev => setAnswer(ev.target.value)}/></label><button id="geo-submit" className="btn btn-primary" disabled={running.solved}>答える</button></form> : <p>地図をクリック／タップ。キーボードは矢印キーで十字を移動、Enterで回答。</p>}
 <p id="geo-feedback" role="status" aria-live="polite">{running.solved ? (['correct', 'sufficient'].includes(running.grade!) ? '正解です。' : '正解を確認して、もう一度。') + ' 答え：' + current.displayName : ''}</p>{running.solved && <p>{frequency(current)}</p>}<div className="geo-actions"><button id="geo-reveal" className="btn" disabled={running.solved} onClick={() => respond('revealed')}>答えを見る</button><button id="geo-next" ref={next} className="btn btn-primary" disabled={!running.solved} onClick={() => move(running)}>次へ</button></div><p className="geo-small">間違えた地点・答えを見た地点は、この練習でもう一度出題します。</p></section>}
 {done && stats && <section id="geo-result" ref={summary} tabIndex={-1}><h2>練習が終わりました</h2><p>{stats.total}地点。初回正解 {stats.firstCorrect}／初回誤答・答え確認 {stats.firstWrong}／再出題後正解 {stats.corrected}。</p><div className="geo-actions"><button id="geo-retry" className="btn" disabled={!stats.wrongIDs.length} onClick={() => start(stats.wrongIDs, running.snapshot)}>間違えた地点をもう一度</button><button id="geo-again" className="btn" onClick={() => start(undefined, { ...running.snapshot, size: '10' })}>もう10問</button><button id="geo-result-back" className="btn" onClick={stop}>地図を見る</button></div></section>}
 </section>
 {!running && <><aside className="panel geo-detail" id="geo-detail" aria-label="選択中の地点">{e ? <><span className="chip">{e.priorityClass} · {e.areaName}</span><h2>{e.displayName}</h2><p>{frequency(e)}</p><details><summary>登場回数とは？</summary><p>選択肢登場回数（正解・不正解を問わず）。選択中の集計期間の回数です。{e.choiceCount === null && '保存済みOCRの参考集計で、0回でも過去問登場なしとは限りません。'}</p></details><dl><dt>種別</dt><dd>{e.entityType}</dd><dt>正答での登場</dt><dd>{e.correctCount === null ? '集計対象外' : e.correctCount + '回（確認済み）'}</dd><dt>登場した試験期</dt><dd>{e.examSessionCount}期</dd><dt>初出 / 最終登場</dt><dd>{e.firstAppearance ?? '—'} / {e.lastAppearance ?? '—'}</dd><dt>位置</dt><dd>{e.lat !== null ? `${e.lat.toFixed(2)}° / ${e.lon?.toFixed(2)}°` : e.geometryId ? '地図上の範囲' : '地図以外で名称を確認できます'}</dd><dt>練習状況</dt><dd>{status(progress.entities[e.learningEntityId])}</dd></dl>{(e.historical || e.historicalBasis) && <p>過去の試験で用いられた施設名です。現在の運用状況とは別に学習します。</p>}<details><summary>別名・出典・施設状態</summary><p>{e.aliases.join(' / ') || '—'}</p>{(e.evidenceSummary.coordinateSourceIds ?? []).map(id => { const source = data.seed.sources.find(s => s.id === id); return source?.url ? <p key={id}><a href={source.url} target="_blank" rel="noreferrer">{source.title ?? id}</a></p> : <p key={id}>{id}</p>; })}<p>登場試験期：{e.examIds.join(' / ') || '—'}</p><p>現在の施設状態：{JSON.stringify(e.currentStatus ?? 'unverified')}</p><p>歴史的状態：{JSON.stringify(e.historicalStatus ?? [])}</p><p>固定ID：{e.learningEntityId}</p></details></> : <><h2>気になる地点を選んでみましょう</h2><p>地図や一覧から選ぶと、名称・登場回数・位置を確認できます。</p></>}</aside>
 <section className="panel geo-list-panel"><h2>この範囲の{rows.length}地点</h2><label>並び順<select id="geo-sort" value={sort} onChange={ev => setSort(ev.target.value)}><option value="priority">学習優先順</option><option value="frequency">登場回数順</option><option value="name">名前順</option></select></label><div ref={list} id="geo-list">{rows.map(e => <button className="geo-row" key={e.learningEntityId} data-id={e.learningEntityId} aria-pressed={selected === e.learningEntityId} onClick={() => select(e.learningEntityId)}><span><b>{e.displayName}</b><small>{e.priorityClass} · {status(progress.entities[e.learningEntityId])}</small></span><span>{frequency(e)}</span></button>)}</div></section></>}
 </div>
 <footer className="geo-footer"><details><summary>端末内の学習履歴</summary><p>同じブラウザ・同じURLの端末内に保存します。最近正解は完全習得を意味しません。地理履歴は端末保存で、本体のクラウド同期とは別です。</p><p id="geo-history">完了した練習 {progress.completed.length}回（最近20回まで保持） · 最近の回答 {progress.recent.length}回（200回まで保持）</p><button id="geo-export" className="btn" onClick={exportProgress}>地理履歴を書き出す</button><label>地理履歴を読み込む<input id="geo-import" type="file" accept="application/json" onChange={ev => { void importProgress(ev.target.files?.[0]); ev.target.value = ''; }}/></label><button id="geo-reset-area" className="btn" onClick={() => setConfirm('area')}>このエリアの履歴を消す</button><button id="geo-reset-all" className="btn" onClick={() => setConfirm('all')}>全地理の履歴を消す</button></details><details><summary>登場回数と教材について</summary><p>選択肢登場回数（正解・不正解を問わず）。最近5・10回はエリアが収録された試験期を数えます。頻度は将来の出題を保証しません。一部古い問題はOCR/復元データです。地点位置は学習用の代表位置を含みます。現在の施設状態と過去問登場は別の情報です。</p><p>確認済み正答地点に対する過去データ評価は得点率・合格率ではありません。この画面の正解数は本人の練習結果です。</p></details></footer>
 <dialog ref={dialog} className="geo-dialog" aria-labelledby="geo-confirm-title" onCancel={() => setConfirm(null)}><h2 id="geo-confirm-title">{confirm === 'import' ? '地理履歴をファイルの内容で置き換えますか？' : confirm === 'area' ? 'このエリアの地理履歴を消しますか？' : '全エリアの地理履歴を消しますか？'}</h2><p>地理以外の履歴には触れません。</p><button ref={cancel} id="geo-cancel" className="btn" onClick={closeDialog}>やめる</button><button id="geo-confirm" className="btn btn-primary" onClick={resetOrImport}>実行する</button></dialog>
 </section>;
}
