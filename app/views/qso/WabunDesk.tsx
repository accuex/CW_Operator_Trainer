'use client';

import { useEffect, useRef, useState } from 'react';
import { markCut } from '@/lib/radio/conditions';
import { traceRx } from '@/lib/radio/trace';
import { factTimeline, heardOvers, logFieldsFor, reachOf, scoreWabunLog, type HeardOver, type Reception, type WabunFieldResult, type WabunLog } from '@/lib/radio/wabun/copy';
import type { WabunNote, WabunPhase } from '@/lib/radio/wabun/dialogue';
import { operatorCall } from '@/lib/radio/wabun/intent';
import { reviewProcedure, stationKeying, type WabunProcedure, type WabunProcedureKind } from '@/lib/radio/wabun/procedure';
import { checkChoices, factsToCheck, measureCopy, measureFollow, reviewRepeats, reviewWabun, type FollowPath, type WabunFollowFact, type WabunRepeatReview, type WabunReview, type WabunVerdict } from '@/lib/radio/wabun/review';
import { scenarioFacts, WABUN_LEVELS, type TopicKind, type TopicTruth, type WabunFact, type WabunLevel } from '@/lib/radio/wabun/scenario';
import type { OverPlan } from '@/lib/radio/wabun/utterance';
import { displayNotation, parseSegments, wabunKeyer, type Segment } from '@/lib/radio/wabun/segments';
import { WabunSession } from '@/lib/radio/wabun/session';
import { traceTransmission, WABUN_RECORD_VERSION, type WabunQsoRecord, type WabunTxTrace } from '@/lib/radio/wabun/trace';
import { defaultWabunAxes, describeWabunMove, normalizeWabunAdapt, wabunBand, wabunDrift, type WabunAxes, type WabunAxis } from '@/lib/radio/wabun/adapt';
import { describeFist, type WabunFist } from '@/lib/radio/wabun/fist';
import { devWabunPreset } from '@/lib/radio/wabun/presets';
import type { ReactKind } from '@/lib/radio/wabun/intent';
import type { WabunResponse } from '@/lib/radio/wabun/dialogue';
import { seeded } from '@/lib/radio/random';
import { nowId } from '@/lib/ids';
import { romajiToWabun } from '@/lib/wabunInput';
import type { Capture, Rig } from './useRig';
import { compareDecode, decodeAssist, decodeNote } from '@/lib/radio/decode/assist';
import type { QsoAssist } from '@/lib/types';

/**
 * The wabun QSO desk (Level 1 打ち逃げ, Level 2 和文ラバースタンプ, Level 3 天気・設備,
 * Level 4 近況ひとこと). We find a
 * station sending CQ ホレ, call it in Latin, and it answers. The TX field takes romaji and
 * turns only the part between ホレ and ラタ into kana, so what goes out is a list of
 * segments (Latin / switch / wabun), keyed as such. ラタ(訂正) is the correction ラタ: same
 * sign on the air, the body goes on.
 *
 * Nothing of the station's truth is shown before the log is in; the review compares.
 */

const PREFS_KEY = 'cwt-wabun-desk';
const WPM_CHOICES = [10, 11, 12, 13, 14, 15, 16, 18, 20] as const;
const DEFAULT_WPM = 13;
const DEFAULT_KANA = 'ヤマダ';
const DEFAULT_LEVEL: WabunLevel = 1;

/** A quiet band with a little of everything (QSB / QRN mild): the copy, not the band, is the subject here. */
export const WABUN_RIG_LEVELS = { noise: 0.25, qrn: 0.15, qsb: 0.2 } as const;
const WABUN_CROWD = 3;

const LEVEL_LABEL: Record<WabunLevel, string> = { 1: 'Lv1 打ち逃げ', 2: 'Lv2 ラバースタンプ', 3: 'Lv3 天気・設備', 4: 'Lv4 近況ひとこと', 5: 'Lv5 実用ラグチュー' };
const LEVEL_NOTE: Record<WabunLevel, string> = {
  1: '欧文で呼び、短い和文をひとこと送って欧文で終わります。ログはコールと RST だけ',
  2: '挨拶・RST・QTH・名前の短い和文を聴き取り、和文で返して締めます',
  3: 'Lv2 の交換のあと、天気か設備の話をひとつ聴き取ります。聞き取れない項目は WX AGN? などで聞き返せます',
  4: 'Lv3 に加えて、相手の近況（散歩・買い物・庭など）をひとこと聴き取ります',
  5: 'Lv4 の近況に反応を返すと、相手がもうひとこと（場所・色・時期など）続けます。話題を追い、聞き取れなければ聞き返して会話を続けます。相手局ごとに打ち方のクセがあります',
};

const STEPS: Record<WabunLevel, { phase: WabunPhase; label: string }[]> = {
  1: [
    { phase: 'cq', label: 'CQ ホレ を探して欧文で呼ぶ' },
    { phase: 'exchange', label: 'コールと RST を聴き、ホレ ＋ ひとこと ＋ ラタ を送って 73 TU E E' },
    { phase: 'done', label: '相手の E E を聴いてログ確定' },
  ],
  2: [
    { phase: 'cq', label: 'CQ ホレ を探して欧文で呼ぶ' },
    { phase: 'exchange', label: 'ホレ〜ラタの和文を聴き取り、和文で返信する' },
    { phase: 'closing', label: '締めを聴いて TU E E' },
    { phase: 'done', label: 'E E を聴いてログ確定' },
  ],
  3: [
    { phase: 'cq', label: 'CQ ホレ を探して欧文で呼ぶ' },
    { phase: 'exchange', label: 'ホレ〜ラタの和文を聴き取り、レポートと名前を和文で返す' },
    { phase: 'talk', label: '天気か設備の話を聴き、あいづちを返す（聞き返しも可）' },
    { phase: 'closing', label: '締めを聴いて TU E E' },
    { phase: 'done', label: 'E E を聴いてログ確定' },
  ],
  4: [
    { phase: 'cq', label: 'CQ ホレ を探して欧文で呼ぶ' },
    { phase: 'exchange', label: 'ホレ〜ラタの和文を聴き取り、レポートと名前を和文で返す' },
    { phase: 'talk', label: '天気か設備の話と近況ひとことを聴き、あいづちを返す（聞き返しも可）' },
    { phase: 'closing', label: '締めを聴いて TU E E' },
    { phase: 'done', label: 'E E を聴いてログ確定' },
  ],
  5: [
    { phase: 'cq', label: 'CQ ホレ を探して欧文で呼ぶ' },
    { phase: 'exchange', label: 'ホレ〜ラタの和文を聴き取り、レポートと名前を和文で返す' },
    { phase: 'talk', label: '天気か設備の話と近況を聴き、話題に反応を返す（聞き返しも可）' },
    { phase: 'chat', label: '同じ話題のもうひとことを聴き、もう一度反応を返す' },
    { phase: 'closing', label: '締めを聴いて TU E E' },
    { phase: 'done', label: 'E E を聴いてログ確定' },
  ],
};

const NOTE_TEXT: Record<WabunNote, string> = {
  'no-hore': 'カナの前に ホレ がありませんでした（今回は相手が察してくれました）',
  'no-rata': 'ラタ で欧文に戻さないまま終わりました',
  'roman-only': '返信が欧文だけでした。和文 QSO では ホレ … ラタ で返すのが普通です',
};

const POWER_HINT = '電源を入れて、ウォーターフォールで CQ ホレ を出している局を探しましょう';
const TUNE_HINT = 'ウォーターフォールの局をクリックすると同調します。CQ ホレ を出している局を探しましょう';

const FACT_LABEL: Record<WabunFact, string> = {
  call: 'コール', rst: 'RST', name: '名前', qth: 'QTH', wx: '天気', temp: '気温', condx: 'コンディション',
  rig: 'リグ', ant: 'アンテナ', pwr: 'パワー', key: 'キー', topic: '近況', detail: '近況の続き',
};
/** What the news was about, asked after the QSO (the kind is no secret by then). */
const TOPIC_LABEL: Record<TopicKind, string> = {
  walk: '散歩の行き先', shopping: '買った物', garden: '育てている物', trip: '旅行の行き先', family: '話に出た家族', season: '季節の花', hobby: '趣味',
};
/** Level 5: what the detail was, by topic kind. */
const DETAIL_LABEL: Record<TopicKind, string> = {
  walk: '散歩の途中で見たもの', shopping: '買った物の色', garden: '収穫の時期', trip: '旅行の交通手段', family: '食事のメニュー', season: '見に行く場所', hobby: '趣味をする時',
};
const factLabel = (fact: WabunFact, topic: TopicKind | null) => (fact === 'topic' && topic ? TOPIC_LABEL[topic] : fact === 'detail' && topic ? DETAIL_LABEL[topic] : FACT_LABEL[fact]);
const REACT_TEXT: Record<ReactKind, string> = { ack: 'あいづち', praise: '共感・ほめる', thanks: 'お礼', question: '質問', own: '自分の話' };
/** The station's overs that answer us rather than tell something new. */
const OVER_KIND: Partial<Record<OverPlan['kind'], string>> = { fill: '再送', ask: '相手の聞き返し' };
const PATH_TEXT: Record<FollowPath, string> = {
  logged: 'ログで取れた', postcheck: '確認で選べた', 'repeat-recovered': '聞き返しで回収', missed: '取れず', 'not-reached': '届かず',
};
const FOLLOW_GROUPS: { path: FollowPath; label: string }[] = [
  { path: 'logged', label: 'ログに記録' },
  { path: 'postcheck', label: '交信後の確認で選べた' },
  { path: 'repeat-recovered', label: '聞き返して回収できた（成功・最初の受信とは別に記録）' },
  { path: 'missed', label: '取れなかった（届いたが追えず）' },
  { path: 'not-reached', label: '届かなかった（こちらの送信中など。数えません）' },
];
const RECEPTION_TEXT: Record<Reception, string> = { reached: '届いた', muted: '送信中で聞けず', unheard: '途中で切れた' };
const STAGE_TEXT: Record<TopicTruth['stage'], string> = { preview: 'これからの予定', result: '済んだこと', ongoing: '続いていること' };
const PROCEDURE_TEXT: Record<WabunProcedureKind, string> = {
  'no-hore': 'カナの前に ホレ がない',
  'no-rata': 'ラタ で欧文に戻していない',
  'roman-only': '和文の場面で欧文だけ',
  'no-over-end': '送信の最後に KN / BK がない',
  'npc-asked': '相手に聞き返された',
  missing: '相手が待っていた内容（レポート・TU E E）がなかった',
  'missing-call': '呼ぶときに自分のコールがない',
  'break-in': '相手の送信中に送り始めた（相手の続きは聞けていません）',
};
const VERDICT_TEXT: Record<WabunVerdict, string> = {
  copied: '内容も文字も取れました',
  followed: 'QSO として必要な内容は追えました（一字一句でなくて大丈夫）',
  missed: '追えなかった項目があります',
  incomplete: '交信の途中でログ確定しました',
};

interface DeskPrefs { wpm: number; kana: string; level: WabunLevel }
const readPrefs = (): DeskPrefs => {
  const base: DeskPrefs = { wpm: DEFAULT_WPM, kana: DEFAULT_KANA, level: DEFAULT_LEVEL };
  try {
    const stored = { ...base, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
    return { ...stored, level: WABUN_LEVELS.includes(stored.level) ? stored.level : DEFAULT_LEVEL };
  } catch {
    return base;
  }
};
const writePrefs = (prefs: DeskPrefs) => {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
};

interface Live { id: string; startedAt: number; session: WabunSession; capture: Capture; closed: boolean; axes: WabunAxes; auto: boolean }

/** Facts not in the log (kana left blank, the theme, the news) that reached us, asked as three-way choices after the QSO. */
interface Check { facts: WabunFact[]; choices: Partial<Record<WabunFact, string[]>>; answers: Partial<Record<WabunFact, string>>; topic: TopicKind | null }

interface Result {
  call: string;
  fields: WabunFieldResult[];
  review: WabunReview;
  /** Each over of the station: as sent and as it reached us, and what it was (再送 / 聞き返し). */
  overs: (HeardOver & { kind: string | null })[];
  topic: TopicKind | null;
  /** Our asks for a repeat and what they brought back. */
  repeats: WabunRepeatReview[];
  /** What the station asked us for. */
  requests: WabunFact[][];
  procedure: WabunProcedure;
  /** The news as told (Level 4), and whether it came in the closing over. */
  news: (TopicTruth & { inClosing: boolean }) | null;
  /** What the station finally took from us. */
  understood: { rst: string | null; name: string | null };
  /** Level 3 on: our responses to its talk (Level 5: and the chat). */
  responses: WabunResponse[];
  /** Level 5: the detail as told, and whether the news itself came in the chat over. */
  detail: { value: string; newsInChat: boolean } | null;
  fist: WabunFist | null;
  /** What おまかせ moved after this QSO (null: おまかせ off). */
  adjusted: Partial<Record<WabunAxis, [number, number]>> | null;
  assist?: QsoAssist;
}

const MODE_ID = 'wabun-ragchew';
/** A QSO's record id and start time. */
const stamp = () => ({ id: `wabun-${nowId()}`, startedAt: Date.now() });

const isHore = (word: string) => /^(\[ホレ\]|ホレ|HORE)$/i.test(word);
const isRata = (word: string) => /^(\[ラタ\]|ラタ|RATA)$/i.test(word);
/** The correction ラタ, as the field shows it (typed as ラタ! / rata! too). */
export const CORRECTION_WORD = 'ラタ(訂正)';
const isCorrection = (word: string) => /^(\{ラタ\}|ラタ\(訂正\)|ラタ!|RATA!)$/i.test(word);

/**
 * What the field shows, as typed: Latin upper case, the body (after ホレ, until ラタ)
 * romaji → kana as it is typed (an unfinished syllable stays as romaji). A correction
 * ラタ keeps the body going.
 */
export function liveTx(raw: string) {
  let wabun = false;
  return raw.split(/( +)/).map((part) => {
    if (!part.trim()) return part;
    if (isHore(part)) { wabun = true; return 'ホレ'; }
    if (isCorrection(part)) return CORRECTION_WORD;
    if (isRata(part)) { wabun = false; return 'ラタ'; }
    return wabun ? romajiToWabun(part.toLowerCase()) : part.toUpperCase();
  }).join('');
}

/** The field → segment notation for the keyer (a last trailing n of a body word is ン). Nothing is corrected for us. */
export function txNotation(display: string) {
  let wabun = false;
  return display.trim().split(/\s+/).filter(Boolean).map((word) => {
    if (isHore(word)) { wabun = true; return '[ホレ]'; }
    if (isCorrection(word)) return '{ラタ}';
    if (isRata(word)) { wabun = false; return '[ラタ]'; }
    return wabun ? romajiToWabun(word.toLowerCase()).replace(/n$/i, 'ン') : word.toUpperCase();
  }).join(' ');
}

type Moves = Partial<Record<WabunAxis, [number, number]>>;
interface DeskProps {
  rig: Rig;
  myCall: string;
  /** おまかせ on: the station runs at `adapt`'s axes (adapt.ts), moved after each QSO. */
  auto?: boolean;
  adapt?: { axes?: Record<string, number>; votes?: Record<string, number>; level?: number };
  onAuto?: (auto: boolean) => void;
  /** Saves the QSO; returns what おまかせ moved. */
  onSave?: (record: WabunQsoRecord) => Moves | void;
}

export function WabunDesk({ rig, myCall, auto = false, adapt, onAuto, onSave }: DeskProps) {
  const { engineRef, txOn, powered } = rig;
  const [prefs, setPrefsState] = useState<DeskPrefs>(readPrefs);
  const [phase, setPhase] = useState<WabunPhase>('cq');
  const [hint, setHint] = useState(TUNE_HINT);
  const [notes, setNotes] = useState<WabunNote[]>([]);
  const [txText, setTxText] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const [traces, setTraces] = useState<WabunTxTrace[]>([]);
  const [log, setLog] = useState<WabunLog>({ call: '', rst: '', name: '', qth: '' });
  const [memo, setMemo] = useState('');
  const [check, setCheck] = useState<Check | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [level, setLevel] = useState<WabunLevel>(prefs.level);
  const liveRef = useRef<Live | null>(null);
  const latest = useRef({ prefs, myCall, onSave, auto, adapt });
  useEffect(() => { latest.current = { prefs, myCall, onSave, auto, adapt }; });
  const [axes, setAxes] = useState<WabunAxes | null>(null);
  const [preset] = useState(devWabunPreset);
  const stations = useRef(0);

  const setPrefs = (change: Partial<DeskPrefs>) => {
    const next = { ...prefs, ...change };
    setPrefsState(next);
    writePrefs(next);
    latest.current = { ...latest.current, prefs: next };
  };

  /** Clear the band (cut everyone, nothing left queued). */
  const clearBand = () => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (live) {
      live.closed = true;
      if (engine) {
        for (const station of live.session.stations) engine.cut(station);
        markCut(live.capture.rx, engine.epoch, engine.now());
      }
      live.session.stop();
    }
    engine?.setStations([]);
  };

  const newStation = () => {
    const engine = engineRef.current;
    if (!engine) return;
    clearBand();
    const { prefs: current, myCall: me, auto: adaptive, adapt: stored } = latest.current;
    // おまかせ: the station at the axes it left (the WPM picked here seeds the speed); off: Stage 4's desk at that WPM.
    const base = adaptive ? normalizeWabunAdapt(stored as Parameters<typeof normalizeWabunAdapt>[0], current.wpm).axes : defaultWabunAxes(current.wpm);
    // Development: a QA preset (the same station from its seed every time).
    const run = preset ? { ...defaultWabunAxes(preset.wpm), ...preset.axes } : base;
    const level = preset?.level ?? current.level;
    const random = preset ? seeded(preset.seed + stations.current) : Math.random;
    stations.current += 1;
    const band = wabunBand(run.rf);
    const session = new WabunSession({
      random, me, vfo: engine.vfo, wpm: run.speed, hour: new Date().getHours(), level,
      crowd: adaptive || preset ? band.crowd : WABUN_CROWD,
      ...(adaptive || preset ? { strength: band.strength } : {}),
      ...(level >= 3 ? { load: run.load } : {}),
      fist: preset ? preset.fist : { strength: run.fist },
      // Drawn only when it wanders at all (a preset never does: its station stays its seed's).
      drift: run.tuning ? wabunDrift(run.tuning) * (random() < 0.5 ? -1 : 1) : 0,
    });
    liveRef.current = { ...stamp(), session, capture: rig.newCapture(), closed: false, axes: run, auto: Boolean(adaptive) && !preset };
    setAxes(run);
    engine.setStations(session.stations);
    setLevel(session.level);
    setPhase(session.phase);
    setHint(TUNE_HINT);
    setNotes([]);
    setTxText('');
    setSent([]);
    setTraces([]);
    setLog({ call: '', rst: '', name: '', qth: '' });
    setMemo('');
    setCheck(null);
    setResult(null);
  };

  const chooseLevel = (next: WabunLevel) => {
    if (next === level) return;
    setPrefs({ level: next });
    newStation();
  };

  // One station per mount; nobody stays on the band after we leave.
  useEffect(() => {
    newStation();
    return () => clearBand();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one station per mount; 次の局 replaces it
  }, [engineRef]);

  const finished = Boolean(result || check);

  const transmit = async (display: string) => {
    const engine = engineRef.current;
    const live = liveRef.current;
    const notation = txNotation(display);
    if (!engine || !live || !notation || txOn || finished) return;
    if (!engine.powered) { setHint('先に電源を入れてください'); return; }
    setTxText('');
    setSent((list) => [...list, displayNotation(notation)]);
    // Keying over the station (it goes on under us, unheard): a timing note for the review.
    const breakIn = stationKeying(live.capture.rx, live.session.target.id, engine.now(), engine.epoch);
    const phaseBefore = live.session.phase;
    // A station between CQs hears our carrier and holds its next CQ (session.onKeying).
    const onKeyed = (span: { start: number; end: number }) => live.session.onKeying(span, engine.vfo - live.session.target.rf);
    if (!(await rig.transmit(notation, prefs.wpm, onKeyed, wabunKeyer)) || liveRef.current !== live || live.closed) return;
    const { session } = live;
    const reply = session.onTransmit(notation, { offsetHz: engine.vfo - session.target.rf });
    // What we typed, what went out and what the station took from it: kept apart.
    setTraces((list) => [...list, traceTransmission(display.trim(), notation, reply, { phase: phaseBefore, breakIn })]);
    setHint(reply.hint);
    setNotes(reply.notes);
    setPhase(session.phase);
    if (!reply.reply) return;
    const now = engine.now();
    engine.cut(session.target);
    markCut(live.capture.rx, engine.epoch, now, session.target.id);
    engine.send(session.target, reply.reply.text, 0.6 + Math.random() * 0.9);
  };

  /** The QSO is over: the station goes quiet (its CQ would start again otherwise). */
  const quiet = (live: Live) => {
    live.session.target.loop = null;
    engineRef.current?.cut(live.session.target);
  };

  const finish = (answers: Partial<Record<WabunFact, string>>) => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live) return;
    const { session, capture } = live;
    const now = { t: engine.now(), epoch: engine.epoch };
    const records = capture.rx.filter((record) => record.station === session.target.id);
    const { dialogue } = session;
    const timeline = factTimeline(capture.monitor, records, dialogue.overs, session.truth.call, now);
    const reached = Object.fromEntries(Object.entries(timeline).map(([fact, telling]) => [fact, reachOf(telling)])) as Record<WabunFact, ReturnType<typeof reachOf>>;
    const told = scenarioFacts(session.scenario);
    const follow = measureFollow(told, session.truth, log, reached, answers, { timeline, repeats: dialogue.repeats, memo });
    const copy = measureCopy(capture.monitor, records, now, memo);
    const review = reviewWabun({ level: session.level, complete: session.phase === 'done', copy, follow, wpm: session.scenario.persona.wpm });
    const procedure = reviewProcedure(traces);
    const repeats = reviewRepeats(dialogue.repeats, follow);
    const requests = dialogue.requests.map((request) => request.facts);
    const understood = { rst: dialogue.theirRst, name: dialogue.theirName };
    const newsTold = session.scenario.talk?.topic ? session.truth.topic : null;
    const fist = session.scenario.persona.fist ?? null;
    const assist = decodeAssist(capture.decode, [...Object.values(log).filter((value): value is string => typeof value === 'string'), memo]);
    const record: WabunQsoRecord = {
      kind: 'wabun', version: WABUN_RECORD_VERSION, id: live.id, startedAt: live.startedAt, endedAt: Date.now(), modeId: MODE_ID,
      level: session.level, complete: review.complete, wpm: session.scenario.persona.wpm, truth: session.truth, told,
      newsInClosing: dialogue.newsInClosing, log, memo, checks: answers,
      rx: traceRx(records, capture.monitor, now, () => session.scenario.persona.wpm), tx: traces,
      copy, follow, procedure, repeats, requests, understood, evidence: review.evidence, verdict: review.verdict,
      newsInChat: dialogue.newsInChat, responses: [...dialogue.responses], fist, axes: live.axes, auto: live.auto,
      ...(assist ? { assist, decode: compareDecode(records.map((item) => ({ tx: item.tx, station: item.station, epoch: item.epoch })), capture.decode.chars) } : {}),
    };
    quiet(live);
    // The review into the skills, おまかせ and the device's record (QsoView decides where they go).
    const moved = latest.current.onSave?.(record);
    setCheck(null);
    setResult({
      call: session.truth.call,
      fields: scoreWabunLog(session.truth, log).filter((field) => follow.facts.some((fact) => fact.fact === field.key)),
      review,
      overs: heardOvers(capture.monitor, records, now).map((over) => ({ ...over, kind: OVER_KIND[dialogue.overs.find((item) => item.text === over.text)?.plan.kind ?? 'cq'] ?? null })),
      topic: newsTold ? newsTold.kind : null,
      repeats,
      requests,
      procedure,
      news: newsTold ? { ...newsTold, inClosing: dialogue.newsInClosing } : null,
      understood,
      responses: [...dialogue.responses],
      detail: session.scenario.talk?.detail && session.truth.topic.detail ? { value: session.truth.topic.detail, newsInChat: dialogue.newsInChat } : null,
      fist,
      adjusted: live.auto ? (moved || {}) : null,
      assist,
    });
  };

  const submitLog = () => {
    const live = liveRef.current;
    const engine = engineRef.current;
    if (!live || !engine || finished) return;
    const { session, capture } = live;
    // Only what reached us is asked (a fact keyed while we sent is not counted at all).
    const records = capture.rx.filter((record) => record.station === session.target.id);
    const timeline = factTimeline(capture.monitor, records, session.dialogue.overs, session.truth.call, { t: engine.now(), epoch: engine.epoch });
    const blank = factsToCheck(scenarioFacts(session.scenario), log).filter((fact) => reachOf(timeline[fact]));
    if (!blank.length) { finish({}); return; }
    quiet(live);
    setCheck({ facts: blank, choices: Object.fromEntries(blank.map((fact) => [fact, checkChoices(session.truth, fact, Math.random)])), answers: {}, topic: session.scenario.talk?.topic ? session.truth.topic.kind : null });
  };

  // The call for the macros: only what we wrote (the log) or sent (our call to it), never the station's truth.
  const call = operatorCall(log.call, sent) || 'CALL';
  const me = myCall || 'JA1ZZZ';
  const kana = prefs.kana || DEFAULT_KANA;
  const practical = level >= 3;
  const macros: [string, string][] = phase === 'cq'
    ? [['呼ぶ', `${call !== 'CALL' ? `${call} ` : ''}DE ${me} ${me} K`], ['AGN?', 'AGN?']]
    : level === 1
      ? [['打ち逃げ', `${call} DE ${me} UR 599 ホレ アリガトウゴザイマシタ ラタ 73 TU E E`], ['AGN?', 'AGN?'], ['QRS', 'QRS AGN?']]
      : phase === 'exchange'
        ? [
          ['和文で返信', `${call} DE ${me} ホレ コンニチハ 」 レポート 599 599 ナマエハ ${kana} ${kana} ヨロシク ラタ KN`],
          ...(practical ? [] : [['ナマエ サラオネ', `${call} DE ${me} ホレ オナマエ サラオネ ラタ KN`], ['AGN?', 'AGN?']] as [string, string][]),
          ['QRS', 'QRS AGN?'],
        ]
        : phase === 'talk' && level >= 5
          ? [
            ['ナルホド', `${call} DE ${me} ホレ ナルホド ソレハ イイデスネ ラタ KN`],
            ['タノシソウ', `${call} DE ${me} ホレ タノシソウデスネ ラタ KN`],
            ['FB', `${call} DE ${me} FB ホレ アリガトウ ラタ KN`],
            ['QRS', 'QRS AGN?'],
          ]
        : phase === 'chat'
          ? [
            ['ソレハ イイデスネ', `${call} DE ${me} ホレ ソレハ イイデスネ アリガトウ ラタ KN`],
            ['ナルホド', `${call} DE ${me} ホレ ナルホド ラタ KN`],
            ['QRS', 'QRS AGN?'],
          ]
        : phase === 'talk'
          ? [['あいづち', `${call} DE ${me} ホレ ナルホド イイデスネ ラタ KN`], ['QRS', 'QRS AGN?']]
          : [['締め', `${call} DE ${me} TU 73 E E`], ...(practical ? [] : [['AGN?', 'AGN?']] as [string, string][])];
  // Level 3 / 4: ask for one item again (only that comes back) or the whole content.
  const asks: [string, string][] = practical && phase !== 'cq' && phase !== 'done'
    ? [
      ['NAME?', `${call} DE ${me} PSE NAME? KN`], ['QTH?', `${call} DE ${me} PSE QTH? KN`], ['RST AGN?', `${call} DE ${me} RST AGN? KN`],
      ['WX AGN?', `${call} DE ${me} WX AGN? KN`], ['RIG AGN?', `${call} DE ${me} RIG AGN? KN`],
      ...(level >= 5 ? [['キンキヨウ サラオネ', `${call} DE ${me} ホレ キンキヨウ サラオネ ラタ KN`]] as [string, string][] : []),
      ['サラオネ', `${call} DE ${me} ホレ サラオネ ラタ KN`], ['AGN?', 'AGN?'],
    ]
    : [];
  const preview = parseSegments(txNotation(txText));
  const inBody = preview.reduce((open, segment) => (segment.kind === 'control' && segment.to ? segment.to === 'wabun' : open), false);
  const steps = STEPS[level];
  const stepIndex = steps.findIndex((step) => step.phase === phase);
  const fields = logFieldsFor(level);

  return (
    <div className="qso-side wabun-desk">
      <div className="panel panel-pad qso-status">
        <div className="pileup-level-row wabun-levels" role="radiogroup" aria-label="レベル">
          {WABUN_LEVELS.map((item) => (
            <button
              key={item}
              type="button"
              role="radio"
              aria-checked={item === level}
              className={`btn btn-sm ${item === level ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => chooseLevel(item)}
              disabled={txOn}
              title={LEVEL_NOTE[item]}
            >
              {LEVEL_LABEL[item]}
            </button>
          ))}
        </div>
        <p className="qso-note">{LEVEL_NOTE[level]}（レベルを変えると別の局になります）</p>
        <label className="wabun-auto">
          <input type="checkbox" checked={auto} onChange={(event) => onAuto?.(event.target.checked)} disabled={txOn} />
          結果で自動調整（相手の速さ・話の量・電波・周波数のずれを、結果に合わせて少しずつ調整）
        </label>
        {auto && axes && !preset && (
          <p className="qso-note wabun-axes">
            次の局から: 相手 {axes.speed} WPM・話の量 {['少なめ', 'ふつう', '多め'][axes.load]}・電波 {Math.round(axes.rf * 100)}%{axes.tuning > 0 && `・ずれ ${Math.round(axes.tuning * 100)}%`}{level >= 5 && `・手打ちのクセ ${Math.round(axes.fist * 100)}%`}
          </p>
        )}
        {preset && <p className="qso-note wabun-preset">開発用プリセット: {preset.label}（seed {preset.seed}・{preset.wpm} WPM）— {preset.listen}</p>}
        <ol className="qso-steps">
          {steps.map((item, index) => (
            <li key={item.phase} className={index < stepIndex || result ? 'done' : index === stepIndex ? 'current' : ''}>
              <b>{index + 1}</b>{item.label}
            </li>
          ))}
        </ol>
        <p className="qso-hint" role="status">{powered || sent.length ? hint : POWER_HINT}</p>
        {notes.length > 0 && <ul className="wabun-notes">{notes.map((note) => <li key={note}>{NOTE_TEXT[note]}</li>)}</ul>}
      </div>

      <div className="panel panel-pad qso-tx">
        <div className="qso-panel-head">
          <h2>送信</h2>
          <label className="wabun-wpm">
            速さ
            <select value={prefs.wpm} onChange={(event) => setPrefs({ wpm: Number(event.target.value) })} aria-label="速さ（WPM）">
              {WPM_CHOICES.map((value) => <option key={value} value={value}>{value} WPM</option>)}
            </select>
          </label>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void transmit(txText); }} className="qso-tx-row">
          <input
            value={txText}
            onChange={(event) => setTxText(liveTx(event.target.value))}
            placeholder={`例: ${me} ${me} K`}
            aria-label="送信する文"
            autoCapitalize="characters"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={finished}
          />
          <button type="submit" className="btn btn-primary" disabled={txOn || !txText.trim() || finished}>{txOn ? '送信中' : '送信'}</button>
        </form>
        <div className="qso-macros">
          <button type="button" className="btn btn-ghost btn-sm wabun-switch" onClick={() => setTxText(`${txText.trimEnd()} ホレ `.trimStart())} title="ここから和文（ローマ字で打つとカナになります）">ホレ</button>
          <button type="button" className="btn btn-ghost btn-sm wabun-switch" onClick={() => setTxText(`${txText.trimEnd()} ラタ `.trimStart())} title="和文を終えて欧文へ">ラタ</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTxText(`${txText.trimEnd()} ${CORRECTION_WORD} `.trimStart())} disabled={!inBody} title="和文の途中の打ち間違い: ラタ を打って、2〜3文字前から打ち直します（欧文には戻りません）">訂正</button>
          {macros.map(([label, text]) => (
            <button key={label} type="button" className="btn btn-ghost btn-sm" onClick={() => setTxText(text)} title={text}>{label}</button>
          ))}
        </div>
        {asks.length > 0 && (
          <div className="qso-macros wabun-asks" role="group" aria-label="聞き返し">
            <span>聞き返し</span>
            {asks.map(([label, text]) => (
              <button key={label} type="button" className="btn btn-ghost btn-sm" onClick={() => setTxText(text)} title={text}>{label}</button>
            ))}
          </div>
        )}
        {preview.length > 0 && <SegmentLine segments={preview} label="送る内容" />}
        <p className="qso-note">ホレ の後はローマ字で打つとカナになります（ga → ガ、kyo → キヨ）。ラタ で欧文に戻ります。打ち間違えたら「訂正」（ラタ）を押して、少し前から打ち直します。</p>
        {sent.length > 0 && <ul className="qso-sent">{sent.map((line, index) => <li key={index}>{line}</li>)}</ul>}
      </div>

      <div className="panel panel-pad qso-log">
        <div className="qso-panel-head">
          <h2>ログ</h2>
          <small>{result ? `${result.fields.filter((field) => field.correct).length} / ${result.fields.length}` : level === 1 ? 'コールと RST' : '名前・QTH はローマ字かカナで'}</small>
        </div>
        <div className="qso-log-grid">
          {fields.map((field) => {
            const scored = result?.fields.find((item) => item.key === field.key);
            return (
              <label key={field.key} className={scored ? (scored.correct ? 'ok' : 'ng') : ''}>
                <span>{field.label}</span>
                <input
                  value={log[field.key]}
                  onChange={(event) => setLog({ ...log, [field.key]: field.wabun ? romajiToWabun(event.target.value.toLowerCase()) : event.target.value.toUpperCase() })}
                  readOnly={finished}
                  aria-label={`ログ ${field.label}`}
                  autoCapitalize={field.wabun ? 'none' : 'characters'}
                  autoComplete="off"
                  spellCheck={false}
                />
                {scored && !scored.correct && <small>{scored.expected}</small>}
              </label>
            );
          })}
        </div>
        <label className="wabun-kana wabun-memo">
          <span>受信メモ（任意・聞こえた和文を書いた分だけ）</span>
          <textarea
            value={memo}
            onChange={(event) => setMemo(romajiToWabun(event.target.value.toLowerCase()))}
            readOnly={finished}
            rows={2}
            placeholder="例: konnichiha → コンニチハ"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {result ? (
          <button type="button" className="btn btn-success btn-block" onClick={newStation}>次の局を探す</button>
        ) : check ? null : (
          <div className="qso-log-actions">
            <button type="button" className="btn btn-primary" onClick={submitLog} disabled={phase === 'cq'}>ログ確定</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={newStation}>別の局にする</button>
          </div>
        )}
        {check && (
          <div className="wabun-check" role="group" aria-label="内容の確認">
            <p className="qso-note">ログに書けなかった項目を確認します。聞こえた内容に近いものを選んでください。</p>
            {check.facts.map((fact) => (
              <div key={fact} className="wabun-check-row" role="radiogroup" aria-label={`相手の${factLabel(fact, check.topic)}`}>
                <span>相手の{factLabel(fact, check.topic)}は？</span>
                {[...(check.choices[fact] ?? []), 'わからない'].map((choice) => (
                  <button
                    key={choice}
                    type="button"
                    role="radio"
                    aria-checked={check.answers[fact] === choice}
                    className={`btn btn-sm ${check.answers[fact] === choice ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setCheck({ ...check, answers: { ...check.answers, [fact]: choice } })}
                  >
                    {choice}
                  </button>
                ))}
              </div>
            ))}
            <button type="button" className="btn btn-primary btn-block" onClick={() => finish(check.answers)} disabled={check.facts.some((fact) => !check.answers[fact])}>振り返りへ</button>
          </div>
        )}
        <label className="wabun-kana">
          <span>自分の名前（和文で送る名前）</span>
          <input value={prefs.kana} onChange={(event) => setPrefs({ kana: romajiToWabun(event.target.value.toLowerCase()) })} maxLength={8} placeholder={DEFAULT_KANA} autoComplete="off" spellCheck={false} />
        </label>
        {!powered && <p className="qso-note">電源が切れていると、送信も受信もできません。</p>}
      </div>

      {result && <WabunReviewPanel result={result} traces={traces} />}
    </div>
  );
}

function WabunReviewPanel({ result, traces }: { result: Result; traces: WabunTxTrace[] }) {
  const { review } = result;
  const { copy, follow } = review;
  const { procedure } = result;
  const phrase = traces.map((trace) => trace.keyedWabun).filter(Boolean);
  const corrections = traces.flatMap((trace) => trace.corrections);
  return (
    <div className="panel panel-pad wabun-result">
      <div className="qso-panel-head">
        <h2>振り返り</h2>
        <small>{result.call} と交信（{LEVEL_LABEL[review.level]}）</small>
      </div>
      <p className={`wabun-verdict ${review.verdict}`}>{VERDICT_TEXT[review.verdict]}</p>
      {review.level === 1 && (
        <p className="wabun-first">
          {phrase.length ? <>電波に乗せた和文: <b>{phrase.join(' ／ ')}</b></> : '今回は和文を送りませんでした。ホレ の後にひとことカナを打ってみましょう'}
        </p>
      )}

      <h3 className="wabun-sub">内容（follow）{follow.required > 0 && <small> {follow.followed} / {follow.required}{follow.recovered > 0 && `（うち聞き返しで ${follow.recovered}）`}</small>}</h3>
      {review.level >= 3
        ? FOLLOW_GROUPS.map((group) => {
          const facts = follow.facts.filter((fact) => fact.path === group.path);
          return facts.length > 0 && (
            <div key={group.path} className="wabun-follow-group">
              <span>{group.label}</span>
              <p className="wabun-facts">{facts.map((fact) => <FollowChip key={fact.fact} fact={fact} topic={result.topic} />)}</p>
            </div>
          );
        })
        : <p className="wabun-facts">{follow.facts.map((fact) => <FollowChip key={fact.fact} fact={fact} topic={result.topic} />)}</p>}

      <h3 className="wabun-sub">項目ごとの受信経路</h3>
      <ul className="wabun-paths" aria-label="項目ごとの受信経路">
        {follow.facts.map((fact) => (
          <li key={fact.fact}>
            <b>{factLabel(fact.fact, result.topic)}</b>
            <span className="wabun-path-value">{fact.expected}</span>
            <span className="wabun-path-steps">
              <span>最初: {fact.first ? RECEPTION_TEXT[fact.first] : '—'}</span>
              {fact.asked && <span>→ {fact.asked === 'specific' ? '個別に聞き返し' : 'AGN / サラオネ'}</span>}
              {fact.again && <span>→ 再送: {RECEPTION_TEXT[fact.again]}</span>}
              {fact.memo !== null && <span>・メモ {fact.memo ? 'あり' : 'なし'}</span>}
            </span>
            <span className={`chip ${fact.path === 'logged' || fact.path === 'postcheck' || fact.path === 'repeat-recovered' ? 'mint' : ''}`}>
              {PATH_TEXT[fact.path]}{fact.path === 'repeat-recovered' && `（${fact.state === 'logged' ? 'ログ' : '確認'}）`}
            </span>
          </li>
        ))}
      </ul>
      {result.news && (
        <p className="qso-note wabun-news">
          近況（相手が話したこと）: {factLabel('topic', result.news.kind)}は「{result.news.subject}」・{STAGE_TEXT[result.news.stage]}
          {result.news.inClosing && '（長くなるので締めの電文で送られました）'}
        </p>
      )}

      {result.detail && (
        <p className="qso-note wabun-news">
          近況の続き: {factLabel('detail', result.topic)}は「{result.detail.value}」
          {result.detail.newsInChat && '（近況そのものも長さの都合で次の電文で送られました）'}
        </p>
      )}
      {review.level >= 3 && result.responses.length > 0 && (
        <>
          <h3 className="wabun-sub">会話（話題への反応）</h3>
          <ul className="wabun-responses">
            {result.responses.map((response, index) => (
              <li key={index}>
                <b>{response.phase === 'talk' ? '近況への返事' : '続きへの返事'}</b>
                {response.kinds.length ? response.kinds.map((kind) => REACT_TEXT[kind]).join('・') : response.ok ? '和文の返事' : '反応なし（締めへ）'}
                {response.topical && <span className="chip mint">話題に触れた</span>}
                {response.body && <span className="wabun-path-value">「{response.body}」</span>}
              </li>
            ))}
          </ul>
          <p className="qso-note">{result.responses.every((response) => response.ok) ? '会話は成立しました（文法は採点しません）。' : '反応を返さずに締めた所があります。ひとことでも返すと会話が続きます。'}</p>
        </>
      )}
      {result.fist && (
        <p className="qso-note wabun-fist">打鍵: {describeFist(result.fist).join(' / ')}（相手局の打ち方のクセ。受信の判定には使っていません）</p>
      )}

      {(result.repeats.length > 0 || result.requests.length > 0) && (
        <>
          <h3 className="wabun-sub">聞き返し</h3>
          <ul className="wabun-repeats">
            {result.repeats.map((repeat, index) => (
              <li key={`r${index}`}>
                <b>こちら</b>
                {repeat.asked ? `${repeat.asked.map((fact) => factLabel(fact, result.topic)).join('・')} を聞き返し` : 'もう一度（AGN / サラオネ）'}
                {' → '}
                {repeat.resent.length ? `${repeat.resent.map((fact) => factLabel(fact, result.topic)).join('・')} を再送` : '同じ電文をもう一度'}
                {repeat.gained.length > 0 && <span className="chip mint">聞き返しで取れた: {repeat.gained.map((fact) => factLabel(fact, result.topic)).join('・')}</span>}
              </li>
            ))}
            {result.requests.map((facts, index) => (
              <li key={`q${index}`}><b>相手</b>{facts.map((fact) => FACT_LABEL[fact]).join('・')} を聞き返してきました（こちらの送信から読み取れなかった・手順として記録）</li>
            ))}
          </ul>
        </>
      )}

      <h3 className="wabun-sub">文字（copy）</h3>
      <p className="qso-note wabun-copy">
        {copy.accuracy === null
          ? '受信メモなし: 一字ずつの受信は今回は測っていません（内容が追えていれば交信としては十分です）。'
          : `受信メモ: 届いた和文 ${copy.reached} 文字のうち ${copy.matched} 文字（${Math.round(copy.accuracy * 100)}%）。`}
        {` 相手の和文 ${copy.keyed} 文字中、届いたのは ${copy.reached} 文字`}
        {copy.muted > 0 && `・こちらの送信中で聞けなかった ${copy.muted} 文字`}
        {copy.unheard > 0 && `・途中で切れた／未送出 ${copy.unheard} 文字`}。
      </p>

      <h3 className="wabun-sub">相手の送信</h3>
      <ol className="wabun-overs">
        {result.overs.map((over, index) => (
          <li key={index}>
            {over.kind && <span className="chip wabun-over-kind">{over.kind}</span>}
            <SegmentLine segments={parseSegments(over.text)} label="相手が送った電文" />
            <p className="wabun-heard"><span>聞こえた内容</span>{over.heard}</p>
          </li>
        ))}
      </ol>

      <h3 className="wabun-sub">自分の送信</h3>
      <ol className="wabun-overs wabun-mine">
        {traces.map((trace, index) => (
          <li key={index}>
            <SegmentLine segments={trace.segments} label="実際に送った電文" />
            <p className="wabun-heard"><span>実際に送出</span>{trace.keyed}</p>
            {trace.input && trace.input !== displayNotation(trace.notation) && <p className="wabun-heard"><span>入力</span>{trace.input}</p>}
            {trace.understood && <p className="wabun-heard"><span>相手の受け取り</span>{understoodText(trace)}</p>}
            {trace.corrections.map((correction, corrIndex) => (
              <p key={corrIndex} className="wabun-heard wabun-correction"><span>訂正</span>{correction.erased} → ラタ → {correction.retyped}（相手は「{correction.after}」と読みました）</p>
            ))}
          </li>
        ))}
      </ol>
      {corrections.length === 0 && <p className="qso-note">ラタでの訂正はありませんでした。</p>}
      {review.level >= 2 && (
        <p className="qso-note wabun-understood">
          相手が最終的に受け取った内容: レポート {result.understood.rst ?? '（受け取れず）'}・名前 {result.understood.name ?? '（受け取れず）'}
        </p>
      )}

      <h3 className="wabun-sub">手順（procedure）<small> {procedure.overs - procedure.slips} / {procedure.overs} 送信が問題なし</small></h3>
      {procedure.items.length > 0
        ? <ul className="wabun-procedure">{procedure.items.map((item, index) => (
          <li key={index}><b>{item.over + 1} 回目の送信</b>{PROCEDURE_TEXT[item.kind]}{item.facts?.length ? `（${item.facts.map((fact) => FACT_LABEL[fact]).join('・')}）` : ''}</li>
        ))}</ul>
        : <p className="qso-note">ホレ / ラタ・KN・締めの手順に気になる点はありませんでした。</p>}
      <p className="qso-note">
        {procedure.corrections > 0 && `ラタでの訂正 ${procedure.corrections} 回（操作として記録。減点しません）。`}
        手順は内容（follow）と文字（copy）の評価には影響しません。
      </p>

      <h3 className="wabun-sub">記録</h3>
      <p className="qso-note wabun-saved">
        {review.evidence['copy.wabun'] ? `copy.wabun: ${review.evidence['copy.wabun'].correct} / ${review.evidence['copy.wabun'].total} 文字` : 'copy.wabun: 未測定（受信メモなし）'}
        {` ・ follow.wabun: ${review.evidence['follow.wabun'].correct} / ${review.evidence['follow.wabun'].total}`}
        {review.evidence['follow.wabun'].paths['repeat-recovered'] > 0 && `（聞き返しで回収 ${review.evidence['follow.wabun'].paths['repeat-recovered']}）`}
        {review.evidence['follow.wabun'].paths['not-reached'] > 0 && `・届かず ${review.evidence['follow.wabun'].paths['not-reached']}（数えず）`}
        {` ・ 手順: ${procedure.overs - procedure.slips} / ${procedure.overs}`}
      </p>
      {result.adjusted && (
        <p className="qso-note wabun-adjusted">
          自動調整: {Object.keys(result.adjusted).length
            ? (Object.entries(result.adjusted) as [WabunAxis, [number, number]][]).map(([axis, move]) => describeWabunMove(axis, move)).join('・')
            : '今回は変更なし（同じ傾向が 2 回続くと少しずつ調整します。手順の結果では変えません）'}
        </p>
      )}
      {result.assist && <p className="qso-note decode-note">{decodeNote(result.assist)}</p>}
      <p className="qso-note">「・」は届かなかった文字です（こちらが送信している間に送られた文字、途中で切れた文字）。ウォーターフォールには見えていても、受信には数えません。送った文は打ったとおりに残しています（打ち間違いは直していません）。</p>
    </div>
  );
}

function FollowChip({ fact, topic }: { fact: WabunFollowFact; topic: TopicKind | null }) {
  const ok = fact.path === 'logged' || fact.path === 'postcheck' || fact.path === 'repeat-recovered';
  return (
    <span className={`chip ${ok ? 'mint' : ''}`} title={fact.path === 'not-reached' ? '一度も最後まで届かなかったので数えません' : fact.path === 'repeat-recovered' ? '聞き返して取れました（最初の受信とは別に記録）' : ''}>
      {factLabel(fact.fact, topic)} {PATH_TEXT[fact.path]}
      {fact.path === 'repeat-recovered' && `（${fact.state === 'logged' ? 'ログ' : '確認'}）`}
      {fact.path === 'missed' || fact.path === 'not-reached' ? `（${fact.expected}）` : ''}
    </span>
  );
}

/** What the station took from one over of ours, in a line. */
function understoodText(trace: WabunTxTrace) {
  const understood = trace.understood!;
  if (!understood.heard) return '届かず（周波数がずれていたか、聞こえなかった）';
  const parts: string[] = [];
  if (understood.called) parts.push('こちらのコール');
  if (understood.report) parts.push(`レポート ${understood.report}`);
  if (understood.thanks) parts.push('お礼・あいさつ');
  if (understood.asked.length) parts.push(`再送の依頼（${understood.asked.map((fact) => FACT_LABEL[fact]).join('・')}）`);
  else if (understood.repeat) parts.push('もう一度の依頼');
  if (understood.qrs) parts.push('QRS');
  if (understood.closing) parts.push('締め');
  const body = understood.body ? `／和文「${understood.body}」` : '';
  return `${parts.length ? parts.join('・') : '（意味のある語なし）'}${body}`;
}

/** A transmission as its segments: Latin, the switches, the wabun body. */
function SegmentLine({ segments, label }: { segments: Segment[]; label: string }) {
  return (
    <p className="wabun-segs" aria-label={label}>
      {segments.map((segment, index) => segment.kind === 'control'
        ? (
          <span
            key={index}
            className={`seg seg-control ${segment.to ? 'seg-switch' : ''} ${segment.correction ? 'seg-correction' : ''}`}
            title={segment.correction ? '訂正（切替なし）' : segment.to === 'wabun' ? '和文へ' : segment.to === 'roman' ? '欧文へ' : '切替なし'}
          >
            {segment.correction ? CORRECTION_WORD : segment.sign}
          </span>
        )
        : <span key={index} className={`seg seg-${segment.kind}`}>{segment.text}</span>)}
    </p>
  );
}
