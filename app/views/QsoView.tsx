'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnswerLog, AudioSettings, CopyCondition, QsoCause, QsoProfile, SessionRecord, TrainerProfile } from '@/lib/types';
import { formatFrequency, makeQrm, nearestStation } from '@/lib/radio/band';
import { CopyMonitor, markCut, sampleBand, type RxRecord } from '@/lib/radio/conditions';
import { collectEvidence, fieldAnswers, scoreFields, type FieldResult } from '@/lib/radio/attribution';
import { AXES, AXIS_SPECS, adjustDifficulty, describeMove, type Axis, type DifficultyVector, type QsoEvidence } from '@/lib/radio/difficulty';
import { PRESETS } from '@/lib/radio/exchange';
import { QSO_MODES, qsoMode, type QsoSession } from '@/lib/radio/modes';
import { isProcedureIssue, MIN_TARGET_WPM } from '@/lib/radio/qso';
import { FILTERS, RigEngine, type FilterWidth } from '@/lib/radio/rig';
import { ScopeRenderer, hzAtRatio } from '@/lib/radio/scope';
import { modeProgress, normalizeQsoProfile, recommendStage, updateSkills } from '@/lib/radio/skills';
import { traceRx, type QsoTrace } from '@/lib/radio/trace';
import { addQsoTrace } from '@/lib/storage';
import { audioEngine, nowId } from '@/app/trainer/shared';
import { Icon } from '@/app/components/icons';

const START_VFO = 7_012_000;
const SPANS = [2500, 5000, 1250] as const;
const PREFS_KEY = 'cwot.qso.prefs';
const LOGBOOK_SIZE = 30;

const CAUSE_LABEL: Record<Exclude<QsoCause, 'ok'> | 'procedure', string> = {
  copy: '受信ミス', environment: '悪条件', tuning: '同調', procedure: '手順', timing: '聴き逃し',
};
const CONDITION_SHORT: Record<CopyCondition, string> = {
  clean: '', weak: '弱', qsb: 'QSB', qrn: 'QRN', qrm: 'QRM', detuned: 'ずれ', muted: '送信中', unheard: '未',
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
  monitor: CopyMonitor;
  rx: RxRecord[];
  tx: QsoTrace['tx'];
  /** Target WPM when each record went out (QRS changes it). */
  rxWpm: Map<RxRecord, number>;
}

interface Review { fields: FieldResult[]; evidence: QsoEvidence; moved: Partial<Record<Axis, number>>; auto: boolean; received: string[] }

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

  const [powered, setPowered] = useState(false);
  const [vfo, setVfo] = useState(START_VFO);
  const [filter, setFilter] = useState<FilterWidth>(500);
  const [span, setSpan] = useState<(typeof SPANS)[number]>(2500);
  const [hold, setHold] = useState(false);
  const [txOn, setTxOn] = useState(false);
  const [step, setStep] = useState(0);
  const [canLog, setCanLog] = useState(false);
  const [hint, setHint] = useState('電源を入れて、ウォーターフォールで CQ を出している局を探しましょう');
  const [txText, setTxText] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const [log, setLog] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Review | null>(null);
  const [macros, setMacros] = useState<[string, string][]>([]);

  const engineRef = useRef<RigEngine | null>(null);
  const liveRef = useRef<Live | null>(null);
  const scopeRef = useRef<HTMLCanvasElement>(null);
  const fallRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ x: number; vfo: number; moved: boolean; width: number } | null>(null);
  const holdRef = useRef(hold);
  const spanRef = useRef<number>(span);
  const settingsRef = useRef({ myCall, difficulty, modeId: mode.id });
  useEffect(() => {
    holdRef.current = hold;
    spanRef.current = span;
    settingsRef.current = { myCall, difficulty, modeId: mode.id };
  });

  const updateQso = useCallback((change: (qso: QsoProfile) => QsoProfile) => {
    setProfile((old) => ({ ...old, qso: change(normalizeQsoProfile(old.qso)) }));
  }, [setProfile]);
  const updateMode = (change: Partial<ReturnType<typeof modeProgress>>) => {
    updateQso((current) => ({ ...current, modes: { ...current.modes, [mode.id]: { ...modeProgress(current, mode.id, difficulty), ...change } } }));
  };

  const tune = useCallback((hz: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setVfo(hz);
    setVfo(engine.vfo);
  }, []);

  const newStation = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const { myCall, difficulty, modeId } = settingsRef.current;
    const current = qsoMode(modeId);
    const preset = PRESETS[current.presets[0]];
    const session = current.createSession({ random: Math.random, myCall, vfo: engine.vfo, difficulty, preset });
    liveRef.current = { id: `qso-${nowId()}`, startedAt: Date.now(), modeId: current.id, session, monitor: new CopyMonitor(), rx: [], tx: [], rxWpm: new Map() };
    engine.setStations(session.stations);
    setStep(session.step);
    setCanLog(session.canLog);
    setMacros(session.macros({}));
    setLog({});
    setReview(null);
    setSent([]);
  }, []);

  // Engine + scope lifecycle.
  useEffect(() => {
    const engine = new RigEngine(START_VFO);
    engine.pitch = settings.pitch;
    engineRef.current = engine;
    engine.onTransmission = (station, tx) => {
      const live = liveRef.current;
      if (!live || station !== live.session.target) return;
      const record: RxRecord = { tx, epoch: engine.epoch, cutAt: null };
      live.rx.push(record);
      live.rxWpm.set(record, station.wpm);
    };
    engine.onTick = (now) => {
      const live = liveRef.current;
      if (!live) return;
      live.monitor.push(sampleBand({
        t: now,
        epoch: engine.epoch,
        listening: engine.listening,
        vfo: engine.vfo,
        filter: engine.filter,
        noise: engine.levels.noise,
        target: live.session.target,
        stations: engine.stations,
        crash: engine.crashAt(now),
      }));
    };
    newStation();
    engine.start();

    const renderer = scopeRef.current && fallRef.current ? new ScopeRenderer(scopeRef.current, fallRef.current) : null;
    const observer = new ResizeObserver(() => renderer?.resize());
    if (scopeRef.current) observer.observe(scopeRef.current);
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      renderer?.frame({
        t: engine.now(),
        vfo: engine.vfo,
        span: spanRef.current,
        filter: engine.filter,
        noise: engine.levels.noise,
        stations: engine.stations,
        crashes: engine.crashes,
        hold: holdRef.current,
        transmitting: engine.transmitting,
      });
      if (meterRef.current) meterRef.current.style.transform = `scaleX(${engine.meter()})`;
    };
    raf = requestAnimationFrame(frame);
    const onVisibility = () => void engine.setBackground(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      engine.onTick = null;
      engine.onTransmission = null;
      engine.dispose();
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one engine per mount
  }, []);

  useEffect(() => { engineRef.current?.setPitch(settings.pitch); }, [settings.pitch]);
  useEffect(() => {
    engineRef.current?.setLevels({ af: prefs.af, noise: difficulty.noise, qrn: difficulty.qrn, qsb: difficulty.qsb });
  }, [prefs.af, difficulty.noise, difficulty.qrn, difficulty.qsb]);
  useEffect(() => { engineRef.current?.setFilter(filter); }, [filter]);
  useEffect(() => {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  }, [prefs]);

  // Header stop button powers the rig off.
  const firstStop = useRef(stopEpoch);
  useEffect(() => {
    if (stopEpoch === firstStop.current) return;
    void engineRef.current?.powerOff();
    setPowered(false);
    setTxOn(false);
  }, [stopEpoch]);

  // Wheel tuning needs a non-passive listener.
  useEffect(() => {
    const canvases = [scopeRef.current, fallRef.current].filter(Boolean) as HTMLCanvasElement[];
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const engine = engineRef.current;
      if (engine) tune(engine.vfo + Math.sign(event.deltaY) * (event.shiftKey ? 2 : 10));
    };
    for (const canvas of canvases) canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => { for (const canvas of canvases) canvas.removeEventListener('wheel', onWheel); };
  }, [tune]);

  const powerToggle = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    if (engine.powered) {
      await engine.powerOff();
      setPowered(false);
      return;
    }
    audioEngine.stop();
    try {
      await engine.powerOn();
      setPowered(true);
      if (step === 0) setHint('ウォーターフォールの局をクリックすると同調します。CQ を出している局を探しましょう');
    } catch {
      setHint('このブラウザでは音声を出せませんでした');
    }
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, vfo: engineRef.current?.vfo ?? vfo, moved: false, width: event.currentTarget.getBoundingClientRect().width };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (drag.moved) tune(drag.vfo - (dx / drag.width) * span * 2);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const engine = engineRef.current;
    if (!drag || drag.moved || !engine) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const hz = hzAtRatio((event.clientX - rect.left) / rect.width, engine.vfo, span);
    const near = nearestStation(engine.stations, hz, span * 0.04);
    tune(near ? near.rf : hz);
  };
  const onRigKey = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    const delta = event.shiftKey ? 50 : 10;
    if (event.key === 'ArrowLeft') { event.preventDefault(); tune(vfo - delta); }
    if (event.key === 'ArrowRight') { event.preventDefault(); tune(vfo + delta); }
  };

  const transmit = async (raw: string) => {
    const engine = engineRef.current;
    const live = liveRef.current;
    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!engine || !live || !text || txOn) return;
    if (!engine.powered) { setHint('先に電源を入れてください'); return; }
    if (!myCall) { setHint('設定で自分のコールサインを入れてください'); return; }
    setTxText('');
    setSent((list) => [...list, text]);
    setTxOn(true);
    await engine.transmit(text, difficulty.speed);
    setTxOn(false);
    if (engineRef.current !== engine || liveRef.current !== live || !engine.powered) return;
    const { session } = live;
    const offsetHz = engine.vfo - session.target.rf;
    const reply = session.onTransmit(text, { offsetHz });
    live.tx.push({ at: Date.now(), text, offsetHz: Math.round(offsetHz), issue: reply.issue });
    setHint(reply.hint);
    setStep(session.step);
    setCanLog(session.canLog);
    if (!reply.reply) return;
    const now = engine.now();
    engine.cut(session.target);
    markCut(live.rx, engine.epoch, now);
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
    if (!engine || !live || review) return;
    const { session } = live;
    const now = { t: engine.now(), epoch: engine.epoch };
    const fields = scoreFields(session.preset, session.truth(), log, live.rx, live.monitor, now);
    const offFrequency = live.tx.filter((event) => event.issue === 'off-frequency').length;
    const evidence = collectEvidence(fields, {
      total: live.tx.length,
      onFrequency: live.tx.length - offFrequency,
      procedure: live.tx.filter((event) => isProcedureIssue(event.issue)).length,
    });
    const correctFields = fields.filter((field) => field.correct).length;
    const current = modeProgress(qso, live.modeId, difficulty);
    const adjusted = current.auto
      ? adjustDifficulty({ difficulty: current.difficulty as DifficultyVector, votes: current.votes }, evidence, current.pinned)
      : { difficulty: current.difficulty as DifficultyVector, votes: current.votes, moved: {} };
    const endedAt = Date.now();
    updateQso((old) => {
      const base = modeProgress(old, live.modeId, difficulty);
      const next = updateSkills(old, { modeId: live.modeId, alphabet: session.preset.alphabet, wpm: difficulty.speed, evidence });
      return {
        ...next,
        modes: {
          ...next.modes,
          [live.modeId]: {
            ...base,
            qsos: base.qsos + 1,
            perfect: base.perfect + (correctFields === fields.length ? 1 : 0),
            lastAt: endedAt,
            difficulty: adjusted.difficulty,
            votes: adjusted.votes,
          },
        },
      };
    });

    const answers = fieldAnswers(fields, {
      sessionId: live.id, timestamp: endedAt, wpm: difficulty.speed, modeId: live.modeId, presetId: session.preset.id, alphabet: session.preset.alphabet,
    });
    recordMany(answers);
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
        outcome: session.step >= mode.steps.length - 1 ? 'complete' : 'partial',
        fields: fields.length,
        fieldsCorrect: correctFields,
        cleanAccuracy,
        causes: evidence.causes,
        difficulty: { ...difficulty },
        adjusted: adjusted.moved,
      },
    });
    const rx = traceRx(live.rx, live.monitor, now, (record) => live.rxWpm.get(record) ?? session.target.wpm);
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
    }).catch(() => undefined);
    // What actually went out, without the CQ loop repeating itself.
    const received = rx.filter((record) => !/^u*$/.test(record.conditions)).map((record) => record.text)
      .filter((text, index, list) => text !== list[index - 1]);
    setReview({ fields, evidence, moved: adjusted.moved, auto: current.auto, received });
  };

  const setCrowd = (crowd: number) => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live) return;
    const qrm = engine.stations.filter((station) => station.role === 'qrm');
    const next = crowd < qrm.length ? qrm.slice(0, crowd) : [...qrm, ...makeQrm(Math.random, crowd - qrm.length, engine.vfo, [live.session.target.rf])];
    engine.setStations([live.session.target, ...next]);
  };

  const setAxis = (axis: Axis, value: number) => {
    updateMode({ difficulty: { ...difficulty, [axis]: value } });
    if (axis === 'crowd') setCrowd(value);
  };

  const applyAdvice = () => {
    if (!advice.preset) return;
    updateMode({ difficulty: { ...difficulty, ...advice.preset } });
    if (advice.preset.crowd !== undefined) setCrowd(advice.preset.crowd);
  };

  const togglePin = (axis: Axis) => {
    const pinned = progress.pinned.includes(axis) ? progress.pinned.filter((item) => item !== axis) : [...progress.pinned, axis];
    updateMode({ pinned });
  };

  const freq = formatFrequency(vfo);
  const preset = PRESETS[mode.presets[0]];
  const logbook = useMemo(() => sessions.filter((session) => session.qso).slice(-LOGBOOK_SIZE).reverse(), [sessions]);
  const fieldResult = (key: string) => review?.fields.find((field) => field.key === key);

  return <section className="page-pad qso-page">
    <div className="page-title">
      <div>
        <p className="section-kicker">QSO SIMULATOR</p>
        <h1>QSO シミュレーター</h1>
        <p>バンドを聴いて CQ を出している局を探し、呼んで、レポートを書き取り、73 で締める。混信・ノイズ・フェージングの中で 1 交信を完成させましょう。</p>
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

    <div className="qso-advice">
      <span className="chip gold">おすすめ {advice.stage}</span>
      <p><b>{advice.title}</b> — {advice.reason}</p>
      {advice.preset && <button type="button" className="btn btn-ghost btn-sm" onClick={applyAdvice}>この条件にする</button>}
    </div>

    <div className="qso-grid">
      <div className={`qso-rig ${powered ? 'on' : 'off'}`} tabIndex={0} onKeyDown={onRigKey} aria-label="受信機。左右キーで周波数を変えます">
        <div className="rig-top">
          <button type="button" className={`rig-power ${powered ? 'on' : ''}`} onClick={powerToggle} aria-pressed={powered}>
            <span aria-hidden="true" />POWER
          </button>
          <span className={`rig-lamp tx ${txOn ? 'on' : ''}`}>TX</span>
          <span className="rig-tag mode">CW</span>
          <span className="rig-tag">FIL {filter >= 1000 ? `${filter / 1000}k` : filter}</span>
          <div className="rig-freq" aria-live="off"><span>{freq.main}</span>.<small>{freq.sub}</small></div>
        </div>
        <div className="rig-meter">
          <span>S</span>
          <div className="rig-smeter"><i ref={meterRef} /></div>
          <span className="rig-scale">1 · 3 · 5 · 7 · 9 · +20 · +40</span>
        </div>
        <div className="rig-scope-head"><span>−{span / 1000}k</span><span>SCOPE · CENTER</span><span>+{span / 1000}k</span></div>
        <canvas ref={scopeRef} className="rig-scope" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { dragRef.current = null; }} />
        <canvas ref={fallRef} className="rig-fall" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={() => { dragRef.current = null; }} />
        {!powered && (
          <button type="button" className="rig-poweron" onClick={powerToggle}>
            <Icon name="volume" size={20} />電源を入れて受信する
          </button>
        )}
        <div className="rig-keys">
          {FILTERS.map((width, index) => (
            <button key={width} type="button" className={filter === width ? 'on' : ''} onClick={() => setFilter(width)}>
              FIL{index + 1}<small>{width >= 1000 ? `${width / 1000}k` : width}</small>
            </button>
          ))}
          <button type="button" onClick={() => setSpan(SPANS[(SPANS.indexOf(span) + 1) % SPANS.length])}>SPAN<small>±{span / 1000}k</small></button>
          <button type="button" className={hold ? 'on' : ''} onClick={() => setHold(!hold)}>HOLD<small>{hold ? 'ON' : 'OFF'}</small></button>
          <button type="button" onClick={() => tune(vfo - 50)} aria-label="50 Hz 下げる">◀<small>−50</small></button>
          <button type="button" onClick={() => tune(vfo + 50)} aria-label="50 Hz 上げる">▶<small>+50</small></button>
        </div>
      </div>

      <div className="qso-side">
        <div className="panel panel-pad qso-status">
          <ol className="qso-steps">
            {mode.steps.map((item, index) => (
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
            <button type="button" className="btn btn-success btn-block" onClick={newStation}>次の局を探す</button>
          ) : (
            <div className="qso-log-actions">
              <button type="button" className="btn btn-primary" onClick={submitLog} disabled={!canLog}>ログ確定</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={newStation}>別の局にする</button>
            </div>
          )}
        </div>
      </div>
    </div>

    {review && <QsoReview review={review} />}

    <div className="qso-bottom">
      <div className="panel panel-pad qso-settings">
        <div className="qso-panel-head">
          <h2>難易度</h2>
          <label className="qso-auto">
            <input type="checkbox" checked={progress.auto} onChange={(event) => updateMode({ auto: event.target.checked })} />
            おまかせ調整
          </label>
        </div>
        <p className="qso-note">
          おまかせ調整は交信の成否ではなく、ミスの原因ごとに軸を動かします（受信ミス→速さ、混信下のミス→混信局 など）。
          <Icon name="lock" size={12} /> で固定した軸は動かしません。
        </p>
        <div className="qso-axes">
          {AXES.map((axis) => {
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
        <div className="qso-rig-prefs">
          <label className="qso-mycall">
            <span>自分のコールサイン</span>
            <input value={myCall} onChange={(event) => updateQso((old) => ({ ...old, myCall: event.target.value.toUpperCase().replace(/[^A-Z0-9/]/g, '') }))} maxLength={10} autoCapitalize="characters" spellCheck={false} />
          </label>
          <label>AF 音量 <b>{Math.round(prefs.af * 100)}</b><input type="range" min={0} max={1} step={0.01} value={prefs.af} onChange={(event) => setPrefs({ ...prefs, af: Number(event.target.value) })} /></label>
        </div>
        <p className="qso-note">速さ・弱信号・ドリフトは次の局から反映されます（QRS で相手を遅くできます）。ピッチは全体の設定に従います。</p>
      </div>

      <div className="panel panel-pad qso-logbook">
        <div className="qso-panel-head"><h2>交信記録</h2><small>{progress.qsos} QSO</small></div>
        {logbook.length ? (
          <ol>
            {logbook.map((entry) => (
              <li key={entry.id}>
                <time>{new Date(entry.endedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time>
                <b>{entry.qso!.call}</b>
                <span className={entry.qso!.fieldsCorrect === entry.qso!.fields ? 'perfect' : ''}>{entry.qso!.fieldsCorrect}/{entry.qso!.fields}</span>
              </li>
            ))}
          </ol>
        ) : <p className="qso-note">まだ交信がありません。最初の 1 局を探しましょう。</p>}
      </div>
    </div>

    <p className="qso-help">
      <kbd>クリック</kbd> 局に同調　<kbd>ドラッグ</kbd>・<kbd>ホイール</kbd> VFO（<kbd>Shift</kbd> で細かく）　<kbd>←</kbd><kbd>→</kbd> 10 Hz。
      スコープはフィルタを通す前のバンド全体です。FIL を狭めると隣の局とノイズが実際に消えます。
    </p>
  </section>;
}

/** Post-QSO review: which characters were missed, and why. */
function QsoReview({ review }: { review: Review }) {
  const { fields, evidence, moved, auto, received } = review;
  const causes = (Object.keys(CAUSE_LABEL) as (keyof typeof CAUSE_LABEL)[]).filter((cause) => evidence.causes[cause] > 0);
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
      <div className="qso-review-fields">
        {fields.map((field) => (
          <div key={field.key} className="qso-review-row">
            <span>{field.label}</span>
            <div className="qso-chars">
              {field.cells.map((cell, index) => (
                <i key={index} className={`cause-${cell.cause} op-${cell.op}`} title={cell.op === 'match' ? '正解' : `${cell.expected || '—'} → ${cell.input || '（なし）'}`}>
                  {cell.expected || cell.input}
                  {cell.op !== 'ins' && CONDITION_SHORT[cell.condition] && <small>{CONDITION_SHORT[cell.condition]}</small>}
                </i>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="qso-note">
        {!auto ? 'おまかせ調整はオフです。'
          : moves.length ? `次の局から: ${moves.join('、')}`
            : '難易度はそのまま（もう少し様子を見ます）。'}
        {' '}悪条件で落とした文字は苦手分析に入りません（分析画面のスイッチで表示できます）。
      </p>
      <details className="qso-reveal">
        <summary>相手局が送った電文</summary>
        <ul>{received.map((line, index) => <li key={index}>{line}</li>)}</ul>
      </details>
    </div>
  );
}
