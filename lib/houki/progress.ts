import { BUNDLES, type Bundle, type HoukiItem } from './data';
import { scoreBlock } from './session';
export const HOUKI_PROGRESS_KEY = 'cwot:houki-progress:v2';
export interface HoukiSet { id: string; seed: number; at: string; itemIds: string[]; cursor: number; answers: Record<string, string>; graded: boolean; wrongItems: string[] }
export interface HoukiAttempt { id: string; at: string; score: number; total: number; itemIds: string[]; answers: Record<string, string> }
export interface HoukiProgress {
  schemaVersion: 2; held: Record<string, string>; last: { bundle: Bundle | 'all'; item: string };
  screen: 'home' | 'read' | 'drill' | 'result'; active: HoukiSet | null; attempts: HoukiAttempt[];
}
export const emptyProgress = (): HoukiProgress => ({ schemaVersion: 2, held: {}, last: { bundle: 'all', item: '' }, screen: 'home', active: null, attempts: [] });
const dateValid = (date: unknown) => typeof date === 'string' && Number.isFinite(Date.parse(date));
export function parseProgress(raw: string | null, items: readonly HoukiItem[]): HoukiProgress {
  if (!raw) return emptyProgress();
  const v = JSON.parse(raw) as HoukiProgress;
  const map = new Map(items.map(i => [i.id, i]));
  const fail = () => { throw Error('保存データの形式を確認できません'); };
  const idsValid = (ids: unknown): ids is string[] => Array.isArray(ids) && ids.length === 9 && new Set(ids).size === 9 && ids.every(id => map.has(id)) && ids.reduce((s, id) => s + map.get(id)!.points, 0) === 25 && ids.filter(id => map.get(id)!.kind === 'judge').length === 5;
  const answersValid = (answers: unknown, ids: string[]) => !!answers && typeof answers === 'object' && !Array.isArray(answers) && Object.entries(answers).every(([id, answer]) => ids.includes(id) && map.get(id)?.options.includes(answer as string));
  if (v?.schemaVersion !== 2 || !v.held || typeof v.held !== 'object' || Array.isArray(v.held) || !v.last || !Array.isArray(v.attempts)
    || !['home','read','drill','result'].includes(v.screen) || (v.last.bundle !== 'all' && !BUNDLES.includes(v.last.bundle)) || (v.last.item !== '' && !map.has(v.last.item))) fail();
  if (Object.entries(v.held).some(([id, date]) => !map.has(id) || !dateValid(date))) fail();
  if (v.active !== null) {
    const a = v.active;
    if (!a || typeof a.id !== 'string' || !a.id || !Number.isSafeInteger(a.seed) || !dateValid(a.at) || !idsValid(a.itemIds)
      || !Number.isInteger(a.cursor) || a.cursor < 0 || a.cursor >= a.itemIds.length || typeof a.graded !== 'boolean' || !answersValid(a.answers, a.itemIds) || !Array.isArray(a.wrongItems)) fail();
    const block = a.itemIds.map(id => map.get(id)!);
    if (a.graded && (Object.keys(a.answers).length !== 9 || JSON.stringify(scoreBlock(block, a.answers).misses) !== JSON.stringify(a.wrongItems))) fail();
    if (!a.graded && a.wrongItems.length) fail();
  }
  if ((v.screen === 'drill' && (!v.active || v.active.graded)) || (v.screen === 'result' && !v.active?.graded)) fail();
  const attemptIds = new Set<string>();
  for (const a of v.attempts) {
    if (!a || typeof a.id !== 'string' || !a.id || attemptIds.has(a.id) || !dateValid(a.at) || !idsValid(a.itemIds) || !answersValid(a.answers, a.itemIds) || Object.keys(a.answers).length !== 9) fail();
    const result = scoreBlock(a.itemIds.map(id => map.get(id)!), a.answers);
    if (a.score !== result.points || a.total !== result.total) fail();
    attemptIds.add(a.id);
  }
  return { ...v, attempts: v.attempts.slice(-20) };
}
export function readProgress(storage: Pick<Storage, 'getItem'>, items: readonly HoukiItem[]) {
  try {
    const raw = storage.getItem(HOUKI_PROGRESS_KEY);
    const old = !raw && storage.getItem('cwot:houki-progress:v1');
    return { progress: parseProgress(raw, items), writable: true, notice: old ? '旧版の記録はそのまま残しています。教材が変わったため、この版では新しく記録します。' : '' };
  } catch { return { progress: emptyProgress(), writable: false, notice: '保存データを読み込めません。この画面の間だけ記録し、元の保存内容は変更しません。' }; }
}
export function saveProgress(progress: HoukiProgress, storage: Pick<Storage, 'setItem'>): boolean {
  try { storage.setItem(HOUKI_PROGRESS_KEY, JSON.stringify(progress)); return true; } catch { return false; }
}
export function toggleHeld(progress: HoukiProgress, id: string, date = new Date().toISOString()): HoukiProgress {
  const held = { ...progress.held }; if (held[id]) delete held[id]; else held[id] = date;
  return { ...progress, held };
}
export function rememberAttempt(progress: HoukiProgress, attempt: HoukiAttempt): HoukiProgress {
  if (progress.attempts.some(a => a.id === attempt.id)) return progress;
  return { ...progress, attempts: [...progress.attempts, attempt].slice(-20) };
}
