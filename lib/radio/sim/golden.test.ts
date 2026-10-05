import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { allSnapshots, type GoldenEntry } from './golden';

/**
 * CQ Run v1 (6a1c74c), fixed seeds: the same stations, the same timing on the air, the
 * same QSOs and the same numbers. `GOLDEN_UPDATE=1` rewrites the fixture (only for a
 * change meant to alter runs); `GOLDEN_DUMP=<dir>` writes each full snapshot for diffing.
 */
const FIXTURE = join(__dirname, '__golden__', 'cq-run-v1.json');

describe('CQ Run golden runs', () => {
  it('reproduces every fixed-seed run exactly', () => {
    const snapshots = allSnapshots();
    const entries = snapshots.map((snapshot) => snapshot.entry);
    const dump = process.env.GOLDEN_DUMP;
    if (dump) {
      mkdirSync(dump, { recursive: true });
      for (const { entry, full } of snapshots) writeFileSync(join(dump, `${entry.name}-${entry.seed}.json`), full);
    }
    if (process.env.GOLDEN_UPDATE || !existsSync(FIXTURE)) {
      writeFileSync(FIXTURE, `${JSON.stringify(entries, null, 1)}\n`);
      return;
    }
    const expected = JSON.parse(readFileSync(FIXTURE, 'utf8')) as GoldenEntry[];
    expect(entries.map((entry) => `${entry.name}#${entry.seed}`)).toEqual(expected.map((entry) => `${entry.name}#${entry.seed}`));
    for (const [index, entry] of entries.entries()) {
      // Summary first: when a digest moves, it says which numbers did.
      expect({ run: `${entry.name}#${entry.seed}`, ...entry.summary }).toEqual({ run: `${expected[index].name}#${expected[index].seed}`, ...expected[index].summary });
      expect(entry.digest, `${entry.name}#${entry.seed}`).toBe(expected[index].digest);
    }
  }, 120_000);
});
