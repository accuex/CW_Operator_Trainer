import { apiFetch } from './api/client';
import { getAvatar } from './avatars';
import { achievementById } from './achievements';

export const ACTIVITY_SUBJECTS = {
  learn: '符号', train: '受信', levelup: 'レベル試験', queue: '遅れ受信', communication: '電気通信術',
  geography: '地理', english: '専門英語', houki: '法規', 'houki-kakomon': '法規過去問', qso: 'QSO交信',
} as const;
export type ActivityKind = 'started' | 'achievement';
export interface ActivityItem { id: string; publicId: string; nickname: string; avatarId: string | null; kind: ActivityKind; detail: string; createdAt: number }
export interface SharingPreferences { enabled: boolean; nickname: string; publicId: string | null; pendingWithdrawal: boolean }
const KEY = 'cwot:activity:preferences';
const TOKEN_KEY = 'cwot:activity:publisher-token'; // Device-only; never in profile/cloud/backups.
const DEV_FEED = 'cwot:activity:dev-feed';
export const SHARING_CHANGED = 'cwot:sharing-changed';
export const LOCAL_ACTIVITY_PREVIEW = process.env.NODE_ENV === 'development';
export const EMPTY_SHARING: SharingPreferences = { enabled: false, nickname: '', publicId: null, pendingWithdrawal: false };

export function normalizeNickname(value: string): string {
  return [...value.trim().replace(/[\p{C}<>]/gu, '')].slice(0, 24).join('');
}
export function readSharing(): SharingPreferences {
  if (typeof localStorage === 'undefined') return { ...EMPTY_SHARING };
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (!value || typeof value !== 'object') return { ...EMPTY_SHARING };
    return { enabled: value.enabled === true, nickname: normalizeNickname(typeof value.nickname === 'string' ? value.nickname : ''), publicId: typeof value.publicId === 'string' && /^[a-f0-9]{24}$/.test(value.publicId) ? value.publicId : null, pendingWithdrawal: value.pendingWithdrawal === true };
  } catch { return { ...EMPTY_SHARING }; }
}
function writeSharing(value: SharingPreferences) {
  localStorage.setItem(KEY, JSON.stringify(value));
  window.dispatchEvent(new Event(SHARING_CHANGED));
}
function publisherToken(): string {
  const existing = localStorage.getItem(TOKEN_KEY);
  if (existing && /^[a-f0-9]{64}$/.test(existing)) return existing;
  const value = [...crypto.getRandomValues(new Uint8Array(32))].map((x) => x.toString(16).padStart(2, '0')).join('');
  localStorage.setItem(TOKEN_KEY, value);
  return value;
}
function devItems(): ActivityItem[] {
  try { return JSON.parse(localStorage.getItem(DEV_FEED) ?? '[]') as ActivityItem[]; } catch { return []; }
}
let pending: Promise<unknown> = Promise.resolve();
function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation, operation);
  pending = result.catch(() => undefined);
  return result;
}
function activityRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  return apiFetch<T>(path, { ...init, signal: AbortSignal.timeout(12000) }, { auth: false });
}
const INTENT_KEY = 'cwot:activity:consent-intent';
function newIntent(): string {
  const id = crypto.randomUUID(); localStorage.setItem(INTENT_KEY, id); return id;
}
function currentIntent(id: string): boolean { return localStorage.getItem(INTENT_KEY) === id; }
async function sendSettings(value: SharingPreferences, avatarId?: string | null, intent?: string): Promise<string | null> {
  if (LOCAL_ACTIVITY_PREVIEW) {
    const id = value.publicId ?? publisherToken().slice(0, 24);
    if (!value.enabled) localStorage.setItem(DEV_FEED, '[]');
    return id;
  }
  const headers = { Authorization: `Bearer ${publisherToken()}` };
  let revision: number | undefined;
  if (value.enabled) {
    const state = await activityRequest<{ revision: number }>('/api/v1/activity/settings', { headers });
    if (intent && !currentIntent(intent)) throw new Error('Sharing changed in another tab');
    revision = state.revision;
  }
  const result = await activityRequest<{ publicId: string | null; sharing: boolean }>('/api/v1/activity/settings', { method: 'PUT', headers, body: JSON.stringify({ sharing: value.enabled, nickname: value.nickname, avatarId: getAvatar(avatarId)?.id ?? null, ...(revision === undefined ? {} : { revision }) }) });
  if (value.enabled && !result.sharing) throw new Error('Sharing was withdrawn');
  return result.publicId;
}
export function updateSharing(enabled: boolean, nickname: string, avatarId?: string | null): Promise<SharingPreferences> {
  const intent = newIntent();
  const value = { ...readSharing(), enabled, nickname: normalizeNickname(nickname), pendingWithdrawal: !enabled };
  if (!enabled) writeSharing(value);
  return serialize(async () => {
    if (enabled && !currentIntent(intent)) throw new Error('Sharing changed');
    const id = await sendSettings(value, avatarId, intent);
    if (!currentIntent(intent)) return readSharing();
    const next = { ...value, publicId: id, pendingWithdrawal: false };
    writeSharing(next);
    return next;
  });
}
export async function retryWithdrawal(): Promise<void> {
  const value = readSharing();
  if (value.pendingWithdrawal && !value.enabled) await updateSharing(false, value.nickname);
}
export function syncSharedAvatar(avatarId?: string | null, nickname?: string): Promise<unknown> {
  return serialize(async () => {
    const value = readSharing();
    if (!value.enabled) return;
    const name = nickname === undefined ? value.nickname : normalizeNickname(nickname);
    if (LOCAL_ACTIVITY_PREVIEW) {
      localStorage.setItem(DEV_FEED, JSON.stringify(devItems().map((item) => ({ ...item, nickname: name || `学習者-${value.publicId}`, avatarId: getAvatar(avatarId)?.id ?? null }))));
    } else {
      const state = await activityRequest<{ sharing: boolean }>('/api/v1/activity/profile', { method: 'PUT', headers: { Authorization: `Bearer ${publisherToken()}` }, body: JSON.stringify({ nickname: name, avatarId: getAvatar(avatarId)?.id ?? null }) });
      if (!state.sharing) {
        if (readSharing().enabled) { newIntent(); writeSharing({ ...readSharing(), enabled: false, pendingWithdrawal: false }); }
        return;
      }
    }
    if (nickname !== undefined && readSharing().enabled) writeSharing({ ...readSharing(), nickname: name });
  });
}
/** Mount once in the app; settings in other tabs refresh via storage events. */
export function watchSharingWithdrawal(): () => void {
  const retry = () => { void retryWithdrawal().catch(() => undefined); };
  window.addEventListener('online', retry);
  return () => window.removeEventListener('online', retry);
}
export function publishActivity(kind: ActivityKind, detail: string, avatarId?: string | null): Promise<void> {
  if (!readSharing().enabled) return Promise.resolve();
  if (kind === 'started' ? !Object.hasOwn(ACTIVITY_SUBJECTS, detail) : !achievementById(detail)) return Promise.resolve();
  return serialize(async () => {
    const value = readSharing();
    if (!value.enabled) return;
    if (!LOCAL_ACTIVITY_PREVIEW) {
      await activityRequest('/api/v1/activity/events', { method: 'POST', headers: { Authorization: `Bearer ${publisherToken()}` }, body: JSON.stringify({ kind, detail }) });
      return;
    }
    const now = Date.now(), items = devItems().filter((item) => item.createdAt >= now - 30 * 86400000);
    if (kind === 'started' ? items.some((item) => item.kind === kind && now - item.createdAt < 1800000) : items.some((item) => item.kind === kind && item.detail === detail)) return;
    const id = value.publicId ?? publisherToken().slice(0, 24);
    items.unshift({ id: crypto.randomUUID(), publicId: id, nickname: value.nickname || `学習者-${id}`, avatarId: getAvatar(avatarId)?.id ?? null, kind, detail, createdAt: now });
    localStorage.setItem(DEV_FEED, JSON.stringify(items.slice(0, 100)));
  });
}
export async function fetchActivity(): Promise<ActivityItem[]> {
  if (LOCAL_ACTIVITY_PREVIEW) return devItems().filter((item) => item.createdAt >= Date.now() - 30 * 86400000);
  const result = await activityRequest<{ items: ActivityItem[] }>('/api/v1/activity');
  return result.items;
}
export function activityMessage(item: ActivityItem): string {
  return item.kind === 'achievement'
    ? `「${achievementById(item.detail)?.title ?? 'アチーブメント'}」を達成しました`
    : `${ACTIVITY_SUBJECTS[item.detail as keyof typeof ACTIVITY_SUBJECTS] ?? '学習'}の学習を始めました`;
}
