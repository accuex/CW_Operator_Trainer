import { describe, expect, it } from 'vitest';
import { createCaller, type CallerAgent } from '../agents/caller';
import { RST_EXCHANGE } from '../agents/exchangeSpec';
import { mannersOf, PILEUP_PROCEDURE, type CallerManners } from '../agents/manners';
import type { Agent, AgentContext, AgentNote } from '../agents/types';
import type { AirEvent } from '../air/ether';
import { parseIntent } from '../air/intent';
import type { StationPersona } from '../air/persona';
import { keyText } from '../keying';
import { pileupCallForms, pileupCallText, PILEUP_CALL_SECONDS } from '../agents/templates';
import { seeded } from '../random';
import { PileupArrivals } from './pileupArrivals';
import { mannersMix, PILEUP_LEVELS, pileupLevel, pileupManners, pileupParamsOf } from './pileupLevels';
import { pileupIntent } from './pileupRun';

const RF = 7_012_000;
const ME = { call: 'JS2WDR', name: 'MASA', qth: 'NAGOYA' };

const persona = (call: string): StationPersona => ({
  call, name: 'KEN', qth: 'OSAKA', area: 3, wpm: 24, jitter: 0.05, style: 'twice', sendStyle: 'brief',
  patience: 6, waitLimit: 300, recall: 1, reaction: [0.2, 0.4], retry: [2.5, 3], strength: 0.5, offsetHz: 30, rxWidth: 400,
  qrsFloor: 14, rst: '599', cutNumbers: false, closing: 'full',
});

const DISCIPLINED = mannersOf('twice');
const EAGER: CallerManners = { ...DISCIPLINED, answersNearPartial: 1 };
const LID: CallerManners = { ...DISCIPLINED, holdsForTraffic: false, doubleListenOut: null, callsOnMismatch: 1, callsOverQso: 1 };
const DEAF: CallerManners = { ...DISCIPLINED, missesUs: 1 };
const TAIL: CallerManners = { ...DISCIPLINED, tailEnd: 1 };

/** A pileup frequency: callers as given, our transmissions read as a pileup reads them. */
function pile(...callers: [string, CallerManners?][]) {
  const random = seeded(1);
  let now = 0;
  const sent: { agent: Agent; text: string }[] = [];
  const notes: AgentNote[] = [];
  const agents: CallerAgent[] = [];
  const ctx: AgentContext = {
    now: () => now,
    random,
    send: (agent, text) => sent.push({ agent, text }),
    me: ME,
    peers: () => agents.filter((agent) => !agent.gone),
    notify: (note) => notes.push(note),
    hearsKeying: () => false,
    keyingSince: () => null,
  };
  for (const [call, manners = DISCIPLINED] of callers) {
    agents.push(createCaller(persona(call), { random, listenRf: RF, now }, { manners, exchange: RST_EXCHANGE, procedure: PILEUP_PROCEDURE }));
  }
  let seq = 0;
  const say = (text: string) => {
    const event: AirEvent = { id: (seq += 1), from: 'me', text, intent: pileupIntent(parseIntent(text, ME.call)), rf: RF, start: now, end: now + 1, epoch: 0 };
    now += 1;
    const before = sent.length;
    for (const agent of agents) agent.hear(event, ctx);
    return new Set(sent.slice(before).map((item) => (item.agent as CallerAgent).call));
  };
  const tick = (seconds: number) => {
    const before = sent.length;
    for (let t = 0; t < seconds; t += 0.1) {
      now += 0.1;
      for (const agent of agents) agent.tick(now, ctx);
    }
    return new Set(sent.slice(before).map((item) => (item.agent as CallerAgent).call));
  };
  const byCall = (call: string) => agents.find((agent) => agent.call === call)!;
  return { agents, sent, notes, say, tick, byCall };
}

/** Everyone on, everyone has called once. */
function calling(...callers: [string, CallerManners?][]) {
  const frequency = pile(...callers);
  frequency.say('CQ DE JS2WDR JS2WDR K');
  return frequency;
}

describe('pileupIntent', () => {
  it('reads a call asked about and "3AB AGN?" as partials', () => {
    expect(pileupIntent(parseIntent('3ABC?', ME.call)).partial).toBe('3ABC');
    expect(pileupIntent(parseIntent('JA3ABC?', ME.call))).toMatchObject({ partial: 'JA3ABC', calls: [] });
    expect(pileupIntent(parseIntent('3AB AGN?', ME.call)).partial).toBe('3AB');
  });

  it('reads our call alone, or TU with our call, as QRZ?', () => {
    expect(pileupIntent(parseIntent('JS2WDR', ME.call)).qrz).toBe(true);
    expect(pileupIntent(parseIntent('TU JS2WDR', ME.call)).qrz).toBe(true);
    expect(pileupIntent(parseIntent('QRZ?', ME.call)).qrz).toBe(true);
    expect(pileupIntent(parseIntent('JA3ABC 5NN', ME.call)).qrz).toBeFalsy();
    expect(pileupIntent(parseIntent('CQ DE JS2WDR K', ME.call)).qrz).toBeFalsy();
  });
});

describe('pileup callers: who answers what', () => {
  it('a partial: only the stations it fits answer; the rest stand by', () => {
    const { say, byCall } = calling(['JA3ABC'], ['JH8XYZ']);
    expect(say('3ABC?')).toEqual(new Set(['JA3ABC']));
    expect(byCall('JA3ABC').reactions.map((reaction) => reaction.kind)).toEqual(['match']);
    expect(byCall('JH8XYZ')).toMatchObject({ state: 'holding', standBy: 'partial' });
  });

  it('a partial several calls fit: all of them answer and compete again', () => {
    const { say } = calling(['JA3ABC'], ['JH3ABC'], ['JR6QQQ']);
    expect(say('3ABC?')).toEqual(new Set(['JA3ABC', 'JH3ABC']));
    // A longer piece then tells them apart.
    expect(say('JH3ABC?')).toEqual(new Set(['JH3ABC']));
  });

  it('a partial nobody fits: disciplined callers keep quiet', () => {
    const { say, tick } = calling(['JA3ABC'], ['JH8XYZ']);
    expect(say('5QRT?')).toEqual(new Set());
    expect(tick(20)).toEqual(new Set());
  });

  it('only an eager caller answers a partial one letter off its call', () => {
    const { say, byCall } = calling(['JA3ABD', EAGER], ['JH3ABE']);
    expect(say('3ABC?')).toEqual(new Set(['JA3ABD']));
    expect(byCall('JA3ABD').reactions.map((reaction) => reaction.kind)).toEqual(['near']);
    expect(byCall('JH3ABE').reactions).toEqual([]);
  });

  it('only a lid calls on a partial that does not fit it at all', () => {
    const { say, byCall } = calling(['JA3ABC', LID], ['JH3ABD', EAGER], ['JR3ABE']);
    expect(say('8XYZ?')).toEqual(new Set(['JA3ABC']));
    expect(byCall('JA3ABC').reactions.map((reaction) => reaction.kind)).toEqual(['mismatch']);
  });

  it('only a lid calls over a QSO in progress', () => {
    const { say, tick, byCall } = calling(['JA3ABC', LID], ['JH3ABD'], ['JR8XYZ', EAGER]);
    say('JR8XYZ 5NN');
    const over = tick(30);
    expect(over.has('JA3ABC')).toBe(true);
    expect(over.has('JH3ABD')).toBe(false);
    expect(byCall('JA3ABC').reactions.some((reaction) => reaction.kind === 'over-qso')).toBe(true);
  });

  it('a hijack: the eager look-alike answers a call meant for another, then stands back once we call the right one again', () => {
    const { say, byCall } = calling(['JA3ABC'], ['JA3ABD', EAGER]);
    // Our pick: the eager station one letter off takes it as well.
    expect(say('JA3ABC 5NN')).toEqual(new Set(['JA3ABC', 'JA3ABD']));
    const hijacker = byCall('JA3ABD');
    expect(hijacker).toMatchObject({ state: 'exchanged', hijacked: true });
    expect(hijacker.reactions.map((reaction) => reaction.kind)).toEqual(['hijack']);
    // We call the station we meant again: the hijacker stands back, the right one is in the QSO.
    expect(say('JA3ABC 5NN').has('JA3ABD')).toBe(false);
    expect(hijacker).toMatchObject({ state: 'holding', hijacked: false });
    expect(byCall('JA3ABC').state).toBe('exchanged');
    say('TU JS2WDR');
    expect(byCall('JA3ABC').state).toBe('done');
  });

  it('a caller that misses us goes on as if nothing was said, unlike everyone else', () => {
    const { say, byCall } = calling(['JA3ABC', DEAF], ['JH8XYZ'], ['JR6QQQ', TAIL]);
    expect(byCall('JA3ABC').state).toBe('arriving');
    expect(byCall('JA3ABC').reactions.every((reaction) => reaction.kind === 'missed')).toBe(true);
    expect(say('QRZ?').has('JA3ABC')).toBe(false);
    expect(byCall('JH8XYZ').reactions).toEqual([]);
    expect(byCall('JR6QQQ').reactions).toEqual([]);
  });

  it('a tail-ender calls straight after our TU to someone else; the disciplined wait for QRZ?', () => {
    const { say, tick } = calling(['JA3ABC', TAIL], ['JH8XYZ'], ['JR6QQQ']);
    say('JR6QQQ 5NN');
    tick(5);
    // Our TU without our call: no cue for anyone but the tail-ender.
    expect(say('TU')).toEqual(new Set(['JA3ABC']));
    expect(tick(10).has('JH8XYZ')).toBe(false);
  });
});

describe('pileup callers: which callers each of our transmissions moves', () => {
  it('QRZ? (or TU with our call) calls everyone standing by back', () => {
    const { say, tick } = calling(['JA3ABC'], ['JH8XYZ'], ['JR6QQQ']);
    say('JR6QQQ 5NN');
    tick(5);
    expect(say('TU JS2WDR')).toEqual(new Set(['JA3ABC', 'JH8XYZ']));
  });

  it('a bare AGN? after a partial calls back the pile, not a QSO in progress', () => {
    const { say } = calling(['JA3ABC'], ['JH8XYZ'], ['JR6QQQ']);
    say('3ABC?');
    expect(say('AGN?')).toEqual(new Set(['JA3ABC', 'JH8XYZ', 'JR6QQQ']));
    say('JR6QQQ 5NN');
    // In QSO: our AGN? is for our partner only.
    expect(say('AGN?')).toEqual(new Set(['JR6QQQ']));
  });

  it('"3AB AGN?" is for the stations it fits only', () => {
    const { say } = calling(['JA3ABC'], ['JH8XYZ']);
    expect(say('3AB AGN?')).toEqual(new Set(['JA3ABC']));
  });

  it('QRX: everyone stands by (no one calls) until we ask again', () => {
    const { say, tick, agents } = calling(['JA3ABC'], ['JH8XYZ']);
    expect(say('QRX')).toEqual(new Set());
    expect(agents.every((agent) => agent.state === 'holding' && agent.standBy === 'qrx')).toBe(true);
    expect(tick(20)).toEqual(new Set());
    expect(say('AGN?')).toEqual(new Set(['JA3ABC', 'JH8XYZ']));
  });

  it('QRS: everyone calling slows straight to their floor', () => {
    const { say, agents } = calling(['JA3ABC'], ['JH8XYZ']);
    expect(say('QRS')).toEqual(new Set(['JA3ABC', 'JH8XYZ']));
    expect(agents.map((agent) => agent.station.wpm)).toEqual([14, 14]);
  });

  it('picked but not yet sent a report: when we move on, it is one of the pile again', () => {
    const { say, byCall } = calling(['JA3ABC'], ['JH8XYZ']);
    say('JA3ABC');
    expect(byCall('JA3ABC').state).toBe('selected');
    expect(say('QRZ?')).toEqual(new Set(['JA3ABC', 'JH8XYZ']));
    expect(byCall('JA3ABC').state).toBe('waiting');
  });
});

describe('PileupArrivals', () => {
  const intentOf = (text: string) => pileupIntent(parseIntent(text, ME.call));

  it('rounds: a whole round at once, the next only once it is all worked or gone', () => {
    let standing = 0;
    const arrivals = new PileupArrivals(seeded(1), () => ({ pile: 3, rounds: true, refill: 2 }), () => standing);
    expect(arrivals.arrivals(intentOf('CQ DE JS2WDR K'))).toBe(3);
    standing = 3;
    expect(arrivals.arrivals(intentOf('QRZ?'))).toBe(0);
    standing = 1;
    expect(arrivals.arrivals(intentOf('TU JS2WDR'))).toBe(0);
    standing = 0;
    // A partial or an exchange never brings anyone.
    expect(arrivals.arrivals(intentOf('3AB?'))).toBe(0);
    expect(arrivals.arrivals(intentOf('JA3ABC 5NN'))).toBe(0);
    expect(arrivals.arrivals(intentOf('TU JS2WDR'))).toBe(3);
    expect(arrivals.rounds).toBe(2);
  });

  it('continuous: the pile is topped up a few at a time and never grows without bound', () => {
    const pileSize = 10;
    let standing = 0;
    const random = seeded(4);
    const arrivals = new PileupArrivals(random, () => ({ pile: pileSize, rounds: false, refill: 3 }), () => standing);
    standing += arrivals.arrivals(intentOf('CQ DE JS2WDR K'));
    expect(standing).toBe(pileSize);
    let max = standing;
    for (let qso = 0; qso < 500; qso += 1) {
      // One worked, now and then one gives up.
      standing = Math.max(0, standing - 1 - (random() < 0.3 ? 1 : 0));
      const added = arrivals.arrivals(intentOf('TU JS2WDR'));
      expect(added).toBeLessThanOrEqual(3);
      standing += added;
      max = Math.max(max, standing);
    }
    expect(max).toBeLessThanOrEqual(Math.round(pileSize * 1.2));
    expect(standing).toBeGreaterThan(0);
  });
});

describe('pileup levels', () => {
  it('入門・初級 are rounds, 中級 and up continuous', () => {
    expect(PILEUP_LEVELS.map((level) => pileupParamsOf(level.axes).rounds)).toEqual([true, true, false, false, false]);
  });

  it('manners get worse level by level: 入門 has no lids, tail-enders or deaf callers (only eager ones); lids from 中級', () => {
    const random = seeded(9);
    const sample = (id: Parameters<typeof pileupLevel>[0]) => {
      const params = pileupParamsOf(pileupLevel(id).axes);
      return Array.from({ length: 400 }, () => pileupManners('twice', params, random));
    };
    const intro = sample('intro');
    expect(intro.every((manners) => manners.callsOnMismatch === 0 && manners.callsOverQso === 0 && manners.tailEnd === 0 && manners.missesUs === 0)).toBe(true);
    const rude = (manners: CallerManners) => manners.callsOnMismatch > 0 || manners.callsOverQso > 0 || manners.tailEnd > 0 || manners.missesUs > 0;
    const share = (list: CallerManners[]) => list.filter(rude).length / list.length;
    const shares = (['intro', 'intermediate', 'dx'] as const).map((id) => share(sample(id)));
    expect(shares[0]).toBe(0);
    expect(shares[0]).toBeLessThan(shares[1]);
    expect(shares[1]).toBeLessThan(shares[2]);
    expect(sample('intermediate').some((manners) => manners.callsOnMismatch > 0)).toBe(true);
    expect(mannersMix(1).lid).toBeGreaterThan(mannersMix(0.5).lid);
  });

  it('入門: eager answers are rare (one call out of a few is the point), and grow by 初級', () => {
    expect(mannersMix(0).eagerChance).toBeLessThanOrEqual(0.15);
    expect(mannersMix(0.25).eagerChance).toBeGreaterThan(0.5);
    expect(mannersMix(0.5).eagerChance).toBeCloseTo(0.55);
  });
});

describe('pileup call form', () => {
  const as = (style: StationPersona['style'], call = 'JA3ABC') => ({ ...persona(call), style });

  it('drops the DX call and DE sentence, keeps each style’s habits', () => {
    expect(pileupCallForms(as('once'), 'call')).toEqual(['JA3ABC']);
    expect(pileupCallForms(as('twice'), 'call')).toEqual(['JA3ABC JA3ABC', 'JA3ABC']);
    expect(pileupCallForms(as('formal'), 'call')[0]).toBe('DE JA3ABC JA3ABC K');
    expect(pileupCallForms(as('novice'), 'call')[0]).toBe('DE JA3ABC JA3ABC [AR]');
    // The crowd's repeat still counts the calls.
    expect(pileupCallForms(as('once'), 'call', 2)[0]).toBe('JA3ABC JA3ABC');
    expect(pileupCallForms(as('twice'), 'call', 3)[0]).toBe('JA3ABC JA3ABC JA3ABC');
  });

  it('a slow hand sends a shorter form, never one far over the limit, and keeps its DE / AR', () => {
    for (const style of ['once', 'twice', 'formal', 'novice'] as const) {
      for (const wpm of [8, 10, 14, 20, 26]) {
        const text = pileupCallText(as(style, 'JE0VHX'), 'call', wpm, 2);
        const bare = keyText('JE0VHX [AR]', { wpm }).length;
        expect(keyText(text, { wpm }).length).toBeLessThanOrEqual(Math.max(PILEUP_CALL_SECONDS, bare));
        if (style === 'novice') expect(text).toMatch(/\[AR\]$/);
        if (style === 'formal') expect(text).toMatch(/ K$/);
      }
    }
    expect(pileupCallText(as('twice'), 'call', 24, 2)).toBe('JA3ABC JA3ABC');
  });
});
