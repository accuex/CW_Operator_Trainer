'use client';
import { useMemo, useState } from 'react';
import type { Config, Dataset } from '@/lib/geography/types';
import { POINT_TYPES, appearanceCount, countText, explorerGeometries, explorerPoints } from '@/lib/geography/explorer';
import ExplorerMap from './ExplorerMap';

type Kind = keyof typeof POINT_TYPES;
export default function GeographyExplorer({ data, periodRows, config, onPeriodChange }: {
  data: Dataset; periodRows: Dataset['master']['entities']; config: Config;
  onPeriodChange: (key: 'period' | 'from' | 'to', value: string) => void;
}) {
  const [area, setArea] = useState('japan'), [layers, setLayers] = useState<Kind[]>(Object.keys(POINT_TYPES) as Kind[]);
  const [labels, setLabels] = useState(true), [selected, setSelected] = useState<string | null>(null), [search, setSearch] = useState('');
  const points = useMemo(() => explorerPoints(data.master, periodRows), [data.master, periodRows]);
  const shapes = useMemo(() => explorerGeometries(data, periodRows), [data, periodRows]);
  const registered = [...points, ...shapes], areaRows = registered.filter(e => area === 'all' || e.areaId === area);
  const visible = areaRows.filter(e => layers.includes(e.entityType as Kind));
  const pointIDs = new Set(points.map(e => e.learningEntityId));
  const rows = visible.filter(e => [e.displayName, ...e.aliases].some(n => n.toLowerCase().includes(search.toLowerCase()))).sort((a, b) => appearanceCount(b) - appearanceCount(a) || a.displayName.localeCompare(b.displayName, 'ja'));
  const detail = visible.find(e => e.learningEntityId === selected), full = data.master.entities.find(e => e.learningEntityId === selected);
  const invalid = config.period === 'custom' && config.from && config.to && config.from > config.to;
  const maximum = Math.max(1, ...points.map(appearanceCount));
  const areaName = data.master.areas.find(a => a.areaId === area)?.areaName ?? '全エリア';
  function toggle(kind: Kind) { setLayers(xs => xs.includes(kind) ? xs.filter(x => x !== kind) : [...xs, kind]); }
  return <>
    <section className="panel explorer-toolbar" aria-label="マップ表示条件">
      <label>表示エリア<select id="explorer-area" value={area} onChange={e => { setArea(e.target.value); setSelected(null); }}>{data.master.areas.map(a => <option key={a.areaId} value={a.areaId}>{a.areaName}</option>)}<option value="all">全エリア</option></select></label>
      <label>登場回数の集計期間<select id="explorer-period" value={config.period} onChange={e => onPeriodChange('period', e.target.value)}><option value="all">全期間</option><option value="10">最近10回</option><option value="5">最近5回</option><option value="custom">任意期間</option></select></label>
      {config.period === 'custom' && <><label>開始<input id="explorer-from" type="month" value={config.from} onChange={e => onPeriodChange('from', e.target.value)} /></label><label>終了<input id="explorer-to" type="month" value={config.to} onChange={e => onPeriodChange('to', e.target.value)} /></label></>}
      <label className="explorer-check"><input id="explorer-labels" type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)} />地名表示 ON / OFF</label>
    </section>
    {invalid && <p role="alert">開始年月は終了年月以前にしてください。期間を直すまで地図の集計を表示しません。</p>}
    <div className="explorer-layout">
      <aside className="panel explorer-sidebar"><h2>重ねるレイヤー</h2><fieldset aria-label="種別レイヤー">{(Object.keys(POINT_TYPES) as Kind[]).map(kind => <label key={kind} className="explorer-check"><input type="checkbox" data-layer={kind} checked={layers.includes(kind)} onChange={() => toggle(kind)} /><span className={'explorer-kind kind-' + kind}>{POINT_TYPES[kind].symbol}</span>{POINT_TYPES[kind].label}<small>{areaRows.filter(e => e.entityType === kind).length}</small></label>)}</fieldset>
        <div className="geo-actions"><button id="explorer-all-on" className="btn btn-sm" onClick={() => setLayers(Object.keys(POINT_TYPES) as Kind[])}>すべてON</button><button id="explorer-all-off" className="btn btn-sm" onClick={() => setLayers([])}>すべてOFF</button></div>
        <p className="geo-small">大きい点ほど選択期間の登場回数が多い地点。範囲地物は形で表示します。現在廃止された施設も、過去問の記録として保持しています。</p>
        <h2>対象の一覧</h2><label>名称を探す<input id="explorer-search" type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="七尾、Skagerrak…" /></label>
        <p id="explorer-count" aria-live="polite">{visible.filter(e => pointIDs.has(e.learningEntityId)).length}ポイント / {visible.filter(e => !pointIDs.has(e.learningEntityId)).length}範囲地物</p>
        <div id="explorer-list">{rows.map(e => <button key={e.learningEntityId} className="geo-row" data-id={e.learningEntityId} aria-pressed={selected === e.learningEntityId} onClick={() => setSelected(e.learningEntityId)}><span><b>{e.displayName}</b><small>{POINT_TYPES[e.entityType as Kind]?.label}</small></span><span>{invalid ? '—' : (e.choiceCount === null ? 'OCR参考 ' : '') + appearanceCount(e) + '回'}</span></button>)}{!rows.length && <p>表示する地点がありません。</p>}</div>
      </aside>
      <section className="explorer-map-card"><h2>{areaName}</h2><ExplorerMap key={area} data={data} areaID={area} points={invalid ? [] : visible.filter(e => pointIDs.has(e.learningEntityId))} shapes={invalid ? [] : visible.filter(e => !pointIDs.has(e.learningEntityId))} maximum={maximum} selected={detail?.learningEntityId ?? null} labels={labels} onSelect={setSelected} />
        <p className="geo-small">確認済みポイント全{points.length}地点 · 確認済み範囲地物{shapes.length}件 · 座標未確認の地点は配置しません。ドラッグ・2本指で移動／拡大、＋／−でも操作できます。</p>
        <div className="explorer-legend"><span><i className="frequency-dot small" />少ない</span><span><i className="frequency-dot medium" />中程度</span><span><i className="frequency-dot large" />多い</span><span>破線の記号＝OCR参考集計</span></div>
        <aside id="explorer-detail" className="panel geo-detail" aria-live="polite">{detail && full ? <><h2>{detail.displayName}</h2><dl><dt>種別</dt><dd>{POINT_TYPES[detail.entityType as Kind]?.label}</dd><dt>エリア</dt><dd>{detail.areaName}</dd><dt>全期間</dt><dd>{countText(full)}</dd><dt>選択期間</dt><dd>{invalid ? '期間を確認してください' : countText(detail)}</dd><dt>初出 / 最終登場</dt><dd>{detail.firstAppearance ?? '—'} / {detail.lastAppearance ?? '—'}（選択期間）</dd><dt>位置の根拠</dt><dd>{pointIDs.has(detail.learningEntityId) ? '確認済み資料の代表位置' : '確認済み範囲地物（代表点は未設定）'}</dd></dl><details><summary>登場履歴・出典・施設状態</summary><p>選択期間の登場試験期：{detail.examIds.join(' / ') || '記録なし'}</p><p>全期間の登場試験期：{full.examIds.join(' / ') || '記録なし'}</p><p>別名：{detail.aliases.join(' / ') || '—'}</p>{(detail.evidenceSummary.coordinateSourceIds ?? []).map(id => { const source = data.seed.sources.find(s => s.id === id); return <p key={id}>{source?.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title ?? id}</a> : source?.title ?? id}</p>; })}<p>現在の施設状態：{JSON.stringify(full.currentStatus ?? 'unverified')}</p><p>歴史的状態：{JSON.stringify(full.historicalStatus ?? [])}</p><p>固定ID：{detail.learningEntityId}</p></details>{(full.historical || full.historicalBasis) && <p>過去の施設名です。過去問登場と現在の施設状態は別の情報です。</p>}</> : <><h2>地点を選んで詳細を確認</h2><p>地名OFFでも、点・範囲地物や一覧を選ぶと名称と登場回数を確認できます。</p></>}</aside>
      </section>
    </div>
    <p className="geo-small">選択肢登場回数（正解・不正解を問わず）。最近5・10回はエリアが収録された試験期を数えます。OCR参考集計は確認済み選択肢集計とは区別し、0回でも登場なしとは限りません。頻度は得点率・合格率・次回出題確率ではありません。地図：既存Natural Earth等の教材用地理データ。</p>
  </>;
}
