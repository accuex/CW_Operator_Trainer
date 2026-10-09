import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fictionalExam } from './fixtures.mjs';
import { contentDigest, scanKakomonLeak, validateExamSet } from './model.mjs';

describe('houki kakomon model', () => {
  it('accepts a fictional sitting and rejects a public set without approval', () => {
    const exam = fictionalExam();
    expect(validateExamSet(exam)).toEqual([]);
    exam.distribution = 'public';
    expect(validateExamSet(exam).length).toBeGreaterThan(0);
    exam.rights.status = 'onHold';
    exam.rights.holds = [{ reason: '疑義', scope: exam.id, at: '2100-01-01', resolvedAt: null, resolution: null }];
    expect(validateExamSet(exam).join('\n')).toContain('保留');
  });

  it('rejects an English subject and a stale digest', () => {
    const exam = fictionalExam();
    exam.subject = 'english';
    expect(validateExamSet(exam).join('\n')).toContain('subject');
    const again = fictionalExam();
    again.questions[0].lead[0].v += '追記';
    expect(validateExamSet(again).join('\n')).toContain('contentDigest');
    expect(contentDigest(again.questions[0])).not.toBe(again.questionRevisions[0].contentDigest);
  });

  it('keeps private past-exam JSON out of public and data', () => {
    const files = [];
    for (const dir of ['public', 'data']) collectJson(dir, files);
    expect(scanKakomonLeak(files)).toEqual([]);
    expect(readFileSync('.gitignore', 'utf8')).toContain('/private/');
  });
});

describe('extracted private drafts', () => {
  const dir = 'private/houki-kakomon/sets';
  it.skipIf(!existsSync(dir))('validates every local private sitting', () => {
    const names = readdirSync(dir).filter((name) => name.endsWith('.json'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const exam = JSON.parse(readFileSync(join(dir, name), 'utf8'));
      expect(exam.distribution).toBe('private');
      expect(exam.review.transcription).toBe('draft');
      expect(validateExamSet(exam)).toEqual([]);
    }
  });
});

function collectJson(dir: string, files: { path: string; text: string }[]) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) collectJson(path, files);
    else if (name.endsWith('.json')) files.push({ path, text: readFileSync(path, 'utf8') });
  }
}
