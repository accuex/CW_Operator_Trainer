/**
 * data/exam/sets.json → public/exam/sets/v{version}/{subject}/{NN}.json
 * アプリは出題時に1シャードだけ取得する（全セットをバンドルに入れない）。
 * 目録 data/exam/shards.json はアプリが静的に読む。
 *
 * 通常は generateExamSets.mjs が生成の最後に writeExamShards を呼ぶ。
 * sets.json を手で直したときだけ単体で実行する（npm run split:exam-sets）。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETS_PER_SHARD = 20;
const SUBJECTS = ['plain', 'codes', 'wabun'];

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function writeExamShards(file) {
  const outRoot = join(root, 'public/exam/sets');
  rmSync(outRoot, { recursive: true, force: true });

  const shards = {};
  for (const subject of SUBJECTS) {
    const sets = file[subject];
    if (!Array.isArray(sets) || sets.length === 0) throw new Error(`no sets for ${subject}`);
    const dir = join(outRoot, `v${file.version}`, subject);
    mkdirSync(dir, { recursive: true });
    const count = Math.ceil(sets.length / SETS_PER_SHARD);
    for (let index = 0; index < count; index += 1) {
      const chunk = sets.slice(index * SETS_PER_SHARD, (index + 1) * SETS_PER_SHARD);
      writeFileSync(join(dir, `${String(index).padStart(2, '0')}.json`), `${JSON.stringify(chunk)}\n`);
    }
    shards[subject] = count;
  }

  const manifest = { version: file.version, setsPerShard: SETS_PER_SHARD, shards };
  writeFileSync(join(root, 'data/exam/shards.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log('wrote exam set shards', manifest);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeExamShards(JSON.parse(readFileSync(join(root, 'data/exam/sets.json'), 'utf8')));
}
