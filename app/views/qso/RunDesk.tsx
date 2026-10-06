'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { AnswerLog, QsoAssist, QsoSessionSummary } from '@/lib/types';
import { makeQrm, type Station } from '@/lib/radio/band';
import { fieldAnswers } from '@/lib/radio/attribution';
import type { AgentNote } from '@/lib/radio/agents/types';
import type { AxisVotes, DifficultyVector, QsoEvidence } from '@/lib/radio/difficulty';
import type { PileupAxes } from '@/lib/radio/modes/pileupLevels';
import type { PileupAnalysis } from '@/lib/radio/pileup/analysis';
import type { ExchangePreset } from '@/lib/radio/exchange';
import { fillMemory, memoryTemplates, MEMORY_KEYS, retemplate, type MemoryTempo, type MemoryVars } from '@/lib/radio/memories';
import type { RunQsoMode } from '@/lib/radio/modes';
import type { LogFields, RadioPort, RunIssue, RunLogEntry, RunSession } from '@/lib/radio/modes/cqRun';
import { cleanContacts, cleanRate, runSummary, scoreRun } from '@/lib/radio/runReview';
import { RUN_TRACE_LIMIT, RUN_TRACE_VERSION, runTraceLine, type RunTrace, type RunTxTrace } from '@/lib/radio/runTrace';
import { traceRx } from '@/lib/radio/trace';
import type { EarnedBadge, RunOutcome } from '@/lib/radio/badges';
import type { Axis } from '@/lib/radio/difficulty';
import { addRunTrace, getRunTraces } from '@/lib/storage';
import type { RigEngine } from '@/lib/radio/rig';
import { nowId } from '@/app/trainer/shared';
import { RunReview, type RunReviewData, type RunReviewFlavor } from './RunReview';
import type { Capture, Rig } from './useRig';

const TIMERS = [0, 5, 10, 15] as const;
const LOOP_MS = 100;
/** The report we give every caller. */
const OUR_RST = '599';
const EMPTY: LogFields = { call: '', rst: '', name: '', qth: '' };

/** Operating preferences for the run desk (kept on this device). */
interface RunPrefs {
  templates: string[];
  /** CQ repeat: on, and the gap after our CQ before it goes again (seconds). */
  repeat: boolean;
  interval: number;
  coach: boolean;
  /** Run length in minutes; 0 = until QRT. */
  timer: (typeof TIMERS)[number];
  /** Short exchange (standard) or the long rubber stamp: our keys and the callers' style. */
  tempo: MemoryTempo;
}

const readPrefs = (key: string): RunPrefs => {
  const base: RunPrefs = { templates: memoryTemplates(null), repeat: true, interval: 4, coach: true, timer: 0, tempo: 'short' };
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<RunPrefs>;
    const tempo: MemoryTempo = raw.tempo === 'long' ? 'long' : 'short';
    return {
      tempo,
      templates: memoryTemplates(raw.templates, tempo),
      repeat: typeof raw.repeat === 'boolean' ? raw.repeat : base.repeat,
      interval: typeof raw.interval === 'number' ? Math.min(10, Math.max(2, raw.interval)) : base.interval,
      coach: typeof raw.coach === 'boolean' ? raw.coach : base.coach,
      timer: TIMERS.includes(raw.timer as RunPrefs['timer']) ? (raw.timer as RunPrefs['timer']) : base.timer,
    };
  } catch {
    return base;
  }
};

const writePrefs = (key: string, prefs: RunPrefs) => {
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch { /* private mode: keep for this visit only */ }
};

/**
 * What a run mode brings to the desk: its words (procedure slips, coaching, prompts),
 * how a fresh run is set up on the band, and its review. The desk itself — memory keys,
 * CQ repeat, holding a CQ on the frequency check, the log, QRT and the records — is shared.
 */
export interface RunDeskFlavor {
  /** Where the operating preferences are kept on this device. */
  prefsKey: string;
  issueText: Record<RunIssue, string>;
  /** Slips that stop CQ repeat (moving is the operator's call). */
  stopsRepeat: readonly RunIssue[];
  /** Advice cleared once a CQ goes out clean. */
  advice: ReadonlySet<string>;
  /** A CQ held on the frequency check: listening, called off (heard someone), called off (VFO moved). */
  held: { listening: string; cancelled: string; moved: string };
  /**
   * Coaching for what a station just did. It never tells who is calling or that we are
   * being called — noticing that is the practice — only what our partner is asking for.
   */
  coachFor(note: AgentNote, run: RunSession): string | null;
  /** The status line before anything has happened. */
  idlePrompt(powered: boolean): string;
  /** Why the desk asks for our name and QTH. */
  profileNote: string;
  /** Under the controls: how the keys and the procedure work. */
  help: ReactNode;
  /** A fresh run is on the rig: put whatever the mode needs on the band. */
  setup(run: RunSession, engine: RigEngine): void;
  review: RunReviewFlavor;
}

/** One run on the air: the session, what we copied, and the clock bookkeeping between rig and run. */
interface Live {
  id: string;
  run: RunSession;
  capture: Capture;
  qrm: Station[];
  /** Rig epoch and clock as of the last sync, to rebase the run when the rig is power-cycled. */
  epoch: number;
  lastNow: number;
  startedAt: number | null;
  txCount: number;
  procedure: number;
  /** Our transmissions as keyed, for the detailed record. */
  txLog: RunTxTrace[];
  /** Rebased start of the current epoch: CQ repeat counts from here when the air has none of ours yet. */
  epochStart: number;
  /**
   * A message keyed while we were still on the air, or a CQ keyed while we listen after
   * QRL?: it goes out once the air says our transmitter is clear and, for a CQ, the run's
   * frequency check has listened its window out. A reservation only — whether we are
   * keying and whether the frequency is in use are always read from the run's ether.
   */
  queued: { text: string; cq: boolean; rf: number; held?: boolean } | null;
  closed: boolean;
  /** Coaching that waits until the station has finished sending what it is about. */
  pending: { stationId: number; station: Station; text: string }[];
}

/** What the desk hands back at QRT, ready to store. */
export interface RunRecord {
  id: string;
  startedAt: number;
  endedAt: number;
  alphabet: ExchangePreset['alphabet'];
  summary: QsoSessionSummary;
  answers: AnswerLog[];
  evidence: QsoEvidence;
  wpm: number;
  /** Per contact and run-level numbers for badges. */
  run: Omit<RunOutcome, 'alphabet' | 'at'>;
  /** A pileup: the level and axes it ran at, its own votes and skills (おまかせ by cause). */
  pileup?: { level: string; axes: PileupAxes; votes: AxisVotes; analysis: PileupAnalysis };
}

/** What storing the run did: axis moves (おまかせ) and what it earned. */
export interface RunSaved {
  moved: Partial<Record<Axis, number>>;
  auto: boolean;
  earned: EarnedBadge[];
  marked: string[];
  /** DECODE's use in this run (none: never on). */
  assist?: QsoAssist;
}

export interface RunDeskProps {
  rig: Rig;
  mode: RunQsoMode;
  preset: ExchangePreset;
  difficulty: DifficultyVector;
  myCall: string;
  myName: string;
  myQth: string;
  onProfile: (change: { myName?: string; myQth?: string }) => void;
  onSave: (record: RunRecord) => RunSaved;
}

/** Bring the run onto the rig's clock: a power cycle starts a new epoch with a jump in time. */
function sync(live: Live, engine: RigEngine) {
  const now = engine.now();
  if (engine.epoch !== live.epoch) {
    live.run.rebase(engine.epoch, now - live.lastNow);
    live.epoch = engine.epoch;
    live.epochStart = now;
  }
  live.lastNow = now;
  return now;
}

/** A run operating desk: memory keys, CQ repeat, the log and QRT, with the mode's flavor. */
export function RunDesk({ rig, mode, preset, difficulty, myCall, myName, myQth, onProfile, onSave, flavor }: RunDeskProps & { flavor: RunDeskFlavor }) {
  const { engineRef, tapRef, txOn, powered } = rig;
  const [prefs, setPrefsState] = useState<RunPrefs>(() => readPrefs(flavor.prefsKey));
  const [form, setForm] = useState<LogFields>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [rows, setRows] = useState<RunLogEntry[]>([]);
  const [sent, setSent] = useState<string[]>([]);
  const [free, setFree] = useState('');
  const [armed, setArmedState] = useState(false);
  /** Status line; null = the opening prompt, which follows the power switch. */
  const [message, setMessage] = useState<{ text: string; coach: boolean } | null>(null);
  // Asked once on opening; stays until confirmed so typing doesn't make it vanish mid-word.
  const [askProfile, setAskProfile] = useState(!myName || !myQth);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(0);
  const [editMemories, setEditMemories] = useState(false);
  const [review, setReview] = useState<RunReviewData | null>(null);
  /** Runs stored on this device (newest first), and the one opened from that list. */
  const [records, setRecords] = useState<RunTrace[]>([]);
  const [recordsAt, setRecordsAt] = useState(0);
  const [viewing, setViewing] = useState<RunTrace | null>(null);

  const liveRef = useRef<Live | null>(null);
  const armedRef = useRef(false);
  const callRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ prefs, difficulty, myCall, myName, myQth, form, review, mode, preset, flavor });
  // Handlers the run loop and key listener call (they always see this render's values).
  const actions = useRef<{ send: (text: string, cq?: boolean, repeat?: boolean) => Promise<void>; qrt: () => void; memory: (index: number) => void; escape: () => void } | null>(null);
  useEffect(() => {
    latest.current = { prefs, difficulty, myCall, myName, myQth, form, review, mode, preset, flavor };
  });

  const say = (text: string, coach = false) => setMessage({ text, coach });
  const setArmed = (on: boolean) => {
    armedRef.current = on;
    setArmedState(on);
  };
  const setPrefs = (change: Partial<RunPrefs>) => {
    const next = { ...prefs, ...change };
    setPrefsState(next);
    writePrefs(flavor.prefsKey, next);
  };
  /** Keys still on the old defaults follow the tempo; callers arriving from now on do too. */
  const setTempo = (tempo: MemoryTempo) => {
    setPrefs({ tempo, templates: retemplate(prefs.templates, prefs.tempo, tempo) });
    liveRef.current?.run.setParams({ tempo });
  };

  /** A fresh run on the current frequency, with background QRM around it. */
  const newLive = (engine: RigEngine): Live => {
    const { difficulty: d, myCall: call, myName: name, myQth: qth, mode: runMode, flavor: runFlavor } = latest.current;
    const qrm = makeQrm(Math.random, d.crowd, engine.vfo, [engine.vfo], 400);
    const live = {} as Live;
    const radio: RadioPort = {
      now: () => engine.now(),
      send: (station, text, delay) => engine.send(station, text, delay),
      stationsChanged: (stations) => engine.setStations([...live.qrm, ...stations]),
    };
    const run = runMode.createRun({ random: Math.random, me: { call, name, qth }, difficulty: d, tempo: latest.current.prefs.tempo }, radio);
    Object.assign(live, {
      id: `run-${nowId()}`, run, capture: rig.newCapture(), qrm, epoch: engine.epoch, lastNow: engine.now(), startedAt: null,
      txCount: 0, procedure: 0, txLog: [], epochStart: engine.now(), queued: null, closed: false, pending: [],
    } satisfies Live);
    run.rebase(engine.epoch, 0);
    engine.setStations(qrm);
    runFlavor.setup(run, engine);
    return live;
  };

  useEffect(() => {
    let alive = true;
    getRunTraces().then((traces) => { if (alive) setRecords(traces.filter((trace) => trace.modeId === mode.id) as RunTrace[]); }).catch(() => undefined);
    return () => { alive = false; };
  }, [recordsAt, mode.id]);

  // The run lives as long as the desk; the rig taps every station message into its air.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    liveRef.current = newLive(engine);
    tapRef.current = (station, tx, epoch) => {
      const live = liveRef.current;
      if (live && !live.closed) live.run.onStationTransmission(station, tx, epoch);
    };
    return () => {
      tapRef.current = null;
      if (liveRef.current) liveRef.current.closed = true;
      liveRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one run per mount; "new run" replaces it
  }, [engineRef, tapRef]);

  // The run's own clock: deliver the air, let callers think, repeat CQ, end on the timer.
  useEffect(() => {
    let lastSecond = 0;
    const timer = setInterval(() => {
      const engine = engineRef.current;
      const live = liveRef.current;
      if (!engine || !live || live.closed) return;
      const now = sync(live, engine);
      live.run.tick(now);
      const { prefs: p, flavor: f } = latest.current;
      for (const note of live.run.drainNotes()) {
        const text = f.coachFor(note, live.run);
        if (text) live.pending.push({ stationId: note.agent.id, station: note.agent.station, text });
      }
      // Coaching about a message shows once that message is off the air.
      const ready = live.pending.filter(({ station }) => !station.queue.length && station.busyUntil <= now);
      if (ready.length) {
        live.pending = live.pending.filter((item) => !ready.includes(item));
        setMessage({ text: ready[ready.length - 1].text, coach: true });
      }
      // Whether we are on the air comes from the air itself, not from what the UI has queued.
      const clear = !live.run.keying(now) && live.run.keyedUntil <= now;
      if (clear && live.queued && engine.powered) {
        const next = live.queued;
        // A held CQ waits out the listen window after QRL?; anyone heard meanwhile calls it off.
        const check = next.cq ? live.run.frequencyCheck(next.rf, now) : null;
        if (next.cq && engine.vfo !== next.rf) {
          live.queued = null;
          setArmed(false);
          setMessage({ text: f.held.moved, coach: true });
        } else if (check?.state === 'busy') {
          live.queued = null;
          setArmed(false);
          setMessage({ text: f.held.cancelled, coach: true });
        } else if (check?.state === 'listening') {
          if (!next.held) {
            next.held = true;
            setMessage({ text: f.held.listening, coach: false });
          }
        } else {
          live.queued = null;
          void actions.current?.send(next.text, next.cq);
        }
      } else if (clear && armedRef.current && p.repeat && engine.powered
        // CQ repeat listens from the later of our last message and the last caller's, so it doesn't step on a call.
        && now - Math.max(live.run.keyedUntil, live.epochStart, live.run.callersQuietFrom(engine.vfo, now)) >= p.interval) {
        void actions.current?.send(fillMemory(p.templates[0], { MYCALL: latest.current.myCall }), true, true);
      }
      if (p.timer && live.startedAt && clear && Date.now() >= live.startedAt + p.timer * 60_000) actions.current?.qrt();
      const second = Math.floor(Date.now() / 1000);
      if (second !== lastSecond) {
        lastSecond = second;
        setClock(Date.now());
      }
    }, LOOP_MS);
    return () => clearInterval(timer);
  }, [engineRef]);

  /**
   * Key `raw`; the run hears it the moment its span on the air is fixed (before the audio).
   * `cq` keeps CQ repeat armed; `repeat` marks the repeat itself, which never waits in line.
   */
  const send = async (raw: string, cq = false, repeat = false) => {
    const engine = engineRef.current;
    const live = liveRef.current;
    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!engine || !live || live.closed || !text) return;
    if (!engine.powered) { say('先に電源を入れてください'); return; }
    if (!cq) setArmed(false);
    const now = sync(live, engine);
    if (live.run.keyedUntil > now) {
      // Still on the air (the run's ether says so): hold it until we are clear.
      if (!repeat) live.queued = { text, cq, rf: engine.vfo };
      return;
    }
    if (cq && !repeat && live.run.frequencyCheck(engine.vfo, now).state === 'listening') {
      // Keyed straight after QRL?: listen first, then CQ if nobody answered.
      live.queued = { text, cq, rf: engine.vfo, held: true };
      setMessage({ text: flavor.held.listening, coach: false });
      return;
    }
    setSent((list) => [...list.slice(-40), text]);
    await rig.transmit(text, difficulty.speed, (span) => {
      if (live.closed) return;
      sync(live, engine);
      const { issues, intent } = live.run.transmit(text, { start: span.start, end: span.end, rf: engine.vfo });
      live.txLog.push({ at: span.start, text, rf: engine.vfo, issues });
      if (intent.cq && !issues.length) {
        live.pending = live.pending.filter((item) => !flavor.advice.has(item.text));
        setMessage((old) => (old && flavor.advice.has(old.text) ? null : old));
      }
      if (live.startedAt === null) {
        live.startedAt = Date.now();
        setStartedAt(live.startedAt);
      }
      live.txCount += 1;
      if (issues.length) {
        live.procedure += 1;
        setMessage({ text: flavor.issueText[issues[0]], coach: true });
        if (issues.some((issue) => flavor.stopsRepeat.includes(issue))) setArmed(false);
      }
    });
  };

  // {NAME} falls back to the line just logged, so Enter then F3 still thanks them by name.
  // {CALL} never does: F2 with an empty CALL must not go to the previous station.
  const lastName = rows.length ? rows[rows.length - 1].fields.name : '';
  const vars = (): MemoryVars => ({ CALL: form.call, MYCALL: myCall, RST: OUR_RST, MYNAME: myName, MYQTH: myQth, NAME: form.name || lastName });

  const memory = (index: number) => {
    if (review) return;
    const text = fillMemory(prefs.templates[index], vars());
    if (index === 0) {
      setArmed(prefs.repeat);
      void send(text, true);
      return;
    }
    if (!text) {
      say(index === 4 ? '相手のコール（または 3ABC? のような一部）を CALL 欄に入れてから送ります' : 'このキーの文面が空です');
      return;
    }
    void send(text);
  };

  const submitLog = () => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live || live.closed || !form.call.trim()) return;
    if (editing) live.run.editLog(editing, form);
    else live.run.logEntry(form, engine.now());
    setRows([...live.run.log]);
    setForm(EMPTY);
    setEditing(null);
    callRef.current?.focus();
  };

  const editRow = (entry: RunLogEntry) => {
    setEditing(entry.id);
    setForm({ ...entry.fields });
    callRef.current?.focus();
  };

  const qrt = () => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live || live.closed) return;
    setArmed(false);
    const now = sync(live, engine);
    live.closed = true;
    const result = live.run.finish(now);
    const recordsOf = (stationId: number) => live.capture.rx.filter((record) => record.station === stationId);
    const score = scoreRun({
      result, preset, recordsOf, monitor: live.capture.monitor, now: { t: now, epoch: engine.epoch },
      tx: { total: live.txCount, procedure: live.procedure },
    });
    const endedAt = Date.now();
    const wpmOf = (stationId: number) => live.run.agents.find((agent) => agent.id === stationId)?.station.wpm ?? difficulty.speed;
    const wpms = Object.fromEntries(result.contacts.map((contact) => [contact.stationId, wpmOf(contact.stationId)]));
    let saved: RunSaved | null = null;
    if (live.startedAt !== null && (result.contacts.length || result.log.length)) {
      const summary = runSummary({
        result, score, modeId: mode.id, presetId: preset.id, fieldCount: preset.fields.length, difficulty,
        wallClock: (t) => endedAt - (now - t) * 1000,
      });
      const answers = score.contacts.flatMap(({ contactId, fields }) => {
        const contact = result.contacts.find((item) => item.id === contactId);
        if (!fields || !contact) return [];
        return fieldAnswers(fields, {
          sessionId: live.id, contactId, timestamp: endedAt, wpm: wpmOf(contact.stationId), modeId: mode.id, presetId: preset.id, alphabet: preset.alphabet,
        });
      });
      const contacts = score.contacts.flatMap(({ contactId, fields, evidence }) => {
        const contact = result.contacts.find((item) => item.id === contactId);
        return fields && contact ? [{ fields, evidence, wpm: wpmOf(contact.stationId), complete: contact.outcome === 'complete' }] : [];
      });
      const rate = cleanRate(result, score);
      saved = onSave({
        id: live.id, startedAt: live.startedAt, endedAt, alphabet: preset.alphabet, summary, answers, evidence: score.evidence, wpm: difficulty.speed,
        run: {
          contacts, seconds: result.stats.seconds, frequencyChecks: result.stats.frequencyChecks, busyAvoided: result.stats.busyAvoided,
          cleanContacts: cleanContacts(result, score), cleanRate: rate,
        },
      });
      // The detailed record stays on this device; the cloud gets the summary above.
      const clock = { t: now, epoch: engine.epoch };
      const rx: RunTrace['rx'] = {};
      for (const agent of live.run.agents) {
        const records = recordsOf(agent.id);
        if (records.length) rx[agent.id] = traceRx(records, live.capture.monitor, clock, (record) => live.capture.rxWpm.get(record) ?? agent.station.wpm);
      }
      void addRunTrace({
        kind: 'run', version: RUN_TRACE_VERSION, id: live.id, startedAt: live.startedAt, endedAt, modeId: mode.id, presetId: preset.id,
        difficulty: { ...difficulty }, params: { ...live.run.params }, result, scored: score.contacts, evidence: score.evidence,
        rx, tx: live.txLog, filter: engine.filter, wpmOf: wpms, adjusted: saved.moved, earned: saved.earned, ...(saved.assist ? { assist: saved.assist } : {}),
      }).then(() => setRecordsAt(Date.now())).catch(() => undefined);
    }
    // Callers leave with us; the background stays.
    engine.setStations(live.qrm);
    setReview({ result, score, filter: engine.filter, wpmOf: wpms, saved });
    say('QRT しました。振り返りを確認しましょう');
  };

  const restart = () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (liveRef.current) liveRef.current.closed = true;
    liveRef.current = newLive(engine);
    setRows([]);
    setForm(EMPTY);
    setEditing(null);
    setSent([]);
    setStartedAt(null);
    setReview(null);
    setMessage(null);
  };

  const escape = () => {
    setArmed(false);
    if (liveRef.current) liveRef.current.queued = null;
    if (editing) {
      setEditing(null);
      setForm(EMPTY);
    }
  };

  useEffect(() => {
    actions.current = { send, qrt, memory, escape };
  });

  // Logger keys: F1–F8 send memories, Esc stops CQ repeat. Browser defaults (F5 reload) are suppressed.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (latest.current.review) return;
      const match = /^F([1-8])$/.exec(event.key);
      if (match) {
        event.preventDefault();
        actions.current?.memory(Number(match[1]) - 1);
      } else if (event.key === 'Escape') {
        actions.current?.escape();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const elapsed = startedAt && clock ? Math.max(0, (clock - startedAt) / 1000) : 0;
  const rate = elapsed >= 60 ? Math.round((rows.length * 3600) / elapsed) : null;
  const left = prefs.timer && startedAt ? Math.max(0, prefs.timer * 60 - elapsed) : null;
  const status = message ?? { text: flavor.idlePrompt(powered), coach: false };
  const updateForm = (key: keyof LogFields, value: string) => {
    if (key === 'call') setArmed(false);
    setForm((old) => ({ ...old, [key]: value.toUpperCase() }));
  };

  if (review) {
    return (
      <div className="qso-side run-review-wrap">
        <RunReview review={review} flavor={flavor.review} preset={preset} onRestart={restart} />
      </div>
    );
  }

  if (viewing) {
    const stored: RunReviewData = {
      result: viewing.result,
      score: { contacts: viewing.scored, evidence: viewing.evidence, fields: viewing.scored.flatMap((contact) => contact.fields ?? []) },
      filter: viewing.filter,
      wpmOf: viewing.wpmOf,
      saved: { moved: viewing.adjusted, auto: true, earned: viewing.earned as EarnedBadge[], marked: [] },
      stored: { at: viewing.startedAt },
    };
    return (
      <div className="qso-side run-review-wrap">
        <RunReview review={stored} flavor={flavor.review} preset={preset} onClose={() => setViewing(null)} />
      </div>
    );
  }

  return (
    <div className="qso-side run-desk">
      {askProfile && (
        <div className="panel panel-pad run-profile">
          <div className="qso-panel-head"><h2>交換に使う名前と QTH</h2></div>
          <p className="qso-note">{flavor.profileNote}</p>
          <div className="qso-log-grid">
            <label><span>NAME</span><input value={myName} onChange={(event) => onProfile({ myName: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} maxLength={10} placeholder="MASA" autoCapitalize="characters" spellCheck={false} /></label>
            <label><span>QTH</span><input value={myQth} onChange={(event) => onProfile({ myQth: event.target.value.toUpperCase().replace(/[^A-Z]/g, '') })} maxLength={12} placeholder="TOKYO" autoCapitalize="characters" spellCheck={false} /></label>
          </div>
          <button type="button" className="btn btn-primary btn-sm run-profile-ok" onClick={() => setAskProfile(false)} disabled={!myName || !myQth}>これで始める</button>
        </div>
      )}

      <div className="panel panel-pad run-status">
        <dl>
          <div><dt>経過</dt><dd>{formatSeconds(elapsed)}{left !== null && <small> 残り {formatSeconds(left)}</small>}</dd></div>
          <div><dt>交信</dt><dd>{rows.length}</dd></div>
          <div><dt>レート</dt><dd>{rate ?? '—'}<small>/h</small></dd></div>
          <div><dt>CQ リピート</dt><dd className={armed ? 'on' : ''}>{!prefs.repeat ? '切' : armed ? `${prefs.interval} 秒` : '待機'}</dd></div>
        </dl>
        {(!status.coach || prefs.coach) && <p className="qso-hint" role="status">{status.text}</p>}
      </div>

      <div className="panel panel-pad run-keys">
        <div className="qso-panel-head">
          <h2>送信</h2>
          <small>{difficulty.speed} WPM{txOn ? '・送信中' : ''}</small>
        </div>
        <div className="run-fkeys">
          {MEMORY_KEYS.map((key, index) => (
            <button key={key.key} type="button" className="btn btn-ghost btn-sm" onClick={() => memory(index)} title={fillMemory(prefs.templates[index], vars()) || prefs.templates[index]}>
              <kbd>{key.key}</kbd>{key.label}
            </button>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void send('QRS')} title="QRS（相手に遅く送ってもらう）"><kbd>&nbsp;</kbd>QRS</button>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); void send(free); setFree(''); }} className="qso-tx-row">
          <input value={free} onChange={(event) => setFree(event.target.value.toUpperCase())} placeholder="自由に送る文" aria-label="自由に送る文" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
          <button type="submit" className="btn btn-primary" disabled={!free.trim()}>送信</button>
        </form>
        {sent.length > 0 && <ul className="qso-sent">{sent.slice(-6).map((line, index) => <li key={index}>{line}</li>)}</ul>}
      </div>

      <div className="panel panel-pad run-log">
        <div className="qso-panel-head">
          <h2>ログ</h2>
          <small>{editing ? '修正中（Esc で取消）' : 'Enter で記録'}</small>
        </div>
        <form className="run-log-row" onSubmit={(event) => { event.preventDefault(); submitLog(); }}>
          {preset.fields.map((field) => (
            <label key={field.key} className={`run-field-${field.key}`}>
              <span>{field.label}</span>
              <input
                ref={field.key === 'call' ? callRef : undefined}
                value={form[field.key as keyof LogFields] ?? ''}
                onChange={(event) => updateForm(field.key as keyof LogFields, event.target.value)}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          ))}
          <button type="submit" className="btn btn-primary btn-sm" disabled={!form.call.trim()}>{editing ? '修正' : '記録'}</button>
        </form>
        {rows.length > 0 && (
          <ol className="run-rows">
            {[...rows].reverse().map((entry) => (
              <li key={entry.id} className={entry.id === editing ? 'editing' : ''}>
                <button type="button" onClick={() => editRow(entry)} title="クリックで修正">
                  <b>{entry.fields.call}</b><span>{entry.fields.rst}</span><span>{entry.fields.name}</span><span>{entry.fields.qth}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="panel panel-pad run-controls">
        <div className="run-control-row">
          <label className="qso-auto"><input type="checkbox" checked={prefs.repeat} onChange={(event) => { setPrefs({ repeat: event.target.checked }); if (!event.target.checked) setArmed(false); }} />CQ リピート</label>
          <label className="run-interval">間隔 <b>{prefs.interval} 秒</b><input type="range" min={2} max={10} step={1} value={prefs.interval} onChange={(event) => setPrefs({ interval: Number(event.target.value) })} /></label>
        </div>
        <div className="run-control-row">
          <label className="run-timer">
            交換
            <select value={prefs.tempo} onChange={(event) => setTempo(event.target.value === 'long' ? 'long' : 'short')}>
              <option value="short">短め（標準）</option>
              <option value="long">ラバースタンプ（長め）</option>
            </select>
          </label>
        </div>
        <div className="run-control-row">
          <label className="qso-auto"><input type="checkbox" checked={prefs.coach} onChange={(event) => setPrefs({ coach: event.target.checked })} />コーチ表示</label>
          <label className="run-timer">
            タイマー
            <select value={prefs.timer} onChange={(event) => setPrefs({ timer: Number(event.target.value) as RunPrefs['timer'] })}>
              {TIMERS.map((minutes) => <option key={minutes} value={minutes}>{minutes ? `${minutes} 分` : 'なし'}</option>)}
            </select>
          </label>
        </div>
        <div className="run-control-row">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditMemories(!editMemories)} aria-expanded={editMemories}>メモリーを編集</button>
          <button type="button" className="btn btn-danger btn-sm" onClick={qrt} disabled={startedAt === null}>QRT（終了して振り返り）</button>
        </div>
        {editMemories && (
          <div className="run-memories">
            <p className="qso-note">差し込み: {'{CALL}'} {'{MYCALL}'} {'{RST}'} {'{MYNAME}'} {'{MYQTH}'} {'{NAME}'}（相手の名前）。空にすると初期値に戻ります。</p>
            {MEMORY_KEYS.map((key, index) => (
              <label key={key.key}>
                <span>{key.key} {key.label}</span>
                <input
                  value={prefs.templates[index]}
                  onChange={(event) => setPrefs({ templates: prefs.templates.map((item, at) => (at === index ? event.target.value.toUpperCase() : item)) })}
                  onBlur={() => setPrefs({ templates: memoryTemplates(prefs.templates, prefs.tempo) })}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </label>
            ))}
          </div>
        )}
        {flavor.help}
      </div>

      <details className="panel panel-pad run-records">
        <summary>この端末のランの記録 <small>{records.length} / {RUN_TRACE_LIMIT}</small></summary>
        <p className="qso-note">文字ごとの受信条件まで含む詳しい記録は、この端末だけに直近 {RUN_TRACE_LIMIT} ラン分を残します（クラウドには要約だけを保存）。</p>
        {records.length ? (
          <ol>
            {records.map((trace) => {
              const line = runTraceLine(trace);
              return (
                <li key={trace.id}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setViewing(trace)} disabled={startedAt !== null}>
                    <time>{new Date(line.at).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                    <b>{line.contacts} 交信</b>
                    <span>{line.rate}/h・{formatSeconds(line.seconds)}</span>
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

function formatSeconds(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
