import { describe, expect, it } from 'vitest';
import { APP_BASE, pathToView, viewToPath } from './appPaths';

describe('app paths', () => {
  it('maps home to /app and other views under it', () => {
    expect(viewToPath('home')).toBe(APP_BASE);
    expect(viewToPath('learn')).toBe('/app/learn');
    expect(viewToPath('qso')).toBe('/app/qso');
  });

  it('reads the view from /app/* and ignores the public landing', () => {
    expect(pathToView('/app')).toBe('home');
    expect(pathToView('/app/')).toBe('home');
    expect(pathToView('/app/exam')).toBe('exam');
    expect(pathToView('/app/learn/extra')).toBe('learn');
    expect(pathToView('/')).toBe('home');
    expect(pathToView('/learn')).toBe('home');
    expect(pathToView('/nope')).toBe('home');
  });
});
