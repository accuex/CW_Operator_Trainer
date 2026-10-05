import { makeQrm, makeStation } from '../band';
import { AXES, targetDrift, targetStrength } from '../difficulty';
import { cqText, makeTarget, MIN_TARGET_WPM, respond, type QsoPhase } from '../qso';
import type { QsoMode, QsoSession, SessionContext } from './types';

const STEP_OF: Record<QsoPhase, number> = { cq: 0, report: 1, done: 2 };

/** Answer someone's CQ and trade RST / name / QTH. */
export const ragchew: QsoMode = {
  id: 'ragchew',
  label: 'ラグチュー',
  description: 'CQ を出している局を呼んで、RST・名前・QTH を交換する基本の 1 対 1 交信',
  alphabet: 'international',
  available: true,
  presets: ['basic-rst-name-qth'],
  axes: AXES,
  steps: [
    { id: 'cq', label: 'CQ を探して呼ぶ' },
    { id: 'report', label: 'レポートを書き取って返す' },
    { id: 'done', label: '73 を聴いてログ確定' },
  ],
  createSession({ random, myCall, vfo, difficulty, preset }: SessionContext): QsoSession {
    const info = makeTarget(random, difficulty.speed);
    const offset = (450 + random() * 1700) * (random() < 0.5 ? -1 : 1);
    const target = makeStation(random, {
      role: 'target',
      call: info.call,
      rf: Math.round(vfo + offset),
      wpm: info.wpm,
      strength: targetStrength(difficulty, random),
      jitter: 0.04,
      drift: targetDrift(difficulty, random),
      chirp: 0,
      gap: [3, 6],
      loop: () => cqText(info),
    });
    const stations = [target, ...makeQrm(random, difficulty.crowd, vfo, [target.rf])];
    let phase: QsoPhase = 'cq';
    return {
      preset,
      target,
      stations,
      get phase() { return phase; },
      get step() { return STEP_OF[phase]; },
      get canLog() { return phase !== 'cq'; },
      truth: () => ({ call: info.call, rst: info.rst, name: info.name, qth: info.qth }),
      onTransmit(text, { offsetHz }) {
        const result = respond(phase, info, text, { myCall, offsetHz });
        if (result.slower) {
          info.wpm = Math.max(MIN_TARGET_WPM, info.wpm - result.slower);
          target.wpm = info.wpm;
        }
        if (result.reply && result.phase !== 'cq') target.loop = null;
        phase = result.phase;
        return result;
      },
      macros(log) {
        const call = log.call?.toUpperCase();
        return [
          ['呼ぶ', `${call ? `${call} DE ` : ''}${myCall} ${myCall} K`],
          ['レポート', `R TNX ${log.name ? log.name.toUpperCase() : 'OM'} UR 599 599 73 TU`],
          ['AGN?', 'AGN?'],
          ['QRS', 'QRS'],
        ];
      },
    };
  },
};
