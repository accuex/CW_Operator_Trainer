import { apiFetch } from './client';
import type { AnswerLog, AudioSettings, SessionRecord, TrainerProfile } from '@/lib/types';

export type SyncStatePayload = {
  schemaVersion: number;
  revision: number;
  updatedAt?: string;
  profile: TrainerProfile | Record<string, unknown>;
  settings: AudioSettings | Record<string, unknown>;
  answers?: AnswerLog[];
  sessions?: SessionRecord[];
};

export async function fetchSyncState(options?: {
  answers?: boolean;
  sessions?: boolean;
  since?: number;
}): Promise<SyncStatePayload> {
  const params = new URLSearchParams();
  if (options?.answers) params.set('answers', '1');
  if (options?.sessions) params.set('sessions', '1');
  if (typeof options?.since === 'number') params.set('since', String(options.since));
  const query = params.toString();
  return apiFetch<SyncStatePayload>(`/api/v1/sync${query ? `?${query}` : ''}`);
}

export async function putSyncState(input: {
  revision: number;
  schemaVersion: number;
  profile: TrainerProfile;
  settings: AudioSettings;
}): Promise<{ revision: number; schemaVersion: number; updatedAt?: string }> {
  return apiFetch('/api/v1/sync/state', {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function postSyncAnswers(items: AnswerLog[]): Promise<{ accepted: number; skipped: number }> {
  if (items.length === 0) return { accepted: 0, skipped: 0 };
  return apiFetch('/api/v1/sync/answers', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}

export async function postSyncSessions(items: SessionRecord[]): Promise<{ accepted: number; skipped: number }> {
  if (items.length === 0) return { accepted: 0, skipped: 0 };
  return apiFetch('/api/v1/sync/sessions', {
    method: 'POST',
    body: JSON.stringify({ items }),
  });
}
