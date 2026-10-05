import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseIntent } from '../air/intent';
import { pileupLevel, pileupParamsOf } from '../modes/pileupLevels';
import { pileupIntent, PileupSession } from '../modes/pileupRun';
import { seeded } from '../random';
import {
  afterSend, fieldsAfter, keyAction, nextAction, partialFor, phaseLine, PILEUP_KEYS, sendAsTyped, shapeOf, START,
  type PickAction, type PickInput, type PickState,
} from './nextAction';

const ME = 'JS2WDR';
const listening: PickState = { phase: 'listening', sentCall: null, path: [] };
const working = (call: string, path: string[] = [call]): PickState => ({ phase: 'working', sentCall: call, path });
const input = (call: string, rst = ''): PickInput => ({ call, rst });
const enter = (state: PickState, call: string, rst = '') => nextAction(state, input(call, rst), ME);

describe('shapeOf', () => {
  it.each([
    ['', 'empty'], ['   ', 'empty'],
    ['JA3ABC', 'call'], ['ja3abc', 'call'], [' JA3ABC ', 'call'], ['K1ABC', 'call'], ['JA3ABC/1', 'call'], ['W1AW', 'call'], ['7K1XYZ', 'call'],
    ['3A', 'piece'], ['3AB', 'piece'], ['ABC', 'piece'], ['A', 'piece'], ['JA3', 'piece'], ['599', 'piece'],
    ['JA?ABC', 'piece'], ['3AB?', 'piece'], ['JA3AB?', 'piece'], ['JA3ABC?', 'piece'], ['?', 'piece'],
    ['3AB AGN?', 'other'], ['JA3ABC 5NN', 'other'], ['5-9', 'other'],
  ] as const)('%j is %s', (call, shape) => {
    expect(shapeOf(call)).toBe(shape);
  });
});

describe('nextAction: the Enter table', () => {
  const cases: [string, PickState, string, string, Partial<PickAction>][] = [
    ['start, empty → CQ', START, '', '', { kind: 'cq', text: 'CQ JS2WDR JS2WDR' }],
    ['start, a piece → partial', START, '3AB', '', { kind: 'partial', text: '3AB AGN?', subject: '3AB' }],
    ['start, a call → pick', START, 'JA3ABC', '', { kind: 'pick', text: 'JA3ABC 5NN', subject: 'JA3ABC' }],
    ['listening, empty → QRZ?', listening, '', '', { kind: 'qrz', text: 'QRZ?' }],
    ['listening, empty but an RST → QRZ?', listening, '', '599', { kind: 'qrz', text: 'QRZ?' }],
    ['listening, 2 letters → partial', listening, '3A', '', { kind: 'partial', text: '3A AGN?', subject: '3A' }],
    ['listening, 3 letters → partial', listening, '3ab', '', { kind: 'partial', text: '3AB AGN?', subject: '3AB' }],
    ['listening, wildcard → partial', listening, 'JA?ABC', '', { kind: 'partial', text: 'JA?ABC AGN?', subject: 'JA?ABC' }],
    ['listening, trailing ? → as typed', listening, '3AB?', '', { kind: 'partial', text: '3AB?', subject: '3AB' }],
    ['listening, call + ? → as typed (a partial)', listening, 'JA3AB?', '', { kind: 'partial', text: 'JA3AB?', subject: 'JA3AB' }],
    ['listening, a call → pick', listening, 'JA3ABC', '', { kind: 'pick', text: 'JA3ABC 5NN', subject: 'JA3ABC' }],
    ['listening, a call + RST → still the pick (no report yet)', listening, 'JA3ABC', '599', { kind: 'pick', text: 'JA3ABC 5NN' }],
    ['listening, words → as typed', listening, '3ab  agn?', '', { kind: 'raw', text: '3AB AGN?' }],
    ['working, same call, no RST → AGN?', working('JA3ABC'), 'JA3ABC', '', { kind: 'agn', text: 'AGN?' }],
    ['working, same call, RST → TU + log', working('JA3ABC'), 'JA3ABC', '5nn', { kind: 'tu', text: 'TU JS2WDR', log: { call: 'JA3ABC', rst: '5NN' } }],
    ['working, RST as heard (579)', working('JA3ABC'), 'JA3ABC', '579', { kind: 'tu', log: { call: 'JA3ABC', rst: '579' } }],
    ['working, another call → correction', working('JA3ABC'), 'JA3ABD', '599', { kind: 'correct', text: 'JA3ABD 5NN', subject: 'JA3ABD' }],
    ['working, a piece → partial', working('JA3ABC'), '3AB', '', { kind: 'partial', text: '3AB AGN?' }],
    ['working, empty → QRZ? (drop)', working('JA3ABC'), '', '599', { kind: 'qrz', text: 'QRZ?' }],
    ['working, words → as typed', working('JA3ABC'), 'JA3ABC 559', '', { kind: 'raw', text: 'JA3ABC 559' }],
  ];
  it.each(cases)('%s', (_, state, call, rst, expected) => {
    expect(enter(state, call, rst)).toMatchObject(expected);
  });

  it('never has nothing to send', () => {
    for (const state of [START, listening, working('JA3ABC')]) {
      for (const call of ['', '3', '3AB', 'JA3ABC', 'JA3ABD', 'X Y', '?']) {
        expect(enter(state, call).kind).not.toBe('none');
        expect(enter(state, call).text).not.toBe('');
      }
    }
  });

  it('only TU logs', () => {
    for (const state of [START, listening, working('JA3ABC')]) {
      for (const call of ['', '3AB', 'JA3ABC', 'JA3ABD']) {
        for (const rst of ['', '599']) {
          const action = enter(state, call, rst);
          expect(!!action.log).toBe(action.kind === 'tu');
        }
      }
    }
  });
});

describe('nextAction is a function of what the operator sees', () => {
  /** Every state the desk can be in, as reached by sending. */
  const states: PickState[] = [START, listening, { phase: 'listening', sentCall: null, path: ['3A', '3AB'] }, working('JA3ABC'), working('JA3ABD', ['3AB', 'JA3ABC', 'JA3ABD'])];
  const calls = ['', '3', '3A', '3AB', 'JA3AB', 'JA3ABC', 'JA3ABD', 'ja3abc', 'JA?ABC', '3AB?', 'JA3ABC/P', 'TU', 'X Y Z', '599'];
  const rsts = ['', '599', '5NN', '579', 'x'];

  it('the same fields and state always give the same action', () => {
    for (const state of states) {
      for (const call of calls) {
        for (const rst of rsts) {
          const first = nextAction(state, input(call, rst), ME);
          for (let again = 0; again < 3; again += 1) expect(nextAction(structuredClone(state), input(call, rst), ME)).toEqual(first);
        }
      }
    }
  });

  it('the path never changes what Enter sends — only the phase and the call sent do', () => {
    for (const call of calls) {
      expect(enter({ ...listening, path: ['3A', '3AB', '3ABC'] }, call)).toEqual(enter(listening, call));
      expect(enter(working('JA3ABC', ['3A', '3AB', 'JA3ABC']), call, '599')).toEqual(enter(working('JA3ABC'), call, '599'));
    }
  });

  it('does not mutate the state or the input', () => {
    const state = working('JA3ABC', ['3AB', 'JA3ABC']);
    const fields = input('JA3ABC', '599');
    const frozen = Object.freeze({ ...state, path: Object.freeze([...state.path]) as string[] });
    nextAction(frozen, Object.freeze(fields), ME);
    afterSend(frozen, nextAction(frozen, fields, ME));
    expect(state).toEqual(working('JA3ABC', ['3AB', 'JA3ABC']));
  });

  it('imports nothing that knows the stations (no session, agents, ether or persona)', () => {
    const source = readFileSync(new URL('./nextAction.ts', import.meta.url), 'utf8');
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
    expect(imports.sort()).toEqual(['../air/intent', '../memories']);
  });

  it('two pileups with different callers get the same messages from the same keystrokes', () => {
    /** Keystrokes: what is typed in CALL / RST, then Enter. */
    const script: [string, string][] = [['', ''], ['', ''], ['3A', ''], ['3AB', ''], ['JA3ABC', ''], ['JA3ABC', ''], ['JA3ABC', '5NN'], ['', ''], ['7K', ''], ['7K1XYZ', ''], ['7K1XYZ', '599']];
    const play = (seed: number) => {
      let now = 0;
      const run = new PileupSession(
        { random: seeded(seed), me: { call: ME, name: 'MASA', qth: 'NAGOYA' }, params: pileupParamsOf(pileupLevel('dx').axes) },
        { now: () => now, send: () => 0, stationsChanged: () => undefined },
      );
      let state = START;
      const sent: string[] = [];
      for (const [call, rst] of script) {
        const action = nextAction(state, input(call, rst), ME);
        run.transmit(action.text, { start: now, end: now + 2, rf: 7_012_000 });
        if (action.log) run.logEntry({ ...action.log, name: '', qth: '' }, now + 2);
        state = afterSend(state, action);
        sent.push(action.text);
        now += 8;
        run.tick(now);
      }
      return { sent, calls: run.agents.map((agent) => agent.call).join() };
    };
    const a = play(1);
    const b = play(2);
    expect(a.calls).not.toBe(b.calls); // different stations on the air…
    expect(a.sent).toEqual(b.sent); // …the same messages
    expect(a.sent).toEqual([
      'CQ JS2WDR JS2WDR', 'QRZ?', '3A AGN?', '3AB AGN?', 'JA3ABC 5NN', 'AGN?', 'TU JS2WDR', 'QRZ?', '7K AGN?', '7K1XYZ 5NN', 'TU JS2WDR',
    ]);
  });
});

describe('afterSend: the desk state', () => {
  it('narrows with partials, picks, and starts over with TU', () => {
    let state = START;
    const steps: [string, string, PickState['phase'], string[]][] = [
      ['', '', 'listening', []],
      ['3A', '', 'listening', ['3A']],
      ['3AB', '', 'listening', ['3A', '3AB']],
      ['JA3ABC', '', 'working', ['3A', '3AB', 'JA3ABC']],
      ['JA3ABC', '', 'working', ['3A', '3AB', 'JA3ABC']], // AGN?
      ['JA3ABD', '', 'working', ['3A', '3AB', 'JA3ABC', 'JA3ABD']], // correction
      ['JA3ABD', '599', 'listening', []], // TU
    ];
    for (const [call, rst, phase, path] of steps) {
      state = afterSend(state, enter(state, call, rst));
      expect(state.phase).toBe(phase);
      expect(state.path).toEqual(path);
    }
  });

  it('keeps the call sent while working, follows a correction', () => {
    let state = afterSend(listening, enter(listening, 'JA3ABC'));
    expect(state.sentCall).toBe('JA3ABC');
    state = afterSend(state, enter(state, 'JA3ABD'));
    expect(state.sentCall).toBe('JA3ABD');
  });

  it('a piece while working goes back to narrowing', () => {
    const state = afterSend(working('JA3ABC'), enter(working('JA3ABC'), '3AB'));
    expect(state).toEqual({ phase: 'listening', sentCall: null, path: ['JA3ABC', '3AB'] });
  });

  it('empty while working drops the contact (QRZ?)', () => {
    expect(afterSend(working('JA3ABC'), enter(working('JA3ABC'), ''))).toEqual(listening);
  });

  it('as typed: CQ/QRZ/TU start over, anything else leaves the state', () => {
    expect(afterSend(working('JA3ABC'), sendAsTyped(input('TU 73')))).toEqual(listening);
    expect(afterSend(working('JA3ABC'), sendAsTyped(input('QRZ?')))).toEqual(listening);
    expect(afterSend(working('JA3ABC'), sendAsTyped(input('JA3ABC 559')))).toEqual(working('JA3ABC'));
    expect(afterSend(START, sendAsTyped(input('QRS')))).toEqual(listening);
  });
});

describe('fieldsAfter', () => {
  it('a partial keeps the piece to add letters to', () => {
    expect(fieldsAfter(input('3AB'), enter(listening, '3AB'))).toEqual(input('3AB'));
  });
  it('a pick and AGN? keep the fields', () => {
    expect(fieldsAfter(input('JA3ABC'), enter(listening, 'JA3ABC'))).toEqual(input('JA3ABC'));
    expect(fieldsAfter(input('JA3ABC'), enter(working('JA3ABC'), 'JA3ABC'))).toEqual(input('JA3ABC'));
  });
  it('TU, QRZ? and CQ clear them', () => {
    expect(fieldsAfter(input('JA3ABC', '599'), enter(working('JA3ABC'), 'JA3ABC', '599'))).toEqual(input(''));
    expect(fieldsAfter(input('', '599'), enter(listening, '', '599'))).toEqual(input(''));
    expect(fieldsAfter(input('3AB'), keyAction(0, listening, input('3AB'), ME))).toEqual(input(''));
  });
});

describe('Ctrl+Enter and the memory keys', () => {
  it('Ctrl+Enter sends the field exactly as typed', () => {
    expect(sendAsTyped(input('ja3ab'))).toEqual({ kind: 'raw', text: 'JA3AB' });
    expect(sendAsTyped(input('3ab  agn?'))).toEqual({ kind: 'raw', text: '3AB AGN?' });
    expect(sendAsTyped(input('')).kind).toBe('none');
  });

  it('F6 makes a callsign-shaped piece a partial', () => {
    expect(enter(listening, 'JA3AB').kind).toBe('pick');
    expect(keyAction(5, listening, input('JA3AB'), ME)).toEqual({ kind: 'partial', text: 'JA3AB AGN?', subject: 'JA3AB' });
  });

  it.each([
    [0, listening, '3AB', '', { kind: 'cq', text: 'CQ JS2WDR JS2WDR' }],
    [1, listening, 'JA3ABC', '', { kind: 'pick', text: 'JA3ABC 5NN', subject: 'JA3ABC' }],
    [1, working('JA3ABC'), 'JA3ABD', '', { kind: 'correct', text: 'JA3ABD 5NN', subject: 'JA3ABD' }],
    [1, listening, '', '', { kind: 'none', text: '' }],
    [2, working('JA3ABC'), 'JA3ABC', '599', { kind: 'tu', text: 'TU JS2WDR', log: { call: 'JA3ABC', rst: '599' } }],
    [2, listening, '', '', { kind: 'tu', text: 'TU JS2WDR' }],
    [3, working('JA3ABC'), '', '', { kind: 'qrz', text: 'JS2WDR' }],
    [4, listening, 'JA3AB', '', { kind: 'partial', text: 'JA3AB?', subject: 'JA3AB' }],
    [4, listening, '', '', { kind: 'none', text: '' }],
    [5, listening, '3AB', '', { kind: 'partial', text: '3AB AGN?', subject: '3AB' }],
    [5, listening, '3AB?', '', { kind: 'partial', text: '3AB AGN?', subject: '3AB' }],
    [6, working('JA3ABC'), 'JA3ABC', '', { kind: 'qrz', text: 'QRZ?' }],
    [7, working('JA3ABC'), 'JA3ABC', '', { kind: 'agn', text: 'AGN?' }],
    [8, listening, '', '', { kind: 'raw', text: 'QRS' }],
    [9, listening, '', '', { kind: 'raw', text: 'QRX' }],
    [10, listening, '', '', { kind: 'none', text: '' }],
  ] as const)('key %i with %j', (index, state, call, rst, expected) => {
    expect(keyAction(index, state, input(call, rst), ME)).toEqual(expected);
  });

  it('has ten keys F1–F10', () => {
    expect(PILEUP_KEYS.map((memory) => memory.key)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10']);
  });
});

describe('the pileup hears our messages as meant', () => {
  const heard = (text: string) => pileupIntent(parseIntent(text, ME));
  it('CQ, QRZ? and TU {MYCALL} call the pile', () => {
    expect(heard(enter(START, '').text).cq).toBe(true);
    expect(heard(enter(listening, '').text).qrz).toBe(true);
    expect(heard(enter(working('JA3ABC'), 'JA3ABC', '599').text).qrz).toBe(true);
    expect(heard(keyAction(3, listening, input(''), ME).text).qrz).toBe(true);
  });
  it('partials are partials', () => {
    expect(heard(enter(listening, '3AB').text).partial).toBe('3AB');
    expect(heard(enter(listening, '3A').text).partial).toBe('3A');
    expect(heard(enter(listening, '3AB?').text).partial).toBe('3AB');
    expect(heard(enter(listening, 'JA3AB?').text).partial).toBe('JA3AB');
    expect(heard(keyAction(5, listening, input('JA3AB'), ME).text).partial).toBe('JA3AB');
  });
  it('a pick names the call with the report', () => {
    const intent = heard(enter(listening, 'JA3ABC').text);
    expect(intent.calls).toEqual(['JA3ABC']);
    expect(intent.partial).toBeNull();
    expect(intent.report).toBe('599'); // read as 599
  });
  it('a wildcard piece goes out as typed; the pileup takes it as AGN? (no wildcard matching yet)', () => {
    const intent = heard(enter(listening, 'JA?ABC').text);
    expect(intent.agn).toBe(true);
    expect(intent.partial).toBeNull();
  });
});

describe('phaseLine', () => {
  it('says only what we did', () => {
    expect(phaseLine(START)).toBe('CQ を出して始めます');
    expect(phaseLine(listening)).toBe('聴取中');
    expect(phaseLine({ ...listening, path: ['3A', '3AB'] })).toBe('絞り込み 2 回目');
    expect(phaseLine(working('JA3ABC'))).toBe('JA3ABC と交信中');
  });
  it('partialFor: an empty piece sends nothing', () => {
    expect(partialFor('').kind).toBe('none');
  });
});
