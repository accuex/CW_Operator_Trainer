import type { CopyCondition } from '@/lib/types';
import type { FieldResult } from '@/lib/radio/attribution';

export const CONDITION_SHORT: Record<CopyCondition, string> = {
  clean: '', weak: '弱', qsb: 'QSB', qrn: 'QRN', qrm: 'QRM', detuned: 'ずれ', muted: '送信中', unheard: '未',
};

/** One logged field, character by character: what was sent, what was written, and under what conditions. */
export function FieldCells({ field }: { field: FieldResult }) {
  return (
    <div className="qso-chars">
      {field.cells.map((cell, index) => (
        <i key={index} className={`cause-${cell.cause} op-${cell.op}`} title={cell.op === 'match' ? '正解' : `${cell.expected || '—'} → ${cell.input || '（なし）'}`}>
          {cell.expected || cell.input}
          {cell.op !== 'ins' && CONDITION_SHORT[cell.condition] && <small>{CONDITION_SHORT[cell.condition]}</small>}
        </i>
      ))}
    </div>
  );
}
