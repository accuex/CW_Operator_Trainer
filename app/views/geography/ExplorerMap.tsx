'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { labels as placeLabels, projector, viewBounds } from '@/lib/geography/engine/stage14-core.js';
import { appearanceCount, markerRadius, countText } from '@/lib/geography/explorer';
import type { Dataset, Entity, Geometry, Point } from '@/lib/geography/types';
const colors: Record<string, string> = { station: '#ae7907', port: '#287aad', landform: '#78639a', strait: '#187c70', sea: '#187c70', country: '#78639a' };
interface Camera { zoom: number; center: Point }
export default function ExplorerMap({ data, areaID, points, shapes, maximum, selected, labels, onSelect }: {
  data: Dataset; areaID: string; points: Entity[]; shapes: Entity[]; maximum: number;
  selected: string | null; labels: boolean; onSelect: (id: string) => void;
}) {
  const svg = useRef<SVGSVGElement>(null), frame = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 960, h: 680 }), [camera, setCamera] = useState<Camera>({ zoom: 1, center: [480, 340] });
  const pointers = useRef(new Map<number, Point>()), gesture = useRef<{ camera: Camera; origin: Point; distance: number; count: number; moved: boolean; id: string | null } | null>(null);
  const { w: W, h: H } = size;
  const area = data.master.areas.find(a => a.areaId === areaID);
  const projection = useMemo(() => projector(area ? viewBounds(area, data.master.entities) : [-150, -58, 180, 78], W, H), [area, data.master.entities, W, H]);
  useEffect(() => {
    if (!frame.current) return;
    const observer = new ResizeObserver(entries => { const w = Math.max(240, entries[0].contentRect.width), h = w < 600 ? 520 : Math.min(800, Math.max(600, window.innerHeight * .76)); setSize({ w, h }); setCamera({ zoom: 1, center: [w / 2, h / 2] }); });
    observer.observe(frame.current); return () => observer.disconnect();
  }, []);
  const path = useMemo(() => (g: Geometry) => { const line = (r: number[][]) => r.map((p, i) => (i ? 'L' : 'M') + projection.project(p as Point).map(v => v.toFixed(2)).join(',')).join('') + 'Z'; return g.type === 'Polygon' ? (g.coordinates as number[][][]).map(line).join('') : (g.coordinates as number[][][][]).flatMap(p => p.map(line)).join(''); }, [projection]);
  const land = useMemo(() => data.base.features.map(f => path(f.geometry)), [data.base, path]);
  const screen = (p: Point): Point => [(p[0] - camera.center[0]) * camera.zoom + W / 2, (p[1] - camera.center[1]) * camera.zoom + H / 2];
  const projected = points.map(e => { const [x, y] = screen(projection.project([e.lon!, e.lat!])); return { e, x, y, r: markerRadius(appearanceCount(e), maximum) }; }).sort((a, b) => Number(a.e.learningEntityId === selected) - Number(b.e.learningEntityId === selected) || b.r - a.r);
  // Label collision boxes are in screen coordinates and are recomputed after every pan/zoom.
  const lab = labels ? placeLabels(projected.filter(p => p.x > 5 && p.x < W - 5 && p.y > 5 && p.y < H - 5).sort((a, b) => Number(b.e.learningEntityId === selected) - Number(a.e.learningEntityId === selected) || b.r - a.r).map(p => ({ id: p.e.learningEntityId, name: p.e.displayName + ' · ' + (p.e.choiceCount === null ? 'OCR ' : '') + appearanceCount(p.e), x: p.x, y: p.y, selected: p.e.learningEntityId === selected })), W, H) : [];
  function local(x: number, y: number): Point { const rect = svg.current!.getBoundingClientRect(); return [(x - rect.left) * W / rect.width, (y - rect.top) * H / rect.height]; }
  function metrics() { const ps = [...pointers.current.values()]; return { mid: ps.length > 1 ? [(ps[0][0] + ps[1][0]) / 2, (ps[0][1] + ps[1][1]) / 2] as Point : ps[0], distance: ps.length > 1 ? Math.hypot(ps[1][0] - ps[0][0], ps[1][1] - ps[0][1]) : 0, count: ps.length }; }
  function begin(id: string | null, moved = false) { const m = metrics(); gesture.current = { camera, origin: m.mid, distance: m.distance, count: m.count, moved, id }; }
  function finish(pointerID: number, cancelled: boolean) {
    const g = gesture.current; pointers.current.delete(pointerID);
    if (!cancelled && g && !g.moved && g.count === 1 && g.id) onSelect(g.id);
    if (pointers.current.size) begin(null, true); else gesture.current = null;
  }
  function zoom(factor: number) { setCamera(c => ({ ...c, zoom: Math.min(64, Math.max(1, c.zoom * factor)) })); }
  return <div ref={frame} className="explorer-map-frame">
    <div className="explorer-map-tools"><button id="explorer-zoom-in" className="btn" aria-label="マップを拡大" onClick={() => zoom(1.5)}>＋</button><button id="explorer-zoom-out" className="btn" aria-label="マップを縮小" onClick={() => zoom(1 / 1.5)}>−</button><button id="explorer-reset-view" className="btn" onClick={() => setCamera({ zoom: 1, center: [W / 2, H / 2] })}>全体</button></div>
    <svg ref={svg} id="explorer-map" viewBox={`0 0 ${W} ${H}`} style={{ height: H }} data-zoom={camera.zoom} data-center={camera.center.join(',')} role="group" tabIndex={0} aria-label={(area?.areaName ?? '全エリア') + 'の地理マップ。矢印キーで移動、＋／−で拡大縮小。'}
      onPointerDown={e => { if (e.button !== 0) return; pointers.current.set(e.pointerId, local(e.clientX, e.clientY)); const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id') ?? null; begin(id, pointers.current.size > 1); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerMove={e => { if (!pointers.current.has(e.pointerId)) return; pointers.current.set(e.pointerId, local(e.clientX, e.clientY)); const g = gesture.current; if (!g) return; const m = metrics(); if (Math.hypot(m.mid[0] - g.origin[0], m.mid[1] - g.origin[1]) > 6 || m.count > 1) g.moved = true; if (!g.moved) return; const z = Math.min(64, Math.max(1, g.camera.zoom * (m.count > 1 && g.distance ? m.distance / g.distance : 1))); const anchor: Point = [g.camera.center[0] + (g.origin[0] - W / 2) / g.camera.zoom, g.camera.center[1] + (g.origin[1] - H / 2) / g.camera.zoom]; setCamera({ zoom: z, center: [anchor[0] - (m.mid[0] - W / 2) / z, anchor[1] - (m.mid[1] - H / 2) / z] }); }}
      onPointerUp={e => finish(e.pointerId, false)} onPointerCancel={e => finish(e.pointerId, true)}
      onKeyDown={e => { const id = (e.target as Element).closest('[data-id]')?.getAttribute('data-id'); if (id && ['Enter', ' '].includes(e.key)) { e.preventDefault(); onSelect(id); return; } const deltas: Record<string, Point> = { ArrowLeft: [-40, 0], ArrowRight: [40, 0], ArrowUp: [0, -40], ArrowDown: [0, 40] }; if (deltas[e.key]) { e.preventDefault(); const [dx, dy] = deltas[e.key]; setCamera(c => ({ ...c, center: [c.center[0] + dx / c.zoom, c.center[1] + dy / c.zoom] })); } else if (['+', '=', '-'].includes(e.key)) { e.preventDefault(); zoom(e.key === '-' ? 1 / 1.5 : 1.5); } }}>
      <g transform={`translate(${W / 2},${H / 2}) scale(${camera.zoom}) translate(${-camera.center[0]},${-camera.center[1]})`}>
        {land.map((d, i) => <path key={i} d={d} className="explorer-land" vectorEffect="non-scaling-stroke" />)}
        {shapes.map(e => <path key={e.learningEntityId} data-id={e.learningEntityId} data-type={e.entityType} d={path(data.geoms[e.geometryId!])} className={'explorer-area' + (selected === e.learningEntityId ? ' selected' : '')} fill={colors[e.entityType]} stroke={colors[e.entityType]} vectorEffect="non-scaling-stroke" tabIndex={0} role="button" aria-label={e.displayName + '、' + countText(e)}><title>{e.displayName}：{countText(e)}</title></path>)}
      </g>
      {projected.map(({ e, x, y, r }) => <g key={e.learningEntityId} data-id={e.learningEntityId} data-type={e.entityType} data-count={appearanceCount(e)} data-radius={r} transform={`translate(${x},${y})`} className={'explorer-marker' + (selected === e.learningEntityId ? ' selected' : '')} role="button" tabIndex={0} aria-label={e.displayName + '、' + countText(e)}><title>{e.displayName}：{countText(e)}</title><circle r={Math.max(16, r + 3)} fill="transparent" />
        <g className="explorer-symbol" fill={colors[e.entityType]} strokeDasharray={e.choiceCount === null ? '2 2' : undefined}>{e.entityType === 'port' ? <rect x={-r * .85} y={-r * .85} width={r * 1.7} height={r * 1.7} rx={1} /> : e.entityType === 'landform' ? <path d={`M0,${-r}L${r},${r}H${-r}Z`} /> : e.entityType === 'strait' ? <path d={`M0,${-r}L${r},0L0,${r}L${-r},0Z`} /> : <><circle r={r} /><circle r={r * .45} fill="none" /></>}</g>
      </g>)}
      {lab.map(l => <text key={l.id} data-label-id={l.id} x={l.x + 3} y={l.y + 14} className="explorer-label">{l.name}</text>)}
    </svg>
  </div>;
}
