import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { validateMaster, type HoukiMaster } from './data';
import { buildBlock, optionOrder, scoreBlock } from './session';
import { emptyProgress, HOUKI_PROGRESS_KEY, parseProgress, readProgress, rememberAttempt, saveProgress, toggleHeld, type HoukiProgress } from './progress';
const master = JSON.parse(readFileSync('public/houki/data/houki-phrases-v2.json', 'utf8')) as HoukiMaster;
const fixedDate = '2026-10-07T00:00:00.000Z';
function fixture(graded = false): HoukiProgress {
  const block = buildBlock(master.items, {}, 7);
  const answers = Object.fromEntries((graded ? block : block.slice(0, 2)).map(i => [i.id, i.answer]));
  if (graded) answers[block[0].id] = block[0].options.find(o => o !== block[0].answer)!;
  const scored = scoreBlock(block, answers);
  return { ...emptyProgress(), screen: graded ? 'result' : 'drill', active: { id: 'set-7', seed: 7, at: fixedDate, itemIds: block.map(i => i.id), cursor: 1, answers, graded, wrongItems: graded ? scored.misses : [] } };
}
describe('verified law content', () => {
  it('publishes only dated verified, source-separated stable clauses and uniquely correct questions', () => {
    expect(validateMaster(master)).toBe(master);
    const canonical = JSON.parse(readFileSync('docs/1sou_houki/StageH_Final/verified_items.json', 'utf8'));
    expect(master).toEqual(canonical);
    expect(master.items).toHaveLength(28);
    for (const i of master.items) {
      expect(i.verification.status).toBe('verified');
      expect(i.verification.date).toBe('2026-10-07');
      expect(i.verification.evidence).toBeTruthy();
      expect(i.verification.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(i.learningClause).not.toMatch(/懲役|禁錮|1般|1切|ふく/);
      expect(i).not.toHaveProperty('sourceStatement');
      expect(i.sourceEvidence.every(s => s.sourceStatementRef.startsWith('private:'))).toBe(true);
      expect(i.optionAssessments.map(o => o.option)).toEqual(i.options);
      expect(i.optionAssessments.filter(o => o.correct)).toEqual([expect.objectContaining({ option: i.answer })]);
      if (i.kind === 'pick') expect(i.prompt.replace('［　］', i.answer)).toBe(i.learningClause);
      if (i.kind === 'judge' && i.answer === '適合') expect(i.prompt).toBe(i.learningClause);
      if (i.kind === 'judge' && i.answer === '不適合') expect(i.prompt).not.toBe(i.learningClause);
    }
    expect(master.items.filter(i => i.answer === '適合').length).toBeGreaterThan(0);
    expect(master.items.filter(i => i.answer === '不適合').length).toBeGreaterThan(0);
    expect(new Set(master.items.map(i => i.id)).size).toBe(28);
    expect(master.items.map(i => i.id)).not.toEqual(master.items.map((_, n) => `houki-${n + 1}`));
  });
  it('rejects unverified or duplicate answer material at load time', () => {
    for (const mutate of [(m: HoukiMaster) => { m.items[0].verification.status = 'pending' as 'verified'; }, (m: HoukiMaster) => { m.items[0].options.push(m.items[0].answer); }]) {
      const changed = structuredClone(master); mutate(changed); expect(() => validateMaster(changed)).toThrow();
    }
  });
  it('accounts for every original item without publishing the original choices', () => {
    const dispositions = JSON.parse(readFileSync('docs/1sou_houki/StageH_Final/legacy_dispositions.json', 'utf8'));
    expect(dispositions).toHaveLength(129);
    expect(dispositions.filter((d: { disposition: string }) => d.disposition === 'deferred')).toHaveLength(100);
    for (const d of dispositions) if (d.learningEntityId) expect(master.items.some(i => i.id === d.learningEntityId)).toBe(true);
  });
});
describe('25-point sets', () => {
  it('is reproducible, duplicate-free and scored exactly', () => {
    const block = buildBlock(master.items, {}, 7);
    expect(buildBlock(master.items, {}, 7)).toEqual(block);
    expect(new Set(block.map(i => i.id)).size).toBe(9);
    expect(block.filter(i => i.kind === 'judge')).toHaveLength(5);
    expect(block.filter(i => i.kind === 'pick')).toHaveLength(4);
    expect(scoreBlock(block, Object.fromEntries(block.map(i => [i.id, i.answer])))).toEqual({ points: 25, total: 25, line: 15, misses: [] });
    expect(scoreBlock(block, {}).points).toBe(0);
    expect(optionOrder(block[5])).toEqual(optionOrder(block[5]));
  });
  it('reaches every item, reviews held items and measures repeats over 40,000 sequential sets', () => {
    const scenarios = [0, 14, 27, 28];
    const reports = [];
    for (const count of scenarios) {
      const held = Object.fromEntries(master.items.slice(0, count).map(i => [i.id, fixedDate]));
      const hits = Object.fromEntries(master.items.map(i => [i.id, 0]));
      const groups: Record<string, number> = {}; let previous: string[] = []; let overlaps = 0; let maxOverlap = 0; let heldHits = 0;
      for (let seed = 1; seed <= 10000; seed++) {
        const set = buildBlock(master.items, held, seed, previous);
        expect(new Set(set.map(i => i.id)).size).toBe(9);
        expect(set.reduce((s, i) => s + i.points, 0)).toBe(25);
        const overlap = set.filter(i => previous.includes(i.id)).length; overlaps += overlap; maxOverlap = Math.max(maxOverlap, overlap);
        for (const i of set) { hits[i.id]++; groups[i.bundle] = (groups[i.bundle] ?? 0) + 1; if (held[i.id]) heldHits++; }
        previous = set.map(i => i.id);
      }
      expect(Math.min(...Object.values(hits))).toBeGreaterThan(0);
      if (count) expect(heldHits).toBeGreaterThan(0);
      reports.push({ held: count, sets: 10000, minItemHits: Math.min(...Object.values(hits)), maxItemHits: Math.max(...Object.values(hits)), meanOverlap: overlaps / 9999, maxOverlap, heldHits, groups });
    }
    // Opt-in report output; normal tests do not mutate the repository.
    if (process.env.HOUKI_QA_OUTPUT) writeFileSync(process.env.HOUKI_QA_OUTPUT, JSON.stringify(reports, null, 2));
  });
});
describe('saved practice and correct-clause progress', () => {
  it('round-trips midway answers, cursor, result misses, reading return and held undo', () => {
    for (const graded of [false, true]) {
      let p = fixture(graded);
      p = toggleHeld(p, master.items[0].id, fixedDate);
      expect(parseProgress(JSON.stringify(p), master.items)).toEqual(p);
      expect(parseProgress(JSON.stringify(p), [...master.items].reverse())).toEqual(p);
      expect(toggleHeld(p, master.items[0].id).held).toEqual({});
      p = { ...p, screen: 'read', last: { bundle: master.items[0].bundle, item: master.items[0].id } };
      expect(parseProgress(JSON.stringify(p), master.items).active).toEqual(p.active);
    }
  });
  it('persists a graded attempt once and verifies its score from the answers', () => {
    let p = fixture(true); const a = p.active!; const r = scoreBlock(a.itemIds.map(id => master.items.find(i => i.id === id)!), a.answers);
    const attempt = { id: a.id, at: fixedDate, score: r.points, total: r.total, itemIds: a.itemIds, answers: a.answers };
    p = rememberAttempt(p, attempt); expect(rememberAttempt(p, attempt)).toEqual(p);
    let raw = ''; expect(saveProgress(p, { setItem: (key, value) => { expect(key).toBe(HOUKI_PROGRESS_KEY); raw = value; } })).toBe(true);
    expect(readProgress({ getItem: key => key === HOUKI_PROGRESS_KEY ? raw : null }, master.items).progress).toEqual(p);
    const bad = structuredClone(p); bad.attempts[0].score = 26; expect(() => parseProgress(JSON.stringify(bad), master.items)).toThrow();
  });
  it('protects malformed, unsupported and unknown-ID storage without overwriting it', () => {
    for (const raw of ['broken', '{"schemaVersion":1}', '{"schemaVersion":99}']) expect(readProgress({ getItem: () => raw }, master.items).writable).toBe(false);
    for (const mutate of [(p: HoukiProgress) => { p.held.unknown = fixedDate; }, (p: HoukiProgress) => { p.active!.cursor = 9; }, (p: HoukiProgress) => { p.active!.answers[p.active!.itemIds[0]] = 'fake'; }, (p: HoukiProgress) => { p.active!.wrongItems = ['unknown']; }, (p: HoukiProgress) => { p.active!.itemIds[0] = p.active!.itemIds[1]; }]) {
      const p = fixture(); mutate(p); expect(() => parseProgress(JSON.stringify(p), master.items)).toThrow();
    }
    expect(readProgress({ getItem: key => key.endsWith(':v1') ? '{"schemaVersion":1}' : null }, master.items)).toEqual(expect.objectContaining({ writable: true, progress: emptyProgress(), notice: expect.stringContaining('旧版') }));
    expect(readProgress({ getItem: () => { throw Error('disabled'); } }, master.items).writable).toBe(false);
    expect(saveProgress(emptyProgress(), { setItem: () => { throw Error('quota'); } })).toBe(false);
    expect(parseProgress(null, master.items)).toEqual(emptyProgress());
  });
});
