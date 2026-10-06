import { describe, expect, it } from 'vitest';
import {
  CONTEST_KEYS, EMPTY_INPUT, ESM_START, esmAfter, esmEnter, esmExchange, esmFieldsAfter, esmKey, esmLogTu,
  type EsmAction, type EsmInput, type EsmLog, type EsmState,
} from './esm';

const ME = 'JS2WDR';

/** A desk with its own log: what the operator sees and nothing else. */
function desk() {
  const lines: { call: string; nr: string; sentNr: number }[] = [];
  let state: EsmState = ESM_START;
  let input: EsmInput = EMPTY_INPUT;
  const log = (): EsmLog => ({ me: ME, nextNr: lines.length + 1, isDupe: (call) => lines.some((line) => line.call === call) });
  const press = (action: EsmAction) => {
    if (action.log) lines.push({ call: action.log.call, nr: action.log.nr, sentNr: log().nextNr });
    state = esmAfter(state, action);
    input = esmFieldsAfter(input, action);
    return action;
  };
  return {
    type: (change: Partial<EsmInput>) => { input = { ...input, ...change }; },
    enter: () => press(esmEnter(state, input, log())),
    semicolon: () => press(esmExchange(state, input, log())),
    backslash: () => press(esmLogTu(state, input, log())),
    key: (index: number) => press(esmKey(index, state, input, log())),
    get state() { return state; },
    get input() { return input; },
    get nextNr() { return log().nextNr; },
    lines,
  };
}

describe('contest ESM: the run loop', () => {
  it('CQ TEST → call → exchange → their serial → TU and log, for station after station', () => {
    const d = desk();
    expect(d.enter().text).toBe('CQ TEST JS2WDR TEST');
    for (const [call, nr] of [['JA1ABC', '023'], ['JH3XYZ', '104'], ['JR6AAA', '7'], ['JE1BBB', 'T23'], ['JA9CCC', '2NN']]) {
      const n = d.nextNr;
      d.type({ call });
      expect(d.enter()).toMatchObject({ kind: 'exchange', text: `${call} 5NN ${String(n).padStart(3, '0')}`, nr: n });
      expect(d.state).toMatchObject({ phase: 'working', sentCall: call });
      d.type({ nr });
      expect(d.enter()).toMatchObject({ kind: 'tu', text: 'TU JS2WDR', log: { call, rst: '599', nr } });
      expect(d.input).toEqual(EMPTY_INPUT);
      expect(d.state.phase).toBe('listening');
    }
    // Cut numbers are logged as typed: the log check reads them, the desk never rewrites them.
    expect(d.lines.map((line) => line.nr)).toEqual(['023', '104', '7', 'T23', '2NN']);
    expect(d.lines.map((line) => line.sentNr)).toEqual([1, 2, 3, 4, 5]);
    // Nobody typed: Enter calls CQ again.
    expect(d.enter().text).toBe('CQ TEST JS2WDR TEST');
  });

  it('no serial copied (or none that reads as one): NR?, and the contact waits', () => {
    const d = desk();
    d.type({ call: 'JA1ABC' });
    d.enter();
    expect(d.enter()).toMatchObject({ kind: 'ask', text: 'NR?' });
    d.type({ nr: 'X?' });
    expect(d.enter().text).toBe('NR?');
    expect(d.state).toMatchObject({ phase: 'working', sentCall: 'JA1ABC' });
    d.type({ nr: '023' });
    expect(d.enter().log).toMatchObject({ call: 'JA1ABC', nr: '023' });
  });

  it('partials as the copy grows: JA1? → JA1A? → JA1ABC', () => {
    const d = desk();
    d.enter();
    d.type({ call: 'JA1' });
    expect(d.enter()).toMatchObject({ kind: 'partial', text: 'JA1?' });
    // A piece that is call-shaped needs its "?" to stay a partial.
    d.type({ call: 'JA1A?' });
    expect(d.enter()).toMatchObject({ kind: 'partial', text: 'JA1A?' });
    expect(d.input.call).toBe('JA1A?');
    expect(d.state.path).toEqual(['JA1', 'JA1A']);
    d.type({ call: 'JA1ABC' });
    expect(d.enter().text).toBe('JA1ABC 5NN 001');
  });

  it('a wrong call put right: the exchange again with the same serial, or the right call in the TU', () => {
    const d = desk();
    d.type({ call: 'JA1ABD' });
    expect(d.enter().text).toBe('JA1ABD 5NN 001');
    // Before their serial: the corrected call with our exchange again (still 001).
    d.type({ call: 'JA1ABC' });
    expect(d.enter()).toMatchObject({ kind: 'correct', text: 'JA1ABC 5NN 001', nr: 1 });
    expect(d.state.sentCall).toBe('JA1ABC');
    // After: their serial in, the call changed once more — it goes out with the TU and is what is logged.
    d.type({ call: 'JA1ABE', nr: '023' });
    expect(d.enter()).toMatchObject({ kind: 'tu', text: 'JA1ABE TU JS2WDR', log: { call: 'JA1ABE', nr: '023' } });
  });

  it('a wrong serial: NR? keeps the contact, the typed number is replaced by the operator, not the desk', () => {
    const d = desk();
    d.type({ call: 'JA1ABC' });
    d.enter();
    d.type({ nr: '032' });
    // Unsure of it: NR? (F9) — nothing is logged, the number stays as typed.
    expect(d.key(8)).toMatchObject({ kind: 'ask', text: 'NR?' });
    expect(d.input.nr).toBe('032');
    expect(d.lines).toEqual([]);
    d.type({ nr: '023' });
    expect(d.enter().log?.nr).toBe('023');
  });
});

describe('contest ESM: our serial', () => {
  it('is given when the exchange goes out, the same until logged, and the next only after the log', () => {
    const d = desk();
    d.type({ call: 'JA1ABC' });
    expect(d.enter().nr).toBe(1);
    // Sent again in every form while the contact is open.
    expect(d.semicolon().text).toBe('JA1ABC 5NN 001');
    expect(d.key(1)).toMatchObject({ text: '5NN 001', nr: 1 });
    d.type({ call: 'JA1ABD' });
    expect(d.enter().nr).toBe(1);
    d.type({ nr: '9' });
    expect(d.enter().log).toBeDefined();
    expect(d.lines.at(-1)).toMatchObject({ call: 'JA1ABD', sentNr: 1 });
    d.type({ call: 'JH3XYZ' });
    expect(d.enter().text).toBe('JH3XYZ 5NN 002');
  });

  it('a contact dropped unlogged gives its number to the next station', () => {
    const d = desk();
    d.type({ call: 'JA1ABC' });
    expect(d.enter().nr).toBe(1);
    // Wiped and back to CQ: nothing logged.
    d.type({ call: '', nr: '' });
    expect(d.enter().kind).toBe('cq');
    d.type({ call: 'JH3XYZ' });
    expect(d.enter().text).toBe('JH3XYZ 5NN 001');
    d.type({ nr: '104' });
    d.enter();
    expect(d.lines).toEqual([{ call: 'JH3XYZ', nr: '104', sentNr: 1 }]);
  });
});

describe('contest ESM: DUPE', () => {
  it('a call already in our log gets QSO B4; ";" works it all the same', () => {
    const d = desk();
    d.type({ call: 'JA1ABC' });
    d.enter();
    d.type({ nr: '023' });
    d.enter();
    d.type({ call: 'JA1ABC' });
    expect(d.enter()).toMatchObject({ kind: 'b4', text: 'JA1ABC QSO B4' });
    expect(d.input).toEqual(EMPTY_INPUT);
    expect(d.state.phase).toBe('listening');
    d.type({ call: 'JA1ABC' });
    expect(d.semicolon()).toMatchObject({ kind: 'exchange', text: 'JA1ABC 5NN 002' });
  });

  it('a DUPE typed while working another station: QSO B4, not a call correction (Stage 3 limit fixed)', () => {
    const d = desk();
    d.type({ call: 'JA1ABC' });
    d.enter();
    d.type({ nr: '023' });
    d.enter();
    d.type({ call: 'JH3XYZ' });
    expect(d.enter()).toMatchObject({ kind: 'exchange', text: 'JH3XYZ 5NN 002' });
    // JA1ABC is heard calling again: it is in our log, so it gets QSO B4 and JH3XYZ is left.
    d.type({ call: 'JA1ABC' });
    expect(d.enter()).toMatchObject({ kind: 'b4', text: 'JA1ABC QSO B4', subject: 'JA1ABC' });
    expect(d.state).toMatchObject({ phase: 'listening', sentCall: null });
    expect(d.lines).toHaveLength(1);
    // ";" still works it, as a station of its own (not a correction of JH3XYZ).
    d.type({ call: 'JH3XYZ' });
    d.enter();
    d.type({ call: 'JA1ABC' });
    expect(d.semicolon()).toMatchObject({ kind: 'exchange', text: 'JA1ABC 5NN 002' });
  });

  it('a near call is a correction, a far one another station (both with the same serial)', () => {
    const d = desk();
    d.type({ call: 'JA1ABD' });
    d.enter();
    d.type({ call: 'JA1ABC' });
    expect(d.enter()).toMatchObject({ kind: 'correct', text: 'JA1ABC 5NN 001' });
    d.type({ call: 'JR6QQQ' });
    expect(d.enter()).toMatchObject({ kind: 'exchange', text: 'JR6QQQ 5NN 001' });
    d.type({ call: 'JR6QQB' });
    expect(d.semicolon()).toMatchObject({ kind: 'correct', text: 'JR6QQB 5NN 001' });
    d.type({ call: 'JE1BBB' });
    expect(d.semicolon()).toMatchObject({ kind: 'exchange', text: 'JE1BBB 5NN 001' });
  });
});

describe('contest ESM: memory keys', () => {
  it('F1–F11 in logger order, filled from the fields as typed', () => {
    const d = desk();
    expect(CONTEST_KEYS.map((key) => key.key)).toEqual(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11']);
    expect(d.key(0).text).toBe('CQ TEST JS2WDR TEST');
    // Keys that need a call send nothing without one.
    expect(d.key(4).kind).toBe('none');
    expect(d.key(5).kind).toBe('none');
    d.type({ call: 'JA1ABC' });
    expect(d.key(4).text).toBe('JA1ABC');
    expect(d.key(3).text).toBe('JS2WDR');
    expect(['?', 'AGN?', 'NR?', 'CALL?', 'QRS'].map((_, index) => d.key(6 + index).text)).toEqual(['?', 'AGN?', 'NR?', 'CALL?', 'QRS']);
    expect(d.state.phase).toBe('listening');
    // F3 with a call: TU and log, as "\".
    d.type({ nr: '5' });
    expect(d.key(2)).toMatchObject({ kind: 'tu', log: { call: 'JA1ABC', nr: '5' } });
    // F6 sends QSO B4 and moves on.
    d.type({ call: 'JA1ABC' });
    expect(d.key(5)).toMatchObject({ kind: 'b4', text: 'JA1ABC QSO B4' });
  });

  it('"\\" logs the fields as they are, even with no serial copied', () => {
    const d = desk();
    d.type({ call: 'JA1ABC' });
    d.enter();
    expect(d.backslash()).toMatchObject({ kind: 'tu', text: 'TU JS2WDR', log: { call: 'JA1ABC', nr: '' } });
    expect(d.backslash().kind).toBe('none');
  });
});
