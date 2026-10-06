import { describe, expect, it } from 'vitest';
import { heardOvers } from './copy';
import { DEFAULT_OVERS, runWabunSim } from './sim';

describe('wabun QSO on the band (headless)', () => {
  it('Level 2: completes Latin call → ホレ → wabun → ラタ → Latin E E, the log right from what was heard', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const result = runWabunSim({ seed });
      expect(result.phase, `seed ${seed}`).toBe('done');
      expect(result.replies.map((reply) => reply.phase)).toEqual(['exchange', 'closing', 'done']);
      const npc = result.lines.filter((line) => line.who === 'npc');
      expect(npc.map((line) => line.text.split(' ')[0])).toEqual(['JA1ZZZ', 'JA1ZZZ', 'E']);
      // The station's overs: Latin head, ホレ, kana, ラタ, Latin tail.
      expect(npc[0].heard).toMatch(/^JA1ZZZ DE J\S+ ホレ .+ ラタ KN$/);
      expect(npc[1].heard).toMatch(/^JA1ZZZ DE J\S+ ホレ .+ ラタ (TU VA|73 TU) E E$/);
      expect(npc[2].heard).toBe('E E');
      expect(result.fields.every((field) => field.correct), JSON.stringify(result.fields)).toBe(true);
      expect(result.facts).toMatchObject({ call: true, rst: true, name: true, qth: true, wx: false, topic: false });
      expect(result.review).toMatchObject({ level: 2, complete: true, verdict: 'followed' });
      expect(result.review.follow).toMatchObject({ required: 4, followed: 4, ok: true });
      // No memo: copy not measured (not failed), follow is still evidence.
      expect(result.review.evidence).toEqual({
        'copy.wabun': null,
        'follow.wabun': expect.objectContaining({ total: 4, correct: 4, first: 4, paths: { logged: 4, postcheck: 0, 'repeat-recovered': 0, missed: 0, 'not-reached': 0 } }),
      });
    }
  });

  it('Level 1 (打ち逃げ): a short answer, our one kana phrase, ラタ, Latin to E E', () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const result = runWabunSim({ seed, level: 1 });
      expect(result.phase, `seed ${seed}`).toBe('done');
      expect(result.replies.map((reply) => reply.phase)).toEqual(['exchange', 'done']);
      expect(result.fields.map((field) => field.key)).toEqual(['call', 'rst']);
      expect(result.fields.every((field) => field.correct), JSON.stringify(result.fields)).toBe(true);
      expect(result.review.follow).toMatchObject({ required: 2, followed: 2, ok: true });
      const [, phrase] = result.traces;
      expect(phrase.keyedWabun).toBe('アリガトウゴザイマシタ');
      expect(phrase.switches).toBe(2);
      expect(phrase.understood).toMatchObject({ heard: true, body: 'アリガトウゴザイマシタ', closing: true });
      // Short: the whole QSO (from our call to its E E) in well under three minutes at 13 WPM.
      const lastNpc = result.records.at(-1)!;
      expect(lastNpc.tx.start + lastNpc.tx.length - result.tx[0].start).toBeLessThan(180);
    }
  });

  it('copy and follow apart: every kana copied, part of it, or a blank log recognised afterwards', () => {
    const full = runWabunSim({ seed: 2, memo: 'full' });
    expect(full.review.copy.accuracy).toBe(1);
    expect(full.review.verdict).toBe('copied');
    expect(full.review.evidence['copy.wabun']).toMatchObject({ total: full.review.copy.reached, correct: full.review.copy.reached, wpm: 13 });

    // Not every character, but the QSO followed: still a success.
    const partial = runWabunSim({ seed: 2, memo: 'partial' });
    expect(partial.review.copy.accuracy).toBeLessThan(0.9);
    expect(partial.review.copy.accuracy).toBeGreaterThan(0);
    expect(partial.review.follow.ok).toBe(true);
    expect(partial.review.verdict).toBe('followed');

    // Name and QTH left out of the log, picked out of three afterwards.
    const blank = runWabunSim({ seed: 3, blankLog: true });
    expect(Object.keys(blank.checks).sort()).toEqual(['name', 'qth']);
    expect(blank.review.follow.facts.map((fact) => fact.state)).toEqual(['logged', 'logged', 'postcheck', 'postcheck']);
    expect(blank.review.follow.ok).toBe(true);
  });

  it('a slip corrected with ラタ: keyed as sent, read as corrected', () => {
    const result = runWabunSim({
      seed: 4,
      overs: {
        exchange: (ctx) => DEFAULT_OVERS.exchange(ctx).replace('レポート 599 599', 'レポート 559 {ラタ} 599 599'),
      },
    });
    expect(result.phase).toBe('done');
    const trace = result.traces.find((item) => item.corrections.length)!;
    expect(trace.keyedWabun).toContain('レポート 559 ラタ 599 599');
    expect(trace.switches).toBe(2);
    expect(trace.corrections).toEqual([expect.objectContaining({ erased: '559' })]);
    expect(trace.understood?.report).toBe('599');
    expect(result.session.dialogue.theirRst).toBe('599');
  });

  it('keys the switches on the air where the station said them', () => {
    const result = runWabunSim({ seed: 2 });
    const exchange = result.records.find((record) => record.tx.text.includes('[ホレ]'))!;
    const scripts = exchange.tx.chars.map((span) => ('script' in span ? span.script : 'roman'));
    const first = scripts.indexOf('control');
    const last = scripts.lastIndexOf('control');
    expect(scripts.slice(0, first).every((script) => script === 'roman')).toBe(true);
    expect(scripts.slice(first + 1, last).every((script) => script === 'wabun')).toBe(true);
    expect(scripts.slice(last + 1).every((script) => script === 'roman')).toBe(true);
    expect(exchange.tx.chars[first].char).toBe('[ホレ]');
    expect(exchange.tx.chars[last].char).toBe('[ラタ]');
  });

  it('shows other signals during our TX on the band but never as received', () => {
    const result = runWabunSim({ seed: 4, callEarly: true, crowd: 6 });
    expect(result.phase).toBe('done');
    // Something was keyed while we were (the scope draws it) …
    expect(result.keyedDuringTx).toBeGreaterThan(0);
    // … the station's CQ kept going under our call, and none of that reached us.
    expect(result.underTx.chars).toBeGreaterThan(0);
    expect(result.underTx.heard).toBe(0);
    const cq = result.heard[0];
    expect(cq.text.startsWith('CQ')).toBe(true);
    expect(cq.heard).toContain('・');
  });

  it('reviews each over once, dropping what never reached us (a CQ from before power-on)', () => {
    const result = runWabunSim({ seed: 3 });
    const [cq] = result.records;
    // The same CQ text keyed on an earlier clock epoch, nothing sampled: silent.
    const before = { ...cq, epoch: 99 };
    const overs = heardOvers(result.monitor, [before, ...result.records], { t: 1e6, epoch: 0 });
    expect(overs[0].text).toBe(cq.tx.text);
    expect(overs[0].silent).toBe(false);
    expect(overs.map((over) => over.text.split(' ')[0])).toEqual(['CQ', 'JA1ZZZ', 'JA1ZZZ', 'E']);
    // The same records measured for copy count each body once.
    expect(result.review.copy.keyed).toBeGreaterThan(0);
  });

  it('leaves nobody on the band after QRT (both levels)', () => {
    for (const level of [1, 2] as const) {
      const done = runWabunSim({ seed: 9, crowd: 5, level });
      expect(done.afterQrt).toEqual({ stations: 0, scheduled: 0 });
    }
    const result = runWabunSim({ seed: 5, crowd: 5 });
    expect(result.phase).toBe('done');
    expect(result.afterQrt).toEqual({ stations: 0, scheduled: 0 });
    expect(result.session.target.loop).toBeNull();
    expect(result.session.target.queue).toEqual([]);
  });
});
