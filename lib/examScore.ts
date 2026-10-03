import type { AlphabetType } from './types';

export type ExamAlignOp = 'match' | 'sub' | 'del' | 'ins';

export type ExamAlignCell = {
  op: ExamAlignOp;
  expected: string;
  input: string;
};

/**
 * 受信の減点基準（電気通信術）。
 * - 誤字・冗字: 1字につき 3点
 * - 脱字・書体不明りょう: 1字につき 1点
 * - 抹消・訂正: 3字までごとに 1点
 */
export const EXAM_PENALTY = {
  /** 誤字 */
  sub: 3,
  /** 脱字 */
  del: 1,
  /** 冗字 */
  ins: 3,
  /** 抹消・訂正（3字までごと） */
  correctionUnit: 3,
  correctionPoints: 1,
} as const;

export type ExamScore = {
  expected: string;
  input: string;
  matches: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  corrections: number;
  correctionPenalty: number;
  /** 一致字数 / 出題字数 */
  hitRate: number;
  /** 減点換算スコア（公式重み） */
  accuracy: number;
  penalty: number;
  cells: ExamAlignCell[];
};

/** 空白除去。欧文は大文字化。ずれ採点の前処理。 */
export function normalizeExamCopy(text: string, alphabet: AlphabetType): string {
  const compact = text.replace(/\s+/g, '');
  return alphabet === 'wabun' ? compact : compact.toUpperCase();
}

/**
 * 額表に書かない手続符号を除く（採点・Alignment 用）。
 * 欧文: HRHR / NR / BT(`=` `[BT]`) / AR(`+` `[AR]`) など
 * 和文: HRHR / [ホレ] / [ラタ] / ウホ / 通の区切り「、」（時刻内の「、」は残す）
 */
export function stripExamProcedureMarks(text: string, alphabet: AlphabetType): string {
  if (alphabet === 'wabun') {
    return text
      .replace(/\bHRHR\b/g, ' ')
      .replace(/\[ホレ\]/g, ' ')
      .replace(/\[ラタ\]/g, ' ')
      .replace(/\[特\]/g, ' ')
      .replace(/\[局\]/g, ' ')
      .replace(/\bウホ\b/g, ' ')
      // 通区切りの「、」（前後が空白）。略体時刻の `[5]、[3][8]` は残る
      .replace(/\s、\s/g, ' ')
      .replace(/^\s*、\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
  return text
    .replace(/\bHRHR\b/gi, ' ')
    .replace(/\bNR\b/gi, ' ')
    .replace(/\[BT\]/gi, ' ')
    .replace(/\[AR\]/gi, ' ')
    .replace(/\[CT\]/gi, ' ')
    .replace(/\[AS\]/gi, ' ')
    // BT: 空白に囲まれた `=`、または署名直前の `=CAPTAIN`
    .replace(/(^|[\s])=(?=[\s]|$)/g, '$1')
    .replace(/=(?=[A-Z0-9])/g, ' ')
    .replace(/\+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function correctionPenaltyPoints(correctedChars: number): number {
  if (correctedChars <= 0) return 0;
  return Math.ceil(correctedChars / EXAM_PENALTY.correctionUnit) * EXAM_PENALTY.correctionPoints;
}

/**
 * キー入力向けリカバリー採点。
 * 公式減点（誤字・冗字3 / 脱字1）で整列し、ブロック捨て復帰を拾う。
 * 抹消・訂正は入力中に消した字数から換算。
 */
export function scoreExamCopy(
  expectedRaw: string,
  inputRaw: string,
  alphabet: AlphabetType,
  correctedChars = 0,
): ExamScore {
  const expected = normalizeExamCopy(expectedRaw, alphabet);
  const input = normalizeExamCopy(inputRaw, alphabet);
  const rows = expected.length;
  const cols = input.length;
  const distance = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));
  for (let row = 0; row <= rows; row += 1) distance[row][0] = row * EXAM_PENALTY.del;
  for (let col = 0; col <= cols; col += 1) distance[0][col] = col * EXAM_PENALTY.ins;

  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      const same = expected[row - 1] === input[col - 1];
      distance[row][col] = Math.min(
        distance[row - 1][col] + EXAM_PENALTY.del,
        distance[row][col - 1] + EXAM_PENALTY.ins,
        distance[row - 1][col - 1] + (same ? 0 : EXAM_PENALTY.sub),
      );
    }
  }

  const cells: ExamAlignCell[] = [];
  let row = rows;
  let col = cols;
  while (row > 0 || col > 0) {
    if (row > 0 && col > 0) {
      const same = expected[row - 1] === input[col - 1];
      const diagonal = distance[row - 1][col - 1] + (same ? 0 : EXAM_PENALTY.sub);
      if (distance[row][col] === diagonal) {
        cells.push({ op: same ? 'match' : 'sub', expected: expected[row - 1], input: input[col - 1] });
        row -= 1;
        col -= 1;
        continue;
      }
    }
    if (row > 0 && distance[row][col] === distance[row - 1][col] + EXAM_PENALTY.del) {
      cells.push({ op: 'del', expected: expected[row - 1], input: '' });
      row -= 1;
      continue;
    }
    cells.push({ op: 'ins', expected: '', input: input[col - 1] });
    col -= 1;
  }
  cells.reverse();

  const matches = cells.filter((cell) => cell.op === 'match').length;
  const substitutions = cells.filter((cell) => cell.op === 'sub').length;
  const deletions = cells.filter((cell) => cell.op === 'del').length;
  const insertions = cells.filter((cell) => cell.op === 'ins').length;
  const correctionPenalty = correctionPenaltyPoints(correctedChars);
  const penalty =
    substitutions * EXAM_PENALTY.sub
    + deletions * EXAM_PENALTY.del
    + insertions * EXAM_PENALTY.ins
    + correctionPenalty;
  const denom = Math.max(1, expected.length * EXAM_PENALTY.sub);
  return {
    expected,
    input,
    matches,
    substitutions,
    deletions,
    insertions,
    corrections: Math.max(0, correctedChars),
    correctionPenalty,
    hitRate: expected.length ? matches / expected.length : 0,
    accuracy: Math.max(0, 1 - penalty / denom),
    penalty,
    cells,
  };
}
