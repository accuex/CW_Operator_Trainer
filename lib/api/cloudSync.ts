import { SCHEMA_VERSION } from '@/lib/appMeta';
import { loadAuthSession } from '@/lib/api/authSession';
import { ApiError } from '@/lib/api/client';
import { fetchSyncState, postSyncAnswers, postSyncSessions, putSyncState } from '@/lib/api/sync';
import {
  DEFAULT_SETTINGS,
  getAnswers,
  getProfile,
  getSessions,
  loadSettings,
  normalizeProfile,
  replaceAnswers,
  replaceSessions,
  saveProfile,
  saveSettings,
} from '@/lib/storage';
import type { AnswerLog, AudioSettings, SessionRecord, TrainerProfile } from '@/lib/types';

const REV_KEY = 'cwot:syncRevision';
export const AUTH_SYNC_EVENT = 'cwot:auth-sync';

export type CloudSnapshot = {
  profile: TrainerProfile;
  settings: AudioSettings;
  answers: AnswerLog[];
  sessions: SessionRecord[];
  revision: number;
  /** true when empty cloud was seeded from this device */
  seededFromLocal: boolean;
};

function canUseStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

export function loadSyncRevision(): number | null {
  if (!canUseStorage()) return null;
  const raw = localStorage.getItem(REV_KEY);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function saveSyncRevision(revision: number) {
  if (!canUseStorage()) return;
  localStorage.setItem(REV_KEY, String(revision));
}

export function clearSyncRevision() {
  if (!canUseStorage()) return;
  localStorage.removeItem(REV_KEY);
}

export function notifyAuthSync(reason: 'login' | 'logout' | 'manual' = 'manual') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(AUTH_SYNC_EVENT, { detail: { reason } }));
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function isCloudEmpty(
  profile: Record<string, unknown>,
  settings: Record<string, unknown>,
  answers: unknown[],
  sessions: unknown[],
): boolean {
  const hasProfile = Boolean(
    profile.goal
    || profile.learnCourse
    || (profile.cards && typeof profile.cards === 'object' && Object.keys(profile.cards as object).length > 0)
    || profile.koch
    || profile.kochWabun
    || profile.qso
    || (Array.isArray(profile.unlockedKinds) && profile.unlockedKinds.length > 0)
    || (typeof profile.totalTrainingMs === 'number' && profile.totalTrainingMs > 0),
  );
  const hasSettings = Object.keys(settings).length > 0;
  return !hasProfile && !hasSettings && answers.length === 0 && sessions.length === 0;
}

function coerceAnswers(items: unknown): AnswerLog[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is AnswerLog => Boolean(item && typeof item === 'object' && typeof (item as AnswerLog).id === 'string'));
}

function coerceSessions(items: unknown): SessionRecord[] {
  if (!Array.isArray(items)) return [];
  return items.filter((item): item is SessionRecord => Boolean(item && typeof item === 'object' && typeof (item as SessionRecord).id === 'string'));
}

async function applyCloudToLocal(
  profile: TrainerProfile,
  settings: AudioSettings,
  answers: AnswerLog[],
  sessions: SessionRecord[],
  revision: number,
): Promise<CloudSnapshot> {
  saveSettings(settings);
  await saveProfile(profile);
  await replaceAnswers(answers);
  await replaceSessions(sessions);
  saveSyncRevision(revision);
  return {
    profile,
    settings,
    answers,
    sessions,
    revision,
    seededFromLocal: false,
  };
}

/** Pull cloud state. DB wins when cloud has data; empty cloud is seeded from local once. */
export async function syncPreferCloud(): Promise<CloudSnapshot | null> {
  if (!loadAuthSession()) return null;

  const remote = await fetchSyncState({ answers: true, sessions: true });
  const remoteProfile = asObject(remote.profile);
  const remoteSettings = asObject(remote.settings);
  const remoteAnswers = coerceAnswers(remote.answers);
  const remoteSessions = coerceSessions(remote.sessions);

  if (isCloudEmpty(remoteProfile, remoteSettings, remoteAnswers, remoteSessions)) {
    const localProfile = await getProfile();
    const localSettings = loadSettings();
    const localAnswers = await getAnswers();
    const localSessions = await getSessions();
    const put = await putSyncState({
      revision: remote.revision,
      schemaVersion: SCHEMA_VERSION,
      profile: localProfile,
      settings: localSettings,
    });
    await postSyncAnswers(localAnswers);
    await postSyncSessions(localSessions);
    saveSyncRevision(put.revision);
    return {
      profile: localProfile,
      settings: localSettings,
      answers: localAnswers,
      sessions: localSessions,
      revision: put.revision,
      seededFromLocal: true,
    };
  }

  const profile = normalizeProfile(remoteProfile as TrainerProfile);
  const settings = { ...DEFAULT_SETTINGS, ...remoteSettings } as AudioSettings;
  return applyCloudToLocal(profile, settings, remoteAnswers, remoteSessions, remote.revision);
}

let statePushTimer: ReturnType<typeof setTimeout> | null = null;
let statePushInFlight: Promise<void> | null = null;

export function schedulePushState(profile: TrainerProfile, settings: AudioSettings, delayMs = 900) {
  if (!loadAuthSession()) return;
  if (statePushTimer) clearTimeout(statePushTimer);
  statePushTimer = setTimeout(() => {
    statePushTimer = null;
    statePushInFlight = pushStateNow(profile, settings).catch(() => undefined).finally(() => {
      statePushInFlight = null;
    });
  }, delayMs);
}

export async function pushStateNow(profile: TrainerProfile, settings: AudioSettings): Promise<void> {
  if (!loadAuthSession()) return;
  let revision = loadSyncRevision();
  if (revision == null) {
    const remote = await fetchSyncState();
    revision = remote.revision;
    saveSyncRevision(revision);
  }
  try {
    const put = await putSyncState({
      revision,
      schemaVersion: SCHEMA_VERSION,
      profile,
      settings,
    });
    saveSyncRevision(put.revision);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // DB priority: ask UI to re-pull cloud instead of clobbering newer state.
      notifyAuthSync('manual');
      return;
    }
    throw error;
  }
}

export async function pushAnswers(items: AnswerLog | AnswerLog[]): Promise<void> {
  if (!loadAuthSession()) return;
  const list = Array.isArray(items) ? items : [items];
  await postSyncAnswers(list);
}

export async function pushSessions(items: SessionRecord | SessionRecord[]): Promise<void> {
  if (!loadAuthSession()) return;
  const list = Array.isArray(items) ? items : [items];
  await postSyncSessions(list);
}

export async function flushStatePush() {
  if (statePushTimer) {
    clearTimeout(statePushTimer);
    statePushTimer = null;
  }
  if (statePushInFlight) await statePushInFlight;
}
