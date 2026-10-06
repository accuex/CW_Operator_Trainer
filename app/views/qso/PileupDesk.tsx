'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { Station } from '@/lib/radio/band';
import type { EarnedBadge } from '@/lib/radio/badges';
import { AXIS_SPECS, type Axis } from '@/lib/radio/difficulty';
import { PILEUP_RST } from '@/lib/radio/exchange';
import { pileupLevel, pileupParamsOf, PILEUP_LEVELS, type PileupAxes, type PileupLevelId } from '@/lib/radio/modes/pileupLevels';
import { PileupSession, type PileupResult } from '@/lib/radio/modes/pileupRun';
import type { RadioPort, RunLogEntry } from '@/lib/radio/modes/runCore';
import { COACH_TEXT, FRESH_COACH, idleTip, tipAfterSend, type CoachLevel, type CoachMemory } from '@/lib/radio/pileup/coach';
import {
  afterSend, fieldsAfter, keyAction, nextAction, phaseLine, PILEUP_KEYS, sendAsTyped, START,
  type PickAction, type PickInput, type PickState,
} from '@/lib/radio/pileup/nextAction';
import { judgePileup, type PileupAnalysis } from '@/lib/radio/pileup/analysis';
import { PILEUP_ADAPT_AXES, pileupContacts, pileupOutcome, pileupSummary, votePileupAxes } from '@/lib/radio/pileup/learning';
import { callerSnaps, StepRecorder, type DeskStep } from '@/lib/radio/pileup/review';
import type { RigEngine } from '@/lib/radio/rig';
import { isPileupTrace, RUN_TRACE_LIMIT, RUN_TRACE_VERSION, runTraceLine, type PileupTrace } from '@/lib/radio/runTrace';
import { traceRx } from '@/lib/radio/trace';
import { pileupAnswers, pileupTraceDetail, PILEUP_MODE_ID as MODE_ID } from '@/lib/radio/pileup/save';
import { addRunTrace, getRunTraces } from '@/lib/storage';
import { nowId } from '@/app/trainer/shared';
import { PileupReview } from './PileupReview';
import type { RunRecord, RunSaved } from './RunDesk';
import type { Capture, Rig } from './useRig';

/**
 * The pileup operating desk. One field takes what we hear — a piece or a whole call —
 * and Enter sends the natural next message for it (nextAction): "3AB AGN?", "JA3ABC 5NN",
 * "TU JS2WDR". While the run is on the desk shows only our own side: what we typed and
 * sent, the path of pieces, and what Enter will send. Who was really calling comes out in
 * the review after QRT.
 */

const LOOP_MS = 100;
const PREFS_KEY = 'cwt-pileup-desk';
const EMPTY: PickInput = { call: '', rst: '' };
const WPM_RANGE = [10, 40] as const;

/** The pileup band (as the simulator's PILEUP_BAND): a little noise, no QSB/QRN. */
export const PILEUP_RIG_LEVELS = { noise: 0.2, qrn: 0, qsb: 0 } as const;

const LEVEL_NOTE: Record<PileupLevelId, string> = {
  intro: 'ゆっくり・2 局ほど。まずは 1 局ずつ確実に',
  beginner: '3 局ほど。ピッチの違いで聞き分ける練習',
  intermediate: '5 局ほどが重なります。聞こえた文字で partial を',
  advanced: '10 局ほど。partial で 1 局を浮かせるのが近道',
  dx: '全部は取れません。断片で 1 局ずつ浮かせる練習',
};

interface DeskPrefs {
  level: PileupLevelId;
  /** Coach line on/off; null = the level's default (入門・初級 on). */
  coach: boolean | null;
}

const readPrefs = (): DeskPrefs => {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<DeskPrefs>;
    return {
      level: PILEUP_LEVELS.some((level) => level.id === raw.level) ? (raw.level as PileupLevelId) : 'intro',
      coach: typeof raw.coach === 'boolean' ? raw.coach : null,
    };
  } catch {
    return { level: 'intro', coach: null };
  }
};

const writePrefs = (prefs: DeskPrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* private mode: this visit only */ }
};

const coachLevel = (level: PileupLevelId, on: boolean | null): CoachLevel => {
  const enabled = on ?? (level === 'intro' || level === 'beginner');
  if (!enabled) return 'off';
  return level === 'intro' ? 'always' : 'once';
};

interface Live {
  id: string;
  run: PileupSession;
  level: PileupLevelId;
  /** The axes this run was set up from (the level, as おまかせ has moved it). */
  axes: PileupAxes;
  capture: Capture;
  epoch: number;
  lastNow: number;
  startedAt: number | null;
  /** Pressed while we were still on the air: goes out once we are clear. `prev`: the desk before it, for Esc. */
  queued: { action: PickAction; prev: PickState; prevFields: PickInput } | null;
  /** Handed to the rig, span not fixed yet. */
  keying: boolean;
  closed: boolean;
  /** Our messages with the frequency around them and every caller's message, for the review only. */
  record: StepRecorder;
  coach: CoachMemory;
  /** The idle tip has been given since our last message. */
  idleShown: boolean;
}

export interface PileupReviewData {
  result: PileupResult;
  steps: DeskStep[];
  level: PileupLevelId;
  wpm: number;
  /** The causes as judged at QRT (absent for a run with nothing to judge). */
  analysis?: Pick<PileupAnalysis, 'summary' | 'copy' | 'logging' | 'mistakes'>;
  /** What saving it did (おまかせ moves, badges); null when there was nothing to save. */
  saved?: RunSaved | null;
  /** Reopened from this device's records. */
  stored?: { at: number };
}

function sync(live: Live, engine: RigEngine) {
  const now = engine.now();
  if (engine.epoch !== live.epoch) {
    live.run.rebase(engine.epoch, now - live.lastNow);
    live.epoch = engine.epoch;
  }
  live.lastNow = now;
  return now;
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export interface PileupDeskProps {
  rig: Rig;
  myCall: string;
  myName: string;
  myQth: string;
  /** Where a level starts: as おまかせ left it, or the level's own axes. */
  axesFor: (level: PileupLevelId) => PileupAxes;
  /** The level おまかせ has been moving (null: none yet). */
  stored: PileupLevelId | null;
  auto: boolean;
  onAuto: (auto: boolean) => void;
  /** Back to the level's own axes. */
  onResetLevel: (level: PileupLevelId) => void;
  onSave: (record: RunRecord) => RunSaved;
}

export function PileupDesk({ rig, myCall, myName, myQth, axesFor, stored, auto, onAuto, onResetLevel, onSave }: PileupDeskProps) {
  const { engineRef, tapRef, txOn, powered } = rig;
  const [prefs, setPrefsState] = useState<DeskPrefs>(readPrefs);
  const [wpm, setWpm] = useState(() => axesFor(prefs.level).speed);
  const [pick, setPickState] = useState<PickState>(START);
  const [fields, setFieldsState] = useState<PickInput>(EMPTY);
  /** What waits to go out, and the desk it was pressed on (mirrors live.queued for rendering). */
  const [queued, setQueued] = useState<{ text: string; prev: PickState } | null>(null);
  const [rows, setRows] = useState<RunLogEntry[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const [message, setMessage] = useState<{ text: string; coach: boolean } | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(0);
  const [more, setMore] = useState(false);
  const [review, setReview] = useState<PileupReviewData | null>(null);
  const [records, setRecords] = useState<PileupTrace[]>([]);
  const [recordsAt, setRecordsAt] = useState(0);
  const [viewing, setViewing] = useState<PileupTrace | null>(null);

  const liveRef = useRef<Live | null>(null);
  const pickRef = useRef(pick);
  const fieldsRef = useRef(fields);
  const callRef = useRef<HTMLInputElement>(null);
  const rstRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ prefs, wpm, myCall, myName, myQth, review, axesFor });
  useEffect(() => {
    latest.current = { prefs, wpm, myCall, myName, myQth, review, axesFor };
  });
  useEffect(() => {
    let alive = true;
    getRunTraces().then((traces) => { if (alive) setRecords(traces.filter((trace) => trace.modeId === MODE_ID && isPileupTrace(trace)) as PileupTrace[]); }).catch(() => undefined);
    return () => { alive = false; };
  }, [recordsAt]);
  const handlers = useRef<{
    key: (index: number) => void; escape: () => void; wpm: (step: number) => void; type: (char: string) => void;
    keyIt: (live: Live, engine: RigEngine, action: PickAction, base: PickState) => void;
  } | null>(null);

  const setPick = (next: PickState) => {
    pickRef.current = next;
    setPickState(next);
  };
  const setFields = (next: PickInput) => {
    fieldsRef.current = next;
    setFieldsState(next);
  };
  const setPrefs = (change: Partial<DeskPrefs>) => {
    const next = { ...prefs, ...change };
    setPrefsState(next);
    writePrefs(next);
  };
  const say = (text: string, coach = false) => setMessage({ text, coach });

  const newLive = (engine: RigEngine, level: PileupLevelId, given?: PileupAxes): Live => {
    const { myCall: call, myName: name, myQth: qth } = latest.current;
    const radio: RadioPort = {
      now: () => engine.now(),
      send: (station, text, delay) => engine.send(station, text, delay),
      stationsChanged: (stations) => engine.setStations(stations),
    };
    const axes = given ?? latest.current.axesFor(level);
    const run = new PileupSession({ random: Math.random, me: { call, name, qth }, params: pileupParamsOf(axes) }, radio);
    const live: Live = {
      id: nowId(), run, level, axes, capture: rig.newCapture(), epoch: engine.epoch, lastNow: engine.now(), startedAt: null, queued: null, keying: false,
      closed: false, record: new StepRecorder(), coach: FRESH_COACH, idleShown: false,
    };
    run.rebase(engine.epoch, 0);
    engine.setStations([]);
    return live;
  };

  // One run per mount (and per 新しいラン); the rig taps every station message into its air.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    liveRef.current = newLive(engine, latest.current.prefs.level);
    tapRef.current = (station: Station, tx, epoch) => {
      const live = liveRef.current;
      if (!live || live.closed) return;
      live.run.onStationTransmission(station, tx, epoch);
      // For the review: who keyed right after our last message, and every message (doublings).
      const agent = live.run.agents.find((item) => item.id === station.id);
      if (agent) live.record.heard(agent, tx);
    };
    return () => {
      tapRef.current = null;
      if (liveRef.current) liveRef.current.closed = true;
      liveRef.current = null;
      engine.setStations([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per mount; 新しいラン replaces it
  }, [engineRef, tapRef]);

  /** Key the action on the air; the run hears it the moment its span is fixed. */
  const keyIt = (live: Live, engine: RigEngine, action: PickAction, base: PickState) => {
    live.keying = true;
    live.idleShown = false;
    setSent((list) => [...list.slice(-40), action.text]);
    void rig.transmit(action.text, latest.current.wpm, (span) => {
      live.keying = false;
      if (live.closed) return;
      sync(live, engine);
      live.run.transmit(action.text, { start: span.start, end: span.end, rf: engine.vfo });
      if (action.log) {
        live.run.logEntry({ ...action.log, name: '', qth: '' }, span.start);
        setRows([...live.run.log]);
      }
      live.record.sent({
        at: span.start, end: span.end, text: action.text, kind: action.kind, subject: action.subject, working: base.sentCall,
        callers: callerSnaps(live.run.agents, engine.vfo),
      });
      if (live.startedAt === null) {
        live.startedAt = Date.now();
        setStartedAt(live.startedAt);
      }
    }).finally(() => { live.keying = false; });
  };

  /**
   * Send what `compute` makes of the desk: Enter, Ctrl+Enter or a memory key. Pressed while
   * we are still on the air, it waits (and replaces anything already waiting).
   */
  const press = (compute: (state: PickState, input: PickInput) => PickAction, emptyHint: string) => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live || live.closed || latest.current.review) return;
    if (!engine.powered) { say('先に電源（POWER）を入れてください'); return; }
    const base = live.queued?.prev ?? pickRef.current;
    const input = live.queued?.prevFields ?? fieldsRef.current;
    const action = compute(base, fieldsRef.current);
    if (action.kind === 'none') { say(emptyHint); return; }
    const next = afterSend(base, action);
    const tip = tipAfterSend(coachLevel(live.level, latest.current.prefs.coach), live.coach, action, next);
    live.coach = tip.memory;
    setMessage(tip.tip ? { text: COACH_TEXT[tip.tip], coach: true } : null);
    setPick(next);
    const after = fieldsAfter(fieldsRef.current, action);
    setFields(after);
    // Fields cleared (TU, QRZ?, CQ): the next thing typed is the next call.
    if (!after.call && !after.rst) callRef.current?.focus();
    const now = sync(live, engine);
    if (live.keying || live.run.keying(now) || live.run.keyedUntil > now) {
      live.queued = { action, prev: base, prevFields: input };
      setQueued({ text: action.text, prev: base });
      return;
    }
    live.queued = null;
    setQueued(null);
    keyIt(live, engine, action, base);
  };

  const enter = () => press((state, input) => nextAction(state, input, latest.current.myCall), '');
  const asTyped = () => press((_, input) => sendAsTyped(input), 'Ctrl+Enter は CALL 欄の内容をそのまま送ります。先に入力してください');
  const memoryKey = (index: number) => press(
    (state, input) => keyAction(index, state, input, latest.current.myCall),
    index === 1 || index === 4 || index === 5 ? 'CALL 欄に聞こえたコールか断片を入れてから送ります' : 'このキーは今は送るものがありません',
  );

  /** Esc: take back what is waiting to go out; with nothing waiting, clear the fields. */
  const escape = () => {
    const live = liveRef.current;
    if (live?.queued) {
      setPick(live.queued.prev);
      setFields(live.queued.prevFields);
      live.queued = null;
      setQueued(null);
      say('予約を取り消しました');
      return;
    }
    setFields(EMPTY);
    callRef.current?.focus();
  };

  // The run's clock: the air, the queued message, the idle tip, the elapsed time.
  useEffect(() => {
    let lastSecond = 0;
    const timer = setInterval(() => {
      const engine = engineRef.current;
      const live = liveRef.current;
      if (!engine || !live || live.closed) return;
      const now = sync(live, engine);
      live.run.tick(now);
      live.run.drainNotes(); // the desk coaches from our own actions only
      const clear = !live.keying && !live.run.keying(now) && live.run.keyedUntil <= now;
      if (clear && live.queued && engine.powered) {
        const { action, prev } = live.queued;
        live.queued = null;
        setQueued(null);
        handlers.current?.keyIt(live, engine, action, prev);
      }
      if (clear && !live.idleShown && live.startedAt !== null) {
        const typed = !!(fieldsRef.current.call.trim() || fieldsRef.current.rst.trim());
        const tip = idleTip(coachLevel(live.level, latest.current.prefs.coach), live.coach, pickRef.current, typed, now - live.run.keyedUntil);
        if (tip.tip) {
          live.coach = tip.memory;
          live.idleShown = true;
          setMessage({ text: COACH_TEXT[tip.tip], coach: true });
        }
      }
      const second = Math.floor(Date.now() / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        setClock(Date.now());
      }
    }, LOOP_MS);
    return () => clearInterval(timer);
  }, [engineRef]);

  const qrt = () => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live || live.closed) return;
    const now = sync(live, engine);
    live.closed = true;
    live.queued = null;
    setQueued(null);
    const result = live.run.finish(now);
    const steps = live.record.finish();
    const recordsOf = (stationId: number) => live.capture.rx.filter((record) => record.station === stationId);
    const clock = { t: now, epoch: engine.epoch };
    const { score, analysis } = judgePileup({ result, steps, recordsOf, monitor: live.capture.monitor, now: clock });
    const endedAt = Date.now();
    const wpmOf = (stationId: number) => live.run.agents.find((agent) => agent.id === stationId)?.station.wpm ?? live.axes.speed;
    const wpms = Object.fromEntries(result.contacts.map((contact) => [contact.stationId, wpmOf(contact.stationId)]));
    let saved: RunSaved | null = null;
    if (live.startedAt !== null && (result.contacts.length || result.log.length)) {
      const difficulty = { ...live.axes };
      const summary = pileupSummary({
        result, score, analysis, level: live.level, modeId: MODE_ID, presetId: PILEUP_RST.id, fieldCount: PILEUP_RST.fields.length, difficulty,
        wallClock: (t) => endedAt - (now - t) * 1000,
      });
      const answers = pileupAnswers(result, score, analysis, { sessionId: live.id, timestamp: endedAt, wpmOf });
      saved = onSave({
        id: live.id, startedAt: live.startedAt, endedAt, alphabet: PILEUP_RST.alphabet, summary, answers, evidence: analysis.evidence, wpm: live.axes.speed,
        run: {
          contacts: pileupContacts(result, score, analysis, wpmOf), seconds: result.stats.seconds, frequencyChecks: 0, busyAvoided: 0,
          cleanContacts: 0, cleanRate: analysis.summary.cleanRate, pileup: pileupOutcome(result, score, analysis),
        },
        pileup: { level: live.level, axes: live.axes, votes: votePileupAxes(analysis), analysis },
      });
      // The detailed record (the frequency around each of our messages, every character's conditions) stays on this device.
      const rx: PileupTrace['rx'] = {};
      for (const agent of live.run.agents) {
        const heard = recordsOf(agent.id);
        if (heard.length) rx[agent.id] = traceRx(heard, live.capture.monitor, clock, (record) => live.capture.rxWpm.get(record) ?? agent.station.wpm);
      }
      void addRunTrace({
        kind: 'run', version: RUN_TRACE_VERSION, id: live.id, startedAt: live.startedAt, endedAt, modeId: MODE_ID, presetId: PILEUP_RST.id,
        difficulty, params: { ...live.run.params }, result, scored: score.contacts, evidence: analysis.evidence,
        rx, tx: [], filter: engine.filter, wpmOf: wpms, adjusted: saved.moved, earned: saved.earned,
        pileup: pileupTraceDetail(live.level, wpm, steps, analysis),
      } satisfies PileupTrace).then(() => setRecordsAt(Date.now())).catch(() => undefined);
    }
    engine.setStations([]);
    setReview({ result, steps, level: live.level, wpm, analysis, saved });
    setMessage(null);
  };

  const restart = (level = prefs.level, axes?: PileupAxes) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (liveRef.current) liveRef.current.closed = true;
    liveRef.current = newLive(engine, level, axes);
    setPick(START);
    setFields(EMPTY);
    setQueued(null);
    setRows([]);
    setSent([]);
    setStartedAt(null);
    setReview(null);
    setMessage(null);
  };

  const chooseLevel = (level: PileupLevelId) => {
    setPrefs({ level });
    setWpm(axesFor(level).speed);
    restart(level);
  };

  const changeWpm = (step: number) => setWpm((old) => Math.min(WPM_RANGE[1], Math.max(WPM_RANGE[0], old + step)));

  /** A letter typed outside the fields goes into CALL. */
  const typeChar = (char: string) => {
    setFields({ ...fieldsRef.current, call: (fieldsRef.current.call + char).toUpperCase() });
    callRef.current?.focus();
  };

  useEffect(() => {
    handlers.current = { key: memoryKey, escape, wpm: changeWpm, type: typeChar, keyIt };
  });

  // Logger keys: F1–F10 (and Ctrl+1–9/0 where F keys are media keys), Esc, PgUp/PgDn.
  // Alt+←/→ are kept free for RIT.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (latest.current.review) return;
      const fkey = /^F(\d{1,2})$/.exec(event.key);
      const ctrlDigit = (event.ctrlKey || event.metaKey) && /^[0-9]$/.test(event.key) ? (event.key === '0' ? 10 : Number(event.key)) : null;
      const index = fkey ? Number(fkey[1]) : ctrlDigit;
      if (index && index >= 1 && index <= PILEUP_KEYS.length) {
        event.preventDefault();
        handlers.current?.key(index - 1);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handlers.current?.escape();
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        handlers.current?.wpm(event.key === 'PageUp' ? 2 : -2);
      } else if (!isTyping(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey && /^[a-zA-Z0-9/?]$/.test(event.key)) {
        event.preventDefault();
        handlers.current?.type(event.key);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onFieldKey = (event: ReactKeyboardEvent<HTMLInputElement>, field: keyof PickInput) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) asTyped();
      else enter();
    } else if (event.key === ' ') {
      event.preventDefault();
      (field === 'call' ? rstRef : callRef).current?.focus();
    }
  };
  const updateField = (field: keyof PickInput, value: string) => {
    const clean = value.toUpperCase().replace(field === 'call' ? /[^A-Z0-9/? ]/g : /[^A-Z0-9]/g, '');
    setFields({ ...fieldsRef.current, [field]: clean });
  };

  if (review) {
    return (
      <div className="qso-side run-review-wrap">
        <PileupReview review={review} auto={auto} onRestart={() => { setWpm(axesFor(prefs.level).speed); restart(); }} />
      </div>
    );
  }

  if (viewing) {
    const detail = viewing.pileup;
    const stored: PileupReviewData = {
      result: viewing.result, steps: detail.steps, level: detail.level as PileupLevelId, wpm: detail.wpm, analysis: detail.analysis,
      saved: { moved: viewing.adjusted, auto: true, earned: viewing.earned as EarnedBadge[], marked: [] },
      stored: { at: viewing.startedAt },
    };
    return (
      <div className="qso-side run-review-wrap">
        <PileupReview review={stored} auto onClose={() => setViewing(null)} />
      </div>
    );
  }

  const base = queued?.prev ?? pick;
  const preview = nextAction(base, fields, myCall);
  const elapsed = startedAt && clock ? Math.max(0, (clock - startedAt) / 1000) : 0;
  const rate = elapsed >= 60 ? Math.round((rows.length * 3600) / elapsed) : null;
  const level = pileupLevel(prefs.level);
  // How far おまかせ has moved this level (only the axes it adapts).
  const current = axesFor(prefs.level);
  const moves = stored === prefs.level
    ? PILEUP_ADAPT_AXES.filter((axis) => Math.abs(current[axis] - level.axes[axis]) > 1e-9).map((axis) => describeLevelMove(axis, current[axis], level.axes[axis]))
    : [];
  const coachOn = coachLevel(prefs.level, prefs.coach) !== 'off';
  const status = message ?? { text: powered ? phaseHint(pick) : 'POWER で電源を入れ、Enter で CQ を出して始めます', coach: false };
  const keyLabel = (index: number) => PILEUP_KEYS[index].label;
  const callOrQrz = pick.phase === 'start' ? 0 : 6;

  return (
    <div className="qso-side run-desk pileup-desk">
      <div className="panel panel-pad pileup-levels">
        <div className="qso-panel-head">
          <h2>レベル</h2>
          <small>{LEVEL_NOTE[prefs.level]}</small>
        </div>
        <div className="pileup-level-row" role="radiogroup" aria-label="レベル">
          {PILEUP_LEVELS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={item.id === prefs.level}
              className={`btn btn-sm ${item.id === prefs.level ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => chooseLevel(item.id)}
              disabled={startedAt !== null}
              title={LEVEL_NOTE[item.id]}
            >
              {item.label}
            </button>
          ))}
        </div>
        {startedAt !== null && <p className="qso-note">ラン中はレベルを変えられません。QRT して振り返りのあとに変えられます。</p>}
        <div className="run-control-row pileup-auto">
          <label className="qso-auto"><input type="checkbox" checked={auto} onChange={(event) => onAuto(event.target.checked)} />おまかせ調整</label>
          {moves.length > 0 && (
            <>
              <small>{level.label}から：{moves.join('・')}</small>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { onResetLevel(prefs.level); setWpm(level.axes.speed); restart(prefs.level, level.axes); }} disabled={startedAt !== null}>レベルの設定に戻す</button>
            </>
          )}
        </div>
      </div>

      <div className="panel panel-pad run-status pileup-status">
        <dl>
          <div><dt>経過</dt><dd>{formatSeconds(elapsed)}</dd></div>
          <div><dt>交信</dt><dd>{rows.length}</dd></div>
          <div><dt>レート</dt><dd>{rate ?? '—'}<small>/h</small></dd></div>
          <div><dt>自局</dt><dd>{wpm}<small> WPM</small></dd></div>
        </dl>
        <p className="pileup-phase" aria-live="polite">
          <b>{phaseLine(pick)}</b>
          {txOn && <span className="pileup-tx">送信中</span>}
          {queued && <span className="pileup-queued">予約: {queued.text}（Esc で取消）</span>}
        </p>
        {(!status.coach || coachOn) && <p className={`qso-hint ${status.coach ? 'pileup-coach' : ''}`} role="status">{status.text}</p>}
      </div>

      <div className="panel panel-pad pileup-pick">
        <div className="pileup-touch" aria-label="送信ボタン">
          <button type="button" className="btn btn-ghost" onClick={() => memoryKey(callOrQrz)}>{callOrQrz === 0 ? 'CQ' : 'QRZ?'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => memoryKey(7)}>AGN?</button>
          <button type="button" className="btn btn-primary pileup-touch-go" onClick={enter}>▶ {preview.text}</button>
          <button type="button" className="btn btn-ghost" onClick={() => memoryKey(2)}>TU・記入</button>
          <button type="button" className="btn btn-ghost" onClick={() => setMore(!more)} aria-expanded={more}>…</button>
        </div>
        {more && (
          <div className="pileup-touch-more">
            {[4, 5, 8, 9, 3].map((index) => (
              <button key={index} type="button" className="btn btn-ghost btn-sm" onClick={() => { memoryKey(index); setMore(false); }}>{keyLabel(index)}</button>
            ))}
          </div>
        )}

        {pick.path.length > 0 && (
          <ol className="pileup-path" aria-label="絞り込みの道筋">
            {pick.path.map((piece, index) => <li key={index}>{piece}</li>)}
          </ol>
        )}
        <form className="pileup-fields" onSubmit={(event) => { event.preventDefault(); enter(); }}>
          <label className="pileup-call">
            <span>CALL / 断片</span>
            <input
              ref={callRef}
              value={fields.call}
              onChange={(event) => updateField('call', event.target.value)}
              onKeyDown={(event) => onFieldKey(event, 'call')}
              placeholder="3AB / JA3ABC"
              aria-label="CALL または聞こえた断片"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="send"
              autoFocus
            />
          </label>
          <label className="pileup-rst">
            <span>受信 RST</span>
            <input
              ref={rstRef}
              value={fields.rst}
              onChange={(event) => updateField('rst', event.target.value)}
              onKeyDown={(event) => onFieldKey(event, 'rst')}
              aria-label="受信 RST"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="send"
              inputMode="text"
            />
          </label>
          <button type="button" className="btn btn-ghost btn-sm pileup-5nn" onClick={() => { setFields({ ...fieldsRef.current, rst: '5NN' }); rstRef.current?.focus(); }} title="受信 RST に 5NN を入れる（書き換えできます）">5NN</button>
        </form>
        <p className="pileup-preview" aria-live="polite"><kbd>Enter</kbd> → <b>{preview.text}</b>{preview.log && <small>（{preview.log.call} {preview.log.rst} を記入）</small>}</p>

        <div className="run-fkeys pileup-fkeys">
          {PILEUP_KEYS.map((key, index) => (
            <button key={key.key} type="button" className="btn btn-ghost btn-sm" onClick={() => memoryKey(index)} title={keyAction(index, base, fields, myCall).text || key.template}>
              <kbd>{key.key}</kbd>{key.label}
            </button>
          ))}
        </div>
        {sent.length > 0 && <ul className="qso-sent">{sent.slice(-6).map((line, index) => <li key={index}>{line}</li>)}</ul>}
      </div>

      <div className="panel panel-pad run-log">
        <div className="qso-panel-head"><h2>ログ</h2><small>TU で記入</small></div>
        {rows.length ? (
          <ol className="run-rows">
            {[...rows].reverse().slice(0, 8).map((entry) => (
              <li key={entry.id}><span className="pileup-row"><b>{entry.fields.call}</b><span>{entry.fields.rst}</span></span></li>
            ))}
          </ol>
        ) : <p className="qso-note">まだ記入がありません。</p>}
      </div>

      <div className="panel panel-pad run-controls">
        <div className="run-control-row">
          <label className="qso-auto"><input type="checkbox" checked={coachOn} onChange={(event) => setPrefs({ coach: event.target.checked })} />コーチ表示</label>
          <span className="run-interval">自局の速さ <b>{wpm} WPM</b><input type="range" min={WPM_RANGE[0]} max={WPM_RANGE[1]} step={1} value={wpm} onChange={(event) => setWpm(Number(event.target.value))} aria-label="自局の速さ" /></span>
        </div>
        <div className="run-control-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => restart()} disabled={startedAt === null}>やり直す</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={qrt} disabled={startedAt === null}>QRT（終了して振り返り）</button>
        </div>
        <p className="qso-note pileup-help">
          聞こえた文字を CALL 欄に入れて <kbd>Enter</kbd>。断片なら <b>3AB AGN?</b>、フルコールなら <b>JA3ABC 5NN</b>、相手のレポートを入れて <kbd>Enter</kbd> で <b>TU</b> と記入。
          文字を足しながら何度でも絞れます。<kbd>Space</kbd> CALL⇄RST　<kbd>Esc</kbd> 予約取消・入力を消す　<kbd>Ctrl</kbd>+<kbd>Enter</kbd> 入力どおりに送る（F6 は {'{PIECE}'} AGN?）
          <kbd>F1</kbd>–<kbd>F10</kbd>（または <kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>0</kbd>）メモリー　<kbd>PgUp</kbd>/<kbd>PgDn</kbd> 自局の速さ ±2。
          QRT で記録を保存し、おまかせ調整がオンなら原因に合う軸だけを少しずつ動かします（呼び出しの選局を代わりにすることはありません）。
        </p>
      </div>

      <details className="panel panel-pad run-records">
        <summary>この端末のパイルアップの記録 <small>{records.length} / {RUN_TRACE_LIMIT}</small></summary>
        <p className="qso-note">選局ごとの周波数の様子まで含む詳しい記録は、この端末だけに直近 {RUN_TRACE_LIMIT} ラン分（全モード合計）を残します（クラウドには要約だけを保存）。</p>
        {records.length ? (
          <ol>
            {records.map((trace) => {
              const line = runTraceLine(trace);
              return (
                <li key={trace.id}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewing(trace)} disabled={startedAt !== null}>
                    <time>{new Date(line.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                    <b>{line.contacts} 交信</b>
                    <span>{pileupLevel(trace.pileup.level as PileupLevelId)?.label ?? ''}・{line.rate}/h・{formatSeconds(line.seconds)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : <p className="qso-note">まだ記録がありません。QRT すると、ここに残ります。</p>}
      </details>
    </div>
  );
}

/** One axis as おまかせ has moved it from the level. */
function describeLevelMove(axis: Axis, now: number, from: number) {
  // The level's value and where おまかせ has it now, as the numbers stand (a step's word would hide how far it went).
  const spec = AXIS_SPECS[axis];
  const value = (x: number) => String(Math.round(x * 100) / 100);
  return `${spec.label} ${value(from)}→${value(now)}${spec.unit ? ` ${spec.unit}` : ''}`;
}

/** The status line when the coach has nothing to say: what Enter does now, from our own state. */
function phaseHint(state: PickState) {
  if (state.phase === 'start') return 'Enter で CQ を出して始めます';
  if (state.phase === 'working') return '相手のレポートを聴き、受信 RST を入れて Enter（聞き取れなければ空のまま Enter で AGN?）';
  return state.path.length ? '聞こえた文字を足して Enter。フルコールになったら Enter で 5NN を送ります' : '聞こえたコールか断片を入れて Enter。何も取れなければ空のまま Enter で QRZ?';
}

function formatSeconds(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
