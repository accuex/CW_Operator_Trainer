import type { AnswerLog, CopyCondition, CopySituation, QsoCause, QsoCauseCounts, QsoCharEnv, QsoEnvCondition } from '../types';
import { isEnvCondition, judgeChar, pickEasier, situationOf, SITUATION_SEVERITY, type CharJudgement, type ClockNow, type CopyMonitor, type RxRecord } from './conditions';
import type { CallTally, QsoEvidence } from './difficulty';
import type { ExchangePreset } from './exchange';

/**
 * Log scoring with blame: every expected character is aligned against what was
 * logged and tagged with the easiest conditions it was ever sent under, so a miss
 * becomes copy / environment / overlap / doubling / tuning / timing instead of just "wrong".
 */

export type AlignOp = 'match' | 'sub' | 'del' | 'ins';
export interface AlignCell { op: AlignOp; expected: string; input: string }

/** Unit-cost Levenshtein alignment, substitutions preferred over del+ins. */
export function align(expected: string, input: string): AlignCell[] {
  const rows = expected.length;
  const cols = input.length;
  const d = Array.from({ length: rows + 1 }, (_, row) => Array.from({ length: cols + 1 }, (_, col) => (row === 0 ? col : col === 0 ? row : 0)));
  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      d[row][col] = Math.min(d[row - 1][col] + 1, d[row][col - 1] + 1, d[row - 1][col - 1] + (expected[row - 1] === input[col - 1] ? 0 : 1));
    }
  }
  const cells: AlignCell[] = [];
  let row = rows;
  let col = cols;
  while (row > 0 || col > 0) {
    if (row > 0 && col > 0 && d[row][col] === d[row - 1][col - 1] + (expected[row - 1] === input[col - 1] ? 0 : 1)) {
      cells.push({ op: expected[row - 1] === input[col - 1] ? 'match' : 'sub', expected: expected[row - 1], input: input[col - 1] });
      row -= 1;
      col -= 1;
    } else if (row > 0 && d[row][col] === d[row - 1][col] + 1) {
      cells.push({ op: 'del', expected: expected[row - 1], input: '' });
      row -= 1;
    } else {
      cells.push({ op: 'ins', expected: '', input: input[col - 1] });
      col -= 1;
    }
  }
  return cells.reverse();
}

export function causeOf(situation: CopySituation): Exclude<QsoCause, 'ok'> {
  if (situation === 'clean') return 'copy';
  if (isEnvCondition(situation)) return 'environment';
  if (situation === 'overlap') return 'overlap';
  if (situation === 'doubled') return 'doubling';
  if (situation === 'detuned') return 'tuning';
  return 'timing';
}

export interface CharCell extends AlignCell { condition: CopyCondition; situation: CopySituation; cause: QsoCause; env: QsoCharEnv | null }
export interface FieldResult { key: string; label: string; expected: string; input: string; correct: boolean; cells: CharCell[] }

/** Easiest judgement for each character of `value`, across every time it was sent. */
export function judgeValue(
  value: string,
  records: RxRecord[],
  monitor: CopyMonitor,
  now: ClockNow,
  /** Words that normalise alike are the same value (5NN is 599). */
  normalize: (text: string) => string = (text) => text,
): CharJudgement[] {
  const best: (CharJudgement | null)[] = Array.from({ length: value.length }, () => null);
  const target = normalize(value);
  for (const record of records) {
    const words = record.tx.text.toUpperCase().split(/\s+/).filter(Boolean);
    words.forEach((word, wordIndex) => {
      if (word !== value && normalize(word) !== target) return;
      for (const span of record.tx.chars) {
        if (span.word !== wordIndex || span.index >= value.length) continue;
        best[span.index] = pickEasier(best[span.index], judgeChar(monitor, record, span, now));
      }
    });
  }
  return best.map((judgement) => judgement ?? { condition: 'unheard', env: { snr: 0, qrm: 0, qsb: 0, qrn: 0, offset: 0 } });
}

export function scoreFields(
  preset: ExchangePreset,
  truth: Record<string, string>,
  log: Record<string, string>,
  records: RxRecord[],
  monitor: CopyMonitor,
  now: ClockNow,
): FieldResult[] {
  return preset.fields.map((field) => {
    const expected = field.normalize(truth[field.key] ?? '');
    const input = field.normalize(log[field.key] ?? '');
    const judged = judgeValue(truth[field.key] ?? '', records, monitor, now, field.normalize);
    let index = 0;
    const cells = align(expected, input).map((cell): CharCell => {
      if (cell.op === 'ins') return { ...cell, condition: 'clean', situation: 'clean', cause: 'copy', env: null };
      const judgement = judged[index] ?? { condition: 'unheard' as const, env: null };
      index += 1;
      const situation = situationOf(judgement.condition, judgement.env);
      return { ...cell, condition: judgement.condition, situation, cause: cell.op === 'match' ? 'ok' : causeOf(situation), env: judgement.env };
    });
    return { key: field.key, label: field.label, expected, input, correct: expected === input, cells };
  });
}

export const emptyCauses = (): QsoCauseCounts => ({ copy: 0, environment: 0, overlap: 0, doubling: 0, tuning: 0, timing: 0, procedure: 0 });

/** The hardest situation among a value's characters ('unheard' for nothing judged). */
export function hardestSituation(situations: CopySituation[]): CopySituation {
  if (!situations.length) return 'unheard';
  return situations.reduce((worst, situation) => (SITUATION_SEVERITY[situation] > SITUATION_SEVERITY[worst] ? situation : worst));
}

/** A whole call as logged: right or wrong, under the hardest situation any of its characters met. */
export function callOfFields(fields: FieldResult[]): { situation: CopySituation; correct: boolean } | null {
  const call = fields.find((field) => field.key === 'call');
  if (!call || !call.expected) return null;
  return { situation: hardestSituation(call.cells.filter((cell) => cell.op !== 'ins').map((cell) => cell.situation)), correct: call.correct };
}

export function tallyCall(tally: CallTally, call: { situation: CopySituation; correct: boolean } | null) {
  if (!call) return;
  const bucket = (tally[call.situation] ??= { total: 0, correct: 0 });
  bucket.total += 1;
  bucket.correct += call.correct ? 1 : 0;
}

/**
 * Character-level blame plus transmit-side events → evidence for the tuner. Only band
 * conditions fill `env` (they have axes); overlapped characters go to `overlap`, our
 * doublings to `doubled`, and
 * whole calls to `calls`, sorted by situation so a hard call never counts as a clean one.
 */
export function collectEvidence(fields: FieldResult[], tx: { total: number; onFrequency: number; procedure: number }): QsoEvidence {
  const causes = emptyCauses();
  causes.procedure = tx.procedure;
  causes.tuning += tx.total - tx.onFrequency;
  const clean = { total: 0, correct: 0 };
  const overlap = { total: 0, correct: 0 };
  const doubled = { total: 0, correct: 0 };
  const env: QsoEvidence['env'] = {};
  for (const cell of fields.flatMap((field) => field.cells)) {
    if (cell.op === 'ins') continue;
    if (cell.cause !== 'ok') causes[cell.cause] = (causes[cell.cause] ?? 0) + 1;
    const ok = cell.op === 'match' ? 1 : 0;
    if (cell.situation === 'clean') {
      clean.total += 1;
      clean.correct += ok;
    } else if (cell.situation === 'overlap') {
      overlap.total += 1;
      overlap.correct += ok;
    } else if (cell.situation === 'doubled') {
      doubled.total += 1;
      doubled.correct += ok;
    } else if (isEnvCondition(cell.situation)) {
      const bucket = (env[cell.situation as QsoEnvCondition] ??= { total: 0, correct: 0 });
      bucket.total += 1;
      bucket.correct += ok;
    }
  }
  const calls = { log: {} as CallTally, first: {} as CallTally };
  tallyCall(calls.log, callOfFields(fields));
  return { clean, env, overlap, doubled, causes, tx: { total: tx.total, onFrequency: tx.onFrequency }, calls };
}

/** Add up several contacts' evidence (a run). */
export function mergeEvidence(parts: QsoEvidence[], tx: { total: number; onFrequency: number; procedure: number }): QsoEvidence {
  const out = collectEvidence([], tx);
  const add = (into: { total: number; correct: number }, from?: { total: number; correct: number }) => {
    if (!from) return;
    into.total += from.total;
    into.correct += from.correct;
  };
  for (const part of parts) {
    add(out.clean, part.clean);
    add(out.overlap!, part.overlap);
    add(out.doubled!, part.doubled);
    for (const [condition, bucket] of Object.entries(part.env) as [QsoEnvCondition, { total: number; correct: number }][]) add((out.env[condition] ??= { total: 0, correct: 0 }), bucket);
    for (const stage of ['log', 'first'] as const) {
      for (const [situation, bucket] of Object.entries(part.calls?.[stage] ?? {}) as [CopySituation, { total: number; correct: number }][]) {
        add((out.calls![stage][situation] ??= { total: 0, correct: 0 }), bucket);
      }
    }
    for (const cause of ['copy', 'environment', 'overlap', 'doubling', 'tuning', 'timing'] as const) out.causes[cause] = (out.causes[cause] ?? 0) + (part.causes[cause] ?? 0);
  }
  return out;
}

/** One AnswerLog per expected character, environment kept alongside. */
export function fieldAnswers(
  fields: FieldResult[],
  base: {
    sessionId: string; timestamp: number; wpm: number; modeId: string; presetId: string; alphabet: AnswerLog['alphabetType'];
    /** A run's contact: keeps ids apart between the contacts of one session. */
    contactId?: string;
  },
  /** Fields whose misses were something else's doing (see QsoAnswerMeta.blame). */
  blame: Partial<Record<string, string>> = {},
): AnswerLog[] {
  const out: AnswerLog[] = [];
  for (const field of fields) {
    field.cells.forEach((cell, index) => {
      if (cell.op === 'ins') return;
      out.push({
        id: `${base.sessionId}${base.contactId ? `-${base.contactId}` : ''}-${field.key}-${index}`,
        timestamp: base.timestamp,
        alphabetType: base.alphabet,
        correctSymbol: cell.expected,
        inputSymbol: cell.input,
        characterSpeed: base.wpm,
        effectiveSpeed: base.wpm,
        queueTarget: 0,
        actualQueueDepth: 0,
        stimulusTime: 0,
        inputTime: 0,
        responseLatency: Number.NaN,
        mode: 'qso',
        isCorrect: cell.op === 'match',
        isEarly: false,
        sessionId: base.sessionId,
        qso: {
          modeId: base.modeId,
          presetId: base.presetId,
          field: field.key,
          condition: cell.condition,
          situation: cell.situation,
          cause: cell.cause,
          env: cell.env ?? { snr: 0, qrm: 0, qsb: 0, qrn: 0, offset: 0 },
          ...(blame[field.key] ? { blame: blame[field.key] } : {}),
        },
      });
    });
  }
  return out;
}
