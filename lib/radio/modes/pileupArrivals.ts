import type { OperatorIntent } from '../air/intent';
import type { Random } from '../random';
import type { ArrivalModel } from './arrivals';

/**
 * How callers come to a pileup. They are already there — the pile is the point — and
 * keep it at about `pile` stations standing by:
 *
 *   rounds (入門・初級): `pile` callers at once; the next round only when every one of
 *     them is worked or gone. A round is a small puzzle with an end.
 *   continuous (中級〜): whoever is worked or leaves is replaced, a few at a time, at
 *     each transmission that tells listeners we are taking calls. The pile never grows
 *     past about `pile` (± a fifth), so waiting callers can't pile up without bound.
 *
 * Either way new callers come only on a transmission that says we listen for calls
 * (CQ, QRZ?, and what a pileup reads as QRZ?: our call alone, TU with our call) —
 * never on a partial or an exchange.
 */

export interface PileupArrivalConfig {
  /** Callers standing by that the frequency settles at. */
  pile: number;
  rounds: boolean;
  /** Continuous: at most this many new callers per transmission. */
  refill: number;
}

/** Continuous piles drift ± this share around `pile`. */
const PILE_SWING = 0.2;

export class PileupArrivals implements ArrivalModel {
  /** Rounds handed out so far (continuous: 1 once the first pile came). */
  rounds = 0;
  private target: number;

  /** `standing`: callers on frequency not being worked (arriving, waiting or standing by). */
  constructor(private random: Random, private config: () => PileupArrivalConfig, private standing: () => number) {
    this.target = config().pile;
  }

  arrivals(intent: OperatorIntent) {
    if (!(intent.cq || intent.qrz)) return 0;
    const { pile, rounds, refill } = this.config();
    const standing = this.standing();
    if (rounds) {
      if (standing > 0) return 0;
      this.rounds += 1;
      return pile;
    }
    if (!this.rounds) {
      // The pile is waiting when we first come on.
      this.rounds = 1;
      return this.target;
    }
    if (standing >= this.target) {
      this.target = this.drawTarget(pile);
      return 0;
    }
    const deficit = this.target - standing;
    this.target = this.drawTarget(pile);
    return Math.min(deficit, Math.max(1, refill));
  }

  private drawTarget(pile: number) {
    const low = Math.max(2, Math.round(pile * (1 - PILE_SWING)));
    const high = Math.max(low, Math.round(pile * (1 + PILE_SWING)));
    return low + Math.floor(this.random() * (high - low + 1));
  }
}
