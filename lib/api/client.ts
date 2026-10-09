import {
  clearAuthSession,
  isAccessExpiring,
  loadAuthSession,
  saveAuthSession,
  type AuthSession,
} from './authSession';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  expiresAt?: number;
  user: { id: number; email: string };
};

/** API is production-only; local PHP is not used in normal development. */
const DEFAULT_BASE = 'https://cwot.jp';

export function apiBaseUrl() {
  return (process.env.NEXT_PUBLIC_API_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, '');
}

let refreshInFlight: Promise<AuthSession | null> | null = null;

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function toSession(payload: TokenResponse): AuthSession {
  const expiresAt = typeof payload.expiresAt === 'number'
    ? payload.expiresAt
    : Math.floor(Date.now() / 1000) + (payload.expiresIn || 3600);
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    expiresAt,
    user: payload.user,
  };
}

async function refreshSession(current = loadAuthSession()): Promise<AuthSession | null> {
  if (!current?.refreshToken) {
    clearAuthSession();
    return null;
  }
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const response = await fetch(`${apiBaseUrl()}/api/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      });
      const body = await parseJson(response);
      if (!response.ok) {
        clearAuthSession();
        return null;
      }
      const next = toSession(body as TokenResponse);
      saveAuthSession(next);
      return next;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Ensure a usable access token (proactive refresh when near expiry). */
export async function ensureAccessToken(): Promise<string | null> {
  let session = loadAuthSession();
  if (!session) return null;
  if (isAccessExpiring(session)) {
    session = await refreshSession(session);
  }
  return session?.accessToken ?? null;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
  options?: { auth?: boolean },
): Promise<T> {
  const auth = options?.auth !== false;
  const headers = new Headers(init.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

  if (auth) {
    const token = await ensureAccessToken();
    if (!token) throw new ApiError('Not signed in', 401, 'unauthorized');
    headers.set('Authorization', `Bearer ${token}`);
  }

  const url = path.startsWith('http') ? path : `${apiBaseUrl()}${path.startsWith('/') ? '' : '/'}${path}`;
  let response = await fetch(url, { ...init, headers });

  // Access expired / revoked mid-flight → refresh once and retry
  if (auth && response.status === 401) {
    const refreshed = await refreshSession();
    if (!refreshed) {
      const body = await parseJson(response);
      throw new ApiError('Session expired', 401, 'unauthorized', body);
    }
    headers.set('Authorization', `Bearer ${refreshed.accessToken}`);
    response = await fetch(url, { ...init, headers });
  }

  const body = await parseJson(response);
  if (!response.ok) {
    const errorBody = body as { error?: string; message?: string } | null;
    throw new ApiError(
      errorBody?.message || `Request failed (${response.status})`,
      response.status,
      errorBody?.error,
      body,
    );
  }
  return body as T;
}

export async function login(email: string, password: string): Promise<AuthSession> {
  const payload = await apiFetch<TokenResponse>('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, { auth: false });
  const session = toSession(payload);
  saveAuthSession(session);
  return session;
}

export async function register(email: string, password: string): Promise<AuthSession> {
  const payload = await apiFetch<TokenResponse>('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  }, { auth: false });
  const session = toSession(payload);
  saveAuthSession(session);
  return session;
}

export function logout() {
  clearAuthSession();
}

export async function forgotPassword(email: string): Promise<void> {
  await apiFetch('/api/v1/auth/password/forgot', {
    method: 'POST',
    body: JSON.stringify({ email }),
  }, { auth: false });
}

export async function resetPassword(token: string, password: string): Promise<void> {
  await apiFetch('/api/v1/auth/password/reset', {
    method: 'POST',
    body: JSON.stringify({ token, password }),
  }, { auth: false });
}

export async function requestEmailChange(newEmail: string, password: string): Promise<void> {
  await apiFetch('/api/v1/me/email/change', {
    method: 'POST',
    body: JSON.stringify({ newEmail, password }),
  });
}

export async function confirmEmailChange(token: string): Promise<AuthSession> {
  const payload = await apiFetch<TokenResponse & { ok?: boolean }>('/api/v1/auth/email/confirm', {
    method: 'POST',
    body: JSON.stringify({ token }),
  }, { auth: false });
  const session = toSession(payload);
  saveAuthSession(session);
  return session;
}

export type ContactCategory = 'question' | 'bug' | 'request' | 'account' | 'other';

export type ContactInput = {
  name: string;
  email: string;
  category: ContactCategory;
  message: string;
  /** Honeypot — left empty by people. */
  website: string;
};

/** Sends the contact form to the admin mailbox. No copy is mailed to the sender. */
export async function sendContact(input: ContactInput): Promise<void> {
  await apiFetch('/api/v1/contact', {
    method: 'POST',
    body: JSON.stringify(input),
  }, { auth: false });
}
