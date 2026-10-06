import type { Random } from '../random';
import { LOST, type Heard } from '../pileup/ear';
import { mergeRepeats, PileupBot, type BotAction, type BotProfile, type BotSense, type Partner } from '../pileup/bot';
import { serialIn } from './intent';
import { formatSerial, isContestCall, PLAIN_SERIAL } from './serial';

/**
 * A scripted contest runner for the headless simulator: the pileup bot's ear and pick
 * (whole call → work it, pieces → partial, signals → AGN?), with the contest exchange.
 *
 *   CQ TEST → a call copied → "{CALL} 5NN {NR}"
 *   its report and serial back → log them, "TU {MYCALL}"
 *   its report but the serial lost → "NR?" (twice at most), then logs what it has
 *   a station it has in the log already → "{CALL} QSO B4" (or works it again)
 *
 * Like the pileup bot it decides only from what it copied, never from the truth.
 */

export interface ContestBotLog { call: string; rst: string; nr: string; at: number }

export interface ContestBotOptions {
  /** What it does with a station it has worked: tell it QSO B4, or work it again (a dupe in the log). */
  dupes: 'b4' | 'work';
}

const RST = /^[1-5][1-9N][1-9N]$/;
/** A contest report (always 5xx): where the exchange splits. */
const REPORT = /^5[1-9N][1-9N]$/;
const MAX_NR_ASKS = 2;

export class ContestBot extends PileupBot {
  readonly contestLogs: ContestBotLog[] = [];
  private nrAsks = new WeakMap<Partner, number>();
  private told = new Set<string>();

  constructor(profile: BotProfile, me: string, random: Random, private nextNr: () => number, private options: ContestBotOptions = { dupes: 'b4' }) {
    super(profile, me, random);
  }

  protected cqText() { return `CQ TEST ${this.me} TEST`; }
  protected callText(call: string) { return `${call} 5NN ${formatSerial(this.nextNr(), PLAIN_SERIAL)}`; }
  protected isCall(word: string) { return isContestCall(word); }

  protected pick(sense: BotSense): BotAction | null {
    if (!sense.qrt) {
      const dupe = this.wholeCalls(this.inbox).find((call) => this.worked.has(call) && !this.told.has(call));
      if (dupe && this.options.dupes === 'b4') {
        this.told.add(dupe);
        return { text: `${dupe} QSO B4`, move: 'call', call: dupe };
      }
      if (dupe) this.worked.delete(dupe);
    }
    return super.pick(sense);
  }

  protected work(partner: Partner, sense: BotSense): BotAction | null {
    const mine = this.inbox.filter((item) => this.fromPartner(item, partner));
    const words = mine.flatMap((item) => mergeExchange(item.words));
    const hasReport = words.some((word) => RST.test(word));
    const serial = this.serialOf(words);
    const asked = this.nrAsks.get(partner) ?? 0;
    if ((hasReport || asked > 0) && serial !== null) return this.logAndClose(partner, serial, sense);
    if (hasReport && asked < MAX_NR_ASKS) {
      // The report came through, the number didn't: ask for it.
      this.nrAsks.set(partner, asked + 1);
      return { text: 'NR?', move: 'agn' };
    }
    const logsBefore = this.logs.length;
    const action = super.work(partner, sense);
    if (this.logs.length > logsBefore) {
      // It logged on what it had (a report, maybe from another pitch): whatever serial it can find.
      const entry = this.logs[this.logs.length - 1];
      const any = this.serialOf(this.inbox.flatMap((item) => mergeExchange(item.words)));
      this.contestLogs.push({ call: entry.call, rst: entry.rst, nr: any === null ? '' : String(any), at: entry.at });
    }
    return action;
  }

  private logAndClose(partner: Partner, serial: number, sense: BotSense): BotAction {
    this.logs.push({ call: partner.call, rst: '599', at: sense.t });
    this.contestLogs.push({ call: partner.call, rst: '599', nr: String(serial), at: sense.t });
    this.worked.add(partner.call);
    this.partner = null;
    return { text: `TU ${this.me}`, move: 'tu', call: partner.call };
  }

  /** The serial in what it copied, if whole (a lost letter in it: no serial). */
  private serialOf(words: readonly string[]) {
    const whole = words.filter((word) => !word.includes(LOST));
    // Something lost right after the report is the serial, gone.
    const reportAt = words.findIndex((word) => RST.test(word));
    if (reportAt >= 0 && words[reportAt + 1]?.includes(LOST)) return null;
    return serialIn(whole);
  }

  private wholeCalls(heard: readonly Heard[]) {
    return heard.flatMap((item) => mergeRepeats(item.words)).filter((word) => !word.includes(LOST) && this.isCall(word) && !this.isMine(word));
  }
}

/**
 * Repeats merged as the pileup bot does ("24T 24T"), but never across the report: "5NN 2NN"
 * is a report and a serial, not one word sent twice.
 */
export function mergeExchange(words: readonly string[]): string[] {
  const out: string[] = [];
  let run: string[] = [];
  for (const word of words) {
    if (!REPORT.test(word)) { run.push(word); continue; }
    out.push(...mergeRepeats(run), word);
    run = [];
  }
  return [...out, ...mergeRepeats(run)];
}
