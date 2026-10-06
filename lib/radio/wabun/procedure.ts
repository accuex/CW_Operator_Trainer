import type { RxRecord } from '../conditions';
import type { WabunFact } from './scenario';
import type { WabunTxTrace } from './trace';

/**
 * How we ran the QSO, apart from what we took from it. A switch left out, an over not
 * handed back, the station having to ask us for our report, keying over the station:
 * procedure, never copy.wabun or follow.wabun (docs §4). A ラタ correction is an
 * operation worth seeing, not a slip: it is counted, never held against us.
 *
 * Feeds the shared skills.procedure[modeId] (share of overs without a slip) the way the
 * other modes do; nothing here moves a difficulty axis.
 */

export type WabunProcedureKind =
  /** Kana sent with no ホレ before it. */
  | 'no-hore'
  /** A body not closed with ラタ. */
  | 'no-rata'
  /** A reply in Latin only where the QSO is in wabun. */
  | 'roman-only'
  /** An over in the exchange / talk / chat not handed back (no KN / BK / K at its end). */
  | 'no-over-end'
  /** The station had to ask for what our over should have carried (our report, our name). */
  | 'npc-asked'
  /** Something the station was waiting for was not there (our report, TU / E E). */
  | 'missing'
  /** Our call left out when calling. */
  | 'missing-call'
  /** We started keying while the station was still sending (it went on under us, unheard). */
  | 'break-in';

export interface WabunProcedureItem {
  kind: WabunProcedureKind;
  /** Our over it belongs to (index into the traces). */
  over: number;
  /** npc-asked: what it asked for. */
  facts?: WabunFact[];
}

export interface WabunProcedure {
  /** Our overs (on frequency or not). */
  overs: number;
  /** … heard by the station (on frequency). */
  onFrequency: number;
  /** Overs with at least one slip. */
  slips: number;
  items: WabunProcedureItem[];
  /** ラタ corrections sent (an operation, not a slip). */
  corrections: number;
}

/** Tokens that hand the over back. */
const OVER_END = new Set(['K', 'KN', 'BK', 'AR', 'KN?', 'K?']);

/** Was the station keying an over at `t` (started, not yet ended, not cut)? */
export function stationKeying(records: RxRecord[], station: number, t: number, epoch = 0): boolean {
  return records.some((record) => record.station === station && record.epoch === epoch
    && record.tx.start <= t && t < Math.min(record.tx.start + record.tx.length, record.cutAt ?? Number.POSITIVE_INFINITY));
}

/** Our overs, judged for procedure from their traces (what the station heard and asked). */
export function reviewProcedure(traces: WabunTxTrace[]): WabunProcedure {
  const items: WabunProcedureItem[] = [];
  traces.forEach((trace, over) => {
    const add = (kind: WabunProcedureKind, facts?: WabunFact[]) => items.push({ kind, over, ...(facts ? { facts } : {}) });
    for (const note of trace.notes ?? []) add(note);
    if (trace.breakIn) add('break-in');
    if (trace.issue === 'missing-call') add('missing-call');
    if (trace.issue === 'missing-report') add('missing');
    if (trace.request?.length) add('npc-asked', trace.request);
    const tokens = trace.notation.trim().split(/\s+/);
    const asksOnly = !trace.intent.body && !trace.intent.report && (trace.intent.repeat || trace.intent.asks.length > 0 || trace.intent.qrs);
    const handing = (trace.phase === 'exchange' || trace.phase === 'talk' || trace.phase === 'chat') && !trace.intent.closing && !asksOnly;
    if (handing && trace.understood?.heard && !OVER_END.has(tokens.at(-1) ?? '')) add('no-over-end');
  });
  const slipped = new Set(items.map((item) => item.over));
  return {
    overs: traces.length,
    onFrequency: traces.filter((trace) => trace.understood?.heard).length,
    slips: slipped.size,
    items,
    corrections: traces.reduce((sum, trace) => sum + trace.corrections.length, 0),
  };
}
