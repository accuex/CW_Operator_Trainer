import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { selectedItems, TIERS, type EnglishMaster } from './data';
import { emptyProgress, ENGLISH_PROGRESS_KEY, parseProgress, readProgress, saveProgress, toggleConfirmed } from './progress';
const json = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const raw = json('public/english/data/english-learning-master-v1.json');
const master = raw as EnglishMaster;
describe('specialized English v1 published master', () => {
  it('keeps the cumulative curriculum and unique stable IDs', () => {
    expect(master.items).toHaveLength(101);
    expect(new Set(master.items.map(i => i.learningEntityId)).size).toBe(101);
    expect(TIERS.map(t => selectedItems(master, t, 'all').length)).toEqual([32, 74, 101]);
    expect(master.tier_counts).toEqual({ minimum: 32, standard: 74, extended: 101 });
  });
  it('has complete scene, relation, modality and authored-example references', () => {
    const ids = new Set(master.items.map(i => i.learningEntityId));
    const groups = new Set(master.groups.map(g => g.id));
    for (const i of master.items) {
      expect(i.learning_groups.length).toBeGreaterThan(0);
      i.learning_groups.forEach(g => expect(groups.has(g)).toBe(true));
      i.related_terms.forEach(id => expect(ids.has(id)).toBe(true));
      expect(i.example.source).toBe('E2_original_teaching_example_not_exam_quote');
      expect(i.example.english.length).toBeGreaterThan(10);
      expect(i.example.japanese.length).toBeGreaterThan(4);
      expect(i.modality.audio_checked).toBe(false);
      const modes = new Set(i.evidence_references.filter(e => e.e0_occurrence_id.startsWith(i.learningEntityId + '@')).map(e => e.reading_or_listening));
      if (i.modality.recommended === 'both') expect([...modes].sort()).toEqual(['listening', 'reading']);
      else expect(modes.has(i.modality.recommended)).toBe(true);
      if (i.category === 'LEGAL') expect(i.legal_structure.some(s => s.label === '主体')).toBe(true);
    }
  });
  it('tracks all 146 candidates without promoting integrated words to cards', () => {
    expect(raw.candidate_decisions).toHaveLength(146);
    expect(new Set(raw.candidate_decisions.map((x: { term_id: string }) => x.term_id)).size).toBe(146);
    expect(raw.candidate_decisions.filter((x: { e2_decision: string }) => x.e2_decision === 'adopted')).toHaveLength(101);
    expect(raw.candidate_decisions.filter((x: { e2_decision: string }) => x.e2_decision === 'integrated')).toHaveLength(3);
    expect(raw.candidate_decisions.filter((x: { e2_decision: string }) => x.e2_decision === 'excluded')).toHaveLength(42);
    for (const id of ['term-bound', 'term-life-raft', 'term-flight-regularity']) expect(master.items.some(i => i.learningEntityId === id)).toBe(false);
    for (const id of ['term-bridge', 'term-sensitivity']) expect(master.items.find(i => i.learningEntityId === id)?.evidence_role_note).toContain('選択肢');
  });
});
describe('lightweight confirmation persistence', () => {
  it('roundtrips confirmation and last reading position without inventing scores', () => {
    let p = emptyProgress(); p.last = { tier: 'extended', group: 'aviation', item: 'term-guard' };
    p = toggleConfirmed(p, 'term-guard', '2026-10-07T00:00:00.000Z');
    let stored = ''; expect(saveProgress(p, { setItem: (k, v) => { expect(k).toBe(ENGLISH_PROGRESS_KEY); stored = v; } })).toBe(true);
    expect(readProgress({ getItem: () => stored }).progress).toEqual(p);
    expect(toggleConfirmed(p, 'term-guard').confirmed).toEqual({});
    expect(p).not.toHaveProperty('score');
  });
  it('protects malformed/future storage and handles unavailable persistence', () => {
    for (const value of ['broken', '{"schemaVersion":2}', '{"schemaVersion":1,"confirmed":[],"last":{}}']) expect(readProgress({ getItem: () => value }).writable).toBe(false);
    expect(() => parseProgress('{"schemaVersion":1,"confirmed":{"term-guard":"bad"},"last":{"tier":"minimum","group":"all","item":""}}')).toThrow();
    expect(readProgress({ getItem: () => { throw Error('blocked'); } }).writable).toBe(false);
    expect(saveProgress(emptyProgress(), { setItem: () => { throw Error('quota'); } })).toBe(false);
  });
});
