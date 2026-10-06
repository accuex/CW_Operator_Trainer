import { makeQrm, makeStation, type Station } from '../band';
import {
  cqText,
  makeTarget,
  MIN_TARGET_WPM,
  respond,
  TUNE_TOLERANCE_HZ,
  type QsoPhase,
  type QsoTarget,
  type TxResult,
} from '../qso';
import type { Random } from '../random';

/** Quiet band: the lesson is tuning and procedure, not fighting noise. */
export const DEMO_RIG_LEVELS = { noise: 0.2, qrn: 0.12, qsb: 0.12 } as const;
export const DEMO_WPM = 20;
const CQ_LISTEN = 4;

export type DemoGuideStep = 'find' | 'call' | 'report' | 'done';

export interface DemoAction {
  id: 'call' | 'report';
  label: string;
  text: string;
}

/**
 * Karaoke-style guided rag-chew: tune to a prepared CQ, send the lit line, hear the reply.
 * Reuses the same phase machine as the live ラグチュー desk (`respond`).
 */
export class DemoSession {
  info!: QsoTarget;
  target!: Station;
  qrm: Station[] = [];
  phase: QsoPhase = 'cq';
  round = 1;
  private myCall = 'JA1ZZZ';

  constructor(private readonly random: Random) {}

  start(vfo: number, myCall: string) {
    this.myCall = (myCall || 'JA1ZZZ').toUpperCase();
    this.phase = 'cq';
    this.place(vfo);
  }

  nextRound(vfo: number) {
    this.round += 1;
    this.phase = 'cq';
    this.place(vfo);
  }

  get stations(): Station[] {
    return [this.target, ...this.qrm];
  }

  offsetHz(vfo: number) {
    return Math.round(vfo - this.target.rf);
  }

  tuned(vfo: number) {
    return Math.abs(this.offsetHz(vfo)) <= TUNE_TOLERANCE_HZ;
  }

  guide(vfo: number): DemoGuideStep {
    if (this.phase === 'done') return 'done';
    if (this.phase === 'report') return 'report';
    return this.tuned(vfo) ? 'call' : 'find';
  }

  /** The one scripted line that advances the scenario right now. */
  action(vfo: number): DemoAction | null {
    const step = this.guide(vfo);
    if (step === 'call') {
      return { id: 'call', label: '呼ぶ', text: `${this.info.call} DE ${this.myCall} ${this.myCall} K` };
    }
    if (step === 'report') {
      return {
        id: 'report',
        label: 'レポートを返す',
        text: `R TNX ${this.info.name} UR 599 599 NAME TARO QTH TOKYO 73 TU`,
      };
    }
    return null;
  }

  hint(vfo: number, powered: boolean): string {
    if (!powered) return 'POWER を入れて、滝に出ている CQ を探しましょう';
    const step = this.guide(vfo);
    const off = this.offsetHz(vfo);
    if (step === 'find') {
      const dir = off > 0 ? '下（低い方）' : '上（高い方）';
      return `いちばん強いピークが相手の CQ。クリックか「CQに同調」で合わせる。いま ${Math.abs(off)} Hz ${dir}（±${TUNE_TOLERANCE_HZ} Hz）`;
    }
    if (step === 'call') return '同調OK。下の「呼ぶ」を押して送信しましょう';
    if (step === 'report') return '相手のレポートを聴いたら、「レポートを返す」を押しましょう';
    return '73 まで終わりました。「次のシナリオ」で続けられます';
  }

  onTransmit(text: string, vfo: number): TxResult {
    const result = respond(this.phase, this.info, text, {
      myCall: this.myCall,
      offsetHz: this.offsetHz(vfo),
    });
    if (result.slower) {
      this.info.wpm = Math.max(MIN_TARGET_WPM, this.info.wpm - result.slower);
      this.target.wpm = this.info.wpm;
    }
    if (result.reply && result.phase !== 'cq') this.target.loop = null;
    this.phase = result.phase;
    return result;
  }

  onKeying(span: { start: number; end: number }, vfo: number) {
    if (this.phase !== 'cq' || !this.target.loop || !this.tuned(vfo)) return;
    if (this.target.busyUntil > span.start || this.target.queue.length || this.target.nextAt <= span.start) return;
    this.target.nextAt = Math.max(this.target.nextAt, span.end + CQ_LISTEN);
  }

  private place(vfo: number) {
    this.info = makeTarget(this.random, DEMO_WPM);
    this.info.wpm = DEMO_WPM;
    // Far enough that 「CQに同調」slews through a clear pitch sweep (nyuuuiin), still inside ±2.5k SPAN.
    const offset = (1400 + this.random() * 700) * (this.random() < 0.5 ? -1 : 1);
    this.target = makeStation(this.random, {
      role: 'target',
      call: this.info.call,
      rf: Math.round(vfo + offset),
      wpm: this.info.wpm,
      strength: 0.88,
      jitter: 0.03,
      drift: 0,
      chirp: 0,
      gap: [3, 5],
      loop: () => cqText(this.info),
    });
    this.qrm = makeQrm(this.random, 2, vfo, [this.target.rf], 400).map((station) => {
      station.strength = 0.08 + this.random() * 0.1;
      return station;
    });
  }
}
