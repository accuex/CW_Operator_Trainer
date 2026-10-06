import type { DecodeSimOptions } from './sim';

/**
 * DECODE QA presets: one station, one band, the same every time from the seed — for the
 * headless checks (decode.test / the mass simulation) and for listening on the dev desk
 * (/dev/decode). Each says what to look for.
 */
export interface DecodePreset {
  label: string;
  /** Station / speed / condition, for the report. */
  station: string;
  wpm: number;
  condition: string;
  listen: string;
  sim: DecodeSimOptions;
}

const CQ = 'CQ CQ DE JF8QNW JF8QNW K';
const OVER = 'JA1ZZZ DE JF8QNW GM UR RST 579 579 NAME TARO TARO QTH SAPPORO HW? BK';
const WABUN = 'JA1ZZZ DE JF8QNW [ホレ] コンニチハ オナマエハ タロウ ゴキゲンヨウ シモンカラ イツモ ガンバッテマス [ラタ] KN';

export const DECODE_PRESETS = {
  'decode-clean': {
    label: 'エレキー・きれいな電波', station: 'JF8QNW', wpm: 20, condition: 'S/N 高・QSB/QRN なし・500 Hz・ゼロイン',
    listen: 'ほぼ完全に読めるか', sim: { seed: 701, stations: [{ call: 'JF8QNW', text: OVER, offset: 0, wpm: 20, strength: 0.7 }], noise: 0.2 },
  },
  'decode-straight': {
    label: '縦振れ（軽め）', station: 'JF8QNW', wpm: 16, condition: 'S/N 高・ストレートキー strength 0.6',
    listen: 'たまに ? や字間のずれが出る程度か（崩れすぎていないか）',
    sim: { seed: 702, stations: [{ call: 'JF8QNW', text: OVER, offset: 0, wpm: 16, strength: 0.7, fist: { kind: 'straight', strength: 0.6 } }], noise: 0.2 },
  },
  'decode-fatigue': {
    label: '縦振れ・長い電文の後半で疲れ', station: 'JF8QNW', wpm: 16, condition: 'S/N 高・ストレートキー・疲れあり',
    listen: '長い電文の後半で ? が増えるか',
    sim: { seed: 703, stations: [{ call: 'JF8QNW', text: `${OVER} ${OVER}`, offset: 0, wpm: 16, strength: 0.7, fist: { kind: 'straight', strength: 1, fatigue: true } }], noise: 0.2 },
  },
  'decode-qsb': {
    label: 'QSB 深め', station: 'JF8QNW', wpm: 18, condition: 'QSB 0.7（周期 約 12 秒）・S/N 中',
    listen: '沈んだところで ? になり、戻ると読めるか',
    sim: { seed: 704, stations: [{ call: 'JF8QNW', text: OVER, offset: 0, wpm: 18, strength: 0.6, qsbRate: 0.08 }], noise: 0.3, qsb: 0.7 },
  },
  'decode-qrm': {
    label: '近くに強い局（QRM）', station: 'JF8QNW / JA9QRM +250 Hz', wpm: 18, condition: '2.4k で強い隣接局・250 Hz で切れる',
    listen: '2.4k では崩れ、250 Hz にすると改善するか',
    sim: {
      seed: 705, filter: 2400, noise: 0.2,
      stations: [
        { call: 'JF8QNW', text: OVER, offset: 0, wpm: 18, strength: 0.3 },
        { call: 'JA9QRM', text: 'CQ CQ CQ DE JA9QRM JA9QRM K', offset: 250, wpm: 24, strength: 1, repeat: 4, delay: 0.3 },
      ],
    },
  },
  'decode-offfreq': {
    label: '少しずれて受信', station: 'JF8QNW', wpm: 18, condition: '+90 Hz ずれ・S/N 高',
    listen: 'ゼロインより ? が増えるか（110 Hz 以上では読めない）',
    sim: { seed: 706, stations: [{ call: 'JF8QNW', text: OVER, offset: 90, wpm: 18, strength: 0.7 }], noise: 0.3 },
  },
  'decode-wabun': {
    label: '和文（ホレ/ラタ・濁点）', station: 'JF8QNW', wpm: 13, condition: 'S/N 高・LANG AUTO',
    listen: 'ホレで和文に、ラタで欧文に戻るか・濁点が付くか',
    sim: { seed: 707, stations: [{ call: 'JF8QNW', text: WABUN, offset: 0, wpm: 13, strength: 0.7, wabun: true }], noise: 0.2 },
  },
  'decode-collision': {
    label: '同じ周波数で 2 局', station: 'JF8QNW / JR3XYZ +20 Hz', wpm: 20, condition: 'ほぼ同じ周波数で同時送信',
    listen: '強い方を追い、重なったところで ? になるか',
    sim: {
      seed: 708, noise: 0.2,
      stations: [
        { call: 'JF8QNW', text: CQ, offset: 0, wpm: 20, strength: 0.7, repeat: 2 },
        { call: 'JR3XYZ', text: 'JF8QNW DE JR3XYZ JR3XYZ K', offset: 20, wpm: 24, strength: 0.4, delay: 2.5 },
      ],
    },
  },
} satisfies Record<string, DecodePreset>;
export type DecodePresetId = keyof typeof DECODE_PRESETS;
export const DECODE_PRESET_IDS = Object.keys(DECODE_PRESETS) as DecodePresetId[];
