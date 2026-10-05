import { DEFAULT_RUN_PARAMS, RunSession } from './cqRun';
import type { RunQsoMode } from './types';

/** We call CQ and work whoever answers, one after another, until QRT. */
export const cqRunMode: RunQsoMode = {
  kind: 'run',
  id: 'cq-run',
  label: 'CQ を出す',
  description: '自分で CQ を出し、呼んできた局と次々に交信する',
  alphabet: 'international',
  available: true,
  presets: ['basic-rst-name-qth'],
  // Callers don't drift. Arrivals, crowd and busy are run params for now; they become axes with pileup-run.
  axes: ['speed', 'crowd', 'qsb', 'qrn', 'noise', 'weak'],
  createRun({ random, me, difficulty, tempo = 'short' }, radio) {
    return new RunSession({ random, me, params: { ...DEFAULT_RUN_PARAMS, speed: difficulty.speed, weak: difficulty.weak, tempo } }, radio);
  },
};
