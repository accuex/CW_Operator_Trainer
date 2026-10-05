import { describe, expect, it } from 'vitest';
import { createCaller, DOUBLED_WEIGHT, HEARD_WAIT, MAX_CORRECTIONS, NUDGE_AFTER, type CallerAgent } from './caller';
import { callText, exchangeText, finalText } from './templates';
import type { Agent, AgentContext, AgentNote } from './types';
import type { AirEvent } from '../air/ether';
import { parseIntent } from '../air/intent';
import type { StationPersona } from '../air/persona';
import { seeded } from '../random';

const RF = 7_012_000;
const ME = { call: 'JA1ZZZ', name: 'MASA', qth: 'TOKYO' };

const persona = (call: string, extra: Partial<StationPersona> = {}): StationPersona => ({
  call, name: 'KEN', qth: 'OSAKA', area: 3, wpm: 20, jitter: 0.05, style: 'twice', sendStyle: 'brief',
  patience: 3, waitLimit: 120, recall: 1, reaction: [0.2, 0.4], retry: [2.5, 3], strength: 0.5, offsetHz: 30, rxWidth: 400,
  qrsFloor: 14, rst: '579', cutNumbers: false, closing: 'full', ...extra,
});

/** A frequency with a few callers and a context that records what they key. */
const setup = (...calls: string[]) => setupWith({}, ...calls);

function setupWith(extra: Partial<StationPersona>, ...calls: string[]) {
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
  for (const call of calls) agents.push(createCaller(persona(call, extra), { random, listenRf: RF, now }));
  let seq = 0;
  const say = (text: string) => {
    const event: AirEvent = { id: (seq += 1), from: 'me', text, intent: parseIntent(text, ME.call), rf: RF, start: now, end: now + 1, epoch: 0 };
    now += 1;
    for (const agent of agents) agent.hear(event, ctx);
  };
  const tick = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.1) {
      now += 0.1;
      for (const agent of agents) agent.tick(now, ctx);
    }
  };
  const said = (agent: Agent) => sent.filter((item) => item.agent === agent).map((item) => item.text);
  /** We start keying while `agent` is still sending its call (the head of ours is lost on it), for `seconds`. */
  const doubleWith = (agent: CallerAgent, seconds = 3) => {
    const start = now;
    agent.station.busyUntil = now + 1.5;
    ctx.keyingSince = (_agent, party) => (party === 'me' ? start : null);
    ctx.hearsKeying = (_agent, party) => party === 'me';
    tick(seconds);
    ctx.keyingSince = () => null;
    ctx.hearsKeying = () => false;
  };
  return { agents, sent, notes, say, tick, said, ctx, doubleWith, get now() { return now; } };
}

describe('CallerAgent', () => {
  it('answers our CQ with its call', () => {
    const { agents: [a], say, said } = setup('JH3ABC');
    say('CQ DE JA1ZZZ JA1ZZZ K');
    expect(a.state).toBe('waiting');
    expect(said(a)).toEqual([callText(a.persona, ME.call)]);
    expect(a.callsMade).toBe(1);
  });

  it('ignores a CQ that does not name us', () => {
    const { agents: [a], say } = setup('JH3ABC');
    say('CQ CQ K');
    expect(a.state).toBe('arriving');
  });

  it('answers a partial only if it fits', () => {
    const { agents: [a, b], say, said } = setup('JH3ABC', 'JA1XYZ');
    say('CQ DE JA1ZZZ K');
    say('3AB?');
    expect(said(a)).toHaveLength(2);
    expect(said(b)).toHaveLength(1);
    expect(b.state).toBe('holding');
  });

  it('stands by while someone else is worked, then calls again', () => {
    const { agents: [a, b], say, said } = setup('JH3ABC', 'JA1XYZ');
    say('CQ DE JA1ZZZ K');
    say('JA1XYZ UR 599 NAME MASA QTH TOKYO BK');
    expect(a.state).toBe('holding');
    expect(b.state).toBe('exchanged');
    say('R TNX 73 TU QRZ? DE JA1ZZZ K');
    expect(a.state).toBe('waiting');
    expect(said(a)).toHaveLength(2);
    expect(b.state).toBe('done');
  });

  it('corrects a wrong call at most MAX_CORRECTIONS times', () => {
    for (let seed = 0; seed < 20; seed += 1) {
      const { agents: [a], say, notes } = setup('JH3ABC');
      say('CQ DE JA1ZZZ K');
      for (let round = 0; round < MAX_CORRECTIONS + 1; round += 1) say('JH3ABD UR 599 NAME MASA QTH TOKYO BK');
      expect(a.corrections).toBe(MAX_CORRECTIONS);
      expect(notes.filter((note) => note.type === 'corrected')).toHaveLength(MAX_CORRECTIONS);
      if (a.state === 'gone') expect(a.goneReason).toBe('ignored-correction');
      else {
        expect(a.busted).toBe(true);
        expect(a.state).toBe('exchanged');
      }
      expect(a.addressedAs).toEqual(['JH3ABD', 'JH3ABD', 'JH3ABD']);
    }
  });

  it('takes the right call after a correction', () => {
    const { agents: [a], say } = setup('JH3ABC');
    say('CQ DE JA1ZZZ K');
    say('JH3ABD UR 599 NAME MASA QTH TOKYO BK');
    say('JH3ABC UR 599 NAME MASA QTH TOKYO BK');
    expect(a.state).toBe('exchanged');
    expect(a.busted).toBe(false);
    expect(a.addressedAs).toEqual(['JH3ABD', 'JH3ABC']);
  });

  it('asks for whatever it did not get', () => {
    const { agents: [a], say, said } = setup('JH3ABC');
    say('CQ DE JA1ZZZ K');
    say('JH3ABC 599');
    expect(a.state).toBe('selected');
    expect(said(a).at(-1)).toBe('NAME? QTH?');
    say('NAME MASA QTH TOKYO');
    expect(a.state).toBe('exchanged');
    expect(said(a).at(-1)).toBe(exchangeText(a.persona, ME, true));
  });

  it('closes on our TU and resends on AGN', () => {
    const { agents: [a], say, said, notes } = setup('JH3ABC');
    say('CQ DE JA1ZZZ K');
    say('JH3ABC UR 599 NAME MASA QTH TOKYO BK');
    say('AGN?');
    expect(said(a).at(-1)).toBe(exchangeText(a.persona, ME, true));
    say('R TNX KEN 73 TU');
    expect(a.state).toBe('done');
    expect(said(a).at(-1)).toBe(finalText(a.persona, ME));
    expect(notes.some((note) => note.type === 'closed')).toBe(true);
  });

  it('leaves when we never answer', () => {
    const { agents: [a], say, tick } = setup('JH3ABC');
    say('CQ DE JA1ZZZ K');
    tick(120);
    expect(a.state).toBe('gone');
    expect(a.goneReason).toBe('patience');
    expect(a.callsMade).toBe(a.persona.patience);
  });

  it('never calls while we are keying', () => {
    const { agents: [a], say, tick, ctx, said } = setup('JH3ABC');
    say('CQ DE JA1ZZZ K');
    ctx.hearsKeying = (_agent, party) => party === 'me';
    tick(60);
    expect(said(a)).toHaveLength(1);
    expect(a.gone).toBe(false);
  });

  it('counts a call lost in a doubling only half against patience', () => {
    const plain = setup('JH3ABC');
    plain.say('CQ DE JA1ZZZ K');
    plain.say('CQ DE JA1ZZZ K');
    expect(plain.agents[0].attempts).toBe(1);

    const doubled = setup('JH3ABC');
    const [a] = doubled.agents;
    doubled.say('CQ DE JA1ZZZ K');
    doubled.doubleWith(a);
    expect(a.doublings).toBe(1);
    doubled.say('CQ DE JA1ZZZ K');
    expect(a.attempts).toBe(DOUBLED_WEIGHT);
    expect(a.callsMade).toBe(2);
  });

  it('stays through a doubling it would have left on, then is worked', () => {
    // Patience 2: two plain unanswered calls and it goes; a doubling in between keeps it.
    const { agents: [a], say, doubleWith, said } = setupWith({ patience: 2 }, 'JH3ABC');
    say('CQ DE JA1ZZZ K');
    say('CQ DE JA1ZZZ K');
    doubleWith(a);
    say('CQ DE JA1ZZZ K');
    expect(a.gone).toBe(false);
    say('JH3ABC UR 599 NAME MASA QTH TOKYO BK');
    expect(a.state).toBe('exchanged');
    expect(said(a).at(-1)).toBe(exchangeText(a.persona, ME, true));
  });

  it('asks again soon when our message to it went under its own', () => {
    const { agents: [a], say, doubleWith, tick, said } = setup('JH3ABC');
    say('CQ DE JA1ZZZ K');
    say('JH3ABC UR 599 NAME MASA QTH TOKYO BK');
    expect(a.state).toBe('exchanged');
    const before = said(a).length;
    doubleWith(a);
    tick(a.persona.retry[1] + 1);
    expect(said(a).length).toBe(before + 1);
    expect(said(a).at(-1)).toBe('JA1ZZZ?');
    // Without a doubling it waits NUDGE_AFTER of silence first.
    const calm = setup('JH3ABC');
    calm.say('CQ DE JA1ZZZ K');
    calm.say('JH3ABC UR 599 NAME MASA QTH TOKYO BK');
    const quiet = calm.said(calm.agents[0]).length;
    calm.tick(a.persona.retry[1] + 1);
    expect(calm.said(calm.agents[0]).length).toBe(quiet);
    calm.tick(NUDGE_AFTER);
    expect(calm.said(calm.agents[0]).length).toBe(quiet + 1);
  });

  it('a novice calls over traffic and is slower to ask again after a doubling in QSO', () => {
    // Someone else (not us) keying: a seasoned caller holds, a novice calls anyway.
    for (const [style, calls] of [['twice', 1], ['novice', 2]] as const) {
      const { agents: [a], say, tick, said, ctx } = setupWith({ style }, 'JH3ABC');
      say('CQ DE JA1ZZZ K');
      ctx.hearsKeying = (_agent, party) => party === undefined;
      tick(a.persona.retry[1] + 1);
      expect(said(a), style).toHaveLength(calls);
    }
    // Our message lost under its own: seasoned asks within its retry, a novice 2 s later.
    const asked: Record<string, boolean[]> = {};
    for (const style of ['twice', 'novice'] as const) {
      const { agents: [a], say, doubleWith, tick, said } = setupWith({ style }, 'JH3ABC');
      say('CQ DE JA1ZZZ K');
      say('JH3ABC UR 599 NAME MASA QTH TOKYO BK');
      const before = said(a).length;
      doubleWith(a);
      tick(0.6);
      const early = said(a).length > before;
      tick(2);
      asked[style] = [early, said(a).length > before];
    }
    expect(asked).toEqual({ twice: [true, true], novice: [false, true] });
  });

  it('moves on after waiting too long to be picked, however lively the frequency', () => {
    const { agents: [a, b], say, tick, ctx } = setupWith({ waitLimit: 40, patience: 9 }, 'JH3ABC', 'JA1XYZ');
    say('CQ DE JA1ZZZ K');
    say('JA1XYZ UR 599 NAME MASA QTH TOKYO BK');
    expect(a.state).toBe('holding');
    // Someone is always on the air: no silence timeout, only the wait — which wears slower
    // while it watches another station being worked.
    ctx.hearsKeying = (_agent, party) => party === undefined;
    tick(40 / HEARD_WAIT - 10);
    expect(a.gone).toBe(false);
    tick(20);
    expect(a.goneReason).toBe('waited');
    expect(b.gone).toBe(false);
  });

  it('sits a CQ out now and then, as its recall says', () => {
    const shy = setupWith({ recall: 0 }, 'JH3ABC');
    shy.say('CQ DE JA1ZZZ K');
    shy.say('CQ DE JA1ZZZ K');
    expect(shy.said(shy.agents[0])).toHaveLength(1);
    const eager = setupWith({ recall: 1 }, 'JH3ABC');
    eager.say('CQ DE JA1ZZZ K');
    eager.say('CQ DE JA1ZZZ K');
    expect(eager.said(eager.agents[0])).toHaveLength(2);
  });

  it('gives up on the wait only when it would call again, never straight after calling', () => {
    const { agents: [a], say, tick, ctx } = setupWith({ waitLimit: 10, patience: 9, recall: 1 }, 'JH3ABC');
    say('CQ DE JA1ZZZ K');
    // A long call of its own runs past the limit.
    a.station.busyUntil = 15;
    ctx.hearsKeying = (agent, party) => party === undefined && agent === a;
    tick(14);
    expect(a.gone).toBe(false);
    ctx.hearsKeying = () => false;
    say('CQ DE JA1ZZZ K');
    expect(a.goneReason).toBe('waited');
  });
});

