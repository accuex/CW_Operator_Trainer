const STORAGE_KEY = 'cwot:auth';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user?: { id: number; email: string };
}

export interface AuthSession extends AuthTokens {
  user: { id: number; email: string };
}

/** In-memory fallback for SSR / Node tests when localStorage is unavailable. */
let memorySession: AuthSession | null = null;

function canUseStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function parseSession(raw: Partial<AuthSession> | null | undefined): AuthSession | null {
  if (!raw?.accessToken || !raw?.refreshToken || !raw.user?.email || !raw.user?.id) return null;
  return {
    accessToken: raw.accessToken,
    refreshToken: raw.refreshToken,
    expiresAt: typeof raw.expiresAt === 'number' ? raw.expiresAt : 0,
    user: { id: Number(raw.user.id), email: String(raw.user.email) },
  };
}

export function loadAuthSession(): AuthSession | null {
  if (!canUseStorage()) return memorySession;
  try {
    return parseSession(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<AuthSession> | null);
  } catch {
    return memorySession;
  }
}

export function saveAuthSession(session: AuthSession) {
  memorySession = session;
  if (!canUseStorage()) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearAuthSession() {
  memorySession = null;
  if (!canUseStorage()) return;
  localStorage.removeItem(STORAGE_KEY);
}

export function isAccessExpiring(session: AuthTokens | null, skewSec = 60): boolean {
  if (!session) return true;
  return session.expiresAt <= Math.floor(Date.now() / 1000) + skewSec;
}
