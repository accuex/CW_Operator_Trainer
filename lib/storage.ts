import type { AnswerLog, AudioSettings, SessionRecord, TrainerProfile } from './types';
import { clampSpeedWpm } from './speed';
import { COURSE_DEFAULT_UNLOCK } from './course';

const DB_NAME = 'cw-operator-trainer';
const DB_VERSION = 1;
const SETTINGS_KEY = 'cwot:settings';

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
  version: 1, goal: null, learnCourse: null, unlockedKinds: [], cards: {}, totalTrainingMs: 0, lastMode: 'home',
};

export function normalizeProfile(profile: TrainerProfile | null | undefined): TrainerProfile {
  const merged = { ...DEFAULT_PROFILE, ...profile, cards: profile?.cards ?? {} };
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
export const saveProfile = (profile: TrainerProfile) => transaction('profile', 'readwrite', (store) => store.put(normalizeProfile(profile), 'main'));
export const getProfile = async () => normalizeProfile(await transaction<TrainerProfile | undefined>('profile', 'readonly', (store) => store.get('main')));

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
  return { schemaVersion: 1, exportedAt: new Date().toISOString(), settings: loadSettings(), profile: await getProfile(), answers: await getAnswers(), sessions: await getSessions() };
}

export async function importAllData(data: unknown) {
  if (!data || typeof data !== 'object' || !('schemaVersion' in data)) throw new Error('対応していないバックアップ形式です');
  const payload = data as { settings?: AudioSettings; profile?: TrainerProfile; answers?: AnswerLog[]; sessions?: SessionRecord[] };
  if (payload.settings) saveSettings({ ...DEFAULT_SETTINGS, ...payload.settings });
  if (payload.profile) await saveProfile(normalizeProfile(payload.profile));
  for (const answer of payload.answers ?? []) await addAnswer(answer);
  for (const session of payload.sessions ?? []) await addSession(session);
}
