import { describe, expect, it } from 'vitest';
import { createCaller, type CallerAgent } from '../agents/caller';
import { CONTEST_EXCHANGE } from '../agents/exchangeSpec';
import { CONTEST_PROCEDURE, mannersOf } from '../agents/manners';
import type { Agent, AgentContext, AgentNote } from '../agents/types';
import type { AirEvent } from '../air/ether';
import type { StationPersona } from '../air/persona';
import { seeded } from '../random';
import { mergeExchange } from './bot';
import { readContest, serialIn } from './intent';
import { blockFor, crossCheck, liveScore, rateBlocks, type ContestLogLine, type TheirLine } from './log';
import { SPRINT_RULES, wpxPrefix } from './rules';
import { formatSerial, isContestCall, parseSerial, serialOf } from './serial';
import { ContestField } from './field';
import { tokensOf } from '../air/intent';

const ME = { call: 'JS2WDR', name: 'MASA', qth: 'NAGOYA' };
const RF = 7_012_000;

describe('serials', () => {
  it('formats cut numbers and padding', () => {
    expect(formatSerial(23, { cut: 'none', pad: true })).toBe('023');
    expect(formatSerial(23, { cut: 'none', pad: false })).toBe('23');
    expect(formatSerial(109, { cut: 'tn', pad: true })).toBe('1TN');
    expect(formatSerial(105, { cut: 'tnae', pad: true })).toBe('ATE');
    expect(formatSerial(270, { cut: 'all', pad: true })).toBe('UBT');
    expect(formatSerial(278, { cut: 'all', pad: true })).toBe('278');
    expect(formatSerial(7, { cut: 'tn', pad: true })).toBe('TT7');
  });

  it('reads them back, whatever the cut', () => {
    for (const cut of ['none', 'tn', 'tnae', 'all'] as const) {
      for (const pad of [true, false]) {
        for (const serial of [1, 9, 10, 23, 99, 105, 278, 590, 1234]) expect(parseSerial(formatSerial(serial, { cut, pad }))).toBe(serial);
      }
    }
  });

  it('never reads procedure words or calls as numbers', () => {
    for (const word of ['TU', 'EE', 'DE', 'TEST', 'NR', 'K', 'R', 'JA1ABC', 'AE', 'TNX', 'N', 'NE', 'BK', 'BT', 'NO', 'EE']) expect(parseSerial(word)).toBeNull();
    expect(serialOf(' 023 ')).toBe(23);
    expect(serialOf('t23')).toBe(23);
    expect(serialOf('')).toBeNull();
  });
});

describe('contestIntent', () => {
  it('reads a cut serial that looks like a call as the serial', () => {
    const intent = readContest('JA1ABC 5NN 24T', ME.call);
    expect(intent.calls).toEqual(['JA1ABC']);
    expect(intent.serial).toBe(240);
    expect(serialIn(['5NN', '23N', '23N'])).toBe(239);
    expect(serialIn(['199'])).toBe(199);
    expect(mergeExchange(['5NN', '2NN'])).toEqual(['5NN', '2NN']);
    expect(mergeExchange(['R', '5NN', '23N', '23N'])).toEqual(['R', '5NN', '23N']);
    expect(isContestCall('24T')).toBe(false);
    expect(isContestCall('JA1ABC')).toBe(true);
  });

  it('reads the serial after the report', () => {
    const intent = readContest('JA1ABC 5NN 023', ME.call);
    expect(intent.calls).toEqual(['JA1ABC']);
    expect(intent.report).toBe('599');
    expect(intent.serial).toBe(23);
    expect(readContest('R 5NN TT7', ME.call).serial).toBe(7);
    expect(readContest('5NN 1TN 1TN', ME.call).serial).toBe(109);
    // A serial that looks like a report or a sign-off, right after the report.
    expect(serialIn(tokensOf('5NN 599'))).toBe(599);
    expect(serialIn(tokensOf('5NN 73'))).toBe(73);
    expect(readContest('023 023', ME.call).serial).toBe(23);
  });

  it('reads CQ TEST, TU with our call as a QRZ?, NR?, CALL? and QSO B4', () => {
    const cq = readContest('CQ TEST JS2WDR TEST', ME.call);
    expect(cq.cq && cq.mentionsMe).toBe(true);
    expect(cq.serial).toBeUndefined();
    const tu = readContest('TU JS2WDR', ME.call);
    expect(tu.closing && tu.qrz).toBe(true);
    expect(readContest('NR?', ME.call).ask).toEqual(['NR']);
    expect(readContest('NR AGN?', ME.call).ask).toEqual(['NR']);
    const call = readContest('CALL?', ME.call);
    expect(call.ask).toEqual(['CALL']);
    expect(call.agn).toBe(true);
    const b4 = readContest('JA1ABC QSO B4', ME.call);
    expect(b4.b4).toBe(true);
    expect(b4.serial).toBeUndefined();
    expect(readContest('JA1ABC 5NN 023 TU', ME.call).serial).toBe(23);
  });
});

describe('rules and the log check', () => {
  it('takes WPX prefixes', () => {
    expect(wpxPrefix('JA1ABC')).toBe('JA1');
    expect(wpxPrefix('7K1XYZ')).toBe('7K1');
    expect(wpxPrefix('JH3AB')).toBe('JH3');
  });

  const line = (id: number, at: number, call: string, nr: string, sentNr = id): ContestLogLine => ({ id: `log-${id}`, at, call, rst: '599', nr, sentNr });
  const their = (station: string, at: number, sent: number, nr: number | null): TheirLine => ({ station, at, sent, nr });

  it('finds ok, bust-nr, bust-call, NIL and dupes', () => {
    const ours = [
      line(1, 10, 'JA1ABC', '023'),
      line(2, 30, 'JH3XYZ', '105'), // they sent 106
      line(3, 50, 'JR2QQB', '7'), // it was JR2QQR
      line(4, 70, 'JE7ZZZ', '9'), // nobody
      line(5, 90, 'JA1ABC', '24'), // dupe
    ];
    const theirs = [their('JA1ABC', 8, 23, 1), their('JH3XYZ', 28, 106, 2), their('JR2QQR', 48, 7, 3), their('JA1ABC', 88, 24, 5), their('JF1AAA', 110, 3, 6)];
    const check = crossCheck(ours, theirs, SPRINT_RULES);
    expect(check.lines.map((item) => item.verdict)).toEqual(['ok', 'bust-nr', 'bust-call', 'nil', 'dupe']);
    expect(check.theirOnly.map((item) => item.station)).toEqual(['JF1AAA']);
    // Claimed: 4 contacts (the dupe is worth nothing), 4 prefixes.
    expect(check.claimed).toEqual({ qsos: 4, points: 4, mults: 4, total: 16 });
    // Checked: 1 good, NIL and busted call cost a point each.
    expect(check.checked).toEqual({ qsos: 1, points: -1, mults: 1, total: 0 });
  });

  it('flags a station that miscopied our serial without costing us', () => {
    const check = crossCheck([line(1, 10, 'JA1ABC', '23', 1)], [their('JA1ABC', 9, 23, 7)], SPRINT_RULES);
    expect(check.lines[0].verdict).toBe('ok');
    expect(check.lines[0].theyBustedUs).toBe(true);
  });

  it('does not match a contact far away in time', () => {
    const check = crossCheck([line(1, 900, 'JA1ABC', '23')], [their('JA1ABC', 10, 23, 1)], SPRINT_RULES);
    expect(check.lines[0].verdict).toBe('nil');
  });

  it('scores the live log and blocks the rate', () => {
    expect(liveScore([{ call: 'JA1ABC' }, { call: 'JA1XYZ' }, { call: 'JH3AAA' }, { call: 'JA1ABC' }], SPRINT_RULES)).toEqual({ qsos: 3, points: 3, mults: 2, total: 6 });
    const blocks = rateBlocks([5, 50, 70, 130], 0, 180, 60);
    expect(blocks.map((block) => block.qsos)).toEqual([2, 1, 1]);
    expect(blocks[0].rate).toBe(120);
    expect(blockFor(300)).toBe(60);
    expect(blockFor(1800)).toBe(300);
  });
});

describe('the field', () => {
  it('gives each station its own rising serial, and sends back stations that worked us', () => {
    const random = seeded(5);
    const field = new ContestField({ similar: 0, serial: 0.5, dupes: 1 }, ME.call);
    const request = { random, speed: 24, weak: 0.2, spread: 100, active: [] as string[] };
    const a = field.next(request);
    const b = field.next(request);
    expect(a.call).not.toBe(b.call);
    expect(a.rst).toBe('599');
    const first = field.serialFor(a.call, 0);
    const later = field.serialFor(a.call, 600);
    expect(later).toBeGreaterThan(first);
    // Nobody worked us yet: no dupes, whatever the chance.
    expect(field.next(request).call).not.toBe(a.call);
    field.record(a.call, { agentId: 1, at: 10, nr: 1, sent: first });
    expect(field.next({ ...request, active: [] }).call).toBe(a.call);
    // On frequency already: it doesn't come twice.
    expect(field.next({ ...request, active: [a.call] }).call).not.toBe(a.call);
    expect(field.serialFor(a.call, 600)).toBeGreaterThan(later);
    field.unrecord(a.call, 1);
    expect(field.station(a.call)!.log).toEqual([]);
  });
});

const persona = (call: string, style: StationPersona['style'] = 'once'): StationPersona => ({
  call, name: 'KEN', qth: 'OSAKA', area: 1, wpm: 24, jitter: 0.05, style, sendStyle: 'brief',
  patience: 6, waitLimit: 300, recall: 1, reaction: [0.2, 0.4], retry: [2.5, 3], strength: 0.5, offsetHz: 30, rxWidth: 400,
  qrsFloor: 14, rst: '599', cutNumbers: true, closing: 'ee',
});

/** A contest frequency of hand-made callers. */
function frequency(...calls: [string, string][]) {
  const random = seeded(1);
  let now = 0;
  const sent: { agent: Agent; text: string }[] = [];
  const notes: AgentNote[] = [];
  const agents: CallerAgent[] = [];
  const ctx: AgentContext = {
    now: () => now, random, send: (agent, text) => sent.push({ agent, text }), me: ME,
    peers: () => agents.filter((agent) => !agent.gone), notify: (note) => notes.push(note), hearsKeying: () => false, keyingSince: () => null,
  };
  calls.forEach(([call, nr], index) => {
    agents.push(createCaller(persona(call), { random, listenRf: RF, now }, {
      manners: mannersOf('once'), exchange: CONTEST_EXCHANGE, procedure: CONTEST_PROCEDURE, calling: 'pileup', contest: { serial: index + 7, nr },
    }));
  });
  let seq = 0;
  const say = (text: string) => {
    const event: AirEvent = { id: (seq += 1), from: 'me', text, intent: readContest(text, ME.call), rf: RF, start: now, end: now + 1, epoch: 0 };
    now += 1;
    const before = sent.length;
    for (const agent of agents) agent.hear(event, ctx);
    return sent.slice(before).map((item) => `${(item.agent as CallerAgent).call}: ${item.text}`);
  };
  const byCall = (call: string) => agents.find((agent) => agent.call === call)!;
  return { say, byCall, notes };
}

describe('a contest caller', () => {
  it('calls on CQ TEST, gives report and serial for ours, and goes quietly on TU', () => {
    const f = frequency(['JA1ABC', 'TT7']);
    expect(f.say('CQ TEST JS2WDR TEST')).toEqual(['JA1ABC: JA1ABC']);
    expect(f.say('JA1ABC 5NN 001')).toEqual(['JA1ABC: 5NN TT7']);
    expect(f.byCall('JA1ABC').heardNr).toBe(1);
    expect(f.byCall('JA1ABC').state).toBe('exchanged');
    expect(f.say('TU JS2WDR')).toEqual([]);
    expect(f.byCall('JA1ABC').state).toBe('done');
  });

  it('asks NR? when our serial is missing, and answers NR? and CALL?', () => {
    const f = frequency(['JA1ABC', '023']);
    f.say('CQ TEST JS2WDR TEST');
    expect(f.say('JA1ABC 5NN')).toEqual(['JA1ABC: NR?']);
    expect(f.say('5NN 001')).toEqual(['JA1ABC: 5NN 023']);
    expect(f.say('NR?')).toEqual(['JA1ABC: 023 023']);
    expect(f.say('CALL?')).toEqual(['JA1ABC: JA1ABC JA1ABC']);
    expect(f.say('AGN?')).toEqual(['JA1ABC: 5NN 023']);
    // Our serial sent again: it is what it logs.
    f.say('JA1ABC 5NN 002');
    expect(f.byCall('JA1ABC').heardNr).toBe(2);
  });

  it('leaves without a word on QSO B4', () => {
    const f = frequency(['JA1ABC', '023'], ['JH3XYZ', '104']);
    f.say('CQ TEST JS2WDR TEST');
    expect(f.say('JA1ABC QSO B4')).toEqual([]);
    expect(f.byCall('JA1ABC').goneReason).toBe('b4');
    expect(f.byCall('JH3XYZ').gone).toBe(false);
  });

  it('stands by while another is worked and calls again on TU', () => {
    const f = frequency(['JA1ABC', '023'], ['JH3XYZ', '104']);
    f.say('CQ TEST JS2WDR TEST');
    f.say('JA1ABC 5NN 001');
    expect(f.byCall('JH3XYZ').state).toBe('holding');
    expect(f.say('TU JS2WDR')).toEqual(['JH3XYZ: JH3XYZ']);
  });

  it('a call put right in the TU ("JA1ABC TU JS2WDR") ends the contact and is the cue for the rest', () => {
    expect(readContest('JA1ABC TU JS2WDR', ME.call)).toMatchObject({ calls: [], qrz: true, closing: true });
    const f = frequency(['JA1ABC', '023'], ['JH3XYZ', '104']);
    f.say('CQ TEST JS2WDR TEST');
    f.say('JA1ABC 5NN 001');
    expect(f.byCall('JH3XYZ').state).toBe('holding');
    expect(f.say('JA1ABC TU JS2WDR')).toEqual(['JH3XYZ: JH3XYZ']);
    expect(f.byCall('JA1ABC').state).toBe('done');
  });
});
