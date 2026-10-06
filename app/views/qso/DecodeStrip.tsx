'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DecodedChar, DecodeLang } from '@/lib/radio/decode/decoder';
import type { Rig } from './useRig';

/** Characters the window keeps (about four lines at the narrowest). */
const SHOWN = 160;
const FLUSH_MS = 250;
const LANGS: DecodeLang[] = ['auto', 'roman', 'wabun'];
const LANG_LABEL: Record<DecodeLang, string> = { auto: 'AUTO', roman: '欧文', wabun: '和文' };

interface View { version: number; chars: DecodedChar[]; wpm: number }

/** Runs of the same look, so the window is a handful of spans. */
function runsOf(chars: readonly DecodedChar[]) {
  const runs: { mark: string; text: string }[] = [];
  for (const char of chars) {
    const mark = char.mark === 'space' ? 'ok' : char.mark;
    const last = runs.at(-1);
    if (last && last.mark === mark) last.text += char.text;
    else runs.push({ mark, text: char.text });
  }
  return runs;
}

/**
 * The rig's DECODE: a key, LANG / SPEED when on, and a few lines of what the decoder
 * printed. A receive aid — doubtful characters show dim or as '?'. The decoder runs on
 * the engine tick; this only looks at it every 250 ms and re-renders when it changed.
 */
export function DecodeStrip({ rig }: { rig: Rig }) {
  const { decode, setDecode, decoderRef, decodePerfRef, powered } = rig;
  const [view, setView] = useState<View>({ version: -1, chars: [], wpm: 0 });
  const windowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!decode.on) return;
    const timer = setInterval(() => {
      const decoder = decoderRef.current;
      if (!decoder) return;
      setView((current) => {
        if (current.version === decoder.version && current.wpm === decoder.wpm) return current;
        decodePerfRef.current.flushes += 1;
        return { version: decoder.version, chars: decoder.chars.slice(-SHOWN), wpm: decoder.wpm };
      });
    }, FLUSH_MS);
    return () => clearInterval(timer);
  }, [decode.on, decoderRef, decodePerfRef]);

  useLayoutEffect(() => {
    const pane = windowRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [view.version]);

  const nextLang = LANGS[(LANGS.indexOf(decode.lang) + 1) % LANGS.length];
  const chars = decode.on ? view.chars : [];
  return (
    <div className={`rig-decode ${decode.on ? 'on' : ''}`}>
      <div className="rig-decode-keys">
        <button type="button" className={decode.on ? 'on' : ''} aria-pressed={decode.on} onClick={() => setDecode({ on: !decode.on })}>
          DECODE<small>{decode.on ? 'ON' : 'OFF'}</small>
        </button>
        {decode.on && (
          <>
            <button type="button" onClick={() => setDecode({ lang: nextLang })} aria-label={`言語 ${LANG_LABEL[decode.lang]}（押すと ${LANG_LABEL[nextLang]}）`}>
              LANG<small>{LANG_LABEL[decode.lang]}</small>
            </button>
            <button type="button" className={decode.speed === 'lock' ? 'on' : ''} onClick={() => setDecode({ speed: decode.speed === 'lock' ? 'auto' : 'lock' })}>
              SPEED<small>{decode.speed === 'lock' ? 'LOCK' : 'AUTO'} {view.wpm ? Math.round(view.wpm) : '–'}</small>
            </button>
          </>
        )}
      </div>
      {decode.on && (
        <div ref={windowRef} className="rig-decode-window" role="log" aria-live="off" aria-label="DECODE の表示（受信の補助。正しいとは限りません）">
          {!powered ? <span className="hint">電源を入れると表示します</span>
            : !chars.length ? <span className="hint">受信待ち…（補助表示です。正しいとは限りません）</span>
              : <p>{runsOf(chars).map((run, index) => <span key={index} className={run.mark}>{run.text}</span>)}</p>}
        </div>
      )}
    </div>
  );
}
