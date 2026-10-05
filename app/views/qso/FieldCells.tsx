import type { CopySituation, QsoOverlapEnv } from '@/lib/types';
import type { CharCell, FieldResult } from '@/lib/radio/attribution';

/** Short tag under a character: what it went through (nothing when clean). */
export const SITUATION_SHORT: Record<CopySituation, string> = {
  clean: '', weak: '弱', qsb: 'QSB', qrn: 'QRN', qrm: 'QRM', overlap: '重なり', detuned: 'ずれ', doubled: 'ダブり', unheard: '未',
};
export const SITUATION_LABEL: Record<CopySituation, string> = {
  clean: '通常', weak: '弱信号', qsb: 'QSB', qrn: 'QRN', qrm: 'QRM', overlap: '重なり', detuned: '同調ずれ', doubled: 'ダブり', unheard: '未受信',
};

/** Older records have no situation: a muted character was one we keyed over. */
export const situationOfCell = (cell: CharCell): CopySituation => cell.situation ?? (cell.condition === 'muted' ? 'doubled' : cell.condition);

/** "2局が重なり・80 Hz差・+3.0 dB・+4 WPM" for a character other callers keyed over. */
export function overlapLine(overlap: QsoOverlapEnv) {
  const signed = (value: number, unit: string) => `${value > 0 ? '+' : ''}${value} ${unit}`;
  return `${overlap.n}局が重なり・${overlap.dHz} Hz差・${signed(overlap.dB, 'dB')}・${signed(overlap.dWpm, 'WPM')}`;
}

/** One logged field, character by character: what was sent, what was written, and under what conditions. */
export function FieldCells({ field }: { field: FieldResult }) {
  return (
    <div className="qso-chars">
      {field.cells.map((cell, index) => {
        const tag = cell.op !== 'ins' ? SITUATION_SHORT[situationOfCell(cell)] : '';
        const what = cell.op === 'match' ? '正解' : `${cell.expected || '—'} → ${cell.input || '（なし）'}`;
        const overlap = cell.op !== 'ins' && cell.env?.overlap ? `（${overlapLine(cell.env.overlap)}）` : '';
        return (
          <i key={index} className={`cause-${cell.cause} op-${cell.op}`} title={`${what}${overlap}`}>
            {cell.expected || cell.input}
            {tag && <small>{tag}</small>}
          </i>
        );
      })}
    </div>
  );
}
