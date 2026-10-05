import type { CopySituation } from '@/lib/types';
import type { CharCell, FieldResult } from '@/lib/radio/attribution';

/** Short tag under a character: what it went through (nothing when clean). */
export const SITUATION_SHORT: Record<CopySituation, string> = {
  clean: '', weak: '弱', qsb: 'QSB', qrn: 'QRN', qrm: 'QRM', detuned: 'ずれ', doubled: 'ダブり', unheard: '未',
};
export const SITUATION_LABEL: Record<CopySituation, string> = {
  clean: '通常', weak: '弱信号', qsb: 'QSB', qrn: 'QRN', qrm: 'QRM', detuned: '同調ずれ', doubled: 'ダブり', unheard: '未受信',
};

/** Older records have no situation: a muted character was one we keyed over. */
export const situationOfCell = (cell: CharCell): CopySituation => cell.situation ?? (cell.condition === 'muted' ? 'doubled' : cell.condition);

/** One logged field, character by character: what was sent, what was written, and under what conditions. */
export function FieldCells({ field }: { field: FieldResult }) {
  return (
    <div className="qso-chars">
      {field.cells.map((cell, index) => {
        const tag = cell.op !== 'ins' ? SITUATION_SHORT[situationOfCell(cell)] : '';
        return (
          <i key={index} className={`cause-${cell.cause} op-${cell.op}`} title={cell.op === 'match' ? '正解' : `${cell.expected || '—'} → ${cell.input || '（なし）'}`}>
            {cell.expected || cell.input}
            {tag && <small>{tag}</small>}
          </i>
        );
      })}
    </div>
  );
}
