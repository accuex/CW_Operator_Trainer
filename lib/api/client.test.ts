import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAuthSession, saveAuthSession } from './authSession';
import { apiFetch, ensureAccessToken } from './client';

describe('api client auto refresh', () => {
  beforeEach(() => {
    clearAuthSession();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes proactively when access token is near expiry', async () => {
    saveAuthSession({
      accessToken: 'old-access',
      refreshToken: 'refresh-1',
      expiresAt: Math.floor(Date.now() / 1000) + 10,
      user: { id: 1, email: 'a@example.com' },
    });

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/refresh')) {
        return new Response(JSON.stringify({
          accessToken: 'new-access',
          refreshToken: 'refresh-2',
          expiresIn: 3600,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 1, email: 'a@example.com' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(ensureAccessToken()).resolves.toBe('new-access');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries once after 401 with a refreshed token', async () => {
    saveAuthSession({
      accessToken: 'stale-access',
      refreshToken: 'refresh-1',
      expiresAt: Math.floor(Date.now() / 1000) + 3600,
      user: { id: 1, email: 'a@example.com' },
    });

    let syncCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/refresh')) {
        return new Response(JSON.stringify({
          accessToken: 'fresh-access',
          refreshToken: 'refresh-2',
          expiresIn: 3600,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
          user: { id: 1, email: 'a@example.com' },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.endsWith('/api/v1/sync')) {
        syncCalls += 1;
        const auth = new Headers(init?.headers).get('Authorization');
        if (auth === 'Bearer stale-access') {
          return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
        }
        return new Response(JSON.stringify({ revision: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/v1/sync')).resolves.toEqual({ revision: 1 });
    expect(syncCalls).toBe(2);
  });
});
