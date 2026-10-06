import { describe, expect, it } from 'vitest';
import { seeded } from '../random';
import { adjustWabun, defaultWabunAxes, normalizeWabunAdapt, voteWabunAxes, wabunBand } from './adapt';
import { WabunDialogue } from './dialogue';
import { fistAt, FATIGUE_WORDS, makeFist } from './fist';
import { parseWabunIntent } from './intent';
import { WABUN_PRESETS, type WabunPresetId } from './presets';
import type { WabunEvidence } from './review';
import { makeWabunScenario, TOPIC_DETAILS, TOPIC_SUBJECTS, type WabunLevel } from './scenario';
import { keySegments } from './segments';
import { runWabunSim } from './sim';

const ME = 'JA1ZZZ';
const on = { offsetHz: 20 };

/** A Level 5 dialogue, up to its talk over. */
function toTalk(seed: number) {
  const scenario = makeWabunScenario(seeded(seed), { wpm: 13, hour: 10, level: 5 });
  const dialogue = new WabunDialogue(scenario, ME);
  dialogue.onTransmit(`${scenario.truth.call} DE ${ME} K`, on);
  dialogue.onTransmit(`${scenario.truth.call} DE ${ME} [ホレ] コンニチハ 」 レポート 599 599 ナマエハ イトウ ヨロシク [ラタ] KN`, on);
  return { scenario, dialogue };
}

describe('wabun Stage 5: Level 5 ragchew', () => {
  it('talk → chat → closing: one topic carried on with a detail, answered by what we said', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const { scenario, dialogue } = toTalk(seed);
      expect(dialogue.phase, `seed ${seed}`).toBe('talk');
      expect(scenario.talk?.detail).toBe(true);
      const detail = scenario.truth.topic.detail!;
      expect(TOPIC_DETAILS[scenario.truth.topic.kind]).toContain(detail);
      const praise = dialogue.onTransmit(`${scenario.truth.call} DE ${ME} [ホレ] タノシソウデスネ [ラタ] KN`, on);
      expect(praise.phase).toBe('chat');
      expect(praise.reply?.text).toContain('アリガトウ ウレシイデス');
      expect(praise.reply?.text).toContain(detail);
      const ack = dialogue.onTransmit(`${scenario.truth.call} DE ${ME} [ホレ] ナルホド [ラタ] KN`, on);
      expect(ack.phase).toBe('closing');
      expect(dialogue.responses.map((response) => [response.phase, response.ok])).toEqual([['talk', true], ['chat', true]]);
      expect(dialogue.responses[0]).toMatchObject({ topical: true, kinds: ['praise'] });
    }
  });

  it('no response: a hint, the station waits; a closing from us closes', () => {
    const { scenario, dialogue } = toTalk(2);
    const nothing = dialogue.onTransmit(`${scenario.truth.call} DE ${ME} KN`, on);
    expect(nothing.phase).toBe('talk');
    expect(nothing.hint).toMatch(/話題にひとこと/);
    const bye = dialogue.onTransmit(`${scenario.truth.call} DE ${ME} [ホレ] アリガトウ サヨウナラ [ラタ] TU 73 E E`, on);
    expect(['closing', 'done']).toContain(bye.phase);
  });

  it('asks about the topic: the topic or the detail again, short, nothing else', () => {
    for (const seed of [1, 2, 3]) {
      const { scenario, dialogue } = toTalk(seed);
      const subject = scenario.truth.topic.subject;
      const asked = dialogue.onTransmit(`[ホレ] ${subject} サラオネ [ラタ]`, on);
      expect(asked.reply?.facts.map((fact) => fact.fact)).toEqual(['topic']);
      expect(asked.phase).toBe('talk');
      const theme = dialogue.onTransmit('[ホレ] キンキヨウ サラオネ [ラタ]', on);
      expect(theme.reply?.facts.map((fact) => fact.fact)).toEqual(['topic']);
      const agn = dialogue.onTransmit(`[ホレ] ${subject} [ラタ] AGN?`, on);
      expect(agn.reply?.facts.map((fact) => fact.fact)).toEqual(['topic']);
      dialogue.onTransmit('[ホレ] ナルホド [ラタ] KN', on);
      expect(dialogue.phase).toBe('chat');
      const detail = dialogue.onTransmit(`[ホレ] ${scenario.truth.topic.detail} サラオネ [ラタ]`, on);
      expect(detail.reply?.facts.map((fact) => fact.fact)).toEqual(['detail']);
      // A plain AGN in the chat: the chat's content (the detail), not the whole QSO.
      const plain = dialogue.onTransmit('AGN?', on);
      expect(plain.reply?.facts.map((fact) => fact.fact)).toContain('detail');
      expect(plain.reply?.facts.map((fact) => fact.fact)).not.toContain('name');
      expect(dialogue.phase).toBe('chat');
    }
  });

  it('reads reactions by intent, not grammar', () => {
    const kinds = (text: string) => parseWabunIntent(text, ME).reacts;
    expect(kinds('[ホレ] ナルホド [ラタ] KN')).toContain('ack');
    expect(kinds('[ホレ] ソレハ タノシソウデスネ [ラタ] KN')).toContain('praise');
    expect(kinds('FB TNX KN')).toEqual(expect.arrayContaining(['praise', 'thanks']));
    expect(kinds('[ホレ] ドコマデ イキマシタカ [ラタ] KN')).toContain('question');
    expect(kinds('[ホレ] コチラモ ハレ デス [ラタ] KN')).toContain('own');
    expect(kinds('[ホレ] ナス サラオネ [ラタ]')).toEqual([]);
    // Every subject and detail word reads as a topic ask with サラオネ.
    for (const kind of Object.keys(TOPIC_SUBJECTS) as (keyof typeof TOPIC_SUBJECTS)[]) {
      for (const word of [...TOPIC_SUBJECTS[kind], ...TOPIC_DETAILS[kind]]) {
        const asks = parseWabunIntent(`[ホレ] ${word} サラオネ [ラタ]`, ME).asks;
        expect(asks.length, word).toBe(1);
      }
    }
  });
});

describe('wabun Stage 5: the fist', () => {
  it('Levels 1–4: no fist, keying identical to Stage 4', () => {
    for (const level of [1, 2, 3, 4] as WabunLevel[]) {
      const scenario = makeWabunScenario(seeded(7), { wpm: 13, hour: 10, level });
      expect(scenario.persona.fist ?? null).toBeNull();
    }
    const text = 'JA1ZZZ DE JA7LBT [ホレ] コンニチハ テンキハ ハレ [ラタ] KN';
    expect(keySegments(text, { wpm: 13 }, null)).toEqual(keySegments(text, { wpm: 13 }));
  });

  it('fixed per seed; Level 5 truth is the same with any fist', () => {
    const a = makeWabunScenario(seeded(11), { wpm: 13, hour: 10, level: 5 });
    const b = makeWabunScenario(seeded(11), { wpm: 13, hour: 10, level: 5 });
    expect(a.persona.fist).toEqual(b.persona.fist);
    const soft = makeWabunScenario(seeded(11), { wpm: 13, hour: 10, level: 5, fist: { strength: 0.4 } });
    expect(soft.truth).toEqual(a.truth);
    expect(soft.persona.fist?.strength).toBe(0.4);
  });

  it('tires only in a long over and only in its latter part, back on the next over', () => {
    const fist = makeFist(seeded(3), 'straight', { fatigue: true });
    const from = fist.fatigue!.from;
    expect(fistAt(fist, from - 0.05, true)).toEqual(fistAt(fist, from - 0.05, false));
    expect(fistAt(fist, 1, true).dash).toBeGreaterThan(fistAt(fist, 1, false).dash);
    expect(fistAt(fist, 1, true).char).toBeGreaterThan(fistAt(fist, 1, false).char);
    // A short over (under FATIGUE_WORDS, the switches counted) never tires; a keyer never does.
    const short = Array.from({ length: FATIGUE_WORDS - 3 }, () => 'ハレ').join(' ');
    const long = Array.from({ length: FATIGUE_WORDS + 6 }, () => 'ハレ').join(' ');
    const shortKeyed = keySegments(`[ホレ] ${short} [ラタ]`, { wpm: 13 }, { ...fist, drift: 1 });
    const shortUntired = keySegments(`[ホレ] ${short} [ラタ]`, { wpm: 13 }, { ...fist, drift: 1, fatigue: null });
    expect(shortKeyed).toEqual(shortUntired);
    const longKeyed = keySegments(`[ホレ] ${long} [ラタ]`, { wpm: 13 }, fist);
    const longUntired = keySegments(`[ホレ] ${long} [ラタ]`, { wpm: 13 }, { ...fist, fatigue: null });
    expect(longKeyed.length).toBeGreaterThan(longUntired.length);
    expect(makeFist(seeded(3), 'keyer', { fatigue: true }).fatigue).toBeNull();
  });

  it('the band, not the fist, decides what is received (the sim bot follows every fist)', () => {
    for (const kind of ['keyer', 'bug', 'straight'] as const) {
      const result = runWabunSim({ seed: 21, level: 5, fist: { kind, strength: 1, fatigue: true } });
      expect(result.phase, kind).toBe('done');
      expect(result.review.follow.ok, kind).toBe(true);
      expect(result.session.truth.shack.key).toBe({ keyer: 'エレキー', bug: 'バグ', straight: 'ストレート' }[kind]);
    }
  });
});

const evidence = (follow: Partial<WabunEvidence['follow.wabun']>, copy: WabunEvidence['copy.wabun'] = null): WabunEvidence => ({
  'copy.wabun': copy,
  'follow.wabun': { total: 6, correct: 6, first: 6, paths: { logged: 6, postcheck: 0, 'repeat-recovered': 0, missed: 0, 'not-reached': 0 }, ...follow } as WabunEvidence['follow.wabun'],
});
const procedure = { overs: 4, onFrequency: 4 };

describe('wabun Stage 5: おまかせ', () => {
  it('procedure never moves an axis; tuning moves tuning only', () => {
    const off = voteWabunAxes({ level: 5, evidence: evidence({}), procedure: { overs: 4, onFrequency: 1 }, fistKind: 'keyer' });
    expect(off.tuning).toBe(-1);
    expect(off.speed).toBeUndefined();
    expect(off.rf).toBeUndefined();
    expect(off.fist).toBeUndefined();
    // The same QSO on frequency: only tuning changes sign.
    const onFreq = voteWabunAxes({ level: 5, evidence: evidence({}), procedure, fistKind: 'keyer' });
    expect({ ...off, tuning: 1 }).toEqual(onFreq);
  });

  it('no memo: no speed vote; a repeat-recovered fact holds load', () => {
    expect(voteWabunAxes({ level: 4, evidence: evidence({}), procedure }).speed).toBeUndefined();
    const recovered = voteWabunAxes({ level: 4, evidence: evidence({ correct: 6, first: 4, paths: { logged: 4, postcheck: 0, 'repeat-recovered': 2, missed: 0, 'not-reached': 0 } }), procedure });
    expect(recovered.load).toBeUndefined();
    const missed = voteWabunAxes({ level: 4, evidence: evidence({ correct: 3, first: 3 }), procedure });
    expect(missed.load).toBe(-1);
    // Copy trouble is the ear, not the talk.
    const copy = { total: 40, correct: 20, wpm: 13, clean: { total: 40, correct: 20 } } as unknown as WabunEvidence['copy.wabun'];
    const slow = voteWabunAxes({ level: 4, evidence: evidence({ correct: 3, first: 3 }, copy), procedure });
    expect(slow).toMatchObject({ speed: -1 });
    expect(slow.load).toBeUndefined();
  });

  it('two votes the same way move one step; two axes at most, easing first; level change starts over', () => {
    const start = normalizeWabunAdapt(undefined, 13);
    const once = adjustWabun(start, { speed: 1, load: 1, rf: -1 }, 5);
    expect(once.moved).toEqual({});
    const twice = adjustWabun(once, { speed: 1, load: 1, rf: -1 }, 5);
    expect(Object.keys(twice.moved)).toHaveLength(2);
    expect(twice.moved.rf).toEqual([0.25, 0]);
    expect(adjustWabun(once, { speed: 1 }, 4).moved).toEqual({});
    // A flip in between resets the count.
    const flip = adjustWabun(adjustWabun(start, { speed: 1 }, 5), { speed: -1 }, 5);
    expect(adjustWabun(flip, { speed: 1 }, 5).moved).toEqual({});
  });

  it('rf 0.25 is Stage 4’s desk', () => {
    expect(defaultWabunAxes()).toMatchObject({ rf: 0.25, load: 1, tuning: 0 });
    expect(wabunBand(0.25)).toMatchObject({ strength: 0.6, crowd: 3 });
  });
});

describe('wabun Stage 5: QA presets', () => {
  it('every preset runs to the end in the sim, the same station every time', () => {
    for (const id of Object.keys(WABUN_PRESETS) as WabunPresetId[]) {
      const preset = WABUN_PRESETS[id];
      const axes = { ...defaultWabunAxes(preset.wpm), ...preset.axes };
      const band = wabunBand(axes.rf);
      const run = () => runWabunSim({
        seed: preset.seed, level: preset.level, wpm: preset.wpm, load: axes.load, fist: preset.fist,
        strength: band.strength, crowd: band.crowd, noise: band.rig.noise, qsb: band.rig.qsb, qrn: band.rig.qrn, qrm: axes.rf >= 0.75,
      });
      const a = run();
      const b = run();
      expect(a.phase, id).toBe('done');
      expect(a.session.truth).toEqual(b.session.truth);
      expect(a.session.scenario.persona.fist).toEqual(b.session.scenario.persona.fist);
      expect(a.underTx.heard).toBe(0);
      expect(a.afterQrt).toEqual({ stations: 0, scheduled: 0 });
    }
  });
});
