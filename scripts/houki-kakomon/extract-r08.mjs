import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256, stampInitialRevisions, validateExamSet } from '../../lib/houki/kakomon/model.mjs';

const root = resolve(import.meta.dirname, '../..');
const pdfDir = resolve(root, 'docs/全過去問_解答PDF');
const outDir = resolve(root, 'private/houki-kakomon');
const workDir = resolve(outDir, 'work');
const SITTINGS = [
  '2002-03', '2002-09', '2003-03', '2003-09', '2004-03', '2004-09', '2005-03', '2005-09',
  '2006-03', '2006-09', '2007-03', '2007-09', '2008-03', '2008-09', '2009-03', '2009-09',
  '2010-03', '2010-09',
  '2011-03', '2013-09', '2014-03', '2014-09',
  '2016-03', '2016-09', '2017-03', '2017-09', '2018-03', '2018-09', '2019-03', '2019-09', '2020-03',
  '2020-09', '2021-03', '2021-09', '2022-03', '2022-09', '2023-03', '2023-09', '2024-03', '2024-09',   '2025-03', '2025-09', '2026-03', '2026-09',
];
const pageFooter = /（[ＡA][ＹY][0-9０-９]{3}[－―‐−-][0-9０-９]+）/;
const LAWS = ['国際電気通信連合憲章', '国際電気通信連合条約', '無線局免許手続規則', '電波法施行規則', '無線局運用規則', '無線設備規則', '無線通信規則', '電波法'];
const SUB = { ア: 'a', イ: 'i', ウ: 'u', エ: 'e', オ: 'o' };
const QUOTED_TERMS = 'これらの試験問題の著作権は、公益財団法人日本無線協会に帰属しています。 英語の科目の試験問題を除き、国家試験の受験など試験制度の意義に反しない場合に限り、公表されている過去の試験問題を無償で問題集等に使用することができます。この場合、当協会に許諾を求める必要もありません。 なお、公表しているPDF以外の電子データは提供できかねます。また、英語の科目については他の著作権との関係があり、転用は認めていません。';

const questionHeader = /^[ \t\f]*([ＡＢAB])\s*[－―‐−-]\s*([0-9０-９]{1,2})(?![0-9０-９])/;
const fileHash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const SENT = '\uE000';
const fw = (value) => Number(String(value).replace(/[０-９]/g, (char) => String(char.charCodeAt(0) - 0xff10)));
const text = (value) => (value ? [{ t: 'text', v: value }] : []);
const glue = /[0-9０-９A-Za-zＡ-Ｚａ-ｚ]/;
const halfwidthPunct = { '｡': '。', '｢': '「', '｣': '」', '､': '、', '･': '・' };
const halfwidthKana = 'ヲァィゥェォャュョッーアイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン';
const RUBY_BASE = { ふく: '輻', きょう: '筐', だ: '舵', おそれ: '虞' };
const tidy = (value) => value.replace(/[ \t]{2,}/g, '　').replace(/[ \t]+/g, '').replace(/([のに、])内に/g, '$1　内に');
const widenBlankLetters = (value) => value.replace(/[A-E]/g, (char, index, source) => (
  glue.test(source[index - 1] ?? '') || glue.test(source[index + 1] ?? '')
    ? char
    : String.fromCharCode(char.charCodeAt(0) + 0xfee0)
));

function repairBlankBoxes(value, blanks) {
  const collapsed = value.replace(/([Ａ-Ｅ])\1/g, (pair, char) => (blanks.has(char) ? char : pair));
  return collapsed.replace(/６([Ａ-Ｅ])以/g, (all, char) => (blanks.has(char) ? ` ${char} ` : all));
}

function protectBlanks(value, blanks) {
  if (!blanks.size) return value;
  const sourceText = repairBlankBoxes(value, blanks);
  return sourceText.replace(/[Ａ-ＥA-Eア-オ]/gu, (char, index, source) => {
    if (!blanks.has(char)) return char;
    const prev = source[index - 1] ?? '';
    const next = source[index + 1] ?? '';
    return glue.test(prev) || glue.test(next) ? char : SENT + char;
  });
}

function repairHalfwidth(value) {
  let count = 0;
  let text = '';
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0xff61 || code > 0xff9f) {
      text += char;
      continue;
    }
    count += 1;
    if (halfwidthPunct[char]) text += halfwidthPunct[char];
    else if (code >= 0xff66 && code <= 0xff9d) text += halfwidthKana[code - 0xff66];
    else throw new Error(`未対応の半角カナ U+${code.toString(16)}`);
  }
  return { text, count };
}

function extractText(pdfPath, dest) {
  execFileSync('pdftotext', ['-layout', pdfPath, dest], { stdio: 'inherit' });
  return readFileSync(dest, 'utf8');
}

function versionOf(stderr) {
  const match = stderr.match(/version\s+([0-9.]+)/i);
  return match ? match[1] : 'unknown';
}

const ANSWER_DASH = '[−－―‐−-]';

function parseAnswers(raw) {
  const bracketA = {};
  for (const match of raw.matchAll(new RegExp(`〔\\s*Ａ\\s*${ANSWER_DASH}\\s*([0-9０-９]+)\\s*〕\\s*([0-9０-９])`, 'g'))) bracketA[fw(match[1])] = fw(match[2]);
  const sectionA = Object.keys(bracketA).length === 20 ? bracketA : plainSectionA(raw);
  const sectionB = Object.keys(bracketA).length === 20 ? bracketSectionB(raw) : plainSectionB(raw);
  if (Object.keys(sectionA).length !== 20) throw new Error(`A の正答が ${Object.keys(sectionA).length} 件`);
  for (let question = 1; question <= 5; question += 1) {
    const item = sectionB[question] ?? {};
    if ('アイウエオ'.split('').some((label) => item[label] == null)) throw new Error(`B-${question} の正答が揃っていない`);
  }
  const mode = raw.includes('小設問各') ? 'perSubItem' : 'unspecified';
  const full = raw.match(/(?:満点|総得点)\s+([0-9０-９]+)\s*点/);
  const pass = raw.match(/(?:合格点|合格基準)\s*([0-9０-９]+)\s*点/);
  return {
    sectionA,
    sectionB,
    mode,
    fullMarks: full ? fw(full[1]) : null,
    passMark: pass ? fw(pass[1]) : null,
    note: raw.split('\n').filter((line) => /点（|点。/.test(line)).map((line) => line.replace(/配点内訳/g, '').replace(/\s+/g, '')).filter(Boolean).join('　'),
  };
}

function plainSectionA(raw) {
  const sectionA = {};
  for (const match of raw.matchAll(new RegExp(`[ＡA]\\s*${ANSWER_DASH}\\s*([0-9０-９]{1,2})\\s+([0-9０-９]{1,2})`, 'g'))) sectionA[fw(match[1])] = fw(match[2]);
  return sectionA;
}

function bracketSectionB(raw) {
  const pairs = [];
  for (const line of raw.split('\n')) {
    const match = line.match(/([アイウエオ])\s+([0-9０-９]+)/);
    if (match) pairs.push([match[1], fw(match[2])]);
  }
  if (pairs.length !== 25) throw new Error(`B の正答が ${pairs.length} 件`);
  const sectionB = {};
  for (let question = 1; question <= 5; question += 1) {
    sectionB[question] = {};
    for (let index = 0; index < 5; index += 1) {
      const [label, answer] = pairs[(question - 1) * 5 + index];
      sectionB[question][label] = answer;
    }
  }
  return sectionB;
}

function plainSectionB(raw) {
  const blocks = [];
  let block = [];
  const flush = () => {
    if (block.length) blocks.push(block);
    block = [];
  };
  for (const line of raw.split('\n')) {
    const hasPair = /[アイウエオ]\s+[0-9０-９]/.test(line);
    const hasMarker = new RegExp(`[ＢB]\\s*${ANSWER_DASH}\\s*[0-9０-９]`).test(line);
    if (!hasPair && !hasMarker) {
      flush();
      continue;
    }
    if (/ア/.test(line) && block.some((item) => /ア/.test(item))) flush();
    block.push(line);
  }
  flush();
  const sectionB = {};
  for (const rows of blocks) {
    const left = [];
    const right = [];
    const markers = [];
    for (const line of rows) {
      const pairs = [...line.matchAll(/([アイウエオ])\s+([0-9０-９]{1,2})/g)];
      if (pairs[0]) left.push([pairs[0][1], fw(pairs[0][2])]);
      if (pairs[1]) right.push([pairs[1][1], fw(pairs[1][2])]);
      for (const marker of line.matchAll(new RegExp(`[ＢB]\\s*${ANSWER_DASH}\\s*([0-9０-９]{1,2})`, 'g'))) markers.push({ n: fw(marker[1]), at: marker.index });
    }
    markers.sort((leftMark, rightMark) => leftMark.at - rightMark.at);
    const assign = (pairs, number) => {
      if (!number) return;
      sectionB[number] = Object.fromEntries(pairs);
    };
    if (markers.length >= 2) {
      assign(left, markers[0].n);
      assign(right, markers[1].n);
    } else if (markers.length === 1) assign(left.length >= right.length ? left : right, markers[0].n);
  }
  return sectionB;
}

function splitQuestions(raw) {
  const lines = raw.split('\n');
  const marks = [];
  lines.forEach((line, index) => {
    const match = line.match(questionHeader);
    if (match) marks.push({ section: match[1], number: fw(match[2]), index });
  });
  return marks.map((mark, index) => ({
    section: mark.section === 'Ａ' || mark.section === 'A' ? 'A' : 'B',
    number: mark.number,
    lines: lines.slice(mark.index, marks[index + 1]?.index ?? lines.length).map((line) => line.replace(/\f/g, '')),
  }));
}

function cleanLines(lines) {
  return lines
    .map((line, index) => {
      const next = line.replace(/\f/g, '').replace(/\u216d/g, 'Ｃ').replace(/\u216e/g, 'Ｄ');
      return index === 0 ? next.replace(questionHeader, '') : next;
    })
    .filter((line) => !pageFooter.test(line));
}

function takeLead(lines) {
  const taken = [];
  let index = 0;
  for (; index < lines.length; index += 1) {
    if (!lines[index].trim()) continue;
    taken.push(lines[index].trim());
    const joined = tidy(taken.join(''));
    const ready = /(?:一つ|１つ|番号から)選べ。|解答せよ。/.test(joined);
    const noteTail = joined.split('なお、').pop() ?? '';
    const noteOpen = joined.includes('なお、') && !joined.includes('入るものとする。') && !noteTail.includes('。');
    const tail = joined.split(/(?:一つ|１つ|番号から)選べ。|解答せよ。/).pop() ?? '';
    const provisoOpen = /ただし|なお/.test(tail) && !tail.includes('。');
    const upcoming = lines.slice(index + 1).find((line) => line.trim())?.trim() ?? '';
    if (ready && !noteOpen && !provisoOpen && !/^ただし|^なお/.test(upcoming)) {
      index += 1;
      break;
    }
  }
  return { lead: tidy(taken.join('')), rest: lines.slice(index) };
}

function tokenize(value, blanks) {
  const items = [];
  let buffer = '';
  const push = () => {
    if (!buffer) return;
    items.push({ t: 'text', v: buffer });
    buffer = '';
  };
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === SENT && blanks.has(value[index + 1])) {
      push();
      items.push({ t: 'blank', label: value[index + 1] });
      index += 1;
    } else buffer += char;
  }
  push();
  return items
    .map((item) => (item.t === 'text' ? { ...item, v: item.v.replace(/^　+|　+$/g, '') } : item))
    .filter((item) => item.t !== 'text' || item.v);
}

function appendInline(body, more) {
  if (!more.length) return body;
  const next = body.slice();
  if (next.at(-1)?.t === 'text' && more[0].t === 'text') {
    next[next.length - 1] = { t: 'text', v: next.at(-1).v + more[0].v };
    next.push(...more.slice(1));
  } else next.push(...more);
  return next;
}

function parseBlocks(lines, blanks) {
  const blocks = [];
  let current = null;
  let circled = null;
  let pendingRuby = null;
  const marker = /^([①②③④⑤⑥⑦⑧⑨⑩]|[（(][0-9０-９]+[）)])\s*(.*)$/u;
  const tokens = (value) => {
    const inlines = tokenize(tidy(protectBlanks(value, blanks)), blanks);
    if (pendingRuby && applyRuby(inlines, pendingRuby)) pendingRuby = null;
    return inlines;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (RUBY_BASE[line]) {
      pendingRuby = line;
      continue;
    }
    const item = line.match(marker);
    const note = line.match(/^(注[0-9０-９]*)\s*(.*)$/u);
    if (item) {
      const block = { t: 'item', marker: item[1], body: tokens(item[2]) };
      const paren = /^[（(]/.test(item[1]);
      if (paren && circled) {
        circled.children ??= [];
        circled.children.push(block);
      } else {
        blocks.push(block);
        circled = paren ? null : block;
      }
      current = block;
    } else if (note) {
      const block = { t: 'note', marker: note[1], body: tokens(note[2]) };
      blocks.push(block);
      current = block;
      circled = null;
    } else if (current) current.body = appendInline(current.body, tokens(line));
    else {
      current = { t: 'p', body: tokens(line) };
      blocks.push(current);
    }
  }
  if (pendingRuby) throw new Error(`ふりがなが余った: ${pendingRuby}`);
  return blocks;
}

const COLUMN_LETTERS = 'ＡＢＣＤＥABCDE';

function isColumnHeader(line) {
  const stripped = Object.keys(RUBY_BASE).reduce((value, reading) => value.replaceAll(reading, ''), line);
  const letters = [...stripped].filter((char) => COLUMN_LETTERS.includes(char));
  return letters.length >= 2 && stripped.replace(/[ＡＢＣＤＥABCDE\s]/g, '') === '';
}

function cellText(slice) {
  const trimmed = slice.replace(/^\s+|\s+$/g, '');
  if (!trimmed) return '';
  return trimmed.replace(/[ \t]{2,}/g, '　').replace(/[ \t]/g, '');
}

function lineTokens(line) {
  return [...line.matchAll(/\S+/g)].map((match) => ({ at: match.index, text: match[0] }));
}

function tableCells(line, columns) {
  const rowNumber = /^\s*[1-5１-５](?=\s)/.test(line);
  const buckets = columns.map(() => []);
  for (const token of lineTokens(line)) {
    if (rowNumber && /^[1-5１-５]$/.test(token.text) && token.at <= columns[0].at) continue;
    let nearest = 0;
    columns.forEach((column, index) => {
      if (Math.abs(token.at - column.at) < Math.abs(token.at - columns[nearest].at)) nearest = index;
    });
    buckets[nearest].push(token);
  }
  return buckets.map((bucket) => text(joinTokens(bucket)));
}

function joinTokens(tokens) {
  return tokens.reduce((value, token, index) => {
    if (!index) return token.text;
    const previous = tokens[index - 1];
    const gap = token.at - (previous.at + previous.text.length);
    return value + (gap >= 2 ? '　' : '') + token.text;
  }, '');
}

function appendCell(cell, extra) {
  if (!extra) return;
  const part = [...cell].reverse().find((item) => item.t === 'text');
  if (part) part.v += extra;
  else cell.push({ t: 'text', v: extra });
}

function parseTable(lines) {
  const headerAt = lines.findIndex((line) => isColumnHeader(line));
  if (headerAt < 0) throw new Error('組合せ表の見出しがない');
  let start = headerAt;
  let leadingRuby = null;
  for (let index = headerAt - 1; index >= 0; index -= 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) continue;
    if (RUBY_BASE[trimmed]) {
      leadingRuby ??= trimmed;
      continue;
    }
    if (/^[ＡＢＣＤＥABCDE]$/.test(trimmed)) {
      start = index;
      continue;
    }
    break;
  }
  const headerRuby = Object.keys(RUBY_BASE).find((reading) => lines[headerAt].includes(reading)) ?? null;
  const columns = [];
  for (let index = start; index <= headerAt; index += 1) {
    const trimmed = lines[index].trim();
    if (!isColumnHeader(lines[index]) && !/^[ＡＢＣＤＥABCDE]$/.test(trimmed)) continue;
    [...lines[index]].forEach((char, at) => {
      if (COLUMN_LETTERS.includes(char)) columns.push({ label: char, at });
    });
  }
  let bodyAt = headerAt + 1;
  for (let index = headerAt + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) continue;
    if (/^[ＡＢＣＤＥABCDE]$/.test(trimmed) && !columns.some((column) => column.label === trimmed)) {
      columns.push({ label: trimmed, at: lines[index].indexOf(trimmed) });
      bodyAt = index + 1;
      continue;
    }
    break;
  }
  columns.sort((left, right) => left.at - right.at);
  const peeled = peelTrailingRuby(lines.slice(0, start));
  const rows = [];
  let row = null;
  let pendingRuby = leadingRuby ?? headerRuby ?? peeled.ruby;
  for (const line of lines.slice(bodyAt)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (RUBY_BASE[trimmed]) {
      pendingRuby = trimmed;
      continue;
    }
    const rowMark = line.match(/^\s*([1-5１-５])(?=\s)/);
    if (rowMark) {
      row = { no: fw(rowMark[1]), cells: tableCells(line, columns) };
      rows.push(row);
    } else if (row) {
      tableCells(line, columns).forEach((extra, index) => appendCell(row.cells[index], extra[0]?.v ?? ''));
    }
    if (pendingRuby && row) {
      const base = RUBY_BASE[pendingRuby];
      const cell = row.cells.find((parts) => parts.some((part) => part.t === 'text' && part.v.includes(base)));
      if (cell && applyRuby(cell, pendingRuby)) pendingRuby = null;
    }
  }
  if (pendingRuby) throw new Error(`ふりがなが余った: ${pendingRuby}`);
  const filled = (cell) => cell.some((part) => part.t === 'ruby' || (part.t === 'text' && part.v));
  if (rows.some((item) => item.cells.some((cell) => !filled(cell)))) throw new Error('組合せ表に空のセルがある');
  return { columns: columns.map((column) => column.label), rows, bodyLines: peeled.lines };
}

function applyRuby(inlines, reading) {
  const base = RUBY_BASE[reading];
  if (!base) return false;
  const index = inlines.findIndex((item) => item.t === 'text' && item.v.includes(base));
  if (index < 0) return false;
  const inline = inlines[index];
  const at = inline.v.indexOf(base);
  const replacement = [];
  if (at > 0) replacement.push({ t: 'text', v: inline.v.slice(0, at) });
  replacement.push({ t: 'ruby', base, reading });
  const rest = inline.v.slice(at + base.length);
  if (rest) replacement.push({ t: 'text', v: rest });
  inlines.splice(index, 1, ...replacement);
  return true;
}

function parseBank(lines) {
  const bank = [];
  let pendingRuby = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (RUBY_BASE[line]) {
      pendingRuby = line;
      continue;
    }
    const added = [];
    const marks = [...line.matchAll(/(?:^|\s)([0-9０-９]{1,2})(?=\s)/g)];
    const kept = [];
    const used = new Set(bank.map((entry) => entry.no));
    let next = 1;
    while (used.has(next)) next += 1;
    marks.forEach((match) => {
      const no = fw(match[1]);
      const previous = kept.at(-1);
      const gap = previous ? match.index - previous.index : 99;
      if (no === next) {
        kept.push(match);
        next += 1;
        while (used.has(next)) next += 1;
      } else if (gap >= 8 && no > next && no <= 10 && !used.has(no)) kept.push(match);
    });
    kept.forEach((match, index) => {
      const start = match.index + match[0].length;
      const end = kept[index + 1]?.index ?? line.length;
      const value = cellText(line.slice(start, end));
      if (!value) return;
      const entry = { no: fw(match[1]), body: text(value) };
      bank.push(entry);
      added.push(entry);
    });
    if (pendingRuby) {
      const base = RUBY_BASE[pendingRuby];
      const target = added.find((entry) => entry.body.some((part) => part.t === 'text' && part.v.includes(base)));
      if (target && applyRuby(target.body, pendingRuby)) pendingRuby = null;
    }
  }
  if (pendingRuby) throw new Error(`ふりがなが余った: ${pendingRuby}`);
  bank.sort((a, b) => a.no - b.no);
  return bank;
}

function parseChoices(lines) {
  const groups = [];
  let current = null;
  let held = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (RUBY_BASE[line]) {
      held.push(rawLine);
      continue;
    }
    const packed = line.match(/^(?:[1-5１-５]\s+.*\s{2,}[1-5１-５]\s+)/) ? [...line.matchAll(/(?:^|\s{2,})([1-5１-５])(?=\s)/g)] : [];
    if (packed.length > 1 && fw(packed[0][1]) === (current?.no ?? 0) + 1) {
      packed.forEach((mark, markIndex) => {
        const start = mark.index + mark[0].length;
        const end = packed[markIndex + 1]?.index ?? line.length;
        current = { no: fw(mark[1]), lines: [line.slice(start, end).trim()] };
        groups.push(current);
      });
      held = [];
      continue;
    }
    const choice = line.match(/^([1-5１-５])(?:\s+(.*))?$/);
    const no = choice ? fw(choice[1]) : 0;
    if (choice && no === (current?.no ?? 0) + 1) {
      current = { no, lines: [...held, choice[2] ?? ''] };
      held = [];
      groups.push(current);
    } else if (current) {
      current.lines.push(...held, rawLine);
      held = [];
    }
  }
  if (held.length && current) current.lines.push(...held);
  return groups.map((group) => ({ no: group.no, body: parseBlocks(group.lines, new Set()) }));
}

function legalRefs(lead) {
  const refs = [];
  for (const law of LAWS) {
    for (const match of lead.matchAll(new RegExp(`${law}（([^）]+)）`, 'g'))) {
      refs.push({
        law,
        lawId: law === '電波法' ? '325AC0000000131' : null,
        raw: `${law}（${match[1]}）`,
        provisions: provisionsOf(match[1]),
      });
    }
  }
  return refs;
}

function provisionsOf(inner) {
  const range = inner.match(/第([0-9０-９]+)条から第([0-9０-９]+)条まで/);
  if (range) {
    const from = fw(range[1]);
    const to = fw(range[2]);
    return Array.from({ length: to - from + 1 }, (_, index) => ({ article: String(from + index) }));
  }
  return [...inner.matchAll(/第([0-9０-９]+)条(?:の([0-9０-９]+))?/g)].map((match) => ({
    article: String(fw(match[1])) + (match[2] ? `の${fw(match[2])}` : ''),
  }));
}

function judgeLabels(lead) {
  const match = lead.match(/([^、。]{1,20})を１、([^、。]{1,20})を２/);
  const trim = (value) => value.replace(/するもの$/, 'する').replace(/もの$/, '');
  if (!match) return { 1: '１', 2: '２' };
  return { 1: trim(match[1]), 2: trim(match[2]) };
}

function classify(section, lead) {
  if (section === 'B' && (/[1１]から\s*[1１][0０]/u.test(lead) || /下の番号から選べ/.test(lead))) return 'wordBank';
  if (section === 'B' && /を\s*[1１]\s*、/.test(lead)) return 'judge';
  if (/字句の(?:正しい)?組合せ|字句の組み合わせ|字句の組み合せ/.test(lead)) return 'combination';
  return 'single';
}

function polarityOf(lead) {
  return /適合しないもの|該当しないもの/.test(lead) ? 'negative' : 'positive';
}

function baseQuestion(setId, section, number, lead) {
  return {
    id: `${setId}-${section}${String(number).padStart(2, '0')}`,
    section,
    number,
    revision: 1,
    lead: text(lead),
    body: [],
    legalRefs: legalRefs(lead),
    tags: [],
    variantGroup: null,
    explanation: null,
  };
}

function peelTrailingRuby(lines) {
  const copy = lines.slice();
  while (copy.length && !copy.at(-1).trim()) copy.pop();
  const last = copy.at(-1)?.trim() ?? '';
  if (!RUBY_BASE[last]) return { ruby: null, lines };
  copy.pop();
  return { ruby: last, lines: copy };
}

function parseQuestion(chunk, setId, answers) {
  const lines = cleanLines(chunk.lines);
  const { lead, rest } = takeLead(lines);
  const format = classify(chunk.section, lead);
  const question = baseQuestion(setId, chunk.section, chunk.number, lead);
  try {
    if (format === 'single') {
      const choices = parseChoices(rest);
      Object.assign(question, { format, polarity: polarityOf(lead), choices, answer: answers.sectionA[chunk.number], points: 5 });
    } else if (format === 'combination') {
      const table = parseTable(rest);
      Object.assign(question, {
        format,
        body: parseBlocks(table.bodyLines, new Set(table.columns)),
        columns: table.columns,
        rows: table.rows,
        answer: answers.sectionA[chunk.number],
        points: 5,
      });
    } else if (format === 'judge') {
      const items = [];
      let current = null;
      let held = [];
      for (const rawLine of rest) {
        const line = rawLine.trim();
        if (!line) continue;
        if (RUBY_BASE[line]) {
          held.push(rawLine);
          continue;
        }
        const match = line.match(/^([アイウエオ])\s*(.*)$/);
        if (match) {
          current = { label: match[1], lines: [...held, match[2]] };
          held = [];
          items.push(current);
        } else if (current) {
          current.lines.push(...held, rawLine);
          held = [];
        }
      }
      if (held.length && current) current.lines.push(...held);
      Object.assign(question, {
        format,
        labels: judgeLabels(lead),
        items: items.map((item) => ({
          id: `${question.id}-${SUB[item.label]}`,
          label: item.label,
          body: parseBlocks(item.lines, new Set()),
          answer: answers.sectionB[chunk.number][item.label],
        })),
        pointsEach: 1,
      });
    } else {
      const bankAt = rest.findIndex((line) => /^\s*[1１][ \t]+/.test(line) && /[2２]/.test(line));
      const bodyLines = rest.slice(0, bankAt);
      const blanks = new Set(['ア', 'イ', 'ウ', 'エ', 'オ']);
      const body = parseBlocks(bodyLines, blanks);
      const present = [];
      const walk = (blocks) => blocks.forEach((block) => {
        for (const item of block.body ?? []) if (item.t === 'blank' && !present.includes(item.label)) present.push(item.label);
        if (block.children) walk(block.children);
      });
      walk(body);
      present.sort((a, b) => 'アイウエオ'.indexOf(a) - 'アイウエオ'.indexOf(b));
      Object.assign(question, {
        format,
        body,
        bank: parseBank(rest.slice(bankAt)),
        items: present.map((label) => ({
          id: `${question.id}-${SUB[label]}`,
          label,
          answer: answers.sectionB[chunk.number][label],
        })),
        pointsEach: 1,
      });
    }
  } catch (error) {
    throw new Error(`${question.id}: ${error.message}`);
  }
  return question;
}

function writeRights(questionHash) {
  const terms = {
    id: 'nichimu-kshiken-2026-10-09',
    source: '公益財団法人日本無線協会「試験問題と解答」',
    url: 'https://www.nichimu.or.jp/kshiken/siken/index.html',
    checkedAt: '2026-10-09',
    checkedBy: 'operator',
    quotedText: QUOTED_TERMS,
    quotedTextSha256: sha256(QUOTED_TERMS),
    excludedSubjects: ['英語'],
    operatorDecisions: [
      {
        topic: 'officialAnswers',
        decision: '問題集の採点に付随する利用として公式正答を使う',
        basis: 'operatorJudgment',
        explicitlyGrantedByAssociation: false,
        decidedBy: 'operator',
        decidedAt: '2026-10-09',
      },
    ],
  };
  mkdirSync(resolve(outDir, 'rights'), { recursive: true });
  writeFileSync(resolve(outDir, 'rights/usage-terms.json'), `${JSON.stringify(terms, null, 2)}\n`);
  return { termsId: terms.id, questionHash };
}

function findPdf(year, month, kind) {
  const suffix = `-${String(month).padStart(2, '0')}-houki${kind === 'answer' ? '-kaitou' : ''}.pdf`;
  const name = readdirSync(pdfDir).find((file) => file.startsWith(`1soutuu-${year}(`) && file.endsWith(suffix));
  if (!name) throw new Error(`PDF がない ${year}-${month} ${kind}`);
  return name;
}

function asciiCode(value) {
  return value.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0));
}

function codeOf(questionText, answerText) {
  const match = `${questionText.slice(0, 500)}\n${answerText.slice(0, 1200)}`.match(/[ＡA][ＹY][0-9０-９]{3}/);
  if (!match) throw new Error('試験問題記号が読めない');
  return asciiCode(match[0]);
}

function sittingLabel(year, month, answerText) {
  try {
    return labelOf(answerText);
  } catch (error) {
    if (year > 2018) throw error;
    const fwDigits = (value) => String(value).replace(/[0-9]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0));
    return `平成${fwDigits(year - 1988)}年${fwDigits(month)}月期`;
  }
}

function labelOf(answerText) {
  const line = answerText.split('\n').map((item) => item.trim()).find((item) => /令和|平成/.test(item) && item.length < 24);
  if (!line) throw new Error('期の見出しが読めない');
  return line.replace(/\s+/g, '').replace(/年月([0-9０-９]+)期/g, (_, digits) => `年${digits}月期`);
}

function writeManifest() {
  const dir = resolve(outDir, 'sets');
  const sets = readdirSync(dir).filter((name) => /^1sou-houki-\d{4}-(03|09)\.json$/.test(name)).sort().map((name) => {
    const exam = JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
    return {
      id: exam.id,
      file: `sets/${name}`,
      label: exam.exam.label,
      code: exam.exam.code,
      distribution: exam.distribution,
      transcription: exam.review.transcription,
    };
  });
  writeFileSync(resolve(outDir, 'manifest.json'), `${JSON.stringify({ schemaVersion: 1, sets }, null, 2)}\n`);
}

function extractSitting(sitting, version) {
  const [yearText, monthText] = sitting.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const questionPdf = findPdf(year, month, 'question');
  const answerPdf = findPdf(year, month, 'answer');
  const questionPath = resolve(pdfDir, questionPdf);
  const answerPath = resolve(pdfDir, answerPdf);
  const questionSha = fileHash(questionPath);
  const answerSha = fileHash(answerPath);
  const slug = sitting;
  const manualQuestionPath = resolve(workDir, 'manual', `${slug}-question.txt`);
  const rawQuestion = existsSync(manualQuestionPath)
    ? readFileSync(manualQuestionPath, 'utf8')
    : extractText(questionPath, resolve(workDir, `${slug}-question.txt`));
  const repaired = repairHalfwidth(rawQuestion);
  const questionText = widenBlankLetters(repaired.text);
  const extractedAnswer = extractText(answerPath, resolve(workDir, `${slug}-answer.txt`));
  const manualPath = resolve(workDir, 'manual', `${slug}-answer.txt`);
  const answerText = /〔|Ａ\s*[−－―‐−-]/.test(extractedAnswer) ? extractedAnswer : readFileSync(manualPath, 'utf8');
  const punct = repaired.count ? `; halfwidth punct ${repaired.count}` : '';
  const questionSource = existsSync(manualQuestionPath)
    ? 'question: visual reading of the page images; OCR text layer was not used'
    : `question: pdftotext -layout (poppler ${version})${punct}`;
  const answerSource = /〔|Ａ\s*[−－―‐−-]/.test(extractedAnswer)
    ? `${questionSource}; answer: pdftotext -layout (poppler ${version})`
    : `${questionSource}; answer: visual transcription, no text layer`;
  const answers = parseAnswers(answerText);
  if (answers.fullMarks !== 125 || answers.passMark !== 75) throw new Error('満点または合格点が読み取れない');
  const setId = `1sou-houki-${slug}`;
  const chunks = splitQuestions(questionText);
  if (chunks.length !== 25) throw new Error(`問題が ${chunks.length} 件`);
  const questions = chunks.map((chunk) => parseQuestion(chunk, setId, answers));
  const listed = year === 2026 && month === 3;
  const exam = stampInitialRevisions({
    kind: 'kakomon',
    schemaVersion: 1,
    id: setId,
    contentVersion: 1,
    qualification: '1sou',
    subject: 'houki',
    exam: { year, month, label: sittingLabel(year, month, answerText), code: codeOf(questionText, answerText), durationMin: 150 },
    scoring: {
      fullMarks: 125,
      passMark: 75,
      sectionA: { count: 20, pointsEach: 5 },
      sectionB: { count: 5, pointsEach: 1, mode: answers.mode },
      note: answers.note,
    },
    source: {
      questionPdf,
      answerPdf,
      questionPdfSha256: questionSha,
      answerPdfSha256: answerSha,
      extractedWith: answerSource,
    },
    distribution: 'private',
    rights: {
      status: 'unconfirmed',
      termsId: 'nichimu-kshiken-2026-10-09',
      publicationEvidence: listed ? [{
        kind: 'currentListing',
        url: 'https://www.nichimu.or.jp/kshiken/siken/index.html',
        checkedAt: '2026-10-09',
        sitting: '2026-03',
        savedArtifactSha256: null,
        note: '第一級総合無線通信士の令和8年3月期に、法規の問題と解答が掲載されている。',
      }] : [],
      holds: [],
      approvedBy: null,
      approvedAt: null,
    },
    attribution: {
      organization: '公益財団法人日本無線協会',
      qualificationLabel: '第一級総合無線通信士',
      subjectLabel: '法規',
    },
    review: { transcription: 'draft', checkedBy: null, checkedAt: null },
    questions,
    questionRevisions: [],
  }, '2026-10-09T10:40:00+09:00');
  const errors = validateExamSet(exam, { questionPdfSha256: questionSha, answerPdfSha256: answerSha });
  if (errors.length) throw new Error(errors.join('\n'));
  mkdirSync(resolve(outDir, 'sets'), { recursive: true });
  writeFileSync(resolve(outDir, `sets/${setId}.json`), `${JSON.stringify(exam, null, 2)}\n`);
  const summary = questions.map((question) => `${question.id} ${question.format} ${question.format === 'single' || question.format === 'combination' ? `ans=${question.answer}` : `ans=${question.items.map((item) => item.answer).join(',')}`}`).join('\n');
  writeFileSync(resolve(workDir, `${slug}-summary.txt`), summary);
  return { id: setId, label: exam.exam.label, code: exam.exam.code };
}

function main() {
  const poppler = spawnSync('pdftotext', ['-v'], { encoding: 'utf8' });
  const version = versionOf(`${poppler.stdout ?? ''}${poppler.stderr ?? ''}`);
  mkdirSync(workDir, { recursive: true });
  const requested = process.argv.slice(2);
  const sittings = requested.length ? requested : SITTINGS;
  const unknown = sittings.filter((sitting) => !SITTINGS.includes(sitting));
  if (unknown.length) throw new Error(`対象外の回: ${unknown.join(', ')}`);
  writeRights('');
  const failed = [];
  for (const sitting of sittings) {
    try {
      const result = extractSitting(sitting, version);
      console.log(`ok ${result.id} ${result.label} ${result.code}`);
    } catch (error) {
      failed.push(`${sitting}: ${error.message}`);
      console.error(`ng ${sitting}: ${error.message}`);
    }
  }
  writeManifest();
  if (failed.length) {
    console.error(failed.join('\n'));
    process.exit(1);
  }
}

main();
