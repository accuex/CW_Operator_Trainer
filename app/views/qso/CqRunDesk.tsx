'use client';

import { useEffect, useRef, useState } from 'react';
import type { AnswerLog, QsoSessionSummary } from '@/lib/types';
import { makeQrm, type Station } from '@/lib/radio/band';
import { fieldAnswers } from '@/lib/radio/attribution';
import type { AgentNote } from '@/lib/radio/agents/types';
import type { DifficultyVector, QsoEvidence } from '@/lib/radio/difficulty';
import type { ExchangePreset } from '@/lib/radio/exchange';
import { fillMemory, memoryTemplates, MEMORY_KEYS, type MemoryVars } from '@/lib/radio/memories';
import type { RunQsoMode } from '@/lib/radio/modes';
import type { LogFields, RadioPort, RunIssue, RunLogEntry, RunSession } from '@/lib/radio/modes/cqRun';
import { runSummary, scoreRun } from '@/lib/radio/runReview';
import type { RigEngine } from '@/lib/radio/rig';
import { nowId } from '@/app/trainer/shared';
import { CqRunReview, type RunReviewData } from './CqRunReview';
import type { Capture, Rig } from './useRig';

const PREFS_KEY = 'cwot.cqrun.prefs';
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
}

const readPrefs = (): RunPrefs => {
  const base: RunPrefs = { templates: memoryTemplates(null), repeat: true, interval: 4, coach: true, timer: 0 };
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<RunPrefs>;
    return {
      templates: memoryTemplates(raw.templates),
      repeat: typeof raw.repeat === 'boolean' ? raw.repeat : base.repeat,
      interval: typeof raw.interval === 'number' ? Math.min(10, Math.max(2, raw.interval)) : base.interval,
      coach: typeof raw.coach === 'boolean' ? raw.coach : base.coach,
      timer: TIMERS.includes(raw.timer as RunPrefs['timer']) ? (raw.timer as RunPrefs['timer']) : base.timer,
    };
  } catch {
    return base;
  }
};

const writePrefs = (prefs: RunPrefs) => {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch { /* private mode: keep for this visit only */ }
};

const ISSUE_TEXT: Record<RunIssue, string> = {
  'cq-without-call': 'CQ に自分のコールが入っていません。誰が呼んでいるのか相手にわかりません',
  'no-call': '複数の局が呼んでいます。誰に送ったのかわかるよう、相手のコールを付けましょう',
  'cq-without-qrl': 'QRL? を出さずに CQ を出しました。この周波数は使用中です。VFO を動かし、聴いて F6（QRL?）で確かめてから CQ を出しましょう',
  'busy-frequency': 'QRL? は出しましたが、この周波数は使用中でした（返事や近くの信号がありました）。QRL? のあと数秒聴き、空いていなければ QSY してから CQ を出しましょう',
};
/** A CQ on someone else's QSO stops CQ repeat: moving is the operator's call. */
const BUSY_ISSUES: RunIssue[] = ['cq-without-qrl', 'busy-frequency'];
const QRL_ANSWERED = 'QRL? に返事がありました。この周波数は使用中です。VFO を動かして別の周波数を探しましょう';
const QSY_ASKED = 'この周波数で交信中の局から QSY を求められています。VFO を 1 kHz ほど動かし、聴いて QRL? で確かめてから CQ を出しましょう';
/** Advice about a busy frequency, cleared once a CQ goes out clean elsewhere. */
const FREQUENCY_ADVICE = new Set([QRL_ANSWERED, QSY_ASKED, ...BUSY_ISSUES.map((issue) => ISSUE_TEXT[issue])]);

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
  /** Rebased start of the current epoch: CQ repeat counts from here when the air has none of ours yet. */
  epochStart: number;
  /**
   * A message keyed while we were still on the air: it goes out once the air says our
   * transmitter is clear (CQ repeat never queues). A UI reservation only — whether we are
   * keying is always read from the run's ether.
   */
  queued: { text: string; cq: boolean } | null;
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
}

export interface CqRunDeskProps {
  rig: Rig;
  mode: RunQsoMode;
  preset: ExchangePreset;
  difficulty: DifficultyVector;
  myCall: string;
  myName: string;
  myQth: string;
  onProfile: (change: { myName?: string; myQth?: string }) => void;
  onSave: (record: RunRecord) => void;
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

/**
 * Coaching for what a station just did. It never tells who is calling or that we are
 * being called — noticing that is the practice — only what our partner is asking for.
 */
function coachFor(note: AgentNote, run: RunSession): string | null {
  switch (note.type) {
    case 'corrected': return '訂正が来ています。相手のコールを聴き直して、正しいコールで送り直しましょう';
    case 'asked': return `${note.fields.map((field) => `${field}?`).join(' ')} と聞き返されています。その項目をもう一度送りましょう`;
    case 'exchanged': return '交換が届きました。ログに記入して（Enter）、F3（TU）で締めましょう';
    case 'gone':
      return run.contacts.some((contact) => contact.stationId === note.agent.id && contact.status === 'dropped')
        ? '交信中の局が去りました。F1 で CQ に戻りましょう' : null;
    case 'qrl-answered': return QRL_ANSWERED;
    case 'qsy-asked': return QSY_ASKED;
    default: return null;
  }
}

/** The CQ run operating desk: memory keys, CQ repeat, the log and QRT. */
export function CqRunDesk({ rig, mode, preset, difficulty, myCall, myName, myQth, onProfile, onSave }: CqRunDeskProps) {
  const { engineRef, tapRef, txOn, powered } = rig;
  const [prefs, setPrefsState] = useState<RunPrefs>(readPrefs);
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

  const liveRef = useRef<Live | null>(null);
  const armedRef = useRef(false);
  const callRef = useRef<HTMLInputElement>(null);
  const latest = useRef({ prefs, difficulty, myCall, myName, myQth, form, review, mode, preset });
  // Handlers the run loop and key listener call (they always see this render's values).
  const actions = useRef<{ send: (text: string, cq?: boolean, repeat?: boolean) => Promise<void>; qrt: () => void; memory: (index: number) => void; escape: () => void } | null>(null);
  useEffect(() => {
    latest.current = { prefs, difficulty, myCall, myName, myQth, form, review, mode, preset };
  });

  const say = (text: string, coach = false) => setMessage({ text, coach });
  const setArmed = (on: boolean) => {
    armedRef.current = on;
    setArmedState(on);
  };
  const setPrefs = (change: Partial<RunPrefs>) => {
    const next = { ...prefs, ...change };
    setPrefsState(next);
    writePrefs(next);
  };

  /** A fresh run on the current frequency, with background QRM around it. */
  const newLive = (engine: RigEngine): Live => {
    const { difficulty: d, myCall: call, myName: name, myQth: qth, mode: runMode } = latest.current;
    const qrm = makeQrm(Math.random, d.crowd, engine.vfo, [engine.vfo], 400);
    const live = {} as Live;
    const radio: RadioPort = {
      now: () => engine.now(),
      send: (station, text, delay) => engine.send(station, text, delay),
      stationsChanged: (stations) => engine.setStations([...live.qrm, ...stations]),
    };
    const run = runMode.createRun({ random: Math.random, me: { call, name, qth }, difficulty: d }, radio);
    Object.assign(live, {
      id: `run-${nowId()}`, run, capture: rig.newCapture(), qrm, epoch: engine.epoch, lastNow: engine.now(), startedAt: null,
      txCount: 0, procedure: 0, epochStart: engine.now(), queued: null, closed: false, pending: [],
    } satisfies Live);
    run.rebase(engine.epoch, 0);
    engine.setStations(qrm);
    // QSOs already going on: maybe right here (QRL? finds out), a few more up and down the band.
    run.populate(engine.vfo, engine.now());
    return live;
  };

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
      const { prefs: p } = latest.current;
      for (const note of live.run.drainNotes()) {
        const text = coachFor(note, live.run);
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
        live.queued = null;
        void actions.current?.send(next.text, next.cq);
      } else if (clear && armedRef.current && p.repeat && engine.powered && now - Math.max(live.run.keyedUntil, live.epochStart) >= p.interval) {
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
      if (!repeat) live.queued = { text, cq };
      return;
    }
    setSent((list) => [...list.slice(-40), text]);
    await rig.transmit(text, difficulty.speed, (span) => {
      if (live.closed) return;
      sync(live, engine);
      const { issues, intent } = live.run.transmit(text, { start: span.start, end: span.end, rf: engine.vfo });
      if (intent.cq && !issues.length) {
        live.pending = live.pending.filter((item) => !FREQUENCY_ADVICE.has(item.text));
        setMessage((old) => (old && FREQUENCY_ADVICE.has(old.text) ? null : old));
      }
      if (live.startedAt === null) {
        live.startedAt = Date.now();
        setStartedAt(live.startedAt);
      }
      live.txCount += 1;
      if (issues.length) {
        live.procedure += 1;
        setMessage({ text: ISSUE_TEXT[issues[0]], coach: true });
        if (issues.some((issue) => BUSY_ISSUES.includes(issue))) setArmed(false);
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
    if (live.startedAt !== null && (result.contacts.length || result.log.length)) {
      const summary = runSummary({
        result, score, modeId: mode.id, presetId: preset.id, fieldCount: preset.fields.length, difficulty,
        wallClock: (t) => endedAt - (now - t) * 1000,
      });
      const answers = score.contacts.flatMap(({ contactId, fields }) => {
        const contact = result.contacts.find((item) => item.id === contactId);
        if (!fields || !contact) return [];
        return fieldAnswers(fields, {
          sessionId: live.id, timestamp: endedAt, wpm: wpmOf(contact.stationId), modeId: mode.id, presetId: preset.id, alphabet: preset.alphabet,
        });
      });
      onSave({ id: live.id, startedAt: live.startedAt, endedAt, alphabet: preset.alphabet, summary, answers, evidence: score.evidence, wpm: difficulty.speed });
    }
    // Callers leave with us; the background stays.
    engine.setStations(live.qrm);
    setReview({ result, score, filter: engine.filter, wpmOf: Object.fromEntries(result.contacts.map((contact) => [contact.stationId, wpmOf(contact.stationId)])) });
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
  const status = message ?? {
    text: powered
      ? 'まず周波数を聴き、F6（QRL?）で使用中でないか確かめましょう。返事がなければ F1 で CQ。CQ の合間には呼んでくる局をよく聴いてください'
      : '電源を入れ、周波数を聴いて F6（QRL?）で確かめてから F1 で CQ を出しましょう',
    coach: false,
  };
  const updateForm = (key: keyof LogFields, value: string) => {
    if (key === 'call') setArmed(false);
    setForm((old) => ({ ...old, [key]: value.toUpperCase() }));
  };

  if (review) {
    return (
      <div className="qso-side run-review-wrap">
        <CqRunReview review={review} preset={preset} onRestart={restart} />
      </div>
    );
  }

  return (
    <div className="qso-side run-desk">
      {askProfile && (
        <div className="panel panel-pad run-profile">
          <div className="qso-panel-head"><h2>交換に使う名前と QTH</h2></div>
          <p className="qso-note">CQ Run では F2 で自分の名前と QTH を送ります。ローマ字で入れてください（あとで設定から変えられます）。</p>
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
                  onBlur={() => setPrefs({ templates: memoryTemplates(prefs.templates) })}
                  autoCapitalize="characters"
                  spellCheck={false}
                />
              </label>
            ))}
          </div>
        )}
        <p className="qso-note">
          <kbd>F1</kbd>〜<kbd>F8</kbd> メモリー送信　<kbd>Esc</kbd> CQ リピート停止（送信待ちも取消）　送信中に押したキーは、今の送信が終わるとすぐ送ります。CQ の前に <kbd>F6</kbd> QRL? で周波数が空いているか確かめ、返事があれば VFO を動かして（QSY）確かめ直します。CALL 欄に <code>3AB?</code> と入れて <kbd>F5</kbd> で部分コール。
          正誤は QRT のあとにまとめて表示します。
        </p>
      </div>
    </div>
  );
}

function formatSeconds(seconds: number) {
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}
