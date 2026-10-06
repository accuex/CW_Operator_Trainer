import { makeQrm, makeStation, type Station } from '../band';
import { TUNE_TOLERANCE_HZ } from '../qso';
import { WabunDialogue, WABUN_MIN_WPM, type WabunTxResult } from './dialogue';
import { makeWabunScenario, type FistOptions, type WabunLevel, type WabunLoad, type WabunScenario } from './scenario';
import { fistKeyer, wabunKeyer } from './segments';

/**
 * One wabun QSO on the band: the station that calls CQ ホレ (keying segments, so its
 * ホレ / ラタ really switch the alphabet on the air), a little Latin background around
 * it, and the dialogue it runs. The rig, the scope and the copy capture are the shared
 * ones; the view (or the headless sim) only moves text between them.
 */

export interface WabunSessionInit {
  random: () => number;
  /** Our call, sent in Latin. */
  me: string;
  vfo: number;
  wpm: number;
  hour: number;
  /** Background Latin stations. */
  crowd: number;
  /** Learning level: 1 打ち逃げ, 2 和文ラバースタンプ (default). */
  level?: WabunLevel;
  /** The station's level, 0.025–1 (Stage 1: a comfortable signal). */
  strength?: number;
  /** Where it sits from the VFO (Hz); random either side when omitted. */
  offset?: number;
  /** How much the talk carries (Level 3 on; 1 the default). */
  load?: WabunLoad;
  /** Level 5: the fist's kind / strength / fatigue (presets, おまかせ). */
  fist?: FistOptions;
  /** How far it wanders off its frequency (band.ts drift; 0: it stays put). */
  drift?: number;
}

/** How long a station between CQs keeps listening after a caller stands by (it answers sooner: the reply is queued). */
const CQ_LISTEN = 4;

export class WabunSession {
  readonly scenario: WabunScenario;
  readonly dialogue: WabunDialogue;
  readonly target: Station;
  stations: Station[];

  constructor({ random, me, vfo, wpm, hour, crowd, level = 2, strength = 0.6, offset, load, fist, drift = 0 }: WabunSessionInit) {
    this.scenario = makeWabunScenario(random, { wpm, hour, level, load, fist });
    this.dialogue = new WabunDialogue(this.scenario, me);
    const { truth, persona } = this.scenario;
    const away = offset ?? (450 + random() * 1500) * (random() < 0.5 ? -1 : 1);
    this.target = makeStation(random, {
      role: 'target',
      call: truth.call,
      rf: Math.round(vfo + away),
      wpm: persona.wpm,
      strength,
      jitter: persona.fist?.wobble ?? 0.04,
      drift,
      chirp: 0,
      gap: [3, 6],
      loop: () => this.dialogue.cqText(),
      // Level 5: its own hand (fist.ts); below, the book's timing.
      keyer: persona.fist ? fistKeyer(persona.fist) : wabunKeyer,
    });
    this.stations = [this.target, ...makeQrm(random, crowd, vfo, [this.target.rf], 300)];
  }

  get phase() { return this.dialogue.phase; }
  get truth() { return this.scenario.truth; }
  get level() { return this.scenario.level; }
  /** The log is worth filling in once it has told us something. */
  get canLog() { return this.phase !== 'cq'; }

  /**
   * We started keying (`start`–`end` on the engine clock). A station between CQs that
   * hears a carrier on its frequency listens instead of calling CQ again: its loop waits
   * until we stand by. Only a CQ not yet on the air is held: one already keyed (we
   * called over its CQ) goes on, and off its frequency it never heard us, so it keeps
   * calling — both happen on the band.
   */
  onKeying({ start, end }: { start: number; end: number }, offsetHz: number) {
    const station = this.target;
    if (this.phase !== 'cq' || !station.loop || Math.abs(offsetHz) > TUNE_TOLERANCE_HZ) return;
    if (station.busyUntil > start || station.queue.length) return;
    if (station.nextAt <= start) return;
    station.nextAt = Math.max(station.nextAt, end + CQ_LISTEN);
  }

  /** Our transmission ended; the station decides what to send back (the caller keys it). */
  onTransmit(text: string, ctx: { offsetHz: number }): WabunTxResult {
    const result = this.dialogue.onTransmit(text, ctx);
    if (result.slower) {
      this.scenario.persona.wpm = Math.max(WABUN_MIN_WPM, this.scenario.persona.wpm - result.slower);
      this.target.wpm = this.scenario.persona.wpm;
    }
    // Answered: no more CQ loop (a QRZ? keeps it calling).
    if (result.phase !== 'cq') this.target.loop = null;
    return result;
  }

  /** QRT: nobody stays on the band. */
  stop() {
    for (const station of this.stations) {
      station.loop = null;
      station.queue = [];
    }
    this.stations = [];
  }
}
