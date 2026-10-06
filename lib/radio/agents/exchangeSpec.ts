import type { AskField } from '../air/intent';
import type { AgentMe } from './types';

/**
 * What a caller exchanges with us: the fields it needs from us before it sends its own
 * exchange (asked for in this order), and the fields it resends when we ask for them.
 */
export interface ExchangeSpec {
  wants: readonly AskField[];
  sends: readonly AskField[];
  /**
   * 'ragchew': "R JS2WDR DE JA3ABC GM UR 599 599 NAME … QTH … BK", answered TU with its
   * own final. 'dx': just the fields ("R 5NN"), and silence after our TU so the next
   * caller has the frequency. 'contest': the report and its serial ("5NN 023"),
   * silent after our TU like 'dx'.
   */
  style?: 'ragchew' | 'dx' | 'contest';
}

/** RST, name and QTH both ways — the CQ run's exchange. */
export const BASIC_EXCHANGE: ExchangeSpec = { wants: ['RST', 'NAME', 'QTH'], sends: ['RST', 'NAME', 'QTH'] };
/** A pileup's: the report both ways and nothing else. */
export const RST_EXCHANGE: ExchangeSpec = { wants: ['RST'], sends: ['RST'], style: 'dx' };
/** A gentler pileup's: report and name both ways. */
export const RST_NAME_EXCHANGE: ExchangeSpec = { wants: ['RST', 'NAME'], sends: ['RST', 'NAME'], style: 'dx' };

/** A contest's: report and serial both ways; asked for its call (CALL?) it sends that too. */
export const CONTEST_EXCHANGE: ExchangeSpec = { wants: ['RST', 'NR'], sends: ['RST', 'NR', 'CALL'], style: 'contest' };

/** A wanted field we have nothing to send for (no name or QTH set) counts as received. */
export function needsFrom(spec: ExchangeSpec, field: AskField, me: AgentMe) {
  if (!spec.wants.includes(field)) return false;
  if (field === 'NAME') return me.name !== '';
  if (field === 'QTH') return me.qth !== '';
  // Our call is never something a caller waits for from us.
  if (field === 'CALL') return false;
  return true;
}
