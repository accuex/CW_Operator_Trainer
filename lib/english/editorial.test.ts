import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import fixture from './e2-protected-facts.json';
import type { EnglishMaster, EnglishItem } from './data';
type EditorialItem = Omit<EnglishItem, 'example'> & { example: EnglishItem['example'] & { not_operational_instruction: boolean } };
type EditorialMaster = Omit<EnglishMaster, 'items'> & { items: EditorialItem[] };
const master = JSON.parse(readFileSync('public/english/data/english-learning-master-v1.json', 'utf8')) as EditorialMaster;
const stable = (x: unknown): unknown => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => [k, stable(v)])) : x;
function protectedFacts(x: EditorialItem) {
  const editable = ['specialized_meaning', 'misleading_meanings', 'example', 'japanese_explanation', 'why_it_matters', 'related_terms', 'audit_metadata', 'supplement_modality_note', 'supplements'];
  return { ...Object.fromEntries(Object.entries(x).filter(([k]) => !editable.includes(k))),
    example_metadata: Object.fromEntries(Object.entries(x.example).filter(([k]) => !['english', 'japanese'].includes(k))),
    supplements: x.supplements.map((s) => Object.fromEntries(Object.entries(s).filter(([k]) => !['meaning', 'audit_original_meaning'].includes(k)))),
    supplement_modality_note: x.supplement_modality_note ?? x.audit_metadata?.supplement_modality_note ?? null };
}
describe('E2.0.1 editorial integrity', () => {
  it('preserves all E2 curriculum, frequency, evidence, official-key and modality facts', () => {
    expect(Object.fromEntries(Object.entries(master).filter(([k]) => !['items', 'editorialRevision'].includes(k)))).toEqual(fixture.root);
    expect(master.items.map((i) => i.learningEntityId).sort()).toEqual(Object.keys(fixture.items).sort());
    for (const item of master.items) {
      const hash = createHash('sha256').update(JSON.stringify(stable(protectedFacts(item)))).digest('hex');
      expect(hash, item.term).toBe(fixture.items[item.learningEntityId as keyof typeof fixture.items]);
    }
  });
  it('keeps audit wording out of learner fields and preserves it separately', () => {
    for (const i of master.items) {
      const learner = [i.specialized_meaning, i.misleading_meanings, i.japanese_explanation, i.why_it_matters, ...i.supplements.map((s) => s.meaning)].join(' ');
      expect(learner, i.term).not.toMatch(/E0|E1|E2|OCR|監査|表記検出|検出数|過去問文脈|教える意味|\d{4}-\d{2}|[HR]\d+-\d/);
      expect(i.audit_metadata!.original_inclusion_rationale).toBeTruthy();
      expect(i.audit_metadata!.original_scope_or_confusion).toBeTruthy();
      expect(master.groups.some((g) => i.japanese_explanation.includes(g.goal)), i.term).toBe(false);
    }
    expect(new Set(master.items.map((i) => i.why_it_matters)).size).toBe(101);
    expect(new Set(master.items.map((i) => i.japanese_explanation)).size).toBe(101);
    expect(master.items.filter((i) => !i.misleading_meanings)).toHaveLength(36);
  });
  it('uses valid deliberate relations without self-links, duplication or old hubs', () => {
    const ids = new Set(master.items.map((i) => i.learningEntityId));
    const incoming: Record<string, number> = {};
    for (const i of master.items) {
      expect(new Set(i.related_terms).size).toBe(i.related_terms.length);
      for (const id of i.related_terms) { expect(ids.has(id)).toBe(true); expect(id).not.toBe(i.learningEntityId); incoming[id] = (incoming[id] ?? 0) + 1; }
    }
    expect(Math.max(...Object.values(incoming))).toBeLessThanOrEqual(5);
    for (const [a,b] of [['port','starboard'],['heading','course'],['rolling','pitching'],['air-draught','bridge']]) {
      expect(master.items.find((i) => i.learningEntityId === `term-${a}`)!.related_terms).toContain(`term-${b}`);
      expect(master.items.find((i) => i.learningEntityId === `term-${b}`)!.related_terms).toContain(`term-${a}`);
    }
  });
  it('keeps term usage in authored examples and eliminates the false size rule', () => {
    for (const i of master.items) {
      const text = i.example.english.toLowerCase().replace(/[-\s]+/g, ' ');
      const term = i.term.toLowerCase().replace(/[-\s]+/g, ' ');
      const inflected: Record<string,string> = { guard: 'guards', capsize: 'capsize', acknowledge: 'acknowledge', relay: 'relay' };
      expect(text.includes(term) || !!inflected[term] && text.includes(inflected[term]), i.term).toBe(true);
      expect(i.example.not_operational_instruction).toBe(true);
      expect(i.example.source).toBe('E2_original_teaching_example_not_exam_quote');
      expect(i.example.japanese).toBeTruthy();
    }
    expect(master.items.find((i) => i.term === 'give way')!.example.english).not.toContain('smaller');
    expect(master.items.find((i) => i.term === 'bulbous bow')!.specialized_meaning).toBe('球状船首');
  });
});
