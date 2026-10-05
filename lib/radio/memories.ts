/**
 * Logger-style memory keys (F1–F8). Each is a template with {MACRO} slots filled
 * at send time, so the same keys work for every station worked.
 */

export interface MemoryKey { key: string; label: string; template: string }

/** The default set: the short exchange of a run that keeps moving. */
export const MEMORY_KEYS: readonly MemoryKey[] = [
  { key: 'F1', label: 'CQ', template: 'CQ CQ DE {MYCALL} {MYCALL} K' },
  { key: 'F2', label: '交換', template: '{CALL} UR {RST} {RST} NAME {MYNAME} QTH {MYQTH} BK' },
  { key: 'F3', label: 'TU', template: 'R TU {NAME} 73 DE {MYCALL} QRZ?' },
  { key: 'F4', label: '自局', template: '{MYCALL}' },
  { key: 'F5', label: '相手', template: '{CALL}' },
  { key: 'F6', label: 'QRL?', template: 'QRL? DE {MYCALL}' },
  { key: 'F7', label: '?', template: '?' },
  { key: 'F8', label: 'AGN?', template: 'AGN?' },
];

export const MEMORY_MACROS = ['CALL', 'MYCALL', 'RST', 'MYNAME', 'MYQTH', 'NAME'] as const;
export type MemoryVars = Partial<Record<(typeof MEMORY_MACROS)[number], string>>;

/** Run tempo: the short exchange, or the long rubber stamp. */
export type MemoryTempo = 'short' | 'long';

/** The rubber stamp: everything twice, a proper CQ and a full thank-you. Keys not listed are as in the short set. */
const LONG_TEMPLATES: Partial<Record<string, string>> = {
  F1: 'CQ CQ CQ DE {MYCALL} {MYCALL} {MYCALL} K',
  F2: '{CALL} DE {MYCALL} GM TNX FER CALL UR {RST} {RST} NAME {MYNAME} {MYNAME} QTH {MYQTH} {MYQTH} HW? {CALL} DE {MYCALL} BK',
  F3: 'R TNX FER QSO {NAME} 73 TU {CALL} DE {MYCALL} QRZ?',
};

/** The default template of each key for a tempo. */
export const defaultTemplates = (tempo: MemoryTempo = 'short') =>
  MEMORY_KEYS.map((memory) => (tempo === 'long' ? LONG_TEMPLATES[memory.key] ?? memory.template : memory.template));

/** Switch tempo: keys still on the old defaults take the new ones; keys the operator wrote stay. */
export function retemplate(templates: readonly string[], from: MemoryTempo, to: MemoryTempo): string[] {
  const before = defaultTemplates(from);
  const after = defaultTemplates(to);
  return templates.map((template, index) => (template === before[index] ? after[index] : template));
}

/** Fill a template: unknown or empty slots vanish, spacing collapses, upper case. */
export function fillMemory(template: string, vars: MemoryVars): string {
  return template
    .replace(/\{([A-Z]+)\}/gi, (_, name: string) => (vars as Record<string, string | undefined>)[name.toUpperCase()]?.trim() ?? '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stored templates in key order, falling back to the tempo's defaults for anything missing or blank. */
export function memoryTemplates(stored: unknown, tempo: MemoryTempo = 'short'): string[] {
  const list = Array.isArray(stored) ? stored : [];
  const defaults = defaultTemplates(tempo);
  return defaults.map((template, index) => (typeof list[index] === 'string' && list[index].trim() ? list[index] : template));
}
