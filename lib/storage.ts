import { APP_VERSION, SCHEMA_VERSION, currentDataMeta, currentExportMeta, type DataMeta } from './appMeta';
import type { AnswerLog, AudioSettings, SessionRecord, TrainerProfile } from './types';
import { clampSpeedWpm } from './speed';
import { COURSE_DEFAULT_UNLOCK } from './course';

const DB_NAME = 'cw-operator-trainer';
const DB_VERSION = 1;
const SETTINGS_KEY = 'cwot:settings';
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
  if (merged.learnCourse && (!merged.unlockedKinds || merged.unlockedKinds.length === 0)) {
    merged.unlockedKinds = [...COURSE_DEFAULT_UNLOCK[merged.learnCourse]];
  }
  return merged;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('answers')) db.createObjectStore('answers', { keyPath: 'id' }).createIndex('timestamp', 'timestamp');
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' }).createIndex('startedAt', 'startedAt');
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
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
