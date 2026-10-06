import { describe, expect, it } from 'vitest';
import { seeded } from '../random';
import { WabunDialogue } from './dialogue';
import { applyCorrection, parseWabunIntent } from './intent';
import { makeWabunScenario, scenarioFacts, type WabunLevel, type WabunScenario } from './scenario';
import { keySegments } from './segments';
import { runWabunSim } from './sim';
import { traceTransmission } from './trace';
import { checkChoices, factDisplay } from './review';
import { plans, renderOver } from './utterance';

const ME = 'JA1ZZZ';
const on = { offsetHz: 20 };
const seconds = (text: string) => keySegments(text, { wpm: 13 }).length;

const practical = (level: WabunLevel, theme: 'wx' | 'shack', asksName = false, wording = 0): WabunScenario => ({
  level,
  truth: {
    call: 'JA7LBT', rst: '579', name: 'ワタナベ', qth: 'センダイ', qthSuffix: 'シ', greeting: 'day',
    weather: { sky: 'クモリ', temp: 12, condx: 'マアマア' },
    shack: { rig: 'IC705', ant: 'ダイポール', pwr: 10, key: 'バグ' },
    topic: { kind: 'garden', subject: 'トマト', stage: 'ongoing' },
  },
  persona: { wpm: 14, closing73: 'inside', wording: { cq: 0, answer: 0, exchange: 0, regards: 0, closing: 0, farewell: 0, talk: wording, fill: 0 }, asksName },
  talk: { theme, facts: theme === 'wx' ? ['wx', 'temp'] : ['rig', 'pwr'], topic: level >= 4 },
});

/** Call, then our report and name: the station is in its talk over. */
function toTalk(scenario: WabunScenario) {
  const dialogue = new WabunDialogue(scenario, ME);
  dialogue.onTransmit(`JA7LBT DE ${ME} K`, on);
  const talk = dialogue.onTransmit(`JA7LBT DE ${ME} [ホレ] レポート 599 599 ナマエハ イトウ イトウ [ラタ] KN`, on);
  return { dialogue, talk };
}

const keyedKana = (text: string) => keySegments(text, { wpm: 20 });

describe('wabun practical QSO (Level 3 / 4): the plan', () => {
  it('tells one theme at Level 3, the theme and one piece of news at Level 4, and thanks us by name', () => {
    const { dialogue, talk } = toTalk(practical(3, 'wx'));
    expect(talk.phase).toBe('talk');
    expect(talk.reply?.text).toBe(`${ME} DE JA7LBT [ホレ] イトウサン アリガトウ 」 テンキハ クモリ キオンハ 12ド [ラタ] KN`);
    expect(talk.reply?.facts.map((fact) => fact.fact)).toEqual(['wx', 'temp']);
    expect(dialogue.theirName).toBe('イトウ');

    const four = toTalk(practical(4, 'shack')).talk.reply!;
    expect(four.text).toBe(`${ME} DE JA7LBT [ホレ] イトウサン アリガトウ 」 リグハ （ IC705 ） デス パワーハ 10 ワツト 」 ニワデ トマトヲ ソダテテイマス [ラタ] KN`);
    expect(four.facts.map((fact) => fact.fact)).toEqual(['rig', 'pwr', 'topic']);
    // Model names in parentheses go out in Latin; the rest is kana.
    const keyed = keyedKana(four.text);
    expect(keyed.chars.filter((span) => span.script === 'roman').map((span) => span.char).join('')).toBe(`${ME}DEJA7LBTIC705KN`);
    expect(keyed.switches.map((event) => event.sign)).toEqual(['ホレ', '（', '）', 'ラタ']);
  });

  it('places every fact on a keyed word of its over (all wordings, many scenarios)', () => {
    const random = seeded(31);
    for (let index = 0; index < 120; index += 1) {
      const level = (3 + (index % 2)) as WabunLevel;
      const scenario = makeWabunScenario(random, { wpm: 13, hour: 12, level });
      expect(scenario.talk?.facts).toHaveLength(2);
      expect(scenario.talk?.topic).toBe(level === 4);
      expect(scenarioFacts(scenario)).toHaveLength(level === 4 ? 7 : 6);
      for (const talk of [0, 1]) {
        const over = renderOver(plans.talk({ ...scenario, persona: { ...scenario.persona, wording: { ...scenario.persona.wording, talk } } }, ME, 'イトウ'));
        const keyed = keySegments(over.text, { wpm: 13 });
        const words = over.text.split(' ');
        for (const fact of over.facts) {
          expect(words[fact.word], over.text).toContain(fact.value);
          // The word index is the keyed word index (nothing unkeyable in between).
          expect(keyed.chars.some((span) => span.word === fact.word), over.text).toBe(true);
        }
        expect(keyed.switches.at(0)?.to).toBe('wabun');
        expect(keyed.switches.at(-1)?.to).toBe('roman');
        // No letters dropped by the keyer (Latin only inside parentheses).
        expect(keyed.chars.map((span) => span.char).join('').replace(/\[ホレ\]|\[ラタ\]/g, '').length).toBeGreaterThan(0);
        expect(seconds(over.text), over.text).toBeLessThan(level === 4 ? 115 : 90);
      }
    }
  });
});

describe('wabun practical QSO: asking again', () => {
  it('parses the asks: Latin, kana サラオネ, and a plain AGN / サラオネ', () => {
    expect(parseWabunIntent('JA7LBT DE JA1ZZZ PSE NAME?', ME)).toMatchObject({ asks: ['name'], repeat: false });
    expect(parseWabunIntent('RST AGN?', ME).asks).toEqual(['rst']);
    expect(parseWabunIntent('WX AGN?', ME).asks).toEqual(['wx']);
    expect(parseWabunIntent('RIG AGN? PWR?', ME).asks).toEqual(['rig', 'pwr']);
    expect(parseWabunIntent('[ホレ] テンキ サラオネ [ラタ]', ME).asks).toEqual(['wx']);
    expect(parseWabunIntent('[ホレ] リグハ? [ラタ] KN', ME).asks).toEqual(['rig']);
    expect(parseWabunIntent('[ホレ] サラオネ [ラタ]', ME)).toMatchObject({ asks: [], repeat: true, ack: false });
    expect(parseWabunIntent('[ホレ] ヨロシク オネガイシマス [ラタ]', ME).ack).toBe(true);
    expect(parseWabunIntent('AGN?', ME)).toMatchObject({ asks: [], repeat: true });
    // A name in the reply is a name, not an ask.
    expect(parseWabunIntent('[ホレ] ナマエハ イトウ [ラタ]', ME)).toMatchObject({ asks: [], name: 'イトウ' });
  });

  it('sends back only the fact asked for, worded the other way the next time', () => {
    const { dialogue } = toTalk(practical(3, 'wx'));
    const first = dialogue.onTransmit('WX AGN?', on);
    expect(first.reply?.text).toBe(`${ME} DE JA7LBT [ホレ] テンキハ クモリ [ラタ] KN`);
    expect(first.repeat).toMatchObject({ asked: ['wx'], resent: ['wx'] });
    const again = dialogue.onTransmit('[ホレ] テンキ サラオネ [ラタ]', on);
    expect(again.reply?.text).toBe(`${ME} DE JA7LBT [ホレ] コチラハ クモリ デス [ラタ] KN`);
    expect(again.reply?.facts.map((fact) => fact.fact)).toEqual(['wx']);
    const name = dialogue.onTransmit('PSE NAME?', on);
    expect(name.reply?.facts.map((fact) => fact.fact)).toEqual(['name', 'name']);
    expect(name.reply?.text).not.toContain('センダイ');
    const rst = dialogue.onTransmit('RST AGN?', on);
    expect(rst.reply?.facts.every((fact) => fact.fact === 'rst')).toBe(true);
    // Asking for things never leaves the talk; nothing it did not tell is invented.
    expect(dialogue.phase).toBe('talk');
    expect(dialogue.repeats.map((repeat) => repeat.resent)).toEqual([['wx'], ['wx'], ['name'], ['rst']]);
    for (const over of dialogue.overs.filter((item) => item.plan.kind === 'fill')) expect(seconds(over.text)).toBeLessThan(40);
  });

  it('answers a plain AGN / サラオネ with the part that carried something, a CQ or a closing whole', () => {
    const { dialogue } = toTalk(practical(4, 'wx'));
    const agn = dialogue.onTransmit('AGN?', on);
    expect(agn.reply?.plan.kind).toBe('fill');
    expect(agn.reply?.facts.map((fact) => fact.fact)).toEqual(['wx', 'temp', 'topic']);
    expect(agn.reply?.text).not.toContain('アリガトウ');
    expect(agn.repeat).toMatchObject({ asked: null, resent: ['wx', 'temp', 'topic'] });
    // Again after the fill: the same content, not the fill of a fill of nothing.
    expect(dialogue.onTransmit('[ホレ] サラオネ [ラタ]', on).reply?.facts.map((fact) => fact.fact)).toEqual(['wx', 'temp', 'topic']);
    // Asked for something it never told (no rig talk today): the content again, nothing made up.
    const rig = dialogue.onTransmit('RIG AGN?', on);
    expect(rig.reply?.facts.map((fact) => fact.fact)).not.toContain('rig');
    // The closing is repeated whole.
    dialogue.onTransmit('[ホレ] ナルホド イイデスネ [ラタ] KN', on);
    const closing = dialogue.overs.at(-1)!;
    expect(dialogue.onTransmit('AGN?', on).reply).toBe(closing);
  });

  it('asks us kindly for a report it did not get (at most twice), and some stations for our name once', () => {
    const dialogue = new WabunDialogue(practical(3, 'wx', true), ME);
    dialogue.onTransmit(`JA7LBT DE ${ME} K`, on);
    const noReport = dialogue.onTransmit(`JA7LBT DE ${ME} [ホレ] アリガトウ ヨロシク [ラタ] KN`, on);
    expect(noReport).toMatchObject({ phase: 'exchange', request: ['rst'] });
    expect(noReport.reply?.plan.kind).toBe('ask');
    expect(noReport.reply?.text).toBe(`${ME} DE JA7LBT [ホレ] レポート サラオネ [ラタ] KN`);
    const report = dialogue.onTransmit(`JA7LBT DE ${ME} [ホレ] 599 599 デス [ラタ] KN`, on);
    expect(report).toMatchObject({ phase: 'exchange', request: ['name'] });
    expect(report.reply?.text).toMatch(/PSE NAME\? KN$|オナマエ サラオネ/);
    const name = dialogue.onTransmit(`JA7LBT DE ${ME} [ホレ] ナマエハ イトウ イトウ [ラタ] KN`, on);
    expect(name.phase).toBe('talk');
    expect(name.reply?.text).toContain('イトウサン アリガトウ');
    expect(dialogue.requests.map((request) => request.facts)).toEqual([['rst'], ['name']]);

    // Never mean: with no report twice it goes on without one; a station that does not ask for names never does.
    const patient = new WabunDialogue(practical(3, 'shack'), ME);
    patient.onTransmit(`JA7LBT DE ${ME} K`, on);
    expect(patient.onTransmit('[ホレ] アリガトウ [ラタ] KN', on).request).toEqual(['rst']);
    expect(patient.onTransmit('[ホレ] ヨロシク [ラタ] KN', on).request).toEqual(['rst']);
    const on3 = patient.onTransmit('[ホレ] ヨロシク [ラタ] KN', on);
    expect(on3).toMatchObject({ phase: 'talk', request: [] });
    expect(on3.reply?.text).toContain('[ホレ] アリガトウ 」');
  });
});

describe('wabun practical QSO: corrections in a longer body', () => {
  it('reads a ラタ correction in a long talk answer, keyed as sent, understood corrected', () => {
    const { dialogue } = toTalk(practical(4, 'wx'));
    const input = `JA7LBT DE ${ME} ホレ ナルホド コチラハ アメ デス キオンハ 15ド ラタ 18ド デス トマト イイデスネ ラタ KN`;
    const notation = `JA7LBT DE ${ME} [ホレ] ナルホド コチラハ アメ デス キオンハ 15ド {ラタ} 18ド デス トマト イイデスネ [ラタ] KN`;
    const result = dialogue.onTransmit(notation, on);
    const trace = traceTransmission(input, notation, result);
    expect(trace.keyedWabun).toContain('15ド ラタ 18ド');
    expect(trace.corrections).toEqual([expect.objectContaining({ erased: '15ド' })]);
    expect(trace.understood?.body).toContain('キオンハ 18ド デス');
    expect(trace.understood?.body).not.toContain('15');
    expect(result.phase).toBe('closing');
  });

  it('takes back a word from far back only when the retyped text clearly lines up, else the last word', () => {
    // Retyped from a word well before the end (more than the near reach): lined up on ナマエハ.
    expect(applyCorrection('ナマエハ イトオ デス コチラハ ヨコハマシ', 'ナマエハ イトウ')).toMatchObject({ after: 'ナマエハ イトウ' });
    // The near rule still works in a long body.
    expect(applyCorrection('コチラハ アメ デス キオンハ 15ド', '18ド')).toMatchObject({ erased: '15ド', after: 'コチラハ アメ デス キオンハ 18ド' });
    // A short fragment never lines up far back: the last word goes.
    expect(applyCorrection('ハレ デス キオンハ 20ド デス コンデイシヨン ヨイ', 'マア')).toMatchObject({ erased: 'ヨイ' });
  });
});

describe('wabun practical QSO on the band (headless)', () => {
  it('runs Lv3 / Lv4 QSOs to the end over many stations: theme (and news) followed', () => {
    for (const level of [3, 4] as const) {
      const themes = new Set<string>();
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
        const result = runWabunSim({ seed, level });
        expect(result.phase, `Lv${level} seed ${seed}`).toBe('done');
        expect(result.replies.map((reply) => reply.phase)).toEqual(['exchange', 'talk', 'closing', 'done']);
        themes.add(result.session.scenario.talk!.theme);
        expect(result.told).toHaveLength(level === 4 ? 7 : 6);
        expect(result.fields.every((field) => field.correct)).toBe(true);
        // The theme and the news are not log fields: checked afterwards from what was heard.
        expect(Object.keys(result.checks).sort()).toEqual(result.told.filter((fact) => !['call', 'rst', 'name', 'qth'].includes(fact)).sort());
        expect(result.review.follow).toMatchObject({ required: result.told.length, followed: result.told.length, ok: true });
        expect(result.review.verdict).toBe('followed');
        expect(result.review.follow.facts.every((fact) => fact.via === 'first')).toBe(true);
        // Short enough: call to E E in under seven minutes at 13 WPM.
        const last = result.records.at(-1)!;
        expect(last.tx.start + last.tx.length - result.tx[0].start).toBeLessThan(420);
      }
      expect([...themes].sort()).toEqual(['shack', 'wx']);
    }
  });

  it('a fact lost under our own TX is not counted; asked again, it counts as followed via the repeat', () => {
    const result = runWabunSim({ seed: 1, level: 4, interrupt: { phase: 'talk', beforeFact: 'wx', text: ({ npc, me }) => `${npc} DE ${me} WX AGN?` } });
    expect(result.phase).toBe('done');
    const state = Object.fromEntries(result.review.follow.facts.map((fact) => [fact.fact, [fact.state, fact.via]]));
    expect(state.wx).toEqual(['postcheck', 'repeat']);
    // Keyed while we sent: muted, neither missed nor followed.
    expect(state.temp).toEqual(['not-reached', null]);
    expect(state.topic).toEqual(['not-reached', null]);
    expect(result.review.follow).toMatchObject({ required: 5, followed: 5, ok: true });
    expect(result.review.copy.muted).toBeGreaterThan(0);
    expect(result.repeats).toEqual([{ asked: ['wx'], resent: ['wx'], gained: ['wx'] }]);
    // The fill carried only the weather.
    const fill = result.session.dialogue.overs.find((over) => over.plan.kind === 'fill')!;
    expect(fill.facts.map((fact) => fact.fact)).toEqual(['wx']);
  });

  it('a plain AGN gets the content again, and the news it missed counts via the repeat', () => {
    const result = runWabunSim({ seed: 2, level: 4, interrupt: { phase: 'talk', beforeFact: 'topic', text: ({ npc, me }) => `${npc} DE ${me} AGN?` } });
    expect(result.phase).toBe('done');
    const topic = result.review.follow.facts.find((fact) => fact.fact === 'topic')!;
    expect(topic).toMatchObject({ state: 'postcheck', via: 'repeat', path: 'repeat-recovered', first: 'muted', again: 'reached', asked: 'general' });
    // The content came back whole: what reached us the first time is recovered too (we can't tell which part the AGN was for).
    expect(result.repeats[0]).toMatchObject({ asked: null, gained: ['wx', 'condx', 'topic'] });
    expect(result.review.follow.facts.find((fact) => fact.fact === 'call')).toMatchObject({ path: 'logged', asked: null });
    expect(result.review.follow.ok).toBe(true);
  });

  it('a shack fact asked for (RIG AGN?) comes back alone, its model in Latin', () => {
    const result = runWabunSim({ seed: 3, level: 3, interrupt: { phase: 'talk', beforeFact: 'rig', text: ({ npc, me }) => `${npc} DE ${me} RIG AGN?` } });
    expect(result.phase).toBe('done');
    const fill = result.session.dialogue.overs.find((over) => over.plan.kind === 'fill')!;
    expect(fill.facts.map((fact) => fact.fact)).toEqual(['rig']);
    expect(fill.text).toMatch(/（ [A-Z0-9]+ ）/);
    expect(result.review.follow.facts.find((fact) => fact.fact === 'rig')).toMatchObject({ state: 'postcheck', via: 'repeat' });
  });

  it('the station asks for a report it did not get, and the QSO goes on', () => {
    const result = runWabunSim({
      seed: 5, level: 3,
      overs: { exchange: ({ npc, me, myName, turn }) => (turn === 0 ? `${npc} DE ${me} [ホレ] コンニチハ ヨロシク [ラタ] KN` : `${npc} DE ${me} [ホレ] 599 599 デス ナマエハ ${myName} [ラタ] KN`) },
    });
    expect(result.phase).toBe('done');
    expect(result.session.dialogue.requests.map((request) => request.facts)).toEqual([['rst']]);
    expect(result.replies.map((reply) => reply.phase)).toEqual(['exchange', 'exchange', 'talk', 'closing', 'done']);
    expect(result.session.dialogue.theirRst).toBe('599');
  });

  it('a slip corrected with ラタ in our talk answer', () => {
    const result = runWabunSim({ seed: 6, level: 4, overs: { talk: ({ npc, me }) => `${npc} DE ${me} [ホレ] ナルホド コチラハ ハレ デス キオンハ 15ド {ラタ} 18ド デス [ラタ] KN` } });
    expect(result.phase).toBe('done');
    const trace = result.traces.find((item) => item.corrections.length)!;
    expect(trace.keyedWabun).toContain('15ド ラタ 18ド');
    expect(trace.switches).toBe(2);
    expect(trace.understood?.body).toContain('キオンハ 18ド');
  });

  it('leaves nobody on the band after QRT (Lv3 / Lv4)', () => {
    for (const level of [3, 4] as const) {
      const result = runWabunSim({ seed: 9, crowd: 5, level });
      expect(result.phase).toBe('done');
      expect(result.afterQrt).toEqual({ stations: 0, scheduled: 0 });
    }
  });

  it('keys every letter of our stock answers (no Latin left inside a kana body)', () => {
    const result = runWabunSim({ seed: 1, level: 4 });
    for (const trace of result.traces) expect(trace.keyed).toBe(trace.notation.replace(/\[(ホレ|ラタ)\]/g, '$1'));
  });

  it('offers three different choices for every check, numbers included', () => {
    const random = seeded(8);
    for (let index = 0; index < 40; index += 1) {
      const scenario = makeWabunScenario(random, { wpm: 13, hour: 12, level: 4 });
      for (const fact of ['name', 'qth', 'wx', 'temp', 'condx', 'rig', 'ant', 'pwr', 'key', 'topic'] as const) {
        const choices = checkChoices(scenario.truth, fact, random);
        expect(new Set(choices).size, `${fact} ${choices}`).toBe(3);
        expect(choices).toContain(factDisplay(scenario.truth, fact));
      }
    }
  });

  it('keeps Level 1 / 2 scenarios exactly as Stage 2 drew them', () => {
    const random = seeded(5);
    const two = makeWabunScenario(random, { wpm: 13, hour: 12, level: 2 });
    expect(two.talk).toBeNull();
    expect(scenarioFacts(two)).toEqual(['call', 'rst', 'name', 'qth']);
    // Same draws, Lv3 adds talk on top without moving the Stage 2 truth.
    const three = makeWabunScenario(seeded(5), { wpm: 13, hour: 12, level: 3 });
    expect({ ...three.truth, weather: null, shack: null, topic: null }).toEqual({ ...two.truth, weather: null, shack: null, topic: null });
  });
});
