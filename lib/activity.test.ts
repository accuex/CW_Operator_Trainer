import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ACTIVITY_SUBJECTS, activityMessage, EMPTY_SHARING, normalizeNickname, publishActivity, readSharing, syncSharedAvatar, retryWithdrawal, watchSharingWithdrawal, updateSharing } from './activity';
import { AVATARS } from './avatars';
import { ACHIEVEMENTS } from './achievements';

const request = vi.hoisted(() => vi.fn());
vi.mock('./api/client', () => ({ apiFetch: request }));
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal('window', { dispatchEvent: vi.fn() });
  request.mockReset();
});
describe('opt-in activity', () => {
  it('defaults to no sharing, independently of login/cloud profile', () => {
    expect(readSharing()).toEqual(EMPTY_SHARING);
    values.set('cwot:activity:preferences', 'malformed');
    expect(readSharing().enabled).toBe(false);
  });
  it('sanitizes display names and caps unicode characters', () => {
    expect(normalizeNickname('  みおり\n<>  ')).toBe('みおり');
    expect([...normalizeNickname('あ'.repeat(30))]).toHaveLength(24);
  });
  it('does not enable sharing when server registration fails', async () => {
    request.mockRejectedValue(new Error('offline'));
    await expect(updateSharing(true, '学習者')).rejects.toThrow();
    expect(readSharing().enabled).toBe(false);
  });
  it('disables local publishing immediately, preserving failed withdrawal for retry', async () => {
    values.set('cwot:activity:preferences', JSON.stringify({ ...EMPTY_SHARING, enabled: true }));
    request.mockRejectedValue(new Error('offline'));
    await expect(updateSharing(false, '')).rejects.toThrow();
    expect(readSharing()).toMatchObject({ enabled: false, pendingWithdrawal: true });
  });
  it('sends only opt-in identity and allowed event fields with a separate guest token', async () => {
    request.mockResolvedValue({ publicId: 'a'.repeat(24), revision: 0, sharing: true });
    await updateSharing(true, 'テスト利用者', 'penguin');
    await publishActivity('started', 'learn', 'penguin');
    expect(request).toHaveBeenCalledTimes(3);
    const settings = request.mock.calls[1];
    expect(JSON.parse(settings[1].body)).toEqual({ sharing: true, nickname: 'テスト利用者', avatarId: 'penguin', revision: 0 });
    expect(settings[1].headers.Authorization).toMatch(/^Bearer [a-f0-9]{64}$/);
    expect(settings[2]).toEqual({ auth: false });
    expect(JSON.parse(request.mock.calls[2][1].body)).toEqual({ kind: 'started', detail: 'learn' });
  });
  it('does not send events without consent or for unknown event IDs', async () => {
    await publishActivity('started', 'learn');
    expect(request).not.toHaveBeenCalled();
    values.set('cwot:activity:preferences', JSON.stringify({ ...EMPTY_SHARING, enabled: true }));
    await publishActivity('achievement', 'made-up');
    await publishActivity('started', 'made-up');
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps client and server event/asset allowlists aligned', () => {
    const catalog = JSON.parse(readFileSync('api/data/activity-catalog.json', 'utf8'));
    expect(catalog.avatars).toEqual(AVATARS.map((a) => a.id));
    expect(catalog.achievements).toEqual(ACHIEVEMENTS.map((a) => a.id));
    expect(catalog.subjects).toEqual(Object.keys(ACTIVITY_SUBJECTS));
  });
  it('renders event detail via the fixed catalog, not arbitrary text', () => {
    expect(activityMessage({ id: 'a', publicId: 'b', nickname: 'c', avatarId: null, kind: 'achievement', detail: 'latin-starter', createdAt: 1 })).toContain('欧文入門');
  });
});

describe('consent ordering across tabs and delayed requests', () => {
  it('a delayed ON response does not overwrite a newer local OFF intent', async () => {
    let finish!: (value: unknown) => void;
    request.mockResolvedValueOnce({ revision: 0 });
    request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    request.mockResolvedValueOnce({ publicId: 'a'.repeat(24), sharing: false });
    const on = updateSharing(true, '遅延');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    const off = updateSharing(false, '');
    finish({ publicId: 'a'.repeat(24), sharing: true });
    await on; await off;
    expect(readSharing()).toMatchObject({ enabled: false, pendingWithdrawal: false });
  });
  it('OFF in another tab while ON reads consent cancels the stale ON request', async () => {
    let finish!: (value: unknown) => void;
    request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const on = updateSharing(true, '遅延');
    const rejected = expect(on).rejects.toThrow('another tab');
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    values.set('cwot:activity:consent-intent','other-tab-off');
    values.set('cwot:activity:preferences',JSON.stringify({ ...EMPTY_SHARING }));
    finish({ revision: 1 }); await rejected;
    expect(request).toHaveBeenCalledTimes(1);
    expect(readSharing().enabled).toBe(false);
  });
  it('avatar and nickname updates send no consent and respect server OFF', async () => {
    values.set('cwot:activity:preferences',JSON.stringify({ ...EMPTY_SHARING, enabled: true }));
    request.mockResolvedValue({ sharing: false });
    await syncSharedAvatar('penguin','名前');
    expect(request.mock.calls[0][0]).toBe('/api/v1/activity/profile');
    expect(JSON.parse(request.mock.calls[0][1].body)).toEqual({ nickname: '名前', avatarId: 'penguin' });
    expect(readSharing().enabled).toBe(false);
  });
  it('online retry retains failure and clears pending only on success', async () => {
    values.set('cwot:activity:preferences',JSON.stringify({ ...EMPTY_SHARING, pendingWithdrawal: true }));
    let online!: () => void;
    const remove = vi.fn();
    vi.stubGlobal('window',{ dispatchEvent: vi.fn(), addEventListener: (_: string, fn: () => void) => { online = fn; }, removeEventListener: remove });
    const stop = watchSharingWithdrawal();
    request.mockRejectedValueOnce(new Error('offline'));
    online(); await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(readSharing().pendingWithdrawal).toBe(true);
    request.mockResolvedValue({ publicId: 'a'.repeat(24), sharing: false });
    await retryWithdrawal(); expect(readSharing().pendingWithdrawal).toBe(false);
    stop(); expect(remove).toHaveBeenCalledWith('online',online);
  });
});
