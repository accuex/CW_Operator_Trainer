import { describe, expect, it } from 'vitest';
import { seeded } from '../random';
import { WabunDialogue } from './dialogue';
import { applyCorrection, parseWabunIntent } from './intent';
import { makeWabunScenario, type WabunLevel, type WabunScenario, type WabunWording } from './scenario';
import { keySegments, textOf } from './segments';
import { traceTransmission } from './trace';
import { plans, renderOver } from './utterance';

const ME = 'JA1ZZZ';
const WORDING: WabunWording = { cq: 0, answer: 0, exchange: 0, regards: 0, closing: 0, farewell: 0, talk: 0, fill: 0 };
const scenario = (closing73: 'inside' | 'after' = 'inside', level: WabunLevel = 2, wording: Partial<WabunWording> = {}): WabunScenario => ({
  level,
  truth: {
    call: 'JA7LBT', rst: '579', name: 'ワタナベ', qth: 'センダイ', qthSuffix: 'シ', greeting: 'day',
    weather: { sky: 'クモリ', temp: 12, condx: 'マアマア' },
    shack: { rig: 'IC705', ant: 'ダイポール', pwr: 10, key: 'バグ' },
    topic: { kind: 'garden', subject: 'トマト', stage: 'result' },
  },
  persona: { wpm: 14, closing73, wording: { ...WORDING, ...wording }, asksName: false },
  talk: null,
});
const on = { offsetHz: 20 };
const seconds = (text: string) => keySegments(text, { wpm: 13 }).length;

describe('wabun utterances', () => {
  it('renders the station truth into a short rubber stamp, facts placed', () => {
    const { truth, persona } = scenario();
    const over = renderOver(plans.exchange(truth, persona, ME));
    expect(over.text).toBe(`${ME} DE JA7LBT [ホレ] コンニチハ 」 コチラ センダイシ ニ 579 579 デ キテイマス ナマエハ ワタナベ ワタナベ [ラタ] KN`);
    const words = over.text.split(' ');
    for (const fact of over.facts) expect(words[fact.word]).toContain(fact.value);
    expect(over.facts.map((fact) => fact.fact).sort()).toEqual(['name', 'name', 'qth', 'rst', 'rst']);
    // Calls stay Latin (in the head), the facts sit in the body.
    expect(textOf(over.segments, 'roman')).toBe(`${ME} DE JA7LBT KN`);
  });

  it('keeps every Level 2 over well under the Stage 1 length at 13 WPM (less text, same speed)', () => {
    for (let exchange = 0; exchange < 3; exchange += 1) {
      for (const regards of [0, 1]) {
        const { truth, persona } = scenario('after', 2, { exchange, regards });
        expect(seconds(renderOver(plans.exchange(truth, persona, ME)).text)).toBeLessThan(85);
      }
    }
    for (const closing of [0, 1]) {
      for (const closing73 of ['inside', 'after'] as const) {
        const { truth, persona } = scenario(closing73, 2, { closing });
        expect(seconds(renderOver(plans.closing(truth, persona, ME, '599')).text)).toBeLessThan(55);
      }
    }
  });

  it('words the same truth differently by persona, the facts the same', () => {
    const texts = [0, 1, 2].map((exchange) => {
      const { truth, persona } = scenario('inside', 2, { exchange });
      const over = renderOver(plans.exchange(truth, persona, ME));
      expect([...new Set(over.facts.map((fact) => fact.fact))].sort()).toEqual(['name', 'qth', 'rst']);
      return over.text;
    });
    expect(new Set(texts).size).toBe(3);
    expect(texts[1]).toContain('ワタナベ? ワタナベ');
  });

  it('puts 73 inside the body or after ラタ, by persona', () => {
    const inside = renderOver(plans.closing(scenario().truth, scenario('inside').persona, ME, '599')).text;
    const after = renderOver(plans.closing(scenario().truth, scenario('after', 2, { closing: 1 }).persona, ME, null)).text;
    expect(inside).toBe(`${ME} DE JA7LBT [ホレ] 599 アリガトウ デハ 73 [ラタ] TU VA E E`);
    expect(after).toMatch(/サヨウナラ \[ラタ\] 73 TU E E$/);
  });

  it('Level 1 answers with the report in Latin and at most a word of kana', () => {
    const body = renderOver(plans.answer(scenario().truth, scenario('inside', 1).persona, ME));
    expect(body.text).toBe(`${ME} DE JA7LBT [ホレ] コンニチハ [ラタ] UR 579 579 BK`);
    expect(body.facts.map((fact) => fact.fact)).toEqual(['rst', 'rst']);
    const latin = renderOver(plans.answer(scenario().truth, scenario('inside', 1, { answer: 1 }).persona, ME));
    expect(latin.text).toBe(`${ME} DE JA7LBT GA UR 579 579 PSE <ホレ> BK`);
    expect(keySegments(latin.text, { wpm: 13 }).switches).toEqual([]);
    for (const text of [body.text, latin.text]) expect(seconds(text)).toBeLessThan(45);
  });

  it('scenarios agree with themselves (call area = QTH area)', () => {
    const random = seeded(7);
    for (let index = 0; index < 50; index += 1) {
      const { truth, persona } = makeWabunScenario(random, { wpm: 13, hour: 9 });
      expect(truth.call).toMatch(/^J[A-S][0-9][A-Z]{3}$/);
      expect(truth.greeting).toBe('morning');
      const keyed = keySegments(renderOver(plans.exchange(truth, persona, ME)).text, { wpm: 13 });
      expect(keyed.switches.map((event) => event.to)).toEqual(['wabun', 'roman']);
    }
  });
});

describe('wabun intent', () => {
  it('reads our call, the report in the body, thanks and the switches', () => {
    const intent = parseWabunIntent('JA7LBT DE JA1ZZZ [ホレ] レポート 599 599 デス アリガトウ [ラタ] KN', ME);
    expect(intent).toMatchObject({ opened: true, closed: true, unopened: false, report: '599', ack: true, closing: false });
    expect(intent.roman.mentionsMe).toBe(true);
  });

  it('notes kana sent without ホレ, and asks', () => {
    expect(parseWabunIntent('JA7LBT DE JA1ZZZ アリガトウ', ME).unopened).toBe(true);
    expect(parseWabunIntent('[ホレ] オナマエ サラオネ [ラタ] KN', ME).asks).toEqual(['name']);
    expect(parseWabunIntent('PSE NAME? QTH?', ME).asks).toEqual(['name', 'qth']);
    expect(parseWabunIntent('[ホレ] サラオネ [ラタ]', ME)).toMatchObject({ asks: [], repeat: true });
    expect(parseWabunIntent('TU E E', ME).closing).toBe(true);
  });

  it('applies a ラタ correction retyped from a little before the slip', () => {
    // ゴール → retyped from コ: the slip is taken back from its start.
    expect(applyCorrection('コンニチハ ゴール', 'コール アリガトウ')).toMatchObject({ erased: 'ゴール', after: 'コンニチハ コール アリガトウ' });
    // Retyped two kana before the slip, inside the word.
    expect(applyCorrection('レポート 589', '599')).toMatchObject({ after: 'レポート 599' });
    expect(applyCorrection('アリガトウゴザイマシテ', 'マシタ')).toMatchObject({ erased: 'マシテ', after: 'アリガトウゴザイマシタ' });
    // A digit slipped: retyped from the word, not lined up on the digit that matched to the end.
    expect(applyCorrection('レポート 559', '599 デス')).toMatchObject({ erased: '559', after: 'レポート 599 デス' });
    // Nothing to line up with: the last word goes.
    expect(applyCorrection('アリガトウ ハレ', 'ヨロシク')).toMatchObject({ erased: 'ハレ', after: 'アリガトウ ヨロシク' });
  });

  it('tells a correction ラタ from the closing ラタ, and reads the body corrected', () => {
    const text = `JA7LBT DE ${ME} [ホレ] コンニチハ ゴール {ラタ} コール アリガトウ レポート 589 {ラタ} 599 [ラタ] KN`;
    const intent = parseWabunIntent(text, ME);
    expect(intent.segments.filter((segment) => segment.kind === 'control').map((segment) => segment.kind === 'control' && [segment.sign, segment.to, Boolean(segment.correction)]))
      .toEqual([['ホレ', 'wabun', false], ['ラタ', null, true], ['ラタ', null, true], ['ラタ', 'roman', false]]);
    expect(intent).toMatchObject({ opened: true, closed: true, body: 'コンニチハ コール アリガトウ レポート 599', report: '599' });
    // Each correction: what it took back, and the retyped text up to the next sign.
    expect(intent.corrections.map((correction) => [correction.erased, correction.retyped])).toEqual([['ゴール', 'コール アリガトウ レポート 589'], ['589', '599']]);
    // On the air every ラタ is the same sign; only the closing one switches.
    const keyed = keySegments(text, { wpm: 20 });
    expect(keyed.chars.filter((span) => span.char === '[ラタ]')).toHaveLength(3);
    expect(keyed.switches.map((event) => event.sign)).toEqual(['ホレ', 'ラタ']);
    expect(keyed.corrections).toHaveLength(2);
    expect(keyed.chars.filter((span) => span.script === 'roman').map((span) => span.char).join('')).toBe('JA7LBTDEJA1ZZZKN');
  });

  it('keeps what was typed, what was keyed, what was meant and what was understood apart', () => {
    const dialogue = new WabunDialogue(scenario(), ME);
    dialogue.onTransmit(`JA7LBT DE ${ME} K`, on);
    // A slip nobody corrected (ゴール for コール) and a letter with no wabun code (x).
    const input = `JA7LBT DE ${ME} ホレ コンニチハ ゴール アリガトウx 599 デス ラタ KN`;
    const notation = `JA7LBT DE ${ME} [ホレ] コンニチハ ゴール アリガトウx 599 デス [ラタ] KN`;
    const result = dialogue.onTransmit(notation, on);
    const trace = traceTransmission(input, notation, result);
    expect(trace.input).toBe(input);
    expect(trace.notation).toBe(notation);
    // Keyed: the slip as sent, the x dropped by the keyer, nothing "fixed".
    expect(trace.keyed).toBe(`JA7LBT DE ${ME} ホレ コンニチハ ゴール アリガトウ 599 デス ラタ KN`);
    expect(trace.keyedWabun).toBe('コンニチハ ゴール アリガトウ 599 デス');
    expect(trace.intent).toMatchObject({ opened: true, closed: true, report: '599', ack: true });
    expect(trace.understood).toMatchObject({ heard: true, report: '599', thanks: true, corrections: [] });
    expect(trace.understood?.body).toContain('ゴール');
    expect(result.phase).toBe('closing');
  });
});

describe('wabun dialogue', () => {
  it('Level 2 runs cq → exchange → closing → done with ホレ and ラタ in every body over', () => {
    const dialogue = new WabunDialogue(scenario(), ME);
    expect(dialogue.cqText()).toBe('CQ <ホレ> DE JA7LBT JA7LBT PSE <ホレ> K');

    const call = dialogue.onTransmit(`JA7LBT DE ${ME} ${ME} K`, on);
    expect(call.phase).toBe('exchange');
    expect(call.reply?.plan.kind).toBe('exchange');
    expect(call.reply?.text.startsWith(`${ME} DE JA7LBT [ホレ]`)).toBe(true);

    const reply = dialogue.onTransmit(`JA7LBT DE ${ME} [ホレ] コンニチハ レポート 589 589 デス ヨロシク [ラタ] KN`, on);
    expect(reply).toMatchObject({ phase: 'closing', notes: [] });
    expect(dialogue.theirRst).toBe('589');
    expect(reply.reply?.text).toContain('589 アリガトウ');
    expect(reply.reply?.text).toMatch(/\[ラタ\] TU VA E E$/);

    const end = dialogue.onTransmit(`JA7LBT DE ${ME} TU E E`, on);
    expect(end.phase).toBe('done');
    expect(end.reply?.text).toBe('E E');
    expect(dialogue.overs.map((over) => over.plan.kind)).toEqual(['cq', 'exchange', 'closing', 'farewell']);
  });

  it('Level 1 (打ち逃げ) runs cq → exchange → done on one short phrase of ours', () => {
    const dialogue = new WabunDialogue(scenario('inside', 1), ME);
    const answer = dialogue.onTransmit(`JA7LBT DE ${ME} ${ME} K`, on);
    expect(answer.reply?.text).toBe(`${ME} DE JA7LBT [ホレ] コンニチハ [ラタ] UR 579 579 BK`);
    const phrase = dialogue.onTransmit(`JA7LBT DE ${ME} UR 599 [ホレ] アリガトウゴザイマシタ [ラタ] 73 TU E E`, on);
    expect(phrase).toMatchObject({ phase: 'done', notes: [] });
    expect(phrase.reply?.text).toBe('TU 73 E E');
    expect(phrase.understood).toMatchObject({ body: 'アリガトウゴザイマシタ', report: '599', thanks: true, closing: true });
    expect(dialogue.overs.map((over) => over.plan.kind)).toEqual(['cq', 'exchange', 'farewell']);
  });

  it('Level 1 waits for something of ours, and notes a sign-off with no kana', () => {
    const dialogue = new WabunDialogue(scenario('inside', 1, { farewell: 1 }), ME);
    dialogue.onTransmit(`JA7LBT DE ${ME} K`, on);
    expect(dialogue.onTransmit('JA7LBT', on)).toMatchObject({ phase: 'exchange', issue: 'missing-report' });
    const latin = dialogue.onTransmit(`JA7LBT DE ${ME} TU 73 E E`, on);
    expect(latin).toMatchObject({ phase: 'done', notes: ['roman-only'] });
    expect(latin.reply?.text).toBe('[ホレ] アリガトウ [ラタ] TU E E');
  });

  it('stays silent off frequency and asks for our call when missing', () => {
    const dialogue = new WabunDialogue(scenario(), ME);
    expect(dialogue.onTransmit(`JA7LBT DE ${ME} K`, { offsetHz: 400 })).toMatchObject({ heard: false, reply: null, issue: 'off-frequency', phase: 'cq' });
    const qrz = dialogue.onTransmit('JA7LBT K', on);
    expect(qrz).toMatchObject({ issue: 'missing-call', phase: 'cq' });
    expect(qrz.reply?.text).toBe('QRZ? DE JA7LBT K');
  });

  it('repeats, slows down and fills in what was asked', () => {
    const dialogue = new WabunDialogue(scenario(), ME);
    const exchange = dialogue.onTransmit(`JA7LBT DE ${ME} K`, on).reply!;
    expect(dialogue.onTransmit('AGN?', on).reply).toBe(exchange);
    expect(dialogue.onTransmit('QRS AGN', on)).toMatchObject({ slower: 3, phase: 'exchange' });
    const name = dialogue.onTransmit(`JA7LBT DE ${ME} [ホレ] オナマエ サラオネ [ラタ] KN`, on);
    expect(name.reply?.text).toBe(`${ME} DE JA7LBT [ホレ] ナマエハ ワタナベ? ワタナベ [ラタ] KN`);
    expect(dialogue.phase).toBe('exchange');
  });

  it('accepts a body without ホレ / ラタ, only noting it', () => {
    const dialogue = new WabunDialogue(scenario(), ME);
    dialogue.onTransmit(`JA7LBT DE ${ME} K`, on);
    const result = dialogue.onTransmit(`JA7LBT DE ${ME} 599 アリガトウ KN`, on);
    expect(result.phase).toBe('closing');
    expect(result.notes).toContain('no-hore');
  });

  it('takes the report our correction left, not the slip', () => {
    const dialogue = new WabunDialogue(scenario(), ME);
    dialogue.onTransmit(`JA7LBT DE ${ME} K`, on);
    const result = dialogue.onTransmit(`JA7LBT DE ${ME} [ホレ] レポート 559 {ラタ} 599 デス [ラタ] KN`, on);
    expect(dialogue.theirRst).toBe('599');
    expect(result.notes).toEqual([]);
    expect(result.reply?.text).toContain('599 アリガトウ');
  });
});
