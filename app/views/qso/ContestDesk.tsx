'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AnswerLog, QsoSessionSummary } from '@/lib/types';
import type { Station } from '@/lib/radio/band';
import {
  CONTEST_ALT_KEYS, CONTEST_KEYS, EMPTY_INPUT, ESM_START, esmAfter, esmEnter, esmExchange, esmFieldsAfter, esmKey, esmLogTu, esmPhaseLine, ourNr,
  type EsmAction, type EsmInput, type EsmLog, type EsmState,
} from '@/lib/radio/contest/esm';
import type { ContestAnalysis } from '@/lib/radio/contest/analysis';
import { judgeContest } from '@/lib/radio/contest/judge';
import { CONTEST_ADAPT_AXES, contestContacts } from '@/lib/radio/contest/learning';
import { contestLevel, contestParamsOf, CONTEST_LEVELS, type ContestAxes, type ContestLevelId } from '@/lib/radio/contest/levels';
import { deskLog, deskNumbers, dupeLineIds, isNewMult } from '@/lib/radio/contest/desk';
import type { ContestLogLine } from '@/lib/radio/contest/log';
import { type ContestReview as ContestReviewData, type DeskSent } from '@/lib/radio/contest/review';
import { SPRINT_RULES } from '@/lib/radio/contest/rules';
import { contestSave, reanalyse, reviewOf, storedResult } from '@/lib/radio/contest/save';
import type { RunOutcome, EarnedBadge } from '@/lib/radio/badges';
import { AXIS_SPECS, type Axis } from '@/lib/radio/difficulty';
import { ContestRunSession } from '@/lib/radio/modes/contestRun';
import type { RadioPort } from '@/lib/radio/modes/runCore';
import { shapeOf } from '@/lib/radio/pileup/nextAction';
import type { RigEngine } from '@/lib/radio/rig';
import { isContestTrace, RUN_TRACE_LIMIT, type ContestTrace } from '@/lib/radio/runTrace';
import { addRunTrace, getRunTraces } from '@/lib/storage';
import { nowId } from '@/app/trainer/shared';
import { ContestReview } from './ContestReview';
import type { RunSaved } from './RunDesk';
import type { Capture, Rig } from './useRig';

/**
 * The contest run desk: a logger, not a game screen. One entry line (CALL, RST, NR) and
 * Enter sends what comes next (the ESM): CQ TEST, "{CALL} 5NN {NR}", NR?, "TU {MYCALL}"
 * with the line logged. DUPE and NEW MULT come from our own log and what was typed; who
 * is really calling and what they really sent is never shown until QRT.
 *
 * Saved at QRT (or when the time runs out): the detailed record on this device, a summary
 * in the session record. A run left before QRT is not saved and not resumed (v1).
 */

const LOOP_MS = 100;
const PREFS_KEY = 'cwt-contest-desk';
const WPM_RANGE = [10, 40] as const;
const DURATIONS = [10, 30, 60, 0] as const;

/** The contest band (as the simulator's): a little noise, no QSB/QRN. */
export const CONTEST_RIG_LEVELS = { noise: 0.2, qrn: 0, qsb: 0 } as const;

const LEVEL_NOTE: Record<ContestLevelId, string> = {
  intro: 'ゆっくり・まばら。1 局ずつ確実にログへ',
  beginner: '少し速く。番号を聞き逃したら NR?',
  intermediate: '呼び合いが重なり始めます。テンポよく',
  advanced: '速く・多く。partial とカット数字に慣れる',
  expert: '本番の勢い。正確さを保ったままレートを上げる',
};

interface DeskPrefs { level: ContestLevelId; minutes: number }

const readPrefs = (): DeskPrefs => {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<DeskPrefs>;
    return {
      level: CONTEST_LEVELS.some((level) => level.id === raw.level) ? (raw.level as ContestLevelId) : 'intro',
      minutes: DURATIONS.includes(raw.minutes as (typeof DURATIONS)[number]) ? (raw.minutes as number) : 10,
    };
  } catch {
    return { level: 'intro', minutes: 10 };
  }
};

const writePrefs = (prefs: DeskPrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* private mode: this visit only */ }
};

interface Queued { action: EsmAction; prev: EsmState; prevFields: EsmInput }

interface Live {
  id: string;
  run: ContestRunSession;
  level: ContestLevelId;
  /** The axes this run was set up from (the level, as おまかせ has moved it). */
  axes: ContestAxes;
  /** What reached our receiver: each caller's messages and the band around them. */
  capture: Capture;
  epoch: number;
  lastNow: number;
  /** Wall clock of our first message. */
  startedAt: number | null;
  /** Wall clock as of the last tick of the desk's loop. */
  wall: number;
  /** Pressed while we were on the air: they go out in order once we are clear. */
  queue: Queued[];
  keying: boolean;
  closed: boolean;
  /** What went on the air, on the run's clock (the review counts it from the start). */
  sent: DeskSent[];
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

const RULES = SPRINT_RULES;

/** What QRT hands the view to keep: the session record, the answers and what the learning system reads. */
export interface ContestSaveRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  level: string;
  axes: ContestAxes;
  summary: QsoSessionSummary;
  answers: AnswerLog[];
  analysis: ContestAnalysis;
  review: ContestReviewData;
  /** Callers' speed (copy skill is kept per speed). */
  wpm: number;
  /** Per contact, for the shared counters (blamed fields left out). */
  contacts: RunOutcome['contacts'];
}

interface Shown { review: ContestReviewData; level: string; saved: RunSaved | null; analysis: ContestAnalysis | null }

export interface ContestDeskProps {
  rig: Rig;
  myCall: string;
  myName: string;
  myQth: string;
  /** Where a level starts: as おまかせ left it when that is the level last run, else the level's own axes. */
  axesFor: (level: ContestLevelId) => ContestAxes;
  /** The level おまかせ's numbers are kept for (the one last run). */
  stored: ContestLevelId | null;
  auto: boolean;
  onAuto: (auto: boolean) => void;
  onResetLevel: (level: ContestLevelId) => void;
  onSave: (record: ContestSaveRecord) => RunSaved;
}

export function ContestDesk({ rig, myCall, myName, myQth, axesFor, stored, auto, onAuto, onResetLevel, onSave }: ContestDeskProps) {
  const { engineRef, tapRef, txOn, powered } = rig;
  const [prefs, setPrefsState] = useState<DeskPrefs>(readPrefs);
  const [wpm, setWpm] = useState(() => axesFor(prefs.level).speed);
  const [pick, setPickState] = useState<EsmState>(ESM_START);
  const [fields, setFieldsState] = useState<EsmInput>(EMPTY_INPUT);
  const [queued, setQueued] = useState<string[]>([]);
  const [rows, setRows] = useState<ContestLogLine[]>([]);
  const [loggedAt, setLoggedAt] = useState<number[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(0);
  const [more, setMore] = useState(false);
  const [editing, setEditing] = useState<{ id: string; call: string; nr: string } | null>(null);
  const [result, setResult] = useState<Shown | null>(null);
  const [records, setRecords] = useState<ContestTrace[]>([]);
  const [recordsAt, setRecordsAt] = useState(0);
  const [viewing, setViewing] = useState<ContestTrace | null>(null);

  const liveRef = useRef<Live | null>(null);
  const pickRef = useRef(pick);
  const fieldsRef = useRef(fields);
  const callRef = useRef<HTMLInputElement>(null);
  const nrRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ prefs, wpm, myCall, myName, myQth, result, axesFor });
  useEffect(() => {
    latest.current = { prefs, wpm, myCall, myName, myQth, result, axesFor };
  });
  const handlers = useRef<{
    enter: () => void; exchange: () => void; logTu: () => void; key: (index: number) => void; escape: () => void; wipe: () => void;
    wpm: (step: number) => void; type: (char: string) => void; keyIt: (live: Live, engine: RigEngine, action: EsmAction) => void; qrt: () => void;
  } | null>(null);

  const setPick = (next: EsmState) => {
    pickRef.current = next;
    setPickState(next);
  };
  const setFields = (next: EsmInput) => {
    fieldsRef.current = next;
    setFieldsState(next);
  };
  const setPrefs = (change: Partial<DeskPrefs>) => {
    const next = { ...prefs, ...change };
    setPrefsState(next);
    writePrefs(next);
  };

  const newLive = (engine: RigEngine, level: ContestLevelId, given?: ContestAxes): Live => {
    const { myCall: call, myName: name, myQth: qth } = latest.current;
    const axes = given ?? latest.current.axesFor(level);
    const radio: RadioPort = {
      now: () => engine.now(),
      send: (station, text, delay) => engine.send(station, text, delay),
      stationsChanged: (stations) => engine.setStations(stations),
    };
    const run = new ContestRunSession({ random: Math.random, me: { call, name, qth }, params: contestParamsOf(axes), rules: RULES }, radio);
    const live: Live = { id: nowId(), run, level, axes, capture: rig.newCapture(), epoch: engine.epoch, lastNow: engine.now(), startedAt: null, wall: 0, queue: [], keying: false, closed: false, sent: [] };
    run.rebase(engine.epoch, 0);
    engine.setStations([]);
    return live;
  };

  // One run per mount (and per 新しいラン); the rig taps every station's message into its air.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    liveRef.current = newLive(engine, latest.current.prefs.level);
    tapRef.current = (station: Station, tx, epoch) => {
      const live = liveRef.current;
      if (!live || live.closed) return;
      live.run.onStationTransmission(station, tx, epoch);
    };
    return () => {
      tapRef.current = null;
      if (liveRef.current) liveRef.current.closed = true;
      liveRef.current = null;
      engine.setStations([]);
    };
  }, [engineRef, tapRef]);

  /** Key the action on the air; the run hears it the moment its span is fixed. */
  const keyIt = (live: Live, engine: RigEngine, action: EsmAction) => {
    live.keying = true;
    setSent((list) => [...list.slice(-40), action.text]);
    void rig.transmit(action.text, latest.current.wpm, (span) => {
      live.keying = false;
      if (live.closed) return;
      sync(live, engine);
      live.sent.push({ at: span.start, end: span.end, kind: action.kind, text: action.text, ...(action.subject ? { subject: action.subject } : {}), ...(action.nr !== undefined ? { nr: action.nr } : {}) });
      live.run.transmit(action.text, { start: span.start, end: span.end, rf: engine.vfo });
    }).finally(() => { live.keying = false; });
  };

  /**
   * Send what `compute` makes of the desk (Enter, ";", "\", a memory key). A line is logged
   * the moment the key is pressed, as a logger does; pressed while we are still on the air,
   * the message waits its turn behind what is already waiting.
   */
  const press = (compute: (state: EsmState, input: EsmInput, log: EsmLog) => EsmAction, emptyHint: string) => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live || live.closed || latest.current.result) return;
    if (!engine.powered) { setMessage('先に電源（POWER）を入れてください'); return; }
    const base = pickRef.current;
    const input = fieldsRef.current;
    const action = compute(base, input, deskLog(live.run.qsos, latest.current.myCall));
    if (action.kind === 'none') { setMessage(emptyHint); return; }
    const now = sync(live, engine);
    if (action.log) {
      live.run.logQso(action.log, now);
      setRows(live.run.qsos.map((line) => ({ ...line })));
      setLoggedAt((list) => [...list, live.wall]);
    }
    if (live.startedAt === null && live.wall) {
      live.startedAt = live.wall;
      setStartedAt(live.startedAt);
    }
    setMessage(action.kind === 'b4' ? `${action.subject} はログ済み（DUPE）: QSO B4 を送りました。交信し直すなら ; で交換を送ります` : null);
    setPick(esmAfter(base, action));
    setFields(esmFieldsAfter(input, action));
    // After our exchange the next thing typed is their serial; after TU / QSO B4, the next call.
    if (action.kind === 'exchange' || action.kind === 'correct') nrRef.current?.focus();
    else if (action.kind === 'tu' || action.kind === 'b4' || action.kind === 'cq') callRef.current?.focus();
    if (live.keying || live.run.keying(now) || live.run.keyedUntil > now || live.queue.length) {
      live.queue.push({ action, prev: base, prevFields: input });
      setQueued(live.queue.map((item) => item.action.text));
      return;
    }
    keyIt(live, engine, action);
  };

  const enter = () => press(esmEnter, '');
  const exchange = () => press(esmExchange, '; は CALL 欄のコールに交換を送ります。先にコールを入れてください');
  const logTu = () => press(esmLogTu, '\\ は CALL 欄のコールを記入して TU を送ります。先にコールを入れてください');
  const asTyped = () => press((_, input) => {
    const text = input.call.toUpperCase().replace(/\s+/g, ' ').trim();
    return text ? { kind: 'raw', text } : { kind: 'none', text: '' };
  }, 'Ctrl+Enter は CALL 欄の内容をそのまま送ります');
  const memoryKey = (index: number) => press(
    (state, input, log) => esmKey(index, state, input, log),
    index === 4 || index === 5 ? 'CALL 欄にコールを入れてから送ります' : 'このキーは今は送るものがありません',
  );

  /** Wipe the entry line (Alt+W): nothing is sent or logged. */
  const wipe = () => {
    setFields(EMPTY_INPUT);
    callRef.current?.focus();
  };

  /** Esc: take back what is waiting to go out; with nothing waiting, wipe the entry line. */
  const escape = () => {
    const live = liveRef.current;
    if (live?.queue.length) {
      const logged = live.queue.some((item) => item.action.log);
      // Only an unlogged queue can be taken back to the desk as it was; a line logged stays logged.
      if (!logged) {
        setPick(live.queue[0].prev);
        setFields(live.queue[0].prevFields);
      }
      live.queue = [];
      setQueued([]);
      setMessage(logged ? '送信の予約を取り消しました（記入したログはそのままです）' : '送信の予約を取り消しました');
      return;
    }
    wipe();
  };

  const qrt = () => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live || live.closed) return;
    const now = sync(live, engine);
    live.closed = true;
    live.queue = [];
    setQueued([]);
    engine.setStations([]);
    const result = live.run.finish(now);
    const rel = (at: number) => Math.round((at - result.clock.start) * 10) / 10;
    const sent = live.sent.map((item) => ({ ...item, at: rel(item.at), ...(item.end !== undefined ? { end: rel(item.end) } : {}) }));
    const worked = live.startedAt !== null && (result.qsos.length > 0 || result.contacts.length > 0);
    // Judged from what reached our receiver and our own messages; the truth (who keyed what) only after QRT.
    const roster = result.roster ?? {};
    const judged = judgeContest({
      result: storedResult(result), sent, records: live.capture.rx,
      callOf: (id) => roster[id]?.call ?? null,
      keyedOf: (id) => roster[id]?.nr || null,
      monitor: live.capture.monitor, now: { t: now, epoch: engine.epoch },
    });
    if (worked && live.startedAt !== null) {
      // Wall clock as of the loop's last tick (within 0.1 s of QRT).
      const endedAt = Math.max(live.wall, live.startedAt);
      const { axes } = live;
      const wpmOf = Object.fromEntries(result.contacts.map((contact) => [contact.stationId, roster[contact.stationId]?.wpm ?? axes.speed]));
      const saved = contestSave({
        id: live.id, startedAt: live.startedAt, endedAt, level: live.level, wpm: latest.current.wpm, minutes: latest.current.prefs.minutes,
        axes, params: { ...live.run.params }, result, sent, judged, wpmOf,
      });
      const kept = onSave({
        id: live.id, startedAt: live.startedAt, endedAt, level: live.level, axes, summary: saved.summary, answers: saved.answers,
        analysis: saved.analysis, review: saved.review, wpm: axes.speed,
        contacts: contestContacts(saved.trace.result, judged.scored, saved.analysis, (id) => wpmOf[id] ?? axes.speed),
      });
      // The detailed record (our log, the stations' logs, what we sent and received, the causes) stays on this device.
      void addRunTrace({ ...saved.trace, adjusted: kept.moved, earned: kept.earned, ...(kept.assist ? { assist: kept.assist } : {}) })
        .then(() => setRecordsAt(Date.now())).catch(() => undefined);
      setResult({ review: saved.review, level: live.level, saved: kept, analysis: saved.analysis });
    } else {
      setResult({ review: judged.review, level: live.level, saved: null, analysis: judged.analysis });
    }
    setMessage(null);
  };

  // This device's contest records, newest first.
  useEffect(() => {
    let alive = true;
    getRunTraces()
      .then((traces) => { if (alive) setRecords(traces.filter((trace) => trace.modeId === 'contest' && isContestTrace(trace)).sort((a, b) => b.startedAt - a.startedAt) as ContestTrace[]); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [recordsAt]);

  // The run's clock: the air, the queue, the elapsed time and the contest's end.
  useEffect(() => {
    let lastSecond = 0;
    const timer = setInterval(() => {
      const engine = engineRef.current;
      const live = liveRef.current;
      if (!engine || !live || live.closed) return;
      const now = sync(live, engine);
      live.wall = Date.now();
      live.run.tick(now);
      live.run.drainNotes();
      const clear = !live.keying && !live.run.keying(now) && live.run.keyedUntil <= now;
      if (clear && live.queue.length && engine.powered) {
        const next = live.queue.shift()!;
        setQueued(live.queue.map((item) => item.action.text));
        handlers.current?.keyIt(live, engine, next.action);
      }
      const { minutes } = latest.current.prefs;
      if (clear && !live.queue.length && minutes && live.startedAt !== null && live.wall - live.startedAt >= minutes * 60_000) {
        handlers.current?.qrt();
        return;
      }
      const second = Math.floor(live.wall / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        setClock(live.wall);
      }
    }, LOOP_MS);
    return () => clearInterval(timer);
  }, [engineRef]);

  const restart = (level = prefs.level, axes?: ContestAxes) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (liveRef.current) liveRef.current.closed = true;
    liveRef.current = newLive(engine, level, axes);
    setPick(ESM_START);
    setFields(EMPTY_INPUT);
    setQueued([]);
    setRows([]);
    setLoggedAt([]);
    setSent([]);
    setStartedAt(null);
    setResult(null);
    setEditing(null);
    setMessage(null);
  };

  const chooseLevel = (level: ContestLevelId) => {
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
    handlers.current = { enter, exchange, logTu, key: memoryKey, escape, wipe, wpm: changeWpm, type: typeChar, keyIt, qrt };
  });

  // Logger keys anywhere on the desk: F1–F11 (Ctrl or Alt/Option + 1–9, 0, - where F keys
  // are the system's), Esc, Alt+W, PgUp/PgDn; letters typed outside the fields go to CALL.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (latest.current.result) return;
      const fkey = /^F(\d{1,2})$/.exec(event.key);
      const alt = (event.ctrlKey || event.altKey) && !event.metaKey
        ? CONTEST_ALT_KEYS.findIndex((key) => event.code === (key === '-' ? 'Minus' : `Digit${key}`)) : -1;
      const index = fkey ? Number(fkey[1]) - 1 : alt;
      if (index >= 0 && index < CONTEST_KEYS.length) {
        event.preventDefault();
        handlers.current?.key(index);
      } else if (event.altKey && event.code === 'KeyW') {
        event.preventDefault();
        handlers.current?.wipe();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        handlers.current?.escape();
      } else if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        handlers.current?.wpm(event.key === 'PageUp' ? 2 : -2);
      } else if (!isTyping(event.target) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (event.key === 'Enter') { event.preventDefault(); handlers.current?.enter(); }
        else if (event.key === ';') { event.preventDefault(); handlers.current?.exchange(); }
        else if (event.key === '\\' || event.key === '¥' || event.key === "'") { event.preventDefault(); handlers.current?.logTu(); }
        else if (/^[a-zA-Z0-9/?]$/.test(event.key)) { event.preventDefault(); handlers.current?.type(event.key); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onFieldKey = (event: ReactKeyboardEvent<HTMLInputElement>, field: keyof EsmInput) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) asTyped();
      else enter();
    } else if (event.key === ' ') {
      // Space: CALL ⇄ NR (the report is left as it is, as loggers skip it).
      event.preventDefault();
      (field === 'call' ? nrRef : callRef).current?.focus();
    } else if (event.key === ';' || event.key === 'Insert') {
      event.preventDefault();
      exchange();
    } else if (event.key === '\\' || event.key === '¥' || event.key === "'") {
      event.preventDefault();
      logTu();
    }
  };
  const updateField = (field: keyof EsmInput, value: string) => {
    const pattern = field === 'call' ? /[^A-Z0-9/?]/g : /[^A-Z0-9]/g;
    setFields({ ...fieldsRef.current, [field]: value.toUpperCase().replace(pattern, '') });
  };

  const saveEdit = () => {
    const live = liveRef.current;
    if (!live || !editing) return;
    const line = live.run.qsos.find((item) => item.id === editing.id);
    const call = editing.call.toUpperCase().replace(/[^A-Z0-9/]/g, '');
    if (line && call) {
      live.run.editQso(editing.id, { call, rst: line.rst, nr: editing.nr.toUpperCase().replace(/[^A-Z0-9]/g, '') });
      setRows(live.run.qsos.map((item) => ({ ...item })));
    }
    setEditing(null);
    callRef.current?.focus();
  };

  if (result) {
    return (
      <div className="qso-side run-review-wrap">
        <ContestReview
          review={result.review} level={result.level} saved={result.saved} analysis={result.analysis} auto={auto}
          onRestart={() => { setWpm(axesFor(prefs.level).speed); restart(); }}
        />
      </div>
    );
  }
  if (viewing) {
    return (
      <div className="qso-side run-review-wrap">
        <ContestReview
          review={reviewOf(viewing)} level={viewing.contest.level} analysis={reanalyse(viewing)} auto
          saved={{ moved: viewing.adjusted, auto: true, earned: viewing.earned as EarnedBadge[], marked: [] }}
          stored={{ at: viewing.startedAt }} onClose={() => setViewing(null)}
        />
      </div>
    );
  }

  const log = deskLog(rows, myCall);
  const preview = esmEnter(pick, fields, log);
  const typedCall = fields.call.toUpperCase().trim();
  const isCall = shapeOf(typedCall) === 'call';
  const dupe = isCall && log.isDupe(typedCall);
  const newMult = isCall && !dupe && isNewMult(rows, typedCall, RULES);
  const { score, rate, best, elapsed } = deskNumbers(rows, loggedAt.map((at) => at / 1000), startedAt === null ? null : startedAt / 1000, clock / 1000, RULES);
  const remaining = prefs.minutes && startedAt ? Math.max(0, prefs.minutes * 60 - elapsed) : null;
  const status = message ?? (powered ? phaseHint(pick) : 'POWER で電源を入れ、Enter で CQ TEST を出して始めます');
  const dupeIds = dupeLineIds(rows);
  const level = contestLevel(prefs.level);
  // How far おまかせ has moved this level (only the axes it adapts).
  const current = axesFor(prefs.level);
  const moves = stored === prefs.level
    ? CONTEST_ADAPT_AXES.filter((axis) => Math.abs(current[axis] - level.axes[axis]) > 1e-9).map((axis) => describeLevelMove(axis, current[axis], level.axes[axis]))
    : [];

  return (
    <div className="qso-side run-desk contest-desk">
      <div className="panel panel-pad contest-setup">
        <div className="qso-panel-head">
          <h2>コンテスト</h2>
          <small>{RULES.label}・RST＋シリアル番号・1 交信 1 点 × プリフィックス</small>
        </div>
        <div className="pileup-level-row" role="radiogroup" aria-label="レベル">
          {CONTEST_LEVELS.map((item) => (
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
        <div className="run-control-row contest-duration">
          <small>{LEVEL_NOTE[prefs.level]}</small>
          <label>
            時間
            <select value={prefs.minutes} onChange={(event) => setPrefs({ minutes: Number(event.target.value) })} disabled={startedAt !== null} aria-label="コンテストの時間">
              {DURATIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes ? `${minutes} 分` : '制限なし'}</option>)}
            </select>
          </label>
        </div>
        <div className="run-control-row pileup-auto">
          <label className="qso-auto"><input type="checkbox" checked={auto} onChange={(event) => onAuto(event.target.checked)} />おまかせ調整</label>
          {moves.length > 0 && (
            <>
              <small>{level.label}から：{moves.join('・')}</small>
              <button
                type="button" className="btn btn-ghost btn-sm" disabled={startedAt !== null}
                onClick={() => { onResetLevel(prefs.level); setWpm(level.axes.speed); restart(prefs.level, level.axes); }}
              >
                レベルの設定に戻す
              </button>
            </>
          )}
        </div>
      </div>

      <div className="panel panel-pad contest-logger">
        <dl className="contest-hud" aria-label="コンテストの状況">
          <div><dt>{remaining !== null ? '残り' : '経過'}</dt><dd>{formatSeconds(remaining ?? elapsed)}</dd></div>
          <div><dt>QSO</dt><dd>{score.qsos}</dd></div>
          <div><dt>MULT</dt><dd>{score.mults}</dd></div>
          <div><dt>SCORE</dt><dd>{score.total}</dd></div>
          <div><dt>RATE</dt><dd>{rate}<small>/h</small></dd></div>
          <div><dt>BEST</dt><dd>{best}<small>/h</small></dd></div>
        </dl>

        <p className="pileup-phase contest-phase" aria-live="polite">
          <b>{esmPhaseLine(pick)}</b>
          {txOn && <span className="pileup-tx">送信中</span>}
          <span className="contest-wpm">{wpm} WPM</span>
          {queued.length > 0 && <span className="pileup-queued">予約: {queued.join(' / ')}（Esc で取消）</span>}
        </p>

        <div className="pileup-touch contest-touch" aria-label="送信ボタン">
          <button type="button" className="btn btn-primary pileup-touch-go" onClick={enter}>▶ {preview.text || '—'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => memoryKey(0)}>CQ</button>
          <button type="button" className="btn btn-ghost" onClick={() => memoryKey(8)}>NR?</button>
          <button type="button" className="btn btn-ghost" onClick={() => memoryKey(7)}>AGN?</button>
          <button type="button" className="btn btn-ghost" onClick={logTu}>TU・記入</button>
          <button type="button" className="btn btn-ghost" onClick={() => setMore(!more)} aria-expanded={more}>…</button>
        </div>
        {more && (
          <div className="pileup-touch-more contest-touch-more">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { exchange(); setMore(false); }}>交換を送る</button>
            {[9, 6, 5, 3, 4, 1, 10].map((index) => (
              <button key={index} type="button" className="btn btn-ghost btn-sm" onClick={() => { memoryKey(index); setMore(false); }}>{CONTEST_KEYS[index].label}</button>
            ))}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { wipe(); setMore(false); }}>入力を消す</button>
          </div>
        )}

        {pick.path.length > 0 && (
          <ol className="pileup-path" aria-label="絞り込みの道筋">
            {pick.path.map((piece, index) => <li key={index}>{piece}</li>)}
          </ol>
        )}
        <form className="contest-entry" onSubmit={(event) => { event.preventDefault(); enter(); }}>
          <label className="contest-call">
            <span>CALL {dupe && <em className="contest-flag dupe">DUPE</em>}{newMult && <em className="contest-flag mult">NEW MULT</em>}</span>
            <input
              ref={callRef}
              value={fields.call}
              onChange={(event) => updateField('call', event.target.value)}
              onKeyDown={(event) => onFieldKey(event, 'call')}
              placeholder="JA1ABC"
              aria-label="相手のコール（断片なら ? を付けても可）"
              className={dupe ? 'is-dupe' : ''}
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="send"
              autoFocus
            />
          </label>
          <label className="contest-rst">
            <span>RST</span>
            <input
              value={fields.rst}
              onChange={(event) => updateField('rst', event.target.value)}
              onKeyDown={(event) => onFieldKey(event, 'rst')}
              placeholder="599"
              aria-label="受信 RST（空なら 599）"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="send"
              tabIndex={-1}
            />
          </label>
          <label className="contest-nr">
            <span>NR</span>
            <input
              ref={nrRef}
              value={fields.nr}
              onChange={(event) => updateField('nr', event.target.value)}
              onKeyDown={(event) => onFieldKey(event, 'nr')}
              placeholder="023"
              aria-label="受信した番号"
              autoCapitalize="characters"
              autoCorrect="off"
              autoComplete="off"
              spellCheck={false}
              enterKeyHint="send"
            />
          </label>
          <div className="contest-sent" title="この交信で送る自局の番号（記入すると次の番号になります）">
            <span>送る番号</span>
            <b>{ourNr(log.nextNr)}</b>
          </div>
        </form>
        <p className="pileup-preview" aria-live="polite">
          <kbd>Enter</kbd> → <b>{preview.text || '—'}</b>
          {preview.log && <small>（記入: {preview.log.call} {preview.log.rst} {preview.log.nr}）</small>}
        </p>
        <p className="qso-hint" role="status">{status}</p>

        <div className="run-fkeys contest-fkeys" aria-label="メモリーキー">
          {CONTEST_KEYS.map((key, index) => {
            const resolved = esmKey(index, pick, fields, log);
            return (
              <button key={key.key} type="button" className="btn btn-ghost btn-sm" onClick={() => memoryKey(index)} title={`${resolved.text || key.template}（Ctrl / Alt+${CONTEST_ALT_KEYS[index]}）`}>
                <kbd>{key.key}</kbd>{key.label}
                {resolved.text && resolved.text !== key.label && <small>{resolved.text}</small>}
              </button>
            );
          })}
        </div>
        {sent.length > 0 && <ul className="qso-sent">{sent.slice(-5).map((line, index) => <li key={index}>{line}</li>)}</ul>}
      </div>

      <div className="panel panel-pad run-log contest-log">
        <div className="qso-panel-head"><h2>ログ</h2><small>{rows.length} 行・行を選ぶと直せます</small></div>
        {rows.length ? (
          <table className="contest-rows">
            <thead><tr><th>送</th><th>CALL</th><th>RST</th><th>NR</th><th /></tr></thead>
            <tbody>
              {[...rows].reverse().slice(0, 12).map((line) => (
                editing?.id === line.id ? (
                  <tr key={line.id} className="editing">
                    <td>{ourNr(line.sentNr)}</td>
                    <td><input value={editing.call} onChange={(event) => setEditing({ ...editing, call: event.target.value.toUpperCase() })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveEdit(); } }} aria-label="コールを直す" autoFocus /></td>
                    <td>{line.rst}</td>
                    <td><input value={editing.nr} onChange={(event) => setEditing({ ...editing, nr: event.target.value.toUpperCase() })} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveEdit(); } }} aria-label="番号を直す" /></td>
                    <td><button type="button" className="btn btn-ghost btn-sm" onClick={saveEdit}>保存</button></td>
                  </tr>
                ) : (
                  <tr key={line.id} onClick={() => setEditing({ id: line.id, call: line.call, nr: line.nr })}>
                    <td>{ourNr(line.sentNr)}</td>
                    <td><b>{line.call}</b></td>
                    <td>{line.rst}</td>
                    <td>{line.nr || '—'}</td>
                    <td>{dupeIds.has(line.id) && <em className="contest-flag dupe">DUPE</em>}</td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        ) : <p className="qso-note">まだ記入がありません。TU で記入されます。</p>}
      </div>

      <div className="panel panel-pad run-controls">
        <div className="run-control-row">
          <span className="run-interval">自局の速さ <b>{wpm} WPM</b><input type="range" min={WPM_RANGE[0]} max={WPM_RANGE[1]} step={1} value={wpm} onChange={(event) => setWpm(Number(event.target.value))} aria-label="自局の速さ" /></span>
        </div>
        <div className="run-control-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => restart()} disabled={startedAt === null}>やり直す</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={qrt} disabled={startedAt === null}>QRT（終了して照合）</button>
        </div>
        <p className="qso-note pileup-help">
          コールを入れて <kbd>Enter</kbd> で <b>{myCall || 'JS2WDR'} の交換（5NN と番号）</b>、相手の番号を入れて <kbd>Enter</kbd> で <b>TU</b> と記入。
          断片は <b>JA1</b> や <b>JA1A?</b> のまま <kbd>Enter</kbd>。番号が取れなければ空のまま <kbd>Enter</kbd> で <b>NR?</b>。
          <kbd>Space</kbd> CALL⇄NR　<kbd>;</kbd> 交換を送る（DUPE でも）　<kbd>\</kbd> または <kbd>&apos;</kbd> TU して記入　<kbd>Esc</kbd> 予約取消・入力を消す　<kbd>Alt</kbd>+<kbd>W</kbd> 入力を消す
          <kbd>F1</kbd>–<kbd>F11</kbd>（Mac などは <kbd>Ctrl</kbd> または <kbd>Option</kbd>+<kbd>1</kbd>–<kbd>0</kbd>, <kbd>-</kbd>）メモリー　<kbd>PgUp</kbd>/<kbd>PgDn</kbd> 自局の速さ ±2。
          DUPE と NEW MULT は、入力したコールと自分のログだけから表示します。
          QRT（または時間切れ）で照合して保存します。途中で画面を離れたランは保存も再開もできません。
        </p>
      </div>

      <details className="panel panel-pad run-records">
        <summary>この端末のコンテストの記録 <small>{records.length} / {RUN_TRACE_LIMIT}</small></summary>
        <p className="qso-note">自局ログ・各局のログ・送信内容を含む詳しい記録は、この端末だけに直近 {RUN_TRACE_LIMIT} ラン分（全モード合計）を残します（クラウドには件数と得点の要約だけを保存）。</p>
        {records.length ? (
          <ol>
            {records.map((trace) => {
              const review = trace.contest.review;
              return (
                <li key={trace.id}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewing(trace)} disabled={startedAt !== null}>
                    <time>{new Date(trace.startedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                    <b>{review.lines.length} QSO・{review.checked.total} 点</b>
                    <span>{contestLevel(trace.contest.level as ContestLevelId)?.label ?? ''}・{review.rates.average}/h・{formatSeconds(review.seconds)}</span>
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

/** The status line: what Enter does now, from our own state. */
function phaseHint(state: EsmState) {
  if (state.phase === 'start') return 'Enter で CQ TEST を出して始めます';
  if (state.phase === 'working') return '相手の番号を NR に入れて Enter で TU と記入（取れなければ空のまま Enter で NR?）';
  return state.path.length ? '聞こえた文字を足して Enter。フルコールになったら Enter で交換を送ります' : '聞こえたコールか断片を入れて Enter。誰もいなければ空のまま Enter で CQ';
}

/** One axis as おまかせ has moved it from the level. */
function describeLevelMove(axis: Axis, now: number, from: number) {
  // The level's value and where おまかせ has it now, as the numbers stand (a step's word would hide how far it went).
  const spec = AXIS_SPECS[axis];
  const value = (x: number) => String(Math.round(x * 100) / 100);
  return `${spec.label} ${value(from)}→${value(now)}${spec.unit ? ` ${spec.unit}` : ''}`;
}

function formatSeconds(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
