import type { Ether } from '../air/ether';
import type { Agent, AgentNote } from '../agents/types';

/**
 * Keeping a frequency to run on: QRL? and listening after it, whether a frequency is
 * in use, which frequencies are ours (`held`), and the record procedure badges and the
 * review count from. Read from the shared air, never from a UI's queue.
 */

/** "In use": someone else keyed within ±BUSY_HZ of our frequency in the last BUSY_SECONDS. */
export const BUSY_HZ = 250;
export const BUSY_SECONDS = 20;
/** A QRL? counts for a CQ within this many Hz and seconds of it. */
export const QRL_HZ = 100;
export const QRL_VALID = 60;
/** Seconds to listen after QRL? before the frequency counts as checked. */
export const QRL_LISTEN = 3;

/**
 * What a frequency check says right now: 'none' — no QRL? pending here; 'listening' — QRL?
 * sent, still inside the listen window; 'busy' — someone was heard; 'clear' — listened, nothing.
 */
export type FrequencyCheck = { state: 'none' } | { state: 'listening'; until: number } | { state: 'busy' } | { state: 'clear' };

/** A frequency we called CQ on (the record procedure badges will count from). */
export interface FrequencyUse {
  rf: number;
  firstCqAt: number;
  /** We sent QRL? there before the first CQ. */
  qrlFirst: boolean;
  /** Seconds we listened between that QRL? ending and the first CQ (null: no QRL?). */
  qrlListen: number | null;
  lastCqAt: number;
  /** CQs we sent there while it was in use. */
  busyCqs: number;
  /** Times a station there asked us to QSY. */
  qsyAsked: number;
  /**
   * A CQ went out there clear: the frequency is ours. Someone who turns up later is QRM on
   * our run, not a frequency in use — only the QSOs that were there before us still count.
   */
  held?: boolean;
}

/** Procedure slips a CQ can make on the frequency (see RunIssue). */
export type FrequencyIssue = 'cq-without-qrl' | 'busy-frequency' | 'qrl-no-listen';

/** Who is on the air, as the keeper needs to tell them apart. */
export interface KeeperAir {
  ether: Ether;
  /** Our callers (never "in use"). */
  callers(): readonly Agent[];
  /** Stations that were on the band regardless of us. */
  residents(): readonly Agent[];
}

export class FrequencyKeeper {
  /** QRL?s we sent; `busy` is judged once its listen is over, while the air still remembers it. */
  private qrls: { rf: number; at: number; end: number; busy?: boolean }[] = [];
  private frequencyList: FrequencyUse[] = [];
  private qrlNoListen = 0;

  constructor(private air: KeeperAir) {}

  get frequencies(): readonly FrequencyUse[] { return this.frequencyList; }

  /** Is `rf` in use by someone other than us and our callers, as heard on the air by `at`? */
  busy(rf: number, at: number, held = false) {
    const ours = new Set<number>(this.air.callers().map((agent) => agent.id));
    const residents = new Set<number>(this.air.residents().map((agent) => agent.id));
    const ignore = (party: number | 'me') => party === 'me' || ours.has(party as number) || (held && !residents.has(party as number));
    return this.air.ether.activeNear(rf, BUSY_HZ, at - BUSY_SECONDS, ignore, at);
  }

  /** The QRL? on `rf` not yet followed by a CQ there, if it is recent enough to count. */
  private pendingQrl(rf: number, at: number) {
    const qrl = [...this.qrls].reverse().find((item) => Math.abs(item.rf - rf) <= QRL_HZ && item.at < at && at - item.end <= QRL_VALID);
    if (!qrl) return null;
    const use = this.frequencyList.find((item) => Math.abs(item.rf - rf) <= QRL_HZ);
    return use && use.lastCqAt > qrl.at ? null : qrl;
  }

  /**
   * Where the check of `rf` stands at `now`, read from the air: after a QRL? we listen
   * QRL_LISTEN seconds, and anyone heard near the frequency meanwhile makes it busy.
   */
  check(rf: number, now: number): FrequencyCheck {
    const qrl = this.pendingQrl(rf, now);
    if (!qrl) return { state: 'none' };
    if (this.busy(rf, now)) return { state: 'busy' };
    const until = qrl.end + QRL_LISTEN;
    return now < until ? { state: 'listening', until } : { state: 'clear' };
  }

  /** A CQ of ours starts on `rf` at `start`: record the frequency. Returns whether it was in use, and the slip if any. */
  onCq(rf: number, start: number): { busy: boolean; issue: FrequencyIssue | null } {
    let use = this.frequencyList.find((item) => Math.abs(item.rf - rf) <= QRL_HZ);
    const busy = this.busy(rf, start, use?.held);
    const qrl = this.pendingQrl(rf, start);
    const asked = qrl !== null || this.qrls.some((item) => Math.abs(item.rf - rf) <= QRL_HZ && item.at < start && start - item.end <= QRL_VALID);
    const listened = qrl ? Math.max(0, start - qrl.end) : null;
    if (!use) {
      use = { rf, firstCqAt: start, qrlFirst: asked, qrlListen: listened, lastCqAt: start, busyCqs: 0, qsyAsked: 0 };
      this.frequencyList.push(use);
    }
    use.lastCqAt = start;
    if (!busy) use.held = true;
    let issue: FrequencyIssue | null = null;
    if (busy) {
      use.busyCqs += 1;
      issue = asked ? 'busy-frequency' : 'cq-without-qrl';
    } else if (listened !== null && listened < QRL_LISTEN) {
      issue = 'qrl-no-listen';
      this.qrlNoListen += 1;
    }
    return { busy, issue };
  }

  /** A QRL? of ours on `rf`. */
  onQrl(rf: number, start: number, end: number) {
    this.qrls.push({ rf, at: start, end });
  }

  /** A station using the frequency asked us to move. */
  onNote(note: AgentNote) {
    if (note.type !== 'qsy-asked') return;
    const rf = note.agent.station.rf;
    const use = [...this.frequencyList].reverse().find((item) => Math.abs(item.rf - rf) <= BUSY_HZ);
    if (use) use.qsyAsked += 1;
  }

  /** Was each QRL?'s frequency in use? Judged as its listen ends (or at `now`, at the latest). */
  judge(now: number, final = false) {
    for (const qrl of this.qrls) {
      if (qrl.busy !== undefined || (!final && now < qrl.end + QRL_LISTEN)) continue;
      qrl.busy = this.busy(qrl.rf, Math.min(now, qrl.end + QRL_LISTEN));
    }
  }

  /** The keeper's numbers at QRT. */
  stats(now: number) {
    return {
      /** CQs sent on a frequency in use. */
      busyCqs: this.frequencyList.reduce((sum, use) => sum + use.busyCqs, 0),
      /** First CQs sent before listening out a QRL?. */
      qrlNoListen: this.qrlNoListen,
      /**
       * Frequencies checked as they should be: QRL?, listened QRL_LISTEN s or more, nobody
       * there, then CQ (never in use while we called there).
       */
      frequencyChecks: this.frequencyList.filter((use) => use.qrlFirst && use.qrlListen !== null && use.qrlListen >= QRL_LISTEN && use.busyCqs === 0).length,
      /** Frequencies a QRL? found in use (answered, or heard busy) that we left without a CQ. */
      busyAvoided: this.busyAvoided(now),
    };
  }

  /** QRL?s that found the frequency in use, with no CQ of ours there afterwards — one per frequency. */
  private busyAvoided(now: number) {
    this.judge(now, true);
    const avoided: number[] = [];
    for (const qrl of this.qrls) {
      const cqAfter = this.frequencyList.some((use) => Math.abs(use.rf - qrl.rf) <= QRL_HZ && use.lastCqAt > qrl.at);
      if (cqAfter || avoided.some((rf) => Math.abs(rf - qrl.rf) <= QRL_HZ)) continue;
      if (qrl.busy) avoided.push(qrl.rf);
    }
    return avoided.length;
  }
}
