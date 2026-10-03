/** Shared WPM scale for character / effective speed sliders. */
export const SPEED_WPM_MIN = 5;
export const SPEED_WPM_MAX = 45;

export const clampSpeedWpm = (value: number) =>
  Math.min(SPEED_WPM_MAX, Math.max(SPEED_WPM_MIN, Math.round(value)));

export const speedSliderPercent = (value: number) =>
  ((clampSpeedWpm(value) - SPEED_WPM_MIN) / (SPEED_WPM_MAX - SPEED_WPM_MIN)) * 100;

/** range 親指中心に合わせた left（CSS）。親指幅ぶん端のオフセットを補正する */
export function speedThumbLeft(value: number, thumbPx = 14): string {
  const p = speedSliderPercent(value) / 100;
  return `calc(${p * 100}% + ${(0.5 - p) * thumbPx}px)`;
}

/**
 * Character-speed drag: scale is fixed. Effective never exceeds character.
 */
export function nextSpeedFromCharacter(
  characterSpeed: number,
  effectiveSpeed: number,
  nextCharacter: number,
): { characterSpeed: number; effectiveSpeed: number } {
  const character = clampSpeedWpm(nextCharacter);
  return {
    characterSpeed: character,
    effectiveSpeed: Math.min(clampSpeedWpm(effectiveSpeed), character),
  };
}

/**
 * Effective-speed drag on a fixed shared scale.
 * - Below character: only effective moves.
 * - Crossing up from Farnsworth: stop once at character (notch).
 * - Pushing past the notch, or already equal: raise character with effective.
 */
export function nextSpeedFromEffective(
  characterSpeed: number,
  effectiveSpeed: number,
  nextEffective: number,
  stoppedAtNotch: boolean,
): { characterSpeed: number; effectiveSpeed: number; stoppedAtNotch: boolean } {
  const character = clampSpeedWpm(characterSpeed);
  const prev = clampSpeedWpm(effectiveSpeed);
  const next = clampSpeedWpm(nextEffective);

  if (next <= character) {
    return {
      characterSpeed: character,
      effectiveSpeed: next,
      stoppedAtNotch: false,
    };
  }

  // next > character
  if (prev < character) {
    return {
      characterSpeed: character,
      effectiveSpeed: character,
      stoppedAtNotch: true,
    };
  }

  if (prev === character && stoppedAtNotch) {
    return {
      characterSpeed: next,
      effectiveSpeed: next,
      stoppedAtNotch: false,
    };
  }

  return {
    characterSpeed: next,
    effectiveSpeed: next,
    stoppedAtNotch: false,
  };
}
