/**
 * Logger-style memory keys (F1–F8). Each is a template with {MACRO} slots filled
 * at send time, so the same keys work for every station worked.
 */

export interface MemoryKey { key: string; label: string; template: string }

export const MEMORY_KEYS: readonly MemoryKey[] = [
  { key: 'F1', label: 'CQ', template: 'CQ CQ DE {MYCALL} {MYCALL} K' },
  { key: 'F2', label: '交換', template: '{CALL} DE {MYCALL} UR {RST} {RST} NAME {MYNAME} {MYNAME} QTH {MYQTH} {MYQTH} BK' },
  { key: 'F3', label: 'TU', template: 'R TNX {NAME} 73 TU DE {MYCALL} QRZ?' },
  { key: 'F4', label: '自局', template: '{MYCALL}' },
  { key: 'F5', label: '相手', template: '{CALL}' },
  { key: 'F6', label: 'QRL?', template: 'QRL? DE {MYCALL}' },
  { key: 'F7', label: '?', template: '?' },
  { key: 'F8', label: 'AGN?', template: 'AGN?' },
];

export const MEMORY_MACROS = ['CALL', 'MYCALL', 'RST', 'MYNAME', 'MYQTH', 'NAME'] as const;
export type MemoryVars = Partial<Record<(typeof MEMORY_MACROS)[number], string>>;

/** Fill a template: unknown or empty slots vanish, spacing collapses, upper case. */
export function fillMemory(template: string, vars: MemoryVars): string {
  return template
    .replace(/\{([A-Z]+)\}/gi, (_, name: string) => (vars as Record<string, string | undefined>)[name.toUpperCase()]?.trim() ?? '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Stored templates in key order, falling back to the defaults for anything missing or blank. */
export function memoryTemplates(stored: unknown): string[] {
  const list = Array.isArray(stored) ? stored : [];
  return MEMORY_KEYS.map((memory, index) => (typeof list[index] === 'string' && list[index].trim() ? list[index] : memory.template));
}
