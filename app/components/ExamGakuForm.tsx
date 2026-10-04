'use client';

import { type ReactNode, useSyncExternalStore } from 'react';
import { INTERNATIONAL_MORSE, WABUN_MORSE, expandWabunVoicing } from '@/lib/morse';
import type { AlphabetType } from '@/lib/types';
import type { ExamLedger } from '@/lib/training';
import {
  CODE_GROUPS_PER_ROW,
  WABUN_BODY_CHARS_PER_PAGE,
  WABUN_COLS_PER_BLOCK,
  WABUN_COLS_PER_PAGE,
  WABUN_ROWS_PER_BLOCK,
  WABUN_ROWS_PER_PAGE,
  formatWabunFilingTimePlay,
} from '@/lib/training';

/** 和文額表のモバイル横書き切替（exam.css の max-width: 760px と揃える） */
const WABUN_MOBILE_MQ = '(max-width: 760px)';
function subscribeWabunMobile(onChange: () => void) {
  const media = window.matchMedia(WABUN_MOBILE_MQ);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}
const getWabunMobileSnapshot = () => window.matchMedia(WABUN_MOBILE_MQ).matches;
const getWabunMobileServerSnapshot = () => false;

/** playText 先頭から見たモールス符号数（空白除く。和文濁音は展開） */
export function countPlaySymbols(text: string, alphabet: AlphabetType): number {
  let count = 0;
  let cursor = 0;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (/\s/.test(ch)) {
      cursor += 1;
      continue;
    }
    if (ch === '[') {
      const close = text.indexOf(']', cursor + 1);
      if (close !== -1) {
        count += 1;
        cursor = close + 1;
        continue;
      }
    }
    count += alphabet === 'wabun' ? expandWabunVoicing(ch).length : 1;
    cursor += 1;
  }
  return count;
}

export function highlightPlayText(
  text: string,
  alphabet: AlphabetType,
  localHeard: number,
  keyPrefix: string,
): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = 0;
  let symbolIndex = 0;
  let key = 0;
  // 未到達フィールドは localHeard < 0。0 に丸めると先頭が「今ここ」になるので禁止。
  const reached = localHeard >= 0;
  while (cursor < text.length) {
    const ch = text[cursor];
    if (/\s/.test(ch)) {
      parts.push(ch === '\n' ? <br key={`${keyPrefix}-br-${key++}`} /> : ch);
      cursor += 1;
      continue;
    }
    let token = ch;
    let next = cursor + 1;
    if (ch === '[') {
      const close = text.indexOf(']', cursor + 1);
      if (close !== -1) {
        token = text.slice(cursor, close + 1);
        next = close + 1;
      }
    }
    const span = token.startsWith('[')
      ? 1
      : alphabet === 'wabun'
        ? expandWabunVoicing(token).length
        : 1;
    const heard = reached && symbolIndex + span <= localHeard;
    const current = reached && symbolIndex <= localHeard && localHeard < symbolIndex + span;
    parts.push(
      <i key={`${keyPrefix}-t-${key++}`} className={current ? 'listen-now' : heard ? 'listen-heard' : 'listen-wait'}>
        {token}
      </i>,
    );
    symbolIndex += span;
    cursor = next;
  }
  return parts;
}

function fieldOffset(playText: string, field: string, alphabet: AlphabetType): number {
  if (!field) return 0;
  const index = playText.indexOf(field);
  if (index < 0) return 0;
  return countPlaySymbols(playText.slice(0, index), alphabet);
}

/** fromCharIndex 以降で field を探し、その直前までの符号数を返す */
function fieldOffsetFrom(
  playText: string,
  field: string,
  alphabet: AlphabetType,
  fromCharIndex: number,
): { offset: number; index: number } {
  if (!field) return { offset: 0, index: fromCharIndex };
  const index = playText.indexOf(field, fromCharIndex);
  if (index < 0) return { offset: fieldOffset(playText, field, alphabet), index: fromCharIndex };
  return { offset: countPlaySymbols(playText.slice(0, index), alphabet), index };
}

const toDots = (code: string) => code.replaceAll('.', '・').replaceAll('-', '－');

/**
 * 練習帳の手続符号表記（点「・」線「－」）。
 * HR / NR は文字ごとに空白（`・・・・ ・－・`）、BT / AR は連続符号（`－・・・－`）。
 */
const prosignCode = (letters: string) =>
  INTERNATIONAL_MORSE[`[${letters}]`]
    ? toDots(INTERNATIONAL_MORSE[`[${letters}]`])
    : Array.from(letters).map((letter) => toDots(INTERNATIONAL_MORSE[letter] ?? '')).join(' ');

/** 『・－・－・』形の手続符号。符号数 span ぶん聴いたら既聴、途中なら「今ここ」。 */
function ProsignMark({ code, local, span, label, closing = false }: { code: string; local: number; span: number; label: string; closing?: boolean }) {
  const reached = local >= 0;
  const state = reached && local >= span ? 'listen-heard' : reached && local < span ? 'listen-now' : 'listen-wait';
  return (
    <span className={`gaku-mark ${state}`} aria-label={label} title={label}>
      {closing ? '「' : '『'}{code}{closing ? '」' : '』'}
    </span>
  );
}

const CODE_GROUP = /^[A-Z0-9]{5}$/;

/** 欧文 TELEGRAM 用紙（欧文電報送信練習帳の様式） */
function OubunGakuForm({
  ledger,
  alphabet,
  localHeard,
  active,
}: {
  ledger: ExamLedger;
  alphabet: AlphabetType;
  localHeard: number;
  active: boolean;
}) {
  const play = ledger.playText;
  const hasHrhr = /^HRHR\b/.test(play);
  const sheetKey = ledger.sheet;

  // playText = [HRHR] NR 番号 発信局 語数 [日] 時刻 = 名あて = 本文 [ =署名] [+]
  // To/Text の = は額表で BT 記号、署名前の = だけは文字「=」で書く
  let cursor = 0;
  const hrhr = hasHrhr ? fieldOffsetFrom(play, 'HRHR', alphabet, cursor) : { offset: -1, index: 0 };
  if (hasHrhr) cursor = hrhr.index + 4;
  const nr = fieldOffsetFrom(play, 'NR', alphabet, cursor);
  cursor = nr.index + 2;
  const preambleFields = [ledger.number, ledger.office, ledger.count, ledger.date, ledger.receivedAt].filter((value): value is string => Boolean(value));
  const preamble = fieldOffsetFrom(play, preambleFields[0] ?? '', alphabet, cursor);
  const btTo = fieldOffsetFrom(play, '=', alphabet, preamble.index);
  cursor = btTo.index + 1;
  const address = fieldOffsetFrom(play, ledger.address, alphabet, cursor);
  cursor = address.index + ledger.address.length;
  const btText = fieldOffsetFrom(play, '=', alphabet, cursor);
  cursor = btText.index + 1;
  const body = fieldOffsetFrom(play, ledger.body, alphabet, cursor);
  cursor = body.index + ledger.body.length;
  const btSig = ledger.signature ? fieldOffsetFrom(play, '=', alphabet, cursor) : null;
  if (btSig) cursor = btSig.index + 1;
  const signature = ledger.signature ? fieldOffsetFrom(play, ledger.signature, alphabet, cursor) : null;
  const hasAr = /\+\s*$/.test(play);
  const ar = hasAr ? fieldOffsetFrom(play, '+', alphabet, play.lastIndexOf('+')) : { offset: Number.POSITIVE_INFINITY, index: -1 };

  const preambleText = preambleFields.join(' ');
  const groups = ledger.body.split(/\s+/).filter(Boolean);
  const isCodeText = groups.length > 0 && groups.every((group) => CODE_GROUP.test(group));
  const rows: string[][] = [];
  if (isCodeText) {
    for (let index = 0; index < groups.length; index += CODE_GROUPS_PER_ROW) rows.push(groups.slice(index, index + CODE_GROUPS_PER_ROW));
  }
  const rowOffset = (rowIndex: number) => body.offset + countPlaySymbols(rows.slice(0, rowIndex).flat().join(''), alphabet);
  const arMark = hasAr
    ? <ProsignMark code={prosignCode('AR')} local={localHeard - ar.offset} span={1} label="AR（通信終了）" closing />
    : null;

  return (
    <article className={`gaku-sheet oubun${active ? ' is-active' : ''}`} aria-label={`欧文電報 第${sheetKey}通`}>
      <span className="gaku-punch left" aria-hidden="true" />
      <span className="gaku-punch right" aria-hidden="true" />
      <div className="gaku-page-no">{sheetKey}</div>
      <header className="gaku-title">TELEGRAM</header>

      <div className="gaku-call">
        {hasHrhr
          ? <ProsignMark code={prosignCode('HRHR')} local={localHeard - hrhr.offset} span={4} label="HR HR（呼出し）" />
          : <span className="gaku-mark placeholder" aria-hidden="true" />}
      </div>

      <section className="gaku-row">
        <div className="gaku-label">
          <span>Preamble</span>
          <ProsignMark code={prosignCode('NR')} local={localHeard - nr.offset} span={2} label="NR（番号）" />
        </div>
        <div className="gaku-line">
          {highlightPlayText(preambleText.replaceAll('/', '／'), alphabet, localHeard - preamble.offset, `p${sheetKey}`)}
        </div>
      </section>

      <section className="gaku-row">
        <div className="gaku-label">
          <span>To</span>
          <ProsignMark code={prosignCode('BT')} local={localHeard - btTo.offset} span={1} label="BT（区切り）" />
        </div>
        <div className="gaku-line">
          {highlightPlayText(ledger.address.replaceAll('/', '／'), alphabet, localHeard - address.offset, `a${sheetKey}`)}
        </div>
      </section>

      <section className="gaku-row text">
        <div className="gaku-label">
          <span>Text</span>
          <ProsignMark code={prosignCode('BT')} local={localHeard - btText.offset} span={1} label="BT（区切り）" />
        </div>
        <div className="gaku-text">
          {isCodeText ? rows.map((row, rowIndex) => (
            <div key={`r${sheetKey}-${rowIndex}`} className="gaku-line groups">
              {row.map((group, groupIndex) => (
                <span key={`g${groupIndex}`} className="gaku-group">
                  {highlightPlayText(
                    group,
                    alphabet,
                    localHeard - rowOffset(rowIndex) - countPlaySymbols(row.slice(0, groupIndex).join(''), alphabet),
                    `b${sheetKey}-${rowIndex}-${groupIndex}`,
                  )}
                </span>
              ))}
              {rowIndex === rows.length - 1 && !ledger.signature && row.length < CODE_GROUPS_PER_ROW && arMark}
            </div>
          )) : (
            <div className="gaku-line flow">
              {highlightPlayText(ledger.body, alphabet, localHeard - body.offset, `b${sheetKey}`)}
              {!ledger.signature && arMark && <> {arMark}</>}
            </div>
          )}
          {ledger.signature && btSig && signature && (
            <div className="gaku-line signature">
              {/* 署名前の BT だけは手続符号記号ではなく =署名 と額表に書く */}
              <span aria-label="BT（区切り）" title="BT（区切り）">
                {highlightPlayText('=', alphabet, localHeard - btSig.offset, `btSig${sheetKey}`)}
              </span>
              {highlightPlayText(ledger.signature, alphabet, localHeard - signature.offset, `s${sheetKey}`)}
              {arMark && <>{' '}{arMark}</>}
            </div>
          )}
          {isCodeText && !ledger.signature && arMark && rows.at(-1)?.length === CODE_GROUPS_PER_ROW
            ? <div className="gaku-line groups">{arMark}</div>
            : <div className="gaku-line blank" aria-hidden="true" />}
        </div>
      </section>
    </article>
  );
}

function WabunBodyGrid({
  bodyChars,
  localHeard,
  bodyOffset,
  sheet,
}: {
  bodyChars: string[];
  localHeard: number;
  bodyOffset: number;
  sheet: number;
}) {
  // モバイル横書き: 左→右に10字 × 上→下に6行（帳票の縦10×横6を90°読み替え）
  const horizontal = useSyncExternalStore(
    subscribeWabunMobile,
    getWabunMobileSnapshot,
    getWabunMobileServerSnapshot,
  );
  const cols = horizontal ? WABUN_ROWS_PER_PAGE : WABUN_COLS_PER_PAGE;
  const rows = horizontal ? WABUN_COLS_PER_PAGE : WABUN_ROWS_PER_PAGE;
  const colBlock = horizontal ? WABUN_ROWS_PER_BLOCK : WABUN_COLS_PER_BLOCK;
  const rowBlock = horizontal ? WABUN_COLS_PER_BLOCK : WABUN_ROWS_PER_BLOCK;
  return (
    <div
      className={`gaku-wabun-grid${horizontal ? ' is-ltr' : ''}`}
      style={{
        gridTemplateColumns: `repeat(${colBlock}, var(--wg-cell)) 2px repeat(${colBlock}, var(--wg-cell))`,
        gridTemplateRows: `repeat(${rowBlock}, var(--wg-cell)) 2px repeat(${rowBlock}, var(--wg-cell))`,
      }}
    >
      {Array.from({ length: cols * rows }, (_, cell) => {
        const col = cell % cols;
        const row = Math.floor(cell / cols);
        const charIndex = horizontal
          ? row * cols + col
          : (cols - 1 - col) * rows + row;
        const gridCol = col < colBlock ? col + 1 : col + 2;
        const gridRow = row < rowBlock ? row + 1 : row + 2;
        const layoutKey = horizontal ? 'h' : 'v';
        const ch = bodyChars[charIndex];
        if (!ch) {
          return (
            <span key={`c-${sheet}-${layoutKey}-${cell}`} className="gaku-cell empty" style={{ gridColumn: gridCol, gridRow }} />
          );
        }
        const span = expandWabunVoicing(ch).length;
        let before = 0;
        for (let i = 0; i < charIndex; i += 1) before += expandWabunVoicing(bodyChars[i]).length;
        const local = localHeard - bodyOffset;
        const reached = local >= 0;
        const heard = reached && before + span <= local;
        const current = reached && before <= local && local < before + span;
        return (
          <span
            key={`c-${sheet}-${layoutKey}-${cell}`}
            className={`gaku-cell${current ? ' listen-now' : heard ? ' listen-heard' : ' listen-wait'}`}
            style={{ gridColumn: gridCol, gridRow }}
          >
            {ch}
          </span>
        );
      })}
      <i className="gaku-wabun-gutter v" style={{ gridColumn: colBlock + 1, gridRow: '1 / -1' }} />
      <i className="gaku-wabun-gutter h" style={{ gridColumn: '1 / -1', gridRow: rowBlock + 1 }} />
    </div>
  );
}

const KANJI_DIGITS = '〇一二三四五六七八九';
const toKanjiDigits = (value: string) => value.replace(/[0-9]/g, (digit) => KANJI_DIGITS[Number(digit)]);

/** playText 上で fields を順に探し、各フィールド先頭までの符号数を返す（見つからなければ未到達扱いの Infinity） */
function locateFields(playText: string, fields: [string, string][], alphabet: AlphabetType): Record<string, number> {
  const offsets: Record<string, number> = {};
  let cursor = 0;
  for (const [name, field] of fields) {
    const index = field ? playText.indexOf(field, cursor) : -1;
    if (index < 0) {
      offsets[name] = Number.POSITIVE_INFINITY;
      continue;
    }
    offsets[name] = countPlaySymbols(playText.slice(0, index), alphabet);
    cursor = index + field.length;
  }
  return offsets;
}

const splitPrefix = (value: string, prefix: string) =>
  value.startsWith(prefix) ? { prefix, rest: value.slice(prefix.length) } : { prefix: '', rest: value };

/** 受信者が額表に書き込む緑の手続符号（縦書き。点・線は図形で描く） */
function WabunMark({ letters, local, span, label, muted = false }: { letters: string[]; local: number; span: number; label: string; muted?: boolean }) {
  const reached = local >= 0;
  const state = !reached ? 'listen-wait' : local >= span ? 'listen-heard' : 'listen-now';
  return (
    <span className={`wg-mark ${state}${muted ? ' muted' : ''}`} role="img" aria-label={label} title={label}>
      {letters.map((letter, index) => {
        const code = (/^[A-Z]$/.test(letter) ? INTERNATIONAL_MORSE[letter] : WABUN_MORSE[letter]) ?? '';
        return (
          <b key={`${letter}-${index}`}>
            {Array.from(code).map((symbol, symbolIndex) => (
              <i key={symbolIndex} className={symbol === '-' ? 'dah' : 'dit'} />
            ))}
          </b>
        );
      })}
    </span>
  );
}

/** 和文受信用紙（無線従事者国家試験用の様式。1枚目=フル、続き=本文のみ） */
function WabunGakuForm({
  ledger,
  alphabet,
  localHeard,
  active,
}: {
  ledger: ExamLedger;
  alphabet: AlphabetType;
  localHeard: number;
  active: boolean;
}) {
  const play = ledger.playText;
  const continuation = Boolean(ledger.continuation);
  const sheetKey = ledger.sheet;
  const hour = Number(ledger.receivedAt.slice(0, 2));
  const minute = Number(ledger.receivedAt.slice(2, 4));
  const hour12 = String(hour % 12 === 0 ? 12 : hour % 12);
  const meridiem = hour < 12 ? 'セ' : 'コ';
  const timePlay = formatWabunFilingTimePlay(hour, minute);
  const hasHrhr = /^HRHR\b/.test(play);
  const tail = play.trimEnd();
  const endToken = tail.endsWith('[ラタ]') ? '[ラタ]' : tail.endsWith('ウホ') ? 'ウホ' : '';

  // playText = [HRHR] 、 字数 発信局 番号 受付 、 名あて [ホレ] 本文 [ラタ]|ウホ（続きページは 本文 + 終端のみ）
  const at = locateFields(play, continuation
    ? [['body', ledger.body], ['end', endToken]]
    : [
      ['hrhr', hasHrhr ? 'HRHR' : ''],
      ['sep1', '、'],
      ['count', ledger.count],
      ['office', ledger.office],
      ['number', ledger.number],
      ['time', timePlay],
      ['sep2', '、'],
      ['address', ledger.address],
      ['hole', '[ホレ]'],
      ['body', ledger.body],
      ['end', endToken],
    ], alphabet);
  const L = (name: string) => localHeard - at[name];

  const office = splitPrefix(ledger.office, 'ハツ');
  const serial = splitPrefix(ledger.number, 'タナ');
  const bodyChars = Array.from(ledger.body.replace(/\s+/g, '')).slice(0, WABUN_BODY_CHARS_PER_PAGE);
  const addressLines = continuation
    ? []
    : ledger.address.split('」').filter(Boolean).map((part, index, all) => (
      index < all.length - 1 || ledger.address.endsWith('」') ? `${part}」` : part
    ));
  const addressLocal = (index: number) => L('address') - countPlaySymbols(addressLines.slice(0, index).join(''), alphabet);

  return (
    <article
      className={`gaku-sheet wabun${continuation ? ' continuation' : ''}${active ? ' is-active' : ''}`}
      aria-label={continuation ? `和文電報 続き 第${sheetKey}枚` : `和文電報 第${sheetKey}枚`}
    >
      <header className="wg-title">
        <b>無線従事者国家試験用</b>
        <span>和文受信用紙</span>
      </header>
      <div className="wg-sheet-no">{continuation ? '続き · ' : ''}第{sheetKey}枚</div>

      {!continuation && (
        <div className="wg-margin">
          {/* 再生順 = 横書き左→右。PC 帳票は CSS で「、」を下へずらす */}
          {hasHrhr && <WabunMark letters={['H', 'R', 'H', 'R']} local={L('hrhr')} span={4} label="HR HR（呼出し）" />}
          <WabunMark letters={['、']} local={L('sep1')} span={1} label="、（区切り）" />
        </div>
      )}

      <div className="wg-top">
        <table className="wg-score" aria-hidden="true">
          <tbody>
            {['A', 'B', 'C', 'D'].map((row) => <tr key={row}><th>{row}</th><td /><td /></tr>)}
            <tr><th colSpan={2}>合</th><td /></tr>
          </tbody>
        </table>
        {/* DOM は再生順（字数→発信局→番号→受付）。PC 帳票の左右順は CSS grid-column で戻す */}
        <div className="wg-head">
          <div className="wg-field wg-field-count">
            <span className="wg-label">字数</span>
            {!continuation && (
              <div className="wg-vals">
                <span className="wg-v">{highlightPlayText(toKanjiDigits(ledger.count), alphabet, L('count'), `wk${sheetKey}`)}</span>
              </div>
            )}
          </div>
          <div className="wg-field wg-field-office">
            <span className="wg-label">発信局</span>
            {!continuation && (
              <div className="wg-vals">
                <span className="wg-v">{highlightPlayText(toKanjiDigits(office.rest), alphabet, L('office') - (office.prefix ? 2 : 0), `wo${sheetKey}`)}</span>
                {office.prefix && <span className="wg-note">{highlightPlayText(office.prefix, alphabet, L('office'), `wop${sheetKey}`)}</span>}
              </div>
            )}
          </div>
          <div className="wg-field wg-field-number">
            <span className="wg-label">番号</span>
            {!continuation && (
              <div className="wg-vals">
                <span className="wg-v">{highlightPlayText(toKanjiDigits(serial.rest), alphabet, L('number') - (serial.prefix ? 2 : 0), `wn${sheetKey}`)}</span>
                {serial.prefix && <span className="wg-note">{highlightPlayText(serial.prefix, alphabet, L('number'), `wnp${sheetKey}`)}</span>}
              </div>
            )}
          </div>
          <div className="wg-field wg-field-time">
            <span className="wg-label">受付</span>
            {!continuation && (
              <div className="wg-time">
                <span className="wg-v">{highlightPlayText(`${meridiem}${toKanjiDigits(hour12)}`, alphabet, L('time'), `wt${sheetKey}`)}</span>
                <span className="wg-unit">
                  時
                  <span className="wg-unit-mark">
                    <em aria-hidden="true">←</em>
                    <WabunMark letters={['、']} local={L('time') - 1 - hour12.length} span={1} label="、（時と分の区切り）" />
                  </span>
                </span>
                <span className="wg-v">
                  {highlightPlayText(toKanjiDigits(String(minute).padStart(2, '0')), alphabet, L('time') - 2 - hour12.length, `wm${sheetKey}`)}
                </span>
                <span className="wg-unit">分</span>
              </div>
            )}
          </div>
          <div className="wg-field wg-field-kind">
            <span className="wg-label">種類</span>
          </div>
        </div>
      </div>

      {/*
        DOM 順はモバイル縦積み用: 名あて → 本文 → 区切り。
        PC の横並びは CSS grid-column で固定（auto-placement / order に頼らない）。
      */}
      <div className="wg-main">
        <div className="wg-info" aria-hidden="true">
          <div><span>評価</span></div>
          <div><span>クラス</span><span className="wg-kyu">級</span></div>
          <div><span>受験番号</span></div>
          <div><span>名前</span></div>
        </div>
        <div className="wg-address">
          {[3, 2, 1, 0].map((column) => (
            <div key={`addr-${column}`} className={`wg-addr-col${column === 0 ? ' first' : ''}`}>
              {column === 0 && <span className="wg-label">名あて</span>}
              {column === 0 && !continuation && (
                <span className="wg-addr-mark right">
                  <WabunMark letters={['、']} local={L('sep2')} span={1} label="、（区切り）" />
                </span>
              )}
              {column === 3 && !continuation && (
                <span className="wg-addr-mark left">
                  <WabunMark letters={['[ホレ]']} local={L('hole')} span={1} label="ホレ（本文はじめ）" />
                </span>
              )}
              {addressLines[column] && (
                <span className="wg-v">{highlightPlayText(addressLines[column], alphabet, addressLocal(column), `wa${sheetKey}-${column}`)}</span>
              )}
            </div>
          ))}
        </div>
        <WabunBodyGrid bodyChars={bodyChars} localHeard={localHeard} bodyOffset={at.body} sheet={sheetKey} />
        <div className={`wg-notes${endToken ? '' : ' is-empty'}`}>
          <span className={`wg-end${endToken === '[ラタ]' ? '' : ' muted'}`}>
            <WabunMark letters={['[ラタ]']} local={endToken === '[ラタ]' ? L('end') : -1} span={1} label="ラタ（終わり）" muted={endToken !== '[ラタ]'} />
            <em>（終わりの場合）</em>
          </span>
          <span className={`wg-end${endToken === 'ウホ' ? '' : ' muted'}`}>
            <WabunMark letters={['ウ', 'ホ']} local={endToken === 'ウホ' ? L('end') : -1} span={2} label="ウホ（改ページ）" muted={endToken !== 'ウホ'} />
            <em>（改ページの場合）</em>
          </span>
        </div>
        <div className="wg-side" aria-hidden="true">
          <div><span className="wg-label">特別<br />取扱</span></div>
          <div><span className="wg-label">局内<br />心得</span></div>
        </div>
      </div>
    </article>
  );
}

export function ExamGakuForm({
  ledger,
  alphabet,
  localHeard,
  active,
  plainOnly,
}: {
  ledger: ExamLedger;
  alphabet: AlphabetType;
  localHeard: number;
  active: boolean;
  plainOnly?: boolean;
}) {
  if (plainOnly) {
    return (
      <article className={`gaku-sheet plain${active ? ' is-active' : ''}`}>
        <header className="gaku-title">本文</header>
        <div className="gaku-ruled gaku-text">
          {highlightPlayText(ledger.playText, alphabet, localHeard, `plain${ledger.sheet}`)}
        </div>
      </article>
    );
  }
  if (alphabet === 'wabun') {
    return <WabunGakuForm ledger={ledger} alphabet={alphabet} localHeard={localHeard} active={active} />;
  }
  if (ledger.address === '—') {
    return (
      <article className={`gaku-sheet plain${active ? ' is-active' : ''}`}>
        <header className="gaku-title">本文</header>
        <div className="gaku-ruled gaku-text">
          {highlightPlayText(ledger.playText, alphabet, localHeard, `plain${ledger.sheet}`)}
        </div>
      </article>
    );
  }
  return <OubunGakuForm ledger={ledger} alphabet={alphabet} localHeard={localHeard} active={active} />;
}
