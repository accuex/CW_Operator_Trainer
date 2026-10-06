'use client';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { drillPool, labels as placeLabels, projector, viewBounds } from '@/lib/geography/engine/stage14-core.js';
import { status } from '@/lib/geography/engine/stage15-core.js';
import type { Area, Dataset, Entity, Geometry, Point, Progress } from '@/lib/geography/types';
const colors = { A: '#b36023', B: '#1d728b', C: '#587841', D: '#62727b' };
const resize = (fn: () => void) => { window.addEventListener('resize', fn); return () => window.removeEventListener('resize', fn); };
export default function GeographyMap({ data, area, rows, selected, onSelect, current, solved, answerPoint, positionMode, onAnswer, progress, labelMode }: {
    data: Dataset;
    area: Area;
    rows: Entity[];
    selected: string | null;
    onSelect: (id: string) => void;
    current: Entity | null;
    solved: boolean;
    answerPoint: Point | null;
    positionMode: boolean;
    onAnswer: (p: Point) => void;
    progress: Progress;
    labelMode: string;
}) {
    const mobile = useSyncExternalStore(resize, () => window.innerWidth <= 760, () => false), W = mobile ? 600 : 960, H = mobile ? 820 : 720;
    const projection = useMemo(() => projector(viewBounds(area, data.master.entities), W, H), [area, data.master.entities, W, H]);
    const [screenWidth, setScreenWidth] = useState(W);
    const [zoom, setZoom] = useState(1), [center, setCenter] = useState<Point | null>(null), [cross, setCross] = useState<Point | null>(null);
    const svg = useRef<SVGSVGElement>(null), drag = useRef<{
        x: number;
        y: number;
        center: Point;
        moved: boolean;
    } | null>(null), c = center ?? [W / 2, H / 2];
    const path = (g: Geometry) => { const line = (r: number[][]) => r.map((p, i) => (i ? 'L' : 'M') + projection.project(p as Point).map(v => v.toFixed(2)).join(',')).join('') + 'Z'; return g.type === 'Polygon' ? (g.coordinates as number[][][]).map(line).join('') : (g.coordinates as number[][][][]).flatMap(p => p.map(line)).join(''); };
    // Basemap paths depend only on the projection, never on learner history.
    const land = useMemo(() => data.base.features.map(f => { const line = (r: number[][]) => r.map((p, i) => (i ? 'L' : 'M') + projection.project(p as Point).map(v => v.toFixed(2)).join(',')).join('') + 'Z'; return f.geometry.type === 'Polygon' ? (f.geometry.coordinates as number[][][]).map(line).join('') : (f.geometry.coordinates as number[][][][]).flatMap(p => p.map(line)).join(''); }), [data.base, projection]);
    const points = drillPool(rows), lab = placeLabels(points.filter(e => labelMode === 'on' || labelMode === 'selected' && e.learningEntityId === selected).map(e => { const [x, y] = projection.project([e.lon!, e.lat!]); return { id: e.learningEntityId, name: e.displayName, x, y, selected: e.learningEntityId === selected }; }).sort((a, b) => Number(b.selected) - Number(a.selected)), W, H);
    useEffect(() => { const el = svg.current; if (!el)
        return; const observer = new ResizeObserver(entries => { setScreenWidth(entries[0].contentRect.width || W); }); observer.observe(el); return () => observer.disconnect(); }, [W]);
    const chooseAt = (clientX: number, clientY: number) => { const m = svg.current?.getScreenCTM(); if (!m)
        return; const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse()); onAnswer(projection.unproject([p.x, p.y])); };
    const target = current ? projection.project([current.lon!, current.lat!]) : null, user = answerPoint ? projection.project(answerPoint) : null;
    return <><div className="geo-map-tools"><button className="btn btn-sm" aria-label="地図を拡大" onClick={() => setZoom(z => Math.min(6, z * 1.5))}>＋</button><button className="btn btn-sm" aria-label="地図を縮小" onClick={() => setZoom(z => Math.max(1, z / 1.5))}>−</button><button className="btn btn-sm" onClick={() => { setZoom(1); setCenter(null); setCross(null); }}>全体</button><span>拡大後はドラッグで移動</span></div>
 <svg ref={svg} id="geo-map" data-width={W} data-height={H} viewBox={`${c[0] - W / 2 / zoom} ${c[1] - H / 2 / zoom} ${W / zoom} ${H / zoom}`} role={positionMode && current ? 'application' : 'img'} tabIndex={0} aria-label={current ? (positionMode ? '白地図。矢印キーで位置を選びEnterで回答。' : '強調した地点の名称を答えてください。') : area.areaName + 'の学習地図'} onPointerDown={e => { if (!current && (e.target as Element).closest('[data-id]'))
        return; drag.current = { x: e.clientX, y: e.clientY, center: [...c] as Point, moved: false }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const d = drag.current; if (!d)
        return; if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 8)
        d.moved = true; if (d.moved && zoom > 1) {
        const scale = e.currentTarget.getScreenCTM()?.a ?? 1;
        setCenter([d.center[0] - (e.clientX - d.x) / scale, d.center[1] - (e.clientY - d.y) / scale]);
    } }} onPointerUp={e => { if (drag.current?.moved) {
        drag.current = null;
        return;
    } drag.current = null; if (current) {
        if (positionMode && !solved)
            chooseAt(e.clientX, e.clientY);
    }
    else {
        const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
        if (id)
            onSelect(id);
    } }} onPointerCancel={() => drag.current = null} onKeyDown={e => { if (!current) {
        const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id');
        if (id && ['Enter', ' '].includes(e.key)) {
            e.preventDefault();
            onSelect(id);
        }
        else if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
            e.preventDefault();
            const ds: Record<string, Point> = { ArrowLeft: [-30, 0], ArrowRight: [30, 0], ArrowUp: [0, -30], ArrowDown: [0, 30] }, [dx, dy] = ds[e.key];
            setCenter([c[0] + dx / zoom, c[1] + dy / zoom]);
        }
        return;
    } if (!positionMode || solved)
        return; if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
        e.preventDefault();
        const pt = cross ?? [...c] as Point;
        if (e.key === 'Enter') {
            onAnswer(projection.unproject(pt));
            return;
        }
        const delta: Record<string, Point> = { ArrowLeft: [-12, 0], ArrowRight: [12, 0], ArrowUp: [0, -12], ArrowDown: [0, 12] };
        const [dx, dy] = delta[e.key];
        setCross([pt[0] + dx / zoom, pt[1] + dy / zoom]);
    } }}>
 <defs><clipPath id="geoClip"><rect width={W} height={H}/></clipPath></defs><g clipPath="url(#geoClip)">{land.map((d, i) => <path key={i} d={d} className="geo-land"/>)}
 {!current && <>{rows.filter(e => e.geometryId && data.geoms[e.geometryId]).map(e => <path key={e.learningEntityId} d={path(data.geoms[e.geometryId!])} data-id={e.learningEntityId} className={'geo-area' + (selected === e.learningEntityId ? ' selected' : '')} fill={colors[e.priorityClass]} stroke={colors[e.priorityClass]} tabIndex={0} role="button" aria-label={e.displayName}/>)}
 {points.map(e => { const [x, y] = projection.project([e.lon!, e.lat!]), r = 5 + Math.min(3, Math.sqrt(e.choiceCount ?? e.provisionalChoiceCount ?? 0) / 3), fill = colors[e.priorityClass], st = status(progress.entities[e.learningEntityId]); return <g key={e.learningEntityId} data-id={e.learningEntityId} className={'geo-marker' + (selected === e.learningEntityId ? ' selected' : '')} tabIndex={0} role="button" aria-label={`${e.displayName}、${e.priorityClass}、${st}`}><circle cx={x} cy={y} r={Math.min(48, 22 * W / screenWidth / zoom)} fill="transparent"/>{e.priorityClass === 'B' ? <path d={`M${x},${y - r - 1}L${x + r + 1},${y}L${x},${y + r + 1}L${x - r - 1},${y}Z`} fill={fill} className="geo-symbol"/> : e.priorityClass === 'D' ? <rect x={x - r} y={y - r} width={r * 2} height={r * 2} fill={fill} className="geo-symbol"/> : <><circle cx={x} cy={y} r={r} fill={fill} className="geo-symbol"/>{e.priorityClass === 'A' && <circle cx={x} cy={y} r={r + 3} fill="none" stroke={fill}/>}</>}{st !== '未練習' && <text x={x + 11} y={y - 10} className="geo-progress-mark">{st === '最近正解' ? '✓' : '!'}</text>}</g>; })}
 {lab.map(l => <text key={l.id} x={l.x + 3} y={l.y + 14} className="geo-label">{l.name}</text>)}</>}
 {target && (!positionMode || solved) && <><circle cx={target[0]} cy={target[1]} r={13} className="geo-target"/><circle cx={target[0]} cy={target[1]} r={21} fill="none" stroke="#162c36" strokeDasharray="4 4"/></>}
 {target && user && <><line x1={user[0]} y1={user[1]} x2={target[0]} y2={target[1]} className="geo-answer-line"/><circle cx={user[0]} cy={user[1]} r={8} className="geo-user"/></>}
 {current && positionMode && !solved && cross && <path d={`M${cross[0] - 15},${cross[1]}H${cross[0] + 15}M${cross[0]},${cross[1] - 15}V${cross[1] + 15}`} className="geo-cross"/>}</g></svg></>;
}
