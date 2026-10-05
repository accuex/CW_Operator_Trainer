import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { QsoCharEnv } from '../../types';
import type { CharJudgement, RxRecord } from '../conditions';
import { keyText, type CharSpan } from '../keying';
import { seeded } from '../random';
import { EAR_SKILLS, LOST, PileupEar, interferenceDb, overlapCopyChance, type OverlapProbe } from './ear';
import { PileupBot, BOT_PROFILES, mergeRepeats } from './bot';

const VFO = 7_012_000;
const CLEAN: QsoCharEnv = { snr: 20, qrm: 0, qsb: 0, qrn: 0, offset: 30 };
const now = { t: 1000, epoch: 0 };

const recordOf = (text: string, station = 1): RxRecord => {
  const keyed = keyText(text, { wpm: 24 });
  return { tx: { text, start: 10, ...keyed }, station, epoch: 0, cutAt: null };
};

/** A probe that judges each character by its position only (what the air did to it, whoever sent it). */
const probeBy = (judge: (span: CharSpan) => CharJudgement): OverlapProbe => ({ judge: (_record, span) => judge(span) });

const overlapEnv = (extra: Partial<NonNullable<QsoCharEnv['overlap']>> = {}): QsoCharEnv => ({
  ...CLEAN, qrm: 0.8, qrmFrom: 'caller', overlap: { n: 1, dHz: 40, dB: -2, dWpm: 0, ...extra },
});

describe('PileupEar', () => {
  it('copies only what was audible: lost characters come out the same whatever was sent', () => {
    // The first three characters of each word went under (unheard); the rest in the clear.
    const probe = probeBy((span) => (span.index < 3 ? { condition: 'unheard', env: CLEAN } : { condition: 'clean', env: CLEAN }));
    const signal = { rf: VFO + 40, level: 0.5 };
    const a = new PileupEar(probe, EAR_SKILLS.average, seeded(7)).hear(recordOf('JA3ABC JA3ABC', 1), signal, VFO, now);
    // Another station whose lost letters merely keyed as long (A ·- / N -·, 3 ···-- / 7 --···).
    const b = new PileupEar(probe, EAR_SKILLS.average, seeded(7)).hear(recordOf('JN7ABC JN7ABC', 9), signal, VFO, now);
    expect(a.words[0].startsWith(LOST.repeat(3))).toBe(true);
    expect(b).toEqual(a);
  });

  it('never reads the sender or the text — only the keyed characters and how each fared', () => {
    const probe = probeBy(() => ({ condition: 'clean', env: CLEAN }));
    const signal = { rf: VFO - 25, level: 0.3 };
    const record = recordOf('JA3ABC 5NN');
    const disguised: RxRecord = { ...record, station: -42, tx: { ...record.tx, text: 'XXXXXX XXX' } };
    const ear = () => new PileupEar(probe, EAR_SKILLS.perfect, seeded(3));
    expect(ear().hear(disguised, signal, VFO, now)).toEqual(ear().hear(record, signal, VFO, now));
    expect(ear().hear(record, signal, VFO, now).words).toEqual(['JA3ABC', '5NN']);
  });

  it('perfect ear copies everything audible, nothing that was not', () => {
    const probe = probeBy((span) => (span.index === 0 ? { condition: 'muted' as const, env: CLEAN } : { condition: 'qrm' as const, env: overlapEnv({ n: 5, dB: 6 }) }));
    const heard = new PileupEar(probe, EAR_SKILLS.perfect, seeded(1)).hear(recordOf('JA3ABC'), { rf: VFO, level: 1 }, VFO, now);
    expect(heard.words).toEqual([`${LOST}A3ABC`]);
  });

  it('separates an overlap better the louder, the further off in pitch and the fewer the callers', () => {
    const base = overlapCopyChance(overlapEnv(), 0);
    expect(overlapCopyChance({ ...overlapEnv(), qrm: 0.3 }, 0)).toBeGreaterThan(base);
    expect(overlapCopyChance(overlapEnv({ dHz: 200 }), 0)).toBeGreaterThan(base);
    expect(overlapCopyChance(overlapEnv({ dWpm: 6 }), 0)).toBeGreaterThan(base);
    expect(overlapCopyChance(overlapEnv({ n: 4 }), 0)).toBeLessThan(base);
    expect(overlapCopyChance(overlapEnv(), EAR_SKILLS.skilled.overlapBias)).toBeGreaterThan(overlapCopyChance(overlapEnv(), EAR_SKILLS.novice.overlapBias));
  });

  it('weighs interference by pitch like the QRM model (an overlap below the QRM threshold still counts)', () => {
    // The band's QRM was the louder one, so the overlap's own numbers stand: near pitch full weight, far 0.6.
    const near: QsoCharEnv = { ...CLEAN, qrm: 0.2, qrmFrom: 'band', overlap: { n: 1, dHz: 100, dB: -6, dWpm: 0 } };
    const far: QsoCharEnv = { ...near, overlap: { ...near.overlap!, dHz: 300 } };
    expect(interferenceDb(near)).toBeCloseTo(-6);
    expect(interferenceDb(far)).toBeCloseTo(-6 + 20 * Math.log10(0.6));
    expect(interferenceDb(CLEAN)).toBe(Number.NEGATIVE_INFINITY);
  });
});

describe('mergeRepeats', () => {
  it('fills gaps from the repeat and drops letters the two copies disagree on', () => {
    expect(mergeRepeats(['JA3·BC', 'J·3ABC'])).toEqual(['JA3ABC']);
    expect(mergeRepeats(['JA3ABC', 'JA3ABD'])).toEqual([`JA3AB${LOST}`]);
    expect(mergeRepeats(['JA3ABC', 'UR', '599'])).toEqual(['JA3ABC', 'UR', '599']);
    // Different calls are not merged.
    expect(mergeRepeats(['JA3ABC', 'JH8XYZ'])).toEqual(['JA3ABC', 'JH8XYZ']);
  });
});

describe('PileupBot decides from what it copied only', () => {
  const sense = (t: number, carrier = false) => ({ t, carrier, sending: false, qrt: false });

  it('the same copies give the same moves, whoever really sent them', () => {
    const play = () => {
      const bot = new PileupBot(BOT_PROFILES.average, 'JS2WDR', seeded(5));
      const moves: (string | null)[] = [];
      moves.push(bot.act(sense(0))?.text ?? null);
      bot.keyed(3);
      bot.hear({ start: 4, end: 7, pitch: 40, level: -6, words: [`JA3${LOST}BC`, `J${LOST}3ABC`] });
      bot.hear({ start: 4.2, end: 7.5, pitch: -60, level: -9, words: ['J·8X··'] });
      for (let t = 3.1; t < 20; t += 0.1) {
        const action = bot.act(sense(t));
        if (action) { moves.push(action.text); break; }
      }
      return moves;
    };
    expect(play()).toEqual(play());
    expect(play()[1]).toBe('JA3ABC 5NN');
  });

  it('cannot see the truth: neither the bot nor the ear depends on callers, personas, modes or the ether', () => {
    for (const file of ['bot.ts', 'ear.ts']) {
      const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
      const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
      for (const path of imports) expect(path).not.toMatch(/agents|modes|persona|ether|sim|band/);
    }
  });
});
