import {validConfig} from './config';
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { SCOPES, selectedEntities, drillPool, createSession, nextSession, recordSession, toleranceFor, judge } from './engine/stage14-core.js';
import { openStore, empty, choose, record, result, validate, validActive } from './engine/stage15-core.js';
import { pathToView, viewToPath } from '../appPaths';
import type { Master, Entity, Progress, Checkpoint } from './types';
const read = (p: string) => JSON.parse(readFileSync(p, 'utf8'));
const root = 'docs/1sou_tiri/geography-stage2/', master = read(root + 'data/learning-master-stage13.json') as Master;
const manifest = read('docs/1sou_tiri/Stage16_geography_manifest.json') as {
    engines: Record<string, string>;
    data: Record<string, string>;
};
const digest = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
describe('Stage16 integration contracts', () => {
    it('preserves every engine and every public data file byte-for-byte', () => { for (const [f, s] of Object.entries(manifest.engines)) {
        expect(digest('lib/geography/engine/' + f)).toBe(s);
        expect(digest(root + f)).toBe(s);
    } for (const [f, s] of Object.entries(manifest.data)) {
        expect(digest('public/geography/data/' + f)).toBe(s);
        expect(digest(root + 'data/' + f)).toBe(s);
    } });
    it('keeps all eight areas and Japan tiers', () => { expect(master.areas).toHaveLength(8); expect(master.entities).toHaveLength(497); expect(master.areas.find(a => a.areaId === 'japan')?.cumulative).toEqual({ A: 32, AB: 81, ABC: 128, ALL: 160 }); expect(drillPool(master.entities)).toHaveLength(133); expect(drillPool(master.entities.filter(e => e.areaId === 'japan'))).toHaveLength(70); for (const a of master.areas)
        for (const scope of Object.keys(SCOPES) as (keyof typeof SCOPES)[])
            expect(selectedEntities(master, master.entities, a.areaId, scope)).toHaveLength(a.cumulative[scope]); });
    it('preserves 580 verified keys and unknown evidence', () => { const keys = read(root + 'data/answer-keys.json'); expect(keys.answer_keys).toHaveLength(580); expect(keys.answer_keys.every((k: {
        verification_status: string;
    }) => k.verification_status === 'verified')).toBe(true); expect(master.counts.unknownCorrect).toBe(238); });
    it('extends the existing app routing without changing old views', () => { expect(viewToPath('geography')).toBe('/app/geography'); expect(pathToView('/app/geography')).toBe('geography'); expect(pathToView('/app/qso')).toBe('qso'); expect(viewToPath('home')).toBe('/app'); });
    it('keeps full-period membership when the frequency period changes', () => { const recent = read(root + 'data/learning-period-5-stage13.json').entities as Entity[]; const all = selectedEntities(master, master.entities, 'japan', 'AB'), five = selectedEntities(master, recent, 'japan', 'AB'); expect(five.map(e => e.learningEntityId)).toEqual(all.map(e => e.learningEntityId)); expect(five.every(e => e.examSessionCount <= 5)).toBe(true); });
    it('uses 10/20/all unique fresh questions and the unchanged requeue', () => { const pool = drillPool(selectedEntities(master, master.entities, 'japan', 'AB')); expect(choose(pool, empty(), '10')).toHaveLength(10); expect(choose(pool, empty(), '20')).toHaveLength(20); expect(choose(pool, empty(), 'all')).toHaveLength(35); const s = createSession(choose(pool, empty()).map(e => e.learningEntityId)); let i = 0, id; while ((id = nextSession(s))) {
        recordSession(s, id, i < 2 ? 'incorrect' : 'correct');
        if (++i > 30)
            throw Error('runaway');
    } expect(result(s)).toMatchObject({ total: 10, firstCorrect: 8, firstWrong: 2, corrected: 2 }); });
    it('keeps the Stage15 progress format, per-session counts and ID through rank changes', () => { const e = drillPool(master.entities)[0], p = empty(); record(p, e.learningEntityId, 'incorrect', { area: e.areaId, scope: 'A', mode: 'name' }, 's'); record(p, e.learningEntityId, 'correct', { area: e.areaId, scope: 'A', mode: 'name' }, 's'); expect(p.entities[e.learningEntityId].sessionCount).toBe(1); expect(validate(JSON.parse(JSON.stringify(p)))).toEqual(p); expect(choose([{ ...e, areaRank: 999, displayName: 'changed' }], p, 'all')[0].learningEntityId).toBe(e.learningEntityId); });
    it('accepts saved Stage15 checkpoints without re-counting answers', () => { const e = drillPool(master.entities.filter(e => e.areaId === 'japan'))[0], s = createSession([e.learningEntityId]); nextSession(s); recordSession(s, e.learningEntityId, 'correct'); const a: Checkpoint = { sessionID: 'legacy-stage15', session: s, snapshot: { area: 'japan', scope: 'A', direction: 'name', size: '10', period: 'all', from: '2015-01', to: '2025-12' }, currentID: e.learningEntityId, solved: true, grade: 'correct', answerPoint: null }; expect(validActive(a, master)).toBe(true); const p = empty(); p.active = a; expect(validate(JSON.parse(JSON.stringify(p))).active?.session.results).toHaveLength(1); });
    it('isolates reset, malformed data and unavailable storage', () => { let value: string | null = null; const storage = { getItem: () => value, setItem: (_k: string, v: string) => value = v }; const store = openStore(storage); record(store.data, 'jp', 'incorrect', { area: 'japan', scope: 'A', mode: 'name' }, 's'); record(store.data, 'eu', 'correct', { area: 'europe', scope: 'A', mode: 'name' }, 's'); store.save(); store.reset('japan'); expect(store.data.entities.jp).toBeUndefined(); expect(store.data.entities.eu.correct).toBe(1); value = 'malformed'; const broken = openStore(storage); broken.save(); expect(value).toBe('malformed'); expect(broken.writable).toBe(false); expect(openStore({ getItem() { throw Error('denied'); }, setItem() { } }).warning).toBeTruthy(); const future: Progress = { ...empty(), schemaVersion: 99 }; expect(() => validate(future)).toThrow(); });
    it('retains verified coordinate tolerances instead of guessing positions', () => { const e = drillPool(master.entities.filter(e => e.areaId === 'japan'))[0], db = read(root + 'data/database-stage12.json'), model = read(root + 'data/learning-model-stage12.json'), t = toleranceFor(e, db, model, master.areas); expect(judge(e, [e.lon!, e.lat!], t).accepted).toBe(true); expect(drillPool(master.entities.filter(e => e.lat === null))).toHaveLength(0); });
});

it('ignores damaged UI conditions but keeps v1 progress compatible', () => { const c = {area:'japan',scope:'A',direction:'name',size:'10',period:'all',from:'',to:''} as const; expect(validConfig(c,master)).toBe(true); expect(validConfig({...c, period:'missing'} as unknown as import('./types').Config,master)).toBe(false); expect(validConfig({...c,area:'missing'},master)).toBe(false); });
