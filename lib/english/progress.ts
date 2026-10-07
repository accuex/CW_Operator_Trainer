import { TIERS, type Tier } from './data';
export const ENGLISH_PROGRESS_KEY = 'cwot:english-progress:v1';
export interface EnglishProgress { schemaVersion: 1; confirmed: Record<string, string>; last: { tier: Tier; group: string; item: string } }
export const emptyProgress = (): EnglishProgress => ({ schemaVersion: 1, confirmed: {}, last: { tier: 'minimum', group: 'all', item: '' } });
export function parseProgress(raw: string | null): EnglishProgress {
  if (!raw) return emptyProgress();
  const value = JSON.parse(raw);
  if (value?.schemaVersion !== 1 || !value.confirmed || Array.isArray(value.confirmed) || typeof value.confirmed !== 'object' || !value.last || !TIERS.includes(value.last.tier) || typeof value.last.group !== 'string' || typeof value.last.item !== 'string') throw Error('保存データの形式が対応範囲外です');
  if (Object.entries(value.confirmed).some(([id, date]) => !id.startsWith('term-') || typeof date !== 'string' || !Number.isFinite(Date.parse(date)))) throw Error('確認記録の形式を確認できません');
  return value;
}
export function readProgress(storage: Pick<Storage, 'getItem'>) {
  try { return { progress: parseProgress(storage.getItem(ENGLISH_PROGRESS_KEY)), writable: true, notice: '' }; }
  catch { return { progress: emptyProgress(), writable: false, notice: '保存データを読み込めません。この画面の間だけ記録し、元の保存内容は変更しません。' }; }
}
export function saveProgress(progress: EnglishProgress, storage: Pick<Storage, 'setItem'>): boolean {
  try { storage.setItem(ENGLISH_PROGRESS_KEY, JSON.stringify(progress)); return true; } catch { return false; }
}
export function toggleConfirmed(progress: EnglishProgress, id: string, date = new Date().toISOString()): EnglishProgress {
  const confirmed = { ...progress.confirmed };
  if (confirmed[id]) delete confirmed[id]; else confirmed[id] = date;
  return { ...progress, confirmed };
}
