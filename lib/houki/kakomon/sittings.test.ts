import { describe, expect, it } from 'vitest';
import { fictionalExam } from './fixtures.mjs';
import { emptyProgress, scopeKey, startDrill } from './loop';
import { eraOf, groupSittings, orderOfRun, parseScopeKey, sittingLabel, sittingShort } from './sittings';
import type { ExamSet } from './types';

const base = fictionalExam() as ExamSet;
const sitting = (year: number, month: 3 | 9) => ({ ...base, id: `s-${year}-${month}`, exam: { ...base.exam, year, month } });

describe('kakomon sittings', () => {
  it('switches era at May 2019 and writes year 1 as 元', () => {
    expect(eraOf(2019, 3)).toEqual({ era: '平成', eraYear: 31 });
    expect(eraOf(2019, 9)).toEqual({ era: '令和', eraYear: 1 });
    expect(sittingLabel({ year: 2019, month: 9 })).toBe('令和元年9月期');
    expect(sittingLabel({ year: 2011, month: 3 })).toBe('平成23年3月期');
    expect(sittingShort({ year: 2026, month: 9 })).toBe('R8.9');
  });

  it('groups sittings by year, newest first, keeping a missing month empty', () => {
    const groups = groupSittings([sitting(2011, 3), sitting(2026, 9), sitting(2026, 3)]);
    expect(groups.map((group) => group.year)).toEqual([2026, 2011]);
    expect(groups[0].march?.id).toBe('s-2026-3');
    expect(groups[0].september?.id).toBe('s-2026-9');
    expect(groups[1].september).toBeNull();
    expect(groups[1].eraLabel).toBe('平成23年');
    expect(groupSittings([sitting(2019, 3)])[0].eraLabel).toBe('平成31・令和元年');
  });

  it('reads back the scope and order a run was started with', () => {
    expect(parseScopeKey(scopeKey(['a'], ['A', 'B']))).toEqual({ examIds: ['a'], sections: ['A', 'B'] });
    expect(parseScopeKey(scopeKey(['b', 'a'], ['B']))).toEqual({ examIds: ['a', 'b'], sections: ['B'] });
    expect(parseScopeKey('other')).toBeNull();
    const started = startDrill(emptyProgress(), base, { order: 'weak', sections: ['A', 'B'], excludeMastered: false }, '2026-10-09T11:00:00+09:00');
    expect(orderOfRun(started.progress.active!.setDefinitionDigest)).toBe('weak');
    expect(orderOfRun('random@5:x')).toBe('random');
    expect(orderOfRun('seq@0:x')).toBe('seq');
  });
});
