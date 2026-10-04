import { saveAuthSession, type AuthSession } from './authSession';
import { apiFetch } from './client';
import {
  createPasskey,
  getPasskey,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from './webauthn';

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt?: number;
  user: { id: number; email: string };
};

function toSession(payload: TokenResponse): AuthSession {
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresAt: typeof payload.expiresAt === 'number'
      ? payload.expiresAt
      : Math.floor(Date.now() / 1000) + (payload.expiresIn || 3600),
    user: payload.user,
  };
}

export type PasskeyItem = {
  id: number;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export async function listPasskeys() {
  const data = await apiFetch<{ items: PasskeyItem[] }>('/api/v1/me/passkeys');
  return data.items;
}

export async function registerPasskey(name = 'Passkey') {
  const options = await apiFetch<{
    challengeId: string;
    publicKey: PublicKeyCredentialCreationOptionsJSON;
  }>('/api/v1/me/passkeys/options', { method: 'POST', body: '{}' });
  const credential = await createPasskey(options.publicKey);
  return apiFetch<{ ok: boolean; passkey: PasskeyItem }>('/api/v1/me/passkeys/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId: options.challengeId, name, credential }),
  });
}

export async function deletePasskey(id: number) {
  return apiFetch<{ ok: boolean }>(`/api/v1/me/passkeys/${id}`, { method: 'DELETE' });
}

export async function loginWithPasskey(email?: string): Promise<AuthSession> {
  const options = await apiFetch<{
    challengeId: string;
    publicKey: PublicKeyCredentialRequestOptionsJSON;
  }>('/api/v1/auth/passkey/login/options', {
    method: 'POST',
    body: JSON.stringify({ email: email?.trim() || undefined }),
  }, { auth: false });
  const credential = await getPasskey(options.publicKey);
  const payload = await apiFetch<TokenResponse>('/api/v1/auth/passkey/login/verify', {
    method: 'POST',
    body: JSON.stringify({ challengeId: options.challengeId, credential }),
  }, { auth: false });
  const session = toSession(payload);
  saveAuthSession(session);
  return session;
}

export async function fetchMe() {
  return apiFetch<{ user: { id: number; email: string }; passkeyCount: number }>('/api/v1/me');
}
