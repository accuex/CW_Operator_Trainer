import { describe, expect, it } from 'vitest';
import { schedulePending, cutStation, type Transmission } from '../band';
import { DEFAULT_DIFFICULTY } from '../difficulty';
import { PRESETS } from '../exchange';
import { keyText } from '../keying';
import { seeded } from '../random';
import { ragchew } from './ragchew';

/**
 * The CQ lifecycle around our call (regression: the target's CQ timer fired again while
 * we were answering it, in every case). A station between CQs that hears our carrier on
 * its frequency holds its next CQ; once it has taken our call, nothing held goes out.
 */
const CALL = 'JF8QNW JA1ZZZ JA1ZZZ K';

function scene(seed: number, { offsetHz = 0, at = 'gap' as 'gap' | 'during', hold = true } = {}) {
  const random = seeded(seed);
  const session = ragchew.createSession({ random, myCall: 'JA1ZZZ', vfo: 7_012_000, difficulty: { ...DEFAULT_DIFFICULTY, speed: 18 }, preset: PRESETS[ragchew.presets[0]] });
  const target = session.target;
  target.nextAt = 0;
  target.busyUntil = 0;
  const sent: Transmission[] = [];
  let now = 0;
  const tick = () => { sent.push(...schedulePending(target, now, now + 1.5, random)); now = Math.round((now + 0.1) * 10) / 10; };
  // Until its first CQ is over (gap) or half way through it (during).
  while (!sent.length || now < sent[0].start + sent[0].length * (at === 'gap' ? 1 : 0.5) + 0.3) tick();
  const start = now + 0.05;
  const end = start + keyText(CALL, { wpm: 18 }).length;
  if (hold) session.onKeying?.({ start, end }, offsetHz);
  const before = sent.length;
  while (now < end) tick();
  return { session, target, sent, before, start, end, tick, now: () => now };
}

describe('rag-chew: the target hears our call', () => {
  it('between CQs on its frequency: its next CQ waits — never keyed under our call', () => {
    let held = 0;
    for (let seed = 1; seed <= 100; seed += 1) {
      const { sent, before, end } = scene(seed);
      if (!sent.slice(before).some((tx) => tx.start < end)) held += 1;
    }
    expect(held).toBe(100);
    // Without the hold (the old behaviour) it called CQ under us nearly every time.
    let fired = 0;
    for (let seed = 1; seed <= 100; seed += 1) {
      const { sent, before, end } = scene(seed, { hold: false });
      if (sent.slice(before).some((tx) => tx.start < end)) fired += 1;
    }
    expect(fired).toBeGreaterThan(90);
  });

  it('it takes our call: the held CQ never goes out afterwards, only its reply', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const { session, target, sent, tick, now } = scene(seed);
      const reply = session.onTransmit(CALL, { offsetHz: 0 });
      expect(reply.reply, `seed ${seed}`).toBeTruthy();
      cutStation(target, now());
      target.queue.push(reply.reply!);
      target.nextAt = now() + 0.8;
      const after = sent.length;
      for (let index = 0; index < 400; index += 1) tick();
      const later = sent.slice(after).map((tx) => tx.text);
      expect(later, `seed ${seed}`).toEqual([reply.reply]);
    }
  });

  it('off its frequency it never heard us, and a CQ already keyed goes on (both happen on the band)', () => {
    let offFired = 0;
    for (let seed = 1; seed <= 50; seed += 1) {
      const { sent, before, end } = scene(seed, { offsetHz: 400 });
      if (sent.slice(before).some((tx) => tx.start < end)) offFired += 1;
    }
    expect(offFired).toBeGreaterThan(40);
    for (let seed = 1; seed <= 20; seed += 1) {
      const { sent, target, start } = scene(seed, { at: 'during' });
      // The CQ we called over still ends where it was keyed to end.
      expect(sent[0].start + sent[0].length).toBeGreaterThan(start);
      expect(target.marks.length + sent.length).toBeGreaterThan(0);
    }
  });

  it('not taken (no call in it): a QRZ?, and the CQs go on after it has listened', () => {
    const { session, target, sent, end, tick, now } = scene(7);
    const reply = session.onTransmit('QRL?', { offsetHz: 0 });
    expect(session.phase).toBe('cq');
    expect(target.loop).not.toBeNull();
    cutStation(target, now());
    if (reply.reply) { target.queue.push(reply.reply); target.nextAt = now() + 0.8; }
    const after = sent.length;
    for (let index = 0; index < 200; index += 1) tick();
    const later = sent.slice(after);
    expect(later.some((tx) => tx.text.startsWith('CQ'))).toBe(true);
    expect(later.every((tx) => tx.start >= end)).toBe(true);
  });
});
