import { morseFor, tokenizeMorseInput } from './morse';
import type { AlphabetType, AudioSettings, MorseTimeline } from './types';

function timingConstants(settings: AudioSettings) {
  const characterSpeed = Math.max(5, settings.characterSpeed);
  const effectiveSpeed = Math.min(characterSpeed, Math.max(3, settings.effectiveSpeed));
  const dit = 1.2 / characterSpeed;
  const spacingScale = characterSpeed / effectiveSpeed;
  return {
    dit,
    characterGap: 3 * dit * spacingScale,
    wordGap: 7 * dit * spacingScale,
  };
}

function appendSymbol(
  symbol: string,
  code: string,
  cursor: number,
  dit: number,
  tones: MorseTimeline['tones'],
  characters: MorseTimeline['characters'],
  characterIndex: number,
) {
  const start = cursor;
  let next = cursor;
  Array.from(code).forEach((element, elementIndex) => {
    const duration = element === '-' ? 3 * dit : dit;
    tones.push({ symbol, kind: 'tone', start: next, duration, element: element as '.' | '-' });
    next += duration;
    if (elementIndex < code.length - 1) next += dit;
  });
  characters.push({ symbol, index: characterIndex, start, end: next });
  return next;
}

export function buildMorseTimeline(text: string, alphabet: AlphabetType, settings: AudioSettings): MorseTimeline {
  const tokens = tokenizeMorseInput(text, alphabet);
  const { dit, characterGap, wordGap } = timingConstants(settings);
  const tones: MorseTimeline['tones'] = [];
  const characters: MorseTimeline['characters'] = [];
  let cursor = 0;
  let characterIndex = 0;

  tokens.forEach((symbol, sourceIndex) => {
    if (symbol === ' ') {
      cursor += Math.max(0, wordGap - characterGap);
      return;
    }
    const code = morseFor(symbol, alphabet);
    if (!code) return;
    cursor = appendSymbol(symbol, code, cursor, dit, tones, characters, characterIndex++);
    if (sourceIndex < tokens.length - 1) cursor += characterGap;
  });

  return { tones, characters, duration: cursor, dit, characterGap, wordGap };
}

/** Play one token repeatedly with character gaps (listen drill), not word gaps. */
export function buildRepeatedSymbolTimeline(
  symbol: string,
  code: string,
  repeats: number,
  settings: AudioSettings,
): MorseTimeline {
  const { dit, characterGap, wordGap } = timingConstants(settings);
  const tones: MorseTimeline['tones'] = [];
  const characters: MorseTimeline['characters'] = [];
  let cursor = 0;
  const count = Math.max(1, repeats);
  for (let index = 0; index < count; index += 1) {
    cursor = appendSymbol(symbol, code, cursor, dit, tones, characters, index);
    if (index < count - 1) cursor += characterGap;
  }
  return { tones, characters, duration: cursor, dit, characterGap, wordGap };
}

export const formatCpm = (wpm: number) => Math.round(wpm * 5);
