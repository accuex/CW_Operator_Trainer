import { describe, expect, it } from 'vitest';
import { AVATARS, getAvatar } from './avatars';
import { normalizeProfile } from './storage';

describe('profile avatars', () => {
  it('has 32 distinct local choices', () => {
    expect(AVATARS).toHaveLength(32);
    expect(new Set(AVATARS.map((avatar) => avatar.id)).size).toBe(32);
    expect(AVATARS.every((avatar) => avatar.src.startsWith('/assets/avatar/'))).toBe(true);
  });
  it('retains a chosen avatar through profile serialization without changing progress', () => {
    const original = normalizeProfile({ avatarId: 'miori-radio', totalTrainingMs: 4321, goal: 'exam' });
    const restored = normalizeProfile(JSON.parse(JSON.stringify(original)));
    expect(restored.avatarId).toBe('miori-radio');
    expect(restored.totalTrainingMs).toBe(4321);
    expect(restored.goal).toBe('exam');
  });
  it('uses the standard icon for older profiles, reset selections and untrusted IDs', () => {
    for (const id of [undefined, null, 'https://example.com/avatar', '../private']) {
      expect(normalizeProfile({ avatarId: id }).avatarId).toBeNull();
      expect(getAvatar(id)).toBeNull();
    }
  });
});
