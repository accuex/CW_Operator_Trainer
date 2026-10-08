'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerLog, AudioSettings, QsoCause, QsoProfile, SessionRecord, SkillEstimate, TrainerProfile } from '@/lib/types';
import { makeQrm } from '@/lib/radio/band';
import { markCut } from '@/lib/radio/conditions';
import { collectEvidence, fieldAnswers, scoreFields, type FieldResult } from '@/lib/radio/attribution';
import { AXES, AXIS_SPECS, BAND_PRESETS, adjustDifficulty, bandPresetAxes, describeMove, matchBandPreset, normalizeDifficulty, type Axis, type BandPresetId, type DifficultyVector, type QsoEvidence } from '@/lib/radio/difficulty';
import { PILEUP_ADAPT_AXES, updatePileupSkills } from '@/lib/radio/pileup/learning';
import { CONTEST_ADAPT_AXES, contestOutcome, updateContestSkills, voteContestAxes } from '@/lib/radio/contest/learning';
import { contestAxesOf, contestLevel, isContestLevel, type ContestLevelId } from '@/lib/radio/contest/levels';
import { isPileupLevel, pileupAxesOf, pileupLevel, type PileupLevelId } from '@/lib/radio/modes/pileupLevels';
import { PRESETS } from '@/lib/radio/exchange';
import { QSO_MODES, qsoMode, type QsoSession } from '@/lib/radio/modes';
import { isProcedureIssue, MIN_TARGET_WPM } from '@/lib/radio/qso';
import { TIER_LABEL, badgeById, recordQsoOutcome, recordRunOutcome, type EarnedBadge, type RunOutcome } from '@/lib/radio/badges';
import { modeProgress, normalizeQsoProfile, recommendStage, updateSkills } from '@/lib/radio/skills';
import { logbookEntries } from '@/lib/radio/logbook';
import { traceRx, type QsoTrace } from '@/lib/radio/trace';
import { addQsoTrace, addWabunRecord } from '@/lib/storage';
import { updateWabunSkills } from '@/lib/radio/wabun/learning';
import { adjustWabun, normalizeWabunAdapt, voteWabunAxes, wabunBand, type WabunAxis } from '@/lib/radio/wabun/adapt';
import type { WabunQsoRecord } from '@/lib/radio/wabun/trace';
import { nowId } from '@/app/trainer/shared';
import { Icon } from '@/app/components/icons';
import { FieldCells } from './qso/FieldCells';
import { CqRunDesk, type RunRecord, type RunSaved } from './qso/CqRunDesk';
import { ContestDesk, CONTEST_RIG_LEVELS, type ContestSaveRecord } from './qso/ContestDesk';
import { PileupDesk, PILEUP_RIG_LEVELS } from './qso/PileupDesk';
import { RigPanel } from './qso/RigPanel';
import { DemoDesk, DEMO_RIG_LEVELS } from './qso/DemoDesk';
import { WabunDesk, WABUN_RIG_LEVELS } from './qso/WabunDesk';
import { devWabunPreset } from '@/lib/radio/wabun/presets';
import { assistedAnswers, compareDecode, decodeAssist, decodeNote, isAssisted, outcomeWithoutCopy, wabunWithoutCopy, withoutCopy } from '@/lib/radio/decode/assist';
import type { QsoAssist } from '@/lib/types';
import { useRig, type Capture, type PowerResult } from './qso/useRig';

const PREFS_KEY = 'cwot.qso.prefs';
const LOGBOOK_SIZE = 30;

const CAUSE_LABEL: Record<Exclude<QsoCause, 'ok'> | 'procedure', string> = {
  copy: '受信ミス', environment: '悪条件', overlap: '重なり', doubling: 'ダブり', tuning: '同調', procedure: '手順', timing: '聴き逃し',
};

/** Rig-side preferences that are not difficulty (kept on this device). */
interface Prefs { af: number; myCall?: string }

const readPrefs = (): Prefs => {
  try {
    return { af: 0.6, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { af: 0.6 };
  }
};

interface Live {
  id: string;
  startedAt: number;
  modeId: string;
  session: QsoSession;
  capture: Capture;
  tx: QsoTrace['tx'];
}

interface Review {
  fields: FieldResult[];
  evidence: QsoEvidence;
  moved: Partial<Record<Axis, number>>;
  auto: boolean;
  received: string[];
  earned: EarnedBadge[];
  /** Characters that just got their 実戦マーク. */
  marked: string[];
  assist?: QsoAssist;
}

export interface QsoViewProps {
  settings: AudioSettings;
  stopEpoch: number;
  profile: TrainerProfile;
  setProfile: React.Dispatch<React.SetStateAction<TrainerProfile>>;
  sessions: SessionRecord[];
  recordMany: (answers: AnswerLog[]) => void;
  onSession: (session: SessionRecord) => void;
}

export function QsoView({ settings, stopEpoch, profile, setProfile, sessions, recordMany, onSession }: QsoViewProps) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  const qso = useMemo(() => normalizeQsoProfile(profile.qso), [profile.qso]);
  const [modeId, setModeId] = useState('ragchew');
  const mode = qsoMode(modeId);
  const progress = modeProgress(qso, mode.id, { speed: Math.min(settings.characterSpeed, 18) });
  const difficulty = progress.difficulty as DifficultyVector;
  const myCall = qso.myCall ?? prefs.myCall ?? 'JA1ZZZ';
  const advice = recommendStage(qso);

  // The pileup's band is its own (its levels don't use these axes yet).
  // The wabun desk's band: おまかせ's rf axis when on (0.25 is Stage 4's quiet band), else that quiet band.
  // A dev preset (?wabunPreset=) sets the band too, the same as its sim run.
  const [wabunPreset] = useState(devWabunPreset);
  const wabunAdapt = mode.kind === 'wabun' && progress.auto ? normalizeWabunAdapt(progress.wabun as Parameters<typeof normalizeWabunAdapt>[0]) : null;
  const band = mode.kind === 'pileup' ? PILEUP_RIG_LEVELS : mode.kind === 'contest' ? CONTEST_RIG_LEVELS
    : mode.kind === 'demo' ? DEMO_RIG_LEVELS
    : mode.kind === 'wabun' ? (wabunPreset ? wabunBand(wabunPreset.axes.rf ?? 0.25).rig : wabunAdapt ? wabunBand(wabunAdapt.axes.rf).rig : WABUN_RIG_LEVELS) : difficulty;
  const rig = useRig({ pitch: settings.pitch, stopEpoch, levels: { af: prefs.af, noise: band.noise, qrn: band.qrn, qsb: band.qsb } });
  const { engineRef, txOn, newCapture } = rig;
  const [step, setStep] = useState(0);
  const [canLog, setCanLog] = useState(false);
  const [hint, setHint] = useState('電源を入れて、ウォーターフォールで CQ を出している局を探しましょう');
  const [txText, setTxText] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const [log, setLog] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [macros, setMacros] = useState<[string, string][]>([]);

  const liveRef = useRef<Live | null>(null);
  const settingsRef = useRef({ myCall, difficulty, modeId: mode.id });
  useEffect(() => {
    settingsRef.current = { myCall, difficulty, modeId: mode.id };
  });

  const updateQso = useCallback((change: (qso: QsoProfile) => QsoProfile) => {
    setProfile((old) => ({ ...old, qso: change(normalizeQsoProfile(old.qso)) }));
  }, [setProfile]);
  const updateMode = (change: Partial<ReturnType<typeof modeProgress>>) => {
    updateQso((current) => ({ ...current, modes: { ...current.modes, [mode.id]: { ...modeProgress(current, mode.id, difficulty), ...change } } }));
  };

  /** Put a fresh station on the band for a single-QSO mode (a run puts up its own callers). */
  const newStation = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { myCall, difficulty, modeId } = settingsRef.current;
    const current = qsoMode(modeId);
    if (current.kind !== 'single') return;
    const preset = PRESETS[current.presets[0]];
    const session = current.createSession({ random: Math.random, myCall, vfo: engine.vfo, difficulty, preset });
    liveRef.current = { id: `qso-${nowId()}`, startedAt: Date.now(), modeId: current.id, session, capture: newCapture(), tx: [] };
    engine.setStations(session.stations);
    setStep(session.step);
    setCanLog(session.canLog);
    setMacros(session.macros({}));
    setLog({});
    setReview(null);
    setSent([]);
  }, [engineRef, newCapture]);

  // The rig's engine exists once its own effect has run; put the first station on it,
  // and a fresh one whenever we come back to a single-QSO mode (a run desk sets up its own band).
  useEffect(() => { newStation(); }, [mode.id, newStation]);

  const transmit = async (raw: string) => {
    const engine = engineRef.current;
    const live = liveRef.current;
    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!engine || !live || !text || txOn) return;
    if (!engine.powered) { setHint('先に電源を入れてください'); return; }
    if (!myCall) { setHint('設定で自分のコールサインを入れてください'); return; }
    const macro = macros.some(([, line]) => line.toUpperCase().replace(/\s+/g, ' ').trim() === text);
    setTxText('');
    setSent((list) => [...list, text]);
    // A station between CQs hears our carrier and holds its next CQ (session.onKeying).
    const onKeyed = (span: { start: number; end: number }) => live.session.onKeying?.(span, engine.vfo - live.session.target.rf);
    if (!(await rig.transmit(text, difficulty.speed, onKeyed)) || liveRef.current !== live) return;
    const { session } = live;
    const offsetHz = engine.vfo - session.target.rf;
    const reply = session.onTransmit(text, { offsetHz });
    live.tx.push({ at: Date.now(), text, offsetHz: Math.round(offsetHz), issue: reply.issue, macro });
    setHint(reply.hint);
    setStep(session.step);
    setCanLog(session.canLog);
    if (!reply.reply) return;
    const now = engine.now();
    engine.cut(session.target);
    markCut(live.capture.rx, engine.epoch, now, session.target.id);
    engine.send(session.target, reply.reply, 0.6 + Math.random() * 0.9);
  };

  const updateLog = (key: string, value: string) => {
    const next = { ...log, [key]: value };
    setLog(next);
    if (liveRef.current) setMacros(liveRef.current.session.macros(next));
  };

  const submitLog = () => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live || review || mode.kind !== 'single') return;
    const { session } = live;
    const now = { t: engine.now(), epoch: engine.epoch };
    const { capture } = live;
    const targetRx = capture.rx.filter((record) => record.station === session.target.id);
    const fields = scoreFields(session.preset, session.truth(), log, targetRx, capture.monitor, now);
    const offFrequency = live.tx.filter((event) => event.issue === 'off-frequency').length;
    const evidence = collectEvidence(fields, {
      total: live.tx.length,
      onFrequency: live.tx.length - offFrequency,
      procedure: live.tx.filter((event) => isProcedureIssue(event.issue)).length,
    });
    // DECODE printed: the copy may have come off the screen — kept, but not the ear's.
    const assist = decodeAssist(capture.decode, Object.values(log));
    const learned = isAssisted(assist) ? withoutCopy(evidence) : evidence;
    const correctFields = fields.filter((field) => field.correct).length;
    const current = modeProgress(qso, live.modeId, difficulty);
    const adjusted = current.auto
      ? adjustDifficulty({ difficulty: current.difficulty as DifficultyVector, votes: current.votes }, learned, current.pinned)
      : { difficulty: current.difficulty as DifficultyVector, votes: current.votes, moved: {} };
    const endedAt = Date.now();
    // QRS slows the target down; credit the speed it actually sent at.
    const wpm = Math.min(difficulty.speed, ...targetRx.map((record) => capture.rxWpm.get(record) ?? difficulty.speed));
    const outcome = {
      fields, evidence, alphabet: session.preset.alphabet, wpm, tx: live.tx, at: endedAt,
      complete: session.step >= mode.steps.length - 1,
    };
    // Badges and 実戦マーク: the copy only when it was the ear's.
    const counted = isAssisted(assist) ? outcomeWithoutCopy(outcome) : outcome;
    const { earned, marked } = recordQsoOutcome(qso, counted);
    updateQso((old) => {
      const base = modeProgress(old, live.modeId, difficulty);
      const next = recordQsoOutcome(updateSkills(old, { modeId: live.modeId, alphabet: session.preset.alphabet, wpm, evidence: learned }), counted).qso;
      return {
        ...next,
        modes: {
          ...next.modes,
          [live.modeId]: {
            ...base,
            qsos: base.qsos + 1,
            perfect: base.perfect + (!isAssisted(assist) && correctFields === fields.length ? 1 : 0),
            lastAt: endedAt,
            difficulty: adjusted.difficulty,
            votes: adjusted.votes,
          },
        },
      };
    });

    const answers = fieldAnswers(fields, {
      sessionId: live.id, timestamp: endedAt, wpm, modeId: live.modeId, presetId: session.preset.id, alphabet: session.preset.alphabet,
    });
    recordMany(assistedAnswers(answers, assist));
    const cleanAccuracy = evidence.clean.total ? evidence.clean.correct / evidence.clean.total : null;
    onSession({
      id: live.id,
      startedAt: live.startedAt,
      endedAt,
      mode: 'qso',
      alphabetType: session.preset.alphabet,
      answers: answers.length,
      accuracy: answers.length ? answers.filter((answer) => answer.isCorrect).length / answers.length : 0,
      qso: {
        modeId: live.modeId,
        presetId: session.preset.id,
        call: session.truth().call ?? '',
        outcome: outcome.complete ? 'complete' : 'partial',
        fields: fields.length,
        fieldsCorrect: correctFields,
        cleanAccuracy,
        causes: evidence.causes,
        difficulty: { ...difficulty },
        adjusted: adjusted.moved,
        contacts: [{ call: session.truth().call ?? '', fields: fields.length, fieldsCorrect: correctFields, outcome: outcome.complete ? 'complete' : 'partial', at: endedAt }],
        ...(assist ? { assist } : {}),
      },
    });
    const rx = traceRx(targetRx, capture.monitor, now, (record) => capture.rxWpm.get(record) ?? session.target.wpm);
    void addQsoTrace({
      id: live.id,
      startedAt: live.startedAt,
      endedAt,
      modeId: live.modeId,
      presetId: session.preset.id,
      difficulty: { ...difficulty },
      truth: session.truth(),
      log,
      fields,
      rx,
      tx: live.tx,
      evidence,
      adjusted: adjusted.moved,
      ...(assist ? { assist, decode: compareDecode(targetRx.map((record) => ({ tx: record.tx, station: record.station, epoch: record.epoch })), capture.decode.chars) } : {}),
    }).catch(() => undefined);
    // What actually went out, without the CQ loop repeating itself.
    const received = rx.filter((record) => !/^u*$/.test(record.conditions)).map((record) => record.text)
      .filter((text, index, list) => text !== list[index - 1]);
    setReview({ fields, evidence, moved: adjusted.moved, auto: current.auto, received, earned, marked, assist });
  };

  /** Rag-chew only: a run keeps its background for the whole run (the next run gets the new count). */
  const setCrowd = (crowd: number) => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live || mode.kind !== 'single') return;
    const qrm = engine.stations.filter((station) => station.role === 'qrm');
    const next = crowd < qrm.length ? qrm.slice(0, crowd) : [...qrm, ...makeQrm(Math.random, crowd - qrm.length, engine.vfo, [live.session.target.rf])];
    engine.setStations([live.session.target, ...next]);
  };

  const setAxis = (axis: Axis, value: number) => {
    updateMode({ difficulty: { ...difficulty, [axis]: value } });
    if (axis === 'crowd') setCrowd(value);
  };

  /** A fresh start: votes from the old band would move an axis after the first QSO. */
  const applyBand = (id: BandPresetId) => {
    const values = bandPresetAxes(id, mode.axes);
    updateMode({ difficulty: { ...difficulty, ...values }, votes: {} });
    if (values.crowd !== undefined) setCrowd(values.crowd);
  };
  const bandPreset = matchBandPreset(difficulty, mode.axes);

  const togglePin = (axis: Axis) => {
    const pinned = progress.pinned.includes(axis) ? progress.pinned.filter((item) => item !== axis) : [...progress.pinned, axis];
    updateMode({ pinned });
  };

  /**
   * QRT: store the run's answers and summary, credit skills and badges, and retune the
   * unpinned axes the run mode has (おまかせ) — the same evidence rules as a rag-chew.
   */
  const saveRun = (record: RunRecord): RunSaved => {
    const assist = decodeAssist(rig.captureRef.current?.decode, record.summary.contacts?.map((contact) => contact.call));
    const evidence = isAssisted(assist) ? withoutCopy(record.evidence) : record.evidence;
    recordMany(assistedAnswers(record.answers, assist));
    const modeId = record.summary.modeId;
    const current = modeProgress(qso, modeId, difficulty);
    const { pileup } = record;
    // Axes the mode doesn't have are as good as pinned; a pileup moves only the axes its causes speak for.
    const pinned = [...current.pinned, ...AXES.filter((axis) => !(pileup ? (PILEUP_ADAPT_AXES as readonly Axis[]) : mode.axes).includes(axis))];
    // A pileup starts from the axes it ran at; votes carry over only within the same level.
    const state = pileup
      ? { difficulty: normalizeDifficulty(pileup.axes, current.difficulty as DifficultyVector), votes: current.level === pileup.level ? current.votes : {} }
      : { difficulty: current.difficulty as DifficultyVector, votes: current.votes };
    const adjusted = current.auto
      ? adjustDifficulty(state, evidence, pinned, pileup && !isAssisted(assist) ? pileup.votes : undefined)
      : { ...state, moved: {} };
    const runOutcome = {
      ...record.run, alphabet: record.alphabet, at: record.endedAt,
      // Badges and 実戦マーク: the contacts' copy only when it was the ear's (the run's own counters stay).
      contacts: isAssisted(assist) ? record.run.contacts.map(outcomeWithoutCopy) : record.run.contacts,
    };
    const { earned, marked } = recordRunOutcome(qso, runOutcome);
    onSession({
      id: record.id,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      mode: 'qso',
      alphabetType: record.alphabet,
      answers: record.answers.length,
      accuracy: record.answers.length ? record.answers.filter((answer) => answer.isCorrect).length / record.answers.length : 0,
      qso: { ...record.summary, adjusted: adjusted.moved, ...(assist ? { assist } : {}) },
    });
    const made = record.summary.contacts?.length ?? 0;
    const perfect = isAssisted(assist) ? 0 : record.summary.contacts?.filter((contact) => contact.fields > 0 && contact.fieldsCorrect === contact.fields).length ?? 0;
    updateQso((old) => {
      const skilled = updateSkills(old, { modeId, alphabet: record.alphabet, wpm: record.wpm, evidence });
      // Pileup skills are the partial / callsign copy: not the ear's when DECODE printed.
      const next = recordRunOutcome(pileup && !isAssisted(assist) ? updatePileupSkills(skilled, pileup.analysis) : skilled, runOutcome).qso;
      const base = modeProgress(old, modeId, difficulty);
      return {
        ...next,
        modes: {
          ...next.modes,
          [modeId]: {
            ...base, qsos: base.qsos + made, perfect: base.perfect + perfect, lastAt: record.endedAt, difficulty: adjusted.difficulty, votes: adjusted.votes,
            ...(pileup ? { level: pileup.level } : {}),
          },
        },
      };
    });
    return { moved: adjusted.moved, auto: current.auto, earned, marked, assist };
  };

  /**
   * Contest QRT: the answers and the session record (its summary is what syncs), the
   * shared and contest skills, badges, and おまかせ on the axes its causes speak for
   * (contest/learning.ts) — never on procedure, logging, DUPE or dropped contacts.
   */
  const saveContest = (record: ContestSaveRecord): RunSaved => {
    const assist = decodeAssist(rig.captureRef.current?.decode, record.summary.contacts?.map((contact) => contact.call));
    const evidence = isAssisted(assist) ? withoutCopy(record.analysis.evidence) : record.analysis.evidence;
    recordMany(assistedAnswers(record.answers, assist));
    const modeId = record.summary.modeId;
    const current = modeProgress(qso, modeId, difficulty);
    const pinned = [...current.pinned, ...AXES.filter((axis) => !(CONTEST_ADAPT_AXES as readonly Axis[]).includes(axis))];
    // From the axes it ran at; votes carry over only within the same level.
    const state = { difficulty: normalizeDifficulty({ ...record.axes }, current.difficulty as DifficultyVector), votes: current.level === record.level ? current.votes : {} };
    const adjusted = current.auto
      ? adjustDifficulty(state, evidence, pinned, isAssisted(assist) ? undefined : voteContestAxes(record.analysis))
      : { ...state, moved: {} };
    const runOutcome: RunOutcome = {
      contacts: isAssisted(assist) ? record.contacts.map(outcomeWithoutCopy) : record.contacts, alphabet: 'international', at: record.endedAt, seconds: record.review.seconds,
      frequencyChecks: 0, busyAvoided: 0, cleanContacts: 0, cleanRate: 0, contest: contestOutcome(record.review, record.analysis),
    };
    const { earned, marked } = recordRunOutcome(qso, runOutcome);
    onSession({
      id: record.id,
      startedAt: record.startedAt,
      endedAt: record.endedAt,
      mode: 'qso',
      alphabetType: 'international',
      answers: record.answers.length,
      accuracy: record.answers.length ? record.answers.filter((answer) => answer.isCorrect).length / record.answers.length : 0,
      qso: { ...record.summary, adjusted: adjusted.moved, ...(assist ? { assist } : {}) },
    });
    const logged = record.summary.contest?.logged ?? 0;
    updateQso((old) => {
      const skilled = updateSkills(old, { modeId, alphabet: 'international', wpm: record.wpm, evidence });
      const next = recordRunOutcome(isAssisted(assist) ? skilled : updateContestSkills(skilled, record.analysis, modeId), runOutcome).qso;
      const base = modeProgress(old, modeId, difficulty);
      return {
        ...next,
        modes: {
          ...next.modes,
          [modeId]: { ...base, qsos: base.qsos + logged, lastAt: record.endedAt, level: record.level, difficulty: adjusted.difficulty, votes: adjusted.votes },
        },
      };
    });
    return { moved: adjusted.moved, auto: current.auto, earned, marked, assist };
  };

  /**
   * A wabun QSO reviewed: copy.wabun (memo only), follow.wabun and procedure into the
   * skills, each from its own evidence, the QSO counted for the mode and the record kept
   * on the device. No session record (nothing new synced) and no おまかせ yet.
   */
  const saveWabun = (record: WabunQsoRecord): Partial<Record<WabunAxis, [number, number]>> => {
    // おまかせ: from the axes the QSO ran at; each axis by its own evidence (procedure moves none).
    const current = modeProgress(qso, record.modeId, difficulty);
    // DECODE printed: the memo and the facts may have come off the screen (tuning still counts).
    const evidence = isAssisted(record.assist) ? wabunWithoutCopy(record.evidence) : record.evidence;
    const stored = normalizeWabunAdapt(current.wabun as Parameters<typeof normalizeWabunAdapt>[0], record.axes?.speed);
    const state = { ...stored, axes: record.axes ?? stored.axes };
    const adjusted = record.auto && record.axes
      ? adjustWabun(state, voteWabunAxes({ level: record.level, evidence, procedure: record.procedure, fistKind: record.fist?.kind ?? null }), record.level)
      : null;
    updateQso((old) => {
      const next = updateWabunSkills(old, { modeId: record.modeId, evidence, procedure: record.procedure });
      const base = modeProgress(old, record.modeId, difficulty);
      return {
        ...next,
        modes: {
          ...next.modes,
          [record.modeId]: {
            ...base, qsos: base.qsos + 1, perfect: base.perfect + (record.complete && record.follow.ok ? 1 : 0), lastAt: record.endedAt, level: `${record.level}`,
            ...(adjusted ? { wabun: { axes: { ...adjusted.axes }, votes: adjusted.votes as Record<string, number>, level: record.level } } : {}),
          },
        },
      };
    });
    // Off (or a dev preset): nothing was up for adjusting, kept as null rather than "no change".
    const moved = adjusted ? adjusted.moved : null;
    void addWabunRecord({ ...record, adjusted: moved }).catch(() => undefined);
    return moved ?? {};
  };

  /** Where a contest level starts: as おまかせ left it when that is the level last run, else the level's own axes. */
  const contestAxesFor = (level: ContestLevelId) => {
    const axes = contestLevel(level).axes;
    return progress.level === level ? contestAxesOf(progress.difficulty, axes) : axes;
  };

  /** Where a pileup level starts: as おまかせ left it when that is the level last run, else the level's own axes. */
  const pileupAxesFor = (level: PileupLevelId) => {
    const axes = pileupLevel(level).axes;
    return progress.level === level ? pileupAxesOf(progress.difficulty, axes) : axes;
  };

  const onPower = (result: PowerResult) => {
    if (result === 'on' && step === 0) setHint('ウォーターフォールの局をクリックすると同調します。CQ を出している局を探しましょう');
    if (result === 'failed') setHint('このブラウザでは音声を出せませんでした');
  };

  const preset = PRESETS[mode.presets[0]];
  const logbook = useMemo(() => logbookEntries(sessions).slice(-LOGBOOK_SIZE).reverse(), [sessions]);
  const fieldResult = (key: string) => review?.fields.find((field) => field.key === key);

  return <section className="page-pad qso-page">
    <div className="page-title">
      <div>
        <p className="section-kicker">QSO SIMULATOR</p>
        <h1>QSO シミュレーター</h1>
        <p>{mode.kind === 'demo'
          ? 'チュートリアル。CQ に同調し、案内どおり送信して、呼ぶ→レポート→73 の手順を手で覚えます。'
          : 'バンドを聴いて CQ を出している局を探し、呼んで、レポートを書き取り、73 で締める。混信・ノイズ・フェージングの中で 1 交信を完成させましょう。'}</p>
      </div>
    </div>

    <div className="qso-modes" role="tablist" aria-label="QSO モード">
      {QSO_MODES.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={item.id === mode.id}
          className={item.id === mode.id ? 'on' : ''}
          disabled={!item.available}
          onClick={() => setModeId(item.id)}
          title={item.description}
        >
          <b>{item.label}</b>
          <small>{item.available ? item.description : '準備中'}</small>
        </button>
      ))}
    </div>

    {mode.kind === 'single' && (
      <div className="qso-advice">
        <span className="chip gold">おすすめ {advice.stage}</span>
        <p>
          <b>{advice.title}</b> — {advice.reason}
          {advice.band && `（電波状況は「${BAND_PRESETS.find((item) => item.id === advice.band)?.label}」がおすすめ）`}
        </p>
      </div>
    )}

    <div className="qso-grid">
      <RigPanel rig={rig} onPower={onPower} />

      {mode.kind === 'wabun' ? (
        <WabunDesk
          key={mode.id}
          rig={rig}
          myCall={myCall}
          auto={progress.auto}
          adapt={progress.wabun}
          onAuto={(auto) => updateMode({ auto })}
          onSave={saveWabun}
        />
      ) : mode.kind === 'pileup' ? (
        <PileupDesk
          key={mode.id}
          rig={rig}
          myCall={myCall}
          myName={qso.myName ?? ''}
          myQth={qso.myQth ?? ''}
          axesFor={pileupAxesFor}
          stored={isPileupLevel(progress.level) ? progress.level : null}
          auto={progress.auto}
          onAuto={(auto) => updateMode({ auto })}
          onResetLevel={(level) => updateMode({ level, difficulty: { ...progress.difficulty, ...pileupLevel(level).axes }, votes: {} })}
          onSave={saveRun}
        />
      ) : mode.kind === 'contest' ? (
        <ContestDesk
          key={mode.id}
          rig={rig}
          myCall={myCall}
          myName={qso.myName ?? ''}
          myQth={qso.myQth ?? ''}
          axesFor={contestAxesFor}
          stored={isContestLevel(progress.level) ? progress.level : null}
          auto={progress.auto}
          onAuto={(auto) => updateMode({ auto })}
          onResetLevel={(level) => updateMode({ level, difficulty: { ...progress.difficulty, ...contestLevel(level).axes }, votes: {} })}
          onSave={saveContest}
        />
      ) : mode.kind === 'run' ? (
        <CqRunDesk
          key={mode.id}
          rig={rig}
          mode={mode}
          preset={preset}
          difficulty={difficulty}
          myCall={myCall}
          myName={qso.myName ?? ''}
          myQth={qso.myQth ?? ''}
          onProfile={(change) => updateQso((old) => ({ ...old, ...change }))}
          onSave={saveRun}
        />
      ) : mode.kind === 'demo' ? (
        <DemoDesk key={mode.id} rig={rig} myCall={myCall} />
      ) : (
      <div className="qso-side">
        <div className="panel panel-pad qso-status">
          <ol className="qso-steps">
            {(mode.kind === 'single' ? mode.steps : []).map((item, index) => (
              <li key={item.id} className={index < step || review ? 'done' : index === step ? 'current' : ''}>
                <b>{index + 1}</b>{item.label}
              </li>
            ))}
          </ol>
          <p className="qso-hint" role="status">{hint}</p>
        </div>

        <div className="panel panel-pad qso-tx">
          <div className="qso-panel-head"><h2>送信</h2><small>{difficulty.speed} WPM</small></div>
          <form onSubmit={(event) => { event.preventDefault(); void transmit(txText); }} className="qso-tx-row">
            <input
              value={txText}
              onChange={(event) => setTxText(event.target.value.toUpperCase())}
              placeholder={`例: ${myCall} ${myCall} K`}
              aria-label="送信する文"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn btn-primary" disabled={txOn || !txText.trim()}>{txOn ? '送信中' : '送信'}</button>
          </form>
          <div className="qso-macros">
            {macros.map(([label, text]) => (
              <button key={label} type="button" className="btn btn-ghost btn-sm" onClick={() => setTxText(text)} title={text}>{label}</button>
            ))}
          </div>
          {sent.length > 0 && <ul className="qso-sent">{sent.map((line, index) => <li key={index}>{line}</li>)}</ul>}
        </div>

        <div className="panel panel-pad qso-log">
          <div className="qso-panel-head">
            <h2>ログ</h2>
            <small>{review ? `${review.fields.filter((field) => field.correct).length} / ${review.fields.length}` : '聴き取った内容を記入'}</small>
          </div>
          <div className="qso-log-grid">
            {preset.fields.map((field) => {
              const result = fieldResult(field.key);
              return (
                <label key={field.key} className={result ? (result.correct ? 'ok' : 'ng') : ''}>
                  <span>{field.label}</span>
                  <input
                    value={log[field.key] ?? ''}
                    onChange={(event) => updateLog(field.key, event.target.value.toUpperCase())}
                    readOnly={Boolean(review)}
                    autoCapitalize="characters"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {result && !result.correct && <small>{result.expected}</small>}
                </label>
              );
            })}
          </div>
          {review ? (
            <button type="button" className="btn btn-success btn-block" onClick={() => newStation()}>次の局を探す</button>
          ) : (
            <div className="qso-log-actions">
              <button type="button" className="btn btn-primary" onClick={submitLog} disabled={!canLog}>ログ確定</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => newStation()}>別の局にする</button>
            </div>
          )}
        </div>
      </div>
      )}
    </div>

    {review && mode.kind === 'single' && <QsoReview review={review} />}

    <div className="qso-bottom">
      <div className="panel panel-pad qso-settings">
        {mode.kind === 'wabun' ? (
          <>
            <div className="qso-panel-head"><h2>設定</h2></div>
            <p className="qso-note">和文 QSO はデスクのレベル（Lv1 打ち逃げ・Lv2 ラバースタンプ・Lv3 天気・設備・Lv4 近況ひとこと・Lv5 実用ラグチュー）と「速さ」で選びます（次の局から反映。QRS で相手を遅くできます）。結果で自動調整はデスクで切り替えます（オンのとき相手の速さ・話の量・電波・周波数のずれ・Lv5 の手打ちのクセを結果に合わせて少しずつ調整。手順の結果では変えません）。オフのときのバンドは弱い QSB・QRN と少しの欧文の混信がある程度に固定です。交信の詳しい記録はこの端末だけに保存します（最大 50 件）。</p>
          </>
        ) : mode.kind === 'pileup' ? (
          <>
            <div className="qso-panel-head"><h2>設定</h2></div>
            <p className="qso-note">パイルアップの難しさは、デスクのレベル（入門〜DX級）で選びます。結果で自動調整は、ミスの原因に関係する軸（速さ・呼ぶ局数・似たコール・弱信号・集中度）だけを動かします。</p>
          </>
        ) : mode.kind === 'contest' ? (
          <>
            <div className="qso-panel-head"><h2>設定</h2></div>
            <p className="qso-note">コンテストの難しさは、デスクのレベル（入門〜エキスパート）で選びます。結果で自動調整は、ミスの原因に関係する軸（速さ・呼ぶ局の多さ・似たコール・弱信号・番号の難しさ）だけを動かします。各レベルの値は暫定です。</p>
          </>
        ) : mode.kind === 'demo' ? (
          <>
            <div className="qso-panel-head"><h2>チュートリアル</h2></div>
            <p className="qso-note">採点はありません。滝で CQ を探し、±150 Hz 以内に同調してから、案内の送信ボタンを押します。ずれていると相手は応答しません。</p>
          </>
        ) : <>
        <div className="qso-panel-head">
          <h2>難易度</h2>
        </div>
        <div className="qso-band-presets" role="group" aria-label="電波状況">
          <span>電波状況</span>
          {BAND_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`btn btn-sm ${bandPreset === preset.id ? 'btn-primary' : 'btn-ghost'}`}
              aria-pressed={bandPreset === preset.id}
              onClick={() => applyBand(preset.id)}
            >
              {preset.label}{mode.kind === 'single' && advice.band === preset.id ? '（おすすめ）' : ''}
            </button>
          ))}
          {!bandPreset && <small>カスタム</small>}
        </div>
        <p className="qso-note">押すと速さ以外の電波状況をまとめてその値にします（<Icon name="lock" size={12} /> で固定した軸も変わります）。</p>
        <label className="qso-auto">
          <input type="checkbox" checked={progress.auto} onChange={(event) => updateMode({ auto: event.target.checked })} />
          結果で自動調整
        </label>
        <p className="qso-note">
          交信が終わるたびに、落とした文字の原因に合わせて少しずつ動かします（きれいな条件で落とした→速さ、混信の中で落とした→混信局 など）。チェックしただけでは何も変わりません。
          <Icon name="lock" size={12} /> で固定した軸は動かしません。
        </p>
        <div className="qso-axes">
          {mode.axes.map((axis) => {
            const spec = AXIS_SPECS[axis];
            const value = difficulty[axis];
            const pinned = progress.pinned.includes(axis);
            return (
              <div key={axis} className={`qso-axis ${pinned ? 'pinned' : ''}`}>
                <label>
                  <span title={spec.hint}>{spec.label}</span>
                  <b>{spec.unit ? `${value} ${spec.unit}` : Math.round(value * 100)}</b>
                  <input
                    type="range"
                    min={axis === 'speed' ? MIN_TARGET_WPM : spec.min}
                    max={spec.max}
                    step={spec.step}
                    value={value}
                    onChange={(event) => setAxis(axis, Number(event.target.value))}
                  />
                </label>
                <button type="button" className={pinned ? 'on' : ''} onClick={() => togglePin(axis)} aria-pressed={pinned} aria-label={`${spec.label}を${pinned ? '固定解除' : '固定'}`} title={pinned ? '固定を外す' : 'この値で固定'}>
                  <Icon name="lock" size={14} />
                </button>
              </div>
            );
          })}
        </div>
        </>}
        <div className="qso-rig-prefs">
          <label className="qso-mycall">
            <span>自分のコールサイン</span>
            <input value={myCall} onChange={(event) => updateQso((old) => ({ ...old, myCall: event.target.value.toUpperCase().replace(/[^A-Z0-9/]/g, '') }))} maxLength={10} autoCapitalize="characters" spellCheck={false} />
          </label>
          <label className="qso-mycall">
            <span>自分の名前（交換用）</span>
            <input value={qso.myName ?? ''} onChange={(event) => updateQso((old) => ({ ...old, myName: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))} maxLength={10} placeholder="MASA" autoCapitalize="characters" spellCheck={false} />
          </label>
          <label className="qso-mycall">
            <span>自分の QTH（交換用）</span>
            <input value={qso.myQth ?? ''} onChange={(event) => updateQso((old) => ({ ...old, myQth: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') }))} maxLength={12} placeholder="TOKYO" autoCapitalize="characters" spellCheck={false} />
          </label>
          <label>AF 音量 <b>{Math.round(prefs.af * 100)}</b><input type="range" min={0} max={1} step={0.01} value={prefs.af} onChange={(event) => setPrefs({ ...prefs, af: Number(event.target.value) })} /></label>
        </div>
        {mode.kind !== 'pileup' && mode.kind !== 'contest' && mode.kind !== 'wabun' && <p className="qso-note">速さ・弱信号・ドリフトは次の局から反映されます（QRS で相手を遅くできます）。ピッチは全体の設定に従います。</p>}
      </div>

      <div className="panel panel-pad qso-logbook">
        <div className="qso-panel-head"><h2>交信記録</h2><small>{progress.qsos} QSO</small></div>
        {logbook.length ? (
          <ol>
            {logbook.map((entry) => (
              <li key={entry.id}>
                <time>{new Date(entry.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                <b>{entry.call}</b>
                <span className={entry.fieldsCorrect === entry.fields ? 'perfect' : ''}>{entry.fieldsCorrect}/{entry.fields}</span>
              </li>
            ))}
          </ol>
        ) : <p className="qso-note">まだ交信がありません。最初の 1 局を探しましょう。</p>}
      </div>

      {mode.kind !== 'demo' && <SkillPanel qso={qso} modeId={mode.id} />}
    </div>

    <p className="qso-help">
      <kbd>クリック</kbd> 局に同調　<kbd>ドラッグ</kbd>・<kbd>ホイール</kbd> VFO（<kbd>Shift</kbd> で細かく）　<kbd>←</kbd><kbd>→</kbd> 10 Hz。
      スコープはフィルタを通す前のバンド全体です。FIL を狭めると隣の局とノイズが実際に消えます。
    </p>
  </section>;
}

const SKILL_SITUATION: Record<string, string> = {
  weak: '弱信号', qsb: 'QSB', qrn: 'QRN', qrm: 'QRM', overlap: '重なり', detuned: '同調ずれ', doubled: 'ダブり', unheard: '未受信',
};
const skillPct = (estimate: SkillEstimate | undefined) => (estimate ? `${Math.round(estimate.value * 100)}%` : '—');

/**
 * QSO skills as estimated so far. Normal-condition numbers are the skill itself; the
 * rest show how it holds up (QRM, QSB, overlaps, doublings …) and are never mixed into it.
 */
function SkillPanel({ qso, modeId }: { qso: QsoProfile; modeId: string }) {
  const { copy, robustness, procedure, tuning, callsign } = qso.skills;
  const international = copy.international;
  const hard = (situations: Partial<Record<string, SkillEstimate>> | undefined) => Object.entries(situations ?? {})
    .filter(([, estimate]) => estimate && estimate.n > 0)
    .map(([situation, estimate]) => `${SKILL_SITUATION[situation] ?? situation} ${skillPct(estimate)}`).join('・');
  const rows: [string, string, string][] = [
    ['通常条件の受信', skillPct(international), international ? `${international.wpm} WPM` : ''],
    ['悪条件での受信', hard(robustness) || '—', ''],
    ['コール（通常条件）', skillPct(callsign?.log.clean), callsign?.log.clean ? `${callsign.log.clean.n} 局` : ''],
    ['コール（悪条件・重なり・ダブり）', hard(callsign?.log.situations) || '—', ''],
    ['初回コール（通常条件）', skillPct(callsign?.first.clean), callsign?.first.clean ? `${callsign.first.clean.n} 局` : ''],
    ['初回コール（悪条件・重なり・ダブり）', hard(callsign?.first.situations) || '—', ''],
    ['手順', skillPct(procedure[modeId]), ''],
    ['同調', skillPct(tuning), ''],
  ];
  return (
    <div className="panel panel-pad qso-skills">
      <div className="qso-panel-head"><h2>QSO スキル</h2><small>推定値</small></div>
      <dl>
        {rows.map(([label, value, note]) => (
          <div key={label}><dt>{label}</dt><dd>{value}{note && <small> {note}</small>}</dd></div>
        ))}
      </dl>
      <p className="qso-note">「通常条件」だけがスキルの本体です。QRM・QSB・ダブりなどで落としたものは別に数え、苦手分析にも混ぜません。</p>
    </div>
  );
}

/** Post-QSO review: which characters were missed, and why. */
function QsoReview({ review }: { review: Review }) {
  const { fields, evidence, moved, auto, received, earned, marked, assist } = review;
  const decodeLine = decodeNote(assist);
  const causes = (Object.keys(CAUSE_LABEL) as (keyof typeof CAUSE_LABEL)[]).filter((cause) => (evidence.causes[cause] ?? 0) > 0);
  const moves = (Object.entries(moved) as [Axis, number][]).map(([axis, delta]) => describeMove(axis, delta));
  const clean = evidence.clean.total ? Math.round((evidence.clean.correct / evidence.clean.total) * 100) : null;
  return (
    <div className="panel panel-pad qso-review">
      <div className="qso-panel-head">
        <h2>振り返り</h2>
        <small>{clean !== null ? `通常条件での受信 ${clean}%` : '通常条件の文字はありませんでした'}</small>
      </div>
      <div className="qso-review-causes">
        {causes.length ? causes.map((cause) => (
          <span key={cause} className={`chip cause-${cause}`}>{CAUSE_LABEL[cause]} {evidence.causes[cause]}</span>
        )) : <span className="chip mint">ノーミス</span>}
      </div>
      {(earned.length > 0 || marked.length > 0) && (
        <div className="qso-review-earned" role="status">
          {earned.map(({ id, tier }) => (
            <span key={id} className={`qso-badge-chip tier-${tier}`}><Icon name="trophy" size={14} />{badgeById(id)?.title} {TIER_LABEL[tier]}</span>
          ))}
          {marked.length > 0 && <span className="qso-badge-chip mark"><Icon name="bolt" size={14} />実戦マーク {marked.join(' ')}</span>}
        </div>
      )}
      <div className="qso-review-fields">
        {fields.map((field) => (
          <div key={field.key} className="qso-review-row">
            <span>{field.label}</span>
            <FieldCells field={field} />
          </div>
        ))}
      </div>
      <p className="qso-note">
        {!auto ? '結果で自動調整はオフです。'
          : moves.length ? `次の局から: ${moves.join('、')}`
            : '難易度はそのまま（もう少し様子を見ます）。'}
        {' '}悪条件で落とした文字は苦手分析に入りません（分析画面のスイッチで表示できます）。
      </p>
      {decodeLine && <p className="qso-note decode-note">{decodeLine}</p>}
      <details className="qso-reveal">
        <summary>相手局が送った電文</summary>
        <ul>{received.map((line, index) => <li key={index}>{line}</li>)}</ul>
      </details>
    </div>
  );
}
