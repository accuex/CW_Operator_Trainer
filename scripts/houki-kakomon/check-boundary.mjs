import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { scanKakomonLeak } from '../../lib/houki/kakomon/model.mjs';

const files = [];
for (const dir of ['public', 'data', 'dist']) {
  if (existsSync(dir)) collect(dir, files);
}
const hits = scanKakomonLeak(files);
if (hits.length) {
  console.error(hits.join('\n'));
  process.exit(1);
}
console.log('kakomon boundary ok');

function collect(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path, out);
    else if (name.endsWith('.json')) out.push({ path, text: readFileSync(path, 'utf8') });
  }
}
