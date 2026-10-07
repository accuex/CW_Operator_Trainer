import { describe, expect, it } from 'vitest';
import { readExamMaterial, rememberExamMaterial, EXAM_MATERIAL_KEY } from './examMaterial';
describe('last 一総通 material', () => {
  it('defaults to communication and accepts only real material routes', () => {
    for (const value of [null, 'broken', 'qso', '']) expect(readExamMaterial('exam', { getItem: () => value })).toBe('exam');
    expect(readExamMaterial('exam', { getItem: () => 'geography' })).toBe('geography');
    expect(readExamMaterial('exam', { getItem: () => 'english' })).toBe('english');
  });
  it('remembers material without unrelated navigation overwriting it', () => {
    let saved: string | null = null;
    const storage = { getItem: () => saved, setItem: (key: string, value: string) => { expect(key).toBe(EXAM_MATERIAL_KEY); saved = value; } };
    rememberExamMaterial('geography', storage); rememberExamMaterial('home', storage);
    expect(readExamMaterial('exam', storage)).toBe('geography');
    rememberExamMaterial('english', storage);
    expect(readExamMaterial('exam', storage)).toBe('english');
    rememberExamMaterial('houki', storage);
    expect(readExamMaterial('exam', storage)).toBe('houki');
    rememberExamMaterial('exam', storage);
    expect(readExamMaterial('exam', storage)).toBe('houki');
    rememberExamMaterial('communication', storage);
    expect(readExamMaterial('geography', storage)).toBe('exam');
  });
  it('retains a memory fallback when storage is blocked', () => {
    const blocked = { getItem: () => { throw Error('denied'); }, setItem: () => { throw Error('denied'); } };
    expect(() => rememberExamMaterial('geography', blocked)).not.toThrow();
    expect(readExamMaterial('geography', blocked)).toBe('geography');
  });
});
