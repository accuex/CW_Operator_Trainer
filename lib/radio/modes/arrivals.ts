import type { OperatorIntent } from '../air/intent';
import { poisson, type Random } from '../random';

/**
 * How new callers come to a run. The run asks at each transmission of ours; the model
 * says how many tune in, and they arrive as that transmission ends.
 */
export interface ArrivalModel {
  /** Our transmission `intent` starts at `start`; `busy`: it is a CQ on a frequency in use. */
  arrivals(intent: OperatorIntent, start: number, busy: boolean): number;
}

/** Listeners who found us this long ago or more have moved on: arrivals count at most this window. */
export const ARRIVAL_WINDOW = 45;
/** Who is already tuned to the frequency when our first CQ goes out (seconds' worth of arrivals). */
const FIRST_WINDOW = 20;
/** Callers who still come to a CQ on top of someone else's QSO. */
export const BUSY_ARRIVALS = 0.3;
/** A bare QRZ? (no call of ours) is found by half as many. */
const QRZ_ARRIVALS = 0.5;

/**
 * A CQ run's listeners: they tune in at a steady rate (`perMinute`) and call when they
 * hear who we are; patience and re-calls live on the callers. Together they settle the
 * crowd — nothing caps it. Per minute, not per CQ: repeating CQ faster doesn't bring
 * more people to the band.
 */
export class CqArrivals implements ArrivalModel {
  /** Start of the transmission that last let new listeners find us. */
  private foundAt: number | null = null;

  constructor(private random: Random, private perMinute: () => number) {}

  arrivals(intent: OperatorIntent, start: number, busy: boolean) {
    const found = intent.mentionsMe && (intent.cq || intent.qrz || intent.closing);
    if (!found && !intent.qrz) return 0;
    const window = Math.min(ARRIVAL_WINDOW, start - (this.foundAt ?? start - FIRST_WINDOW));
    this.foundAt = start;
    const mean = (this.perMinute() / 60) * window * (found ? 1 : QRZ_ARRIVALS) * (busy ? BUSY_ARRIVALS : 1);
    return poisson(this.random, mean);
  }
}
