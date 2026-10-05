'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Station, Transmission } from '@/lib/radio/band';
import { CopyMonitor, sampleBand, type RxRecord } from '@/lib/radio/conditions';
import { RigEngine, type FilterWidth, type RigLevels } from '@/lib/radio/rig';
import { ScopeRenderer } from '@/lib/radio/scope';
import { audioEngine } from '@/app/trainer/shared';

export const START_VFO = 7_012_000;
export const SPANS = [2500, 5000, 1250] as const;
export type Span = (typeof SPANS)[number];

/**
 * What one practice session heard: every transmission of a copied station and the
 * band conditions around each of them. A fresh capture starts with each session.
 */
export interface Capture {
  monitor: CopyMonitor;
  rx: RxRecord[];
  /** WPM each record went out at (QRS changes it mid-session). */
  rxWpm: Map<RxRecord, number>;
}

/** Stations whose copy gets judged. Background QRM is only ever interference. */
export const isCopied = (station: Station) => station.role !== 'qrm';

export type PowerResult = 'on' | 'off' | 'failed';

/** Every station message the rig schedules, background QRM included (absolute times, `epoch`). */
export type StationTap = (station: Station, tx: Transmission, epoch: number) => void;
export type KeyedSpan = { start: number; end: number; epoch: number };

export interface UseRigOptions {
  pitch: number;
  /** Header stop button: powers the rig off when it changes. */
  stopEpoch: number;
  levels: Pick<RigLevels, 'af' | 'noise' | 'qrn' | 'qsb'>;
}

/**
 * One receiver shared by every QSO mode: engine lifecycle, scope/waterfall,
 * tuning gestures and the copy capture. Modes only decide who is on the band and
 * what they say. The engine exists from the first effect on, so a caller's own
 * later effects can put stations on it.
 */
export function useRig({ pitch, stopEpoch, levels }: UseRigOptions) {
  const [powered, setPowered] = useState(false);
  const [vfo, setVfo] = useState(START_VFO);
  const [filter, setFilter] = useState<FilterWidth>(500);
  const [span, setSpan] = useState<Span>(2500);
  const [hold, setHold] = useState(false);
  const [txOn, setTxOn] = useState(false);

  const engineRef = useRef<RigEngine | null>(null);
  const captureRef = useRef<Capture | null>(null);
  /** A mode that keeps its own air (CQ run) listens here. */
  const tapRef = useRef<StationTap | null>(null);
  const scopeRef = useRef<HTMLCanvasElement>(null);
  const fallRef = useRef<HTMLCanvasElement>(null);
  const meterRef = useRef<HTMLElement>(null);
  const holdRef = useRef(hold);
  const spanRef = useRef<number>(span);
  useEffect(() => {
    holdRef.current = hold;
    spanRef.current = span;
  });

  const newCapture = useCallback((): Capture => {
    const capture = { monitor: new CopyMonitor(), rx: [], rxWpm: new Map() };
    captureRef.current = capture;
    return capture;
  }, []);

  // Engine + scope lifecycle.
  useEffect(() => {
    const engine = new RigEngine(START_VFO);
    engine.pitch = pitch;
    engineRef.current = engine;
    engine.onTransmission = (station, tx) => {
      tapRef.current?.(station, tx, engine.epoch);
      const capture = captureRef.current;
      if (!capture || !isCopied(station)) return;
      const record: RxRecord = { tx, station: station.id, epoch: engine.epoch, cutAt: null };
      capture.rx.push(record);
      capture.rxWpm.set(record, station.wpm);
    };
    engine.onTick = (now) => {
      const capture = captureRef.current;
      if (!capture) return;
      for (const station of engine.stations) {
        if (!isCopied(station)) continue;
        capture.monitor.push(sampleBand({
          t: now,
          epoch: engine.epoch,
          listening: engine.listening,
          vfo: engine.vfo,
          filter: engine.filter,
          noise: engine.levels.noise,
          target: station,
          stations: engine.stations,
          crash: engine.crashAt(now),
        }));
      }
    };
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

  useEffect(() => { engineRef.current?.setPitch(pitch); }, [pitch]);
  useEffect(() => {
    engineRef.current?.setLevels({ af: levels.af, noise: levels.noise, qrn: levels.qrn, qsb: levels.qsb });
  }, [levels.af, levels.noise, levels.qrn, levels.qsb]);
  useEffect(() => { engineRef.current?.setFilter(filter); }, [filter]);

  // Header stop button powers the rig off.
  const firstStop = useRef(stopEpoch);
  useEffect(() => {
    if (stopEpoch === firstStop.current) return;
    void engineRef.current?.powerOff();
    setPowered(false);
    setTxOn(false);
  }, [stopEpoch]);

  const tune = useCallback((hz: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setVfo(hz);
    setVfo(engine.vfo);
  }, []);

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

  const powerToggle = async (): Promise<PowerResult> => {
    const engine = engineRef.current;
    if (!engine) return 'failed';
    if (engine.powered) {
      await engine.powerOff();
      setPowered(false);
      return 'off';
    }
    // The trainer's own player and the rig must not talk over each other.
    audioEngine.stop();
    try {
      await engine.powerOn();
      setPowered(true);
      return 'on';
    } catch {
      return 'failed';
    }
  };

  /**
   * Key `text` on the air. True when it went out completely on the same, still powered rig.
   * `onKeyed` hears the on-air span the moment it is fixed (before the audio starts).
   */
  const transmit = async (text: string, wpm: number, onKeyed?: (span: KeyedSpan) => void) => {
    const engine = engineRef.current;
    if (!engine?.powered) return false;
    setTxOn(true);
    await engine.transmit(text, wpm, wpm, onKeyed);
    setTxOn(false);
    return engineRef.current === engine && engine.powered;
  };

  return {
    engineRef,
    captureRef,
    tapRef,
    scopeRef,
    fallRef,
    meterRef,
    powered,
    vfo,
    filter,
    span,
    hold,
    txOn,
    setFilter,
    setHold,
    cycleSpan: () => setSpan(SPANS[(SPANS.indexOf(span) + 1) % SPANS.length]),
    tune,
    powerToggle,
    transmit,
    newCapture,
  };
}

export type Rig = ReturnType<typeof useRig>;
