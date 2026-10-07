import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { appearanceCount, countText, explorerGeometries, explorerPoints, markerRadius, POINT_TYPES } from './explorer';
import type { Dataset, Entity, Master } from './types';
const read = (name: string) => JSON.parse(readFileSync('public/geography/data/' + name, 'utf8'));
const master: Master = read('learning-master-stage13.json');
const all: Entity[] = read('learning-period-all-stage13.json').entities;
const five: Entity[] = read('learning-period-5-stage13.json').entities;
describe('Map Explorer read-only data contract', () => {
  it('shows every verified point, independent of learning tiers, across eight areas', () => {
    const points = explorerPoints(master, all);
    expect(points).toHaveLength(133);
    expect(new Set(points.map(e => e.areaId)).size).toBe(8);
    expect(points.filter(e => e.areaId === 'japan')).toHaveLength(70);
    expect(points.every(e => e.coordinateConfidence === 'verified_source_representative' && Number.isFinite(e.lat) && Number.isFinite(e.lon))).toBe(true);
    expect(points.some(e => e.priorityClass === 'D')).toBe(true);
  });
  it('uses saved period materialization without changing membership or stored IDs', () => {
    const snapshot = JSON.stringify(master), points = explorerPoints(master, five);
    expect(points.map(e => e.learningEntityId)).toEqual(explorerPoints(master, all).map(e => e.learningEntityId));
    for (const e of points) expect(e.choiceCount).toBe(five.find(f => f.learningEntityId === e.learningEntityId)!.choiceCount);
    expect(JSON.stringify(master)).toBe(snapshot);
    expect(points.some(e => appearanceCount(e) !== appearanceCount(all.find(f => f.learningEntityId === e.learningEntityId)!))).toBe(true);
  });
  it('only uses verified geometry, without assigning representative coordinates', () => {
    const shapes = explorerGeometries({ master, geoms: read('geometries-stage13.json') } as Dataset, all);
    expect(shapes).toHaveLength(89);
    expect(shapes.every(e => e.lat === null && e.lon === null)).toBe(true);
    expect([...explorerPoints(master, all), ...shapes].every(e => e.entityType in POINT_TYPES)).toBe(true);
  });
  it('bounds display radius and preserves count semantics including zero and OCR', () => {
    expect(markerRadius(0, 21)).toBe(4);
    expect(markerRadius(21, 21)).toBe(14);
    expect(markerRadius(3, 21)).toBeLessThan(markerRadius(16, 21));
    const provisional = explorerPoints(master, all).find(e => e.choiceCount === null)!;
    expect(countText(provisional)).toContain('OCR参考');
    expect(countText(all.find(e => e.choiceCount !== null)!)).toContain('正解・不正解を問わず');
    expect(master.areas.find(a => a.areaId === 'japan')!.cumulative).toEqual({ A: 32, AB: 81, ABC: 128, ALL: 160 });
  });
});
