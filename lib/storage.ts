import { APP_VERSION, SCHEMA_VERSION, currentDataMeta, currentExportMeta, type DataMeta } from './appMeta';
import type { AnswerLog, AudioSettings, SessionRecord, TrainerProfile } from './types';
import { clampSpeedWpm } from './speed';
import { COURSE_DEFAULT_UNLOCK, DEFAULT_UNLOCK } from './course';
import { normalizeQsoProfile } from './radio/skills';
import { QSO_TRACE_LIMIT, type QsoTrace } from './radio/trace';
import type { WabunQsoRecord } from './radio/wabun/trace';
import { RUN_TRACE_LIMIT, type AnyRunTrace } from './radio/runTrace';

const DB_NAME = 'cw-operator-trainer';
const DB_VERSION = 3;
const SETTINGS_KEY = 'cwot:settings';
const STARTED_KEY = 'cwot:started';
const META_KEY = 'meta';

const WAVEFORMS: OscillatorType[] = ['sine', 'triangle', 'square', 'sawtooth'];

export const DEFAULT_SETTINGS: AudioSettings = {
  pitch: 770,
  volume: 0.22,
  characterSpeed: 20,
  effectiveSpeed: 12,
  waveform: 'sawtooth',
  attack: 0.004,
  release: 0.006,
  reverb: false,
};

export const DEFAULT_PROFILE: TrainerProfile = {
  version: 1, goal: null, learnCourse: null, unlockedKinds: [], cards: {}, achievements: {}, totalTrainingMs: 0, lastMode: 'home',
};

export function normalizeProfile(profile: TrainerProfile | null | undefined): TrainerProfile {
  const merged = {
    ...DEFAULT_PROFILE,
    ...profile,
    cards: profile?.cards ?? {},
    achievements: profile?.achievements ?? {},
    revealAll: Boolean(profile?.revealAll),
  };
  if (profile?.qso) merged.qso = normalizeQsoProfile(profile.qso);
  if (!merged.unlockedKinds || merged.unlockedKinds.length === 0) {
    merged.unlockedKinds = merged.learnCourse
      ? [...COURSE_DEFAULT_UNLOCK[merged.learnCourse]]
      : [...DEFAULT_UNLOCK];
  }
  return merged;
}

/** Audio prefs already written to this device. */
export function hasStoredSettings(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(SETTINGS_KEY) !== null;
  } catch {
    return false;
  }
}

/** Profile already has a course or any practice history. Default audio prefs do not count. */
export function isReturningProfile(profile: TrainerProfile | null | undefined): boolean {
  if (!profile) return false;
  return Boolean(profile.goal)
    || Object.keys(profile.cards ?? {}).length > 0
    || (profile.totalTrainingMs ?? 0) > 0;
}

/** Existing user: they already chose a course, or have practice history on this device. */
export async function isReturningUser(profile?: TrainerProfile | null): Promise<boolean> {
  return isReturningProfile(profile === undefined ? await getProfile() : profile);
}

export function hasTrainerStarted(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return localStorage.getItem(STARTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTrainerStarted(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STARTED_KEY, '1');
  } catch {
    /* private / blocked storage */
  }
}

/**
 * Landing CTA only. IndexedDB survives typical “clear site data / localStorage”
 * attempts, so we do not treat a leftover profile as returning unless this
 * device also still has the start flag (or audio prefs + a chosen course).
 */
export function isLandingReturning(profile: TrainerProfile | null | undefined): boolean {
  if (hasTrainerStarted()) return true;
  if (profile?.goal && hasStoredSettings()) {
    markTrainerStarted();
    return true;
  }
  return false;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('answers')) db.createObjectStore('answers', { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
      // v2: QSO review traces. Device-only, never synced or exported.
      if (!db.objectStoreNames.contains('qsoTraces')) db.createObjectStore('qsoTraces', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      // v3: run traces (cq-run, later pileup / contest / free play). Device-only as well.
      if (!db.objectStoreNames.contains('runTraces')) db.createObjectStore('runTraces', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const request = action(tx.objectStore(storeName));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

export const addAnswer = (answer: AnswerLog) => transaction('answers', 'readwrite', (store) => store.put(answer));
export const getAnswers = () => transaction<AnswerLog[]>('answers', 'readonly', (store) => store.getAll());
export const addSession = (session: SessionRecord) => transaction('sessions', 'readwrite', (store) => store.put(session));
export const getSessions = () => transaction<SessionRecord[]>('sessions', 'readonly', (store) => store.getAll());

/** Store a trace and drop all but the newest `limit` (by startedAt). */
async function putCapped(storeName: 'qsoTraces' | 'runTraces', item: { id: string; startedAt: number }, limit: number) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(item);
    const keys = store.index('startedAt').getAllKeys();
    keys.onsuccess = () => {
      const ids = keys.result;
      for (const id of ids.slice(0, Math.max(0, ids.length - limit))) store.delete(id);
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Store a QSO trace and drop all but the newest QSO_TRACE_LIMIT. */
export const addQsoTrace = (trace: QsoTrace) => putCapped('qsoTraces', trace, QSO_TRACE_LIMIT);
/** A wabun QSO record goes with the single-QSO traces (same cap, device-only). */
export const addWabunRecord = (record: WabunQsoRecord) => putCapped('qsoTraces', record, QSO_TRACE_LIMIT);
export const getQsoTrace = (id: string) => transaction<QsoTrace | undefined>('qsoTraces', 'readonly', (store) => store.get(id));

/** Store a run trace and drop all but the newest RUN_TRACE_LIMIT. */
export const addRunTrace = (trace: AnyRunTrace) => putCapped('runTraces', trace, RUN_TRACE_LIMIT);
/** Stored runs, newest first. */
export const getRunTraces = () => transaction<AnyRunTrace[]>('runTraces', 'readonly', (store) => store.getAll())
  .then((traces) => traces.sort((a, b) => b.startedAt - a.startedAt));

async function replaceStoreAll<T>(storeName: 'answers' | 'sessions', items: T[]) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.clear();
    for (const item of items) store.put(item);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

/** Replace all local answers (cloud pull / DB priority). */
export const replaceAnswers = (items: AnswerLog[]) => replaceStoreAll('answers', items);
/** Replace all local sessions (cloud pull / DB priority). */
export const replaceSessions = (items: SessionRecord[]) => replaceStoreAll('sessions', items);

async function putProfileStore(action: (store: IDBObjectStore) => void) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('profile', 'readwrite');
    action(tx.objectStore('profile'));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function saveDataMeta() {
  await putProfileStore((store) => {
    store.put(currentDataMeta(), META_KEY);
  });
}

export async function saveProfile(profile: TrainerProfile) {
  await putProfileStore((store) => {
    store.put(normalizeProfile(profile), 'main');
    store.put(currentDataMeta(), META_KEY);
  });
}

export const getProfile = async () => normalizeProfile(await transaction<TrainerProfile | undefined>('profile', 'readonly', (store) => store.get('main')));

export async function getDataMeta(): Promise<DataMeta | null> {
  try {
    const meta = await transaction<DataMeta | undefined>('profile', 'readonly', (store) => store.get(META_KEY));
    if (!meta || typeof meta !== 'object') return null;
    return {
      appVersion: typeof meta.appVersion === 'string' ? meta.appVersion : APP_VERSION,
      schemaVersion: typeof meta.schemaVersion === 'number' ? meta.schemaVersion : SCHEMA_VERSION,
      updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

function normalizeSettings(settings: AudioSettings): AudioSettings {
  const characterSpeed = clampSpeedWpm(settings.characterSpeed);
  const effectiveSpeed = Math.min(clampSpeedWpm(settings.effectiveSpeed), characterSpeed);
  const waveform = WAVEFORMS.includes(settings.waveform) ? settings.waveform : DEFAULT_SETTINGS.waveform;
  return { ...settings, characterSpeed, effectiveSpeed, waveform, reverb: Boolean(settings.reverb) };
}

export function loadSettings(): AudioSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    return normalizeSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') });
  } catch {
    return DEFAULT_SETTINGS;
  }
}
export function saveSettings(settings: AudioSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
}

export async function exportAllData() {
  return {
    ...currentExportMeta(),
    settings: loadSettings(),
    profile: await getProfile(),
    answers: await getAnswers(),
    sessions: await getSessions(),
  };
}

export async function importAllData(data: unknown) {
  if (!data || typeof data !== 'object') throw new Error('対応していないバックアップ形式です');
  const payload = data as {
    schemaVersion?: number;
    appVersion?: string;
    settings?: AudioSettings;
    profile?: TrainerProfile;
    answers?: AnswerLog[];
    sessions?: SessionRecord[];
  };
  // 旧バックアップは schemaVersion 欠落があり得る。未来版は拒否。
  const schemaVersion = typeof payload.schemaVersion === 'number' ? payload.schemaVersion : 1;
  if (schemaVersion > SCHEMA_VERSION) {
    throw new Error(`新しいアプリ向けのバックアップです（schema ${schemaVersion} > ${SCHEMA_VERSION}）`);
  }
  if (payload.settings) saveSettings({ ...DEFAULT_SETTINGS, ...payload.settings });
  if (payload.profile) await saveProfile(normalizeProfile(payload.profile));
  else await saveDataMeta();
  for (const answer of payload.answers ?? []) await addAnswer(answer);
  for (const session of payload.sessions ?? []) await addSession(session);
}
