import { describe, expect, it } from 'vitest';
import { DemoSession } from './demoRun';
import { seeded } from '../random';
import { TUNE_TOLERANCE_HZ } from '../qso';

const VFO = 7_012_000;
const ME = 'JA1ZZZ';

describe('DemoSession karaoke', () => {
  it('blocks the call until tuned, then advances call → report → done', () => {
    const session = new DemoSession(seeded(4));
    session.start(VFO, ME);
    expect(session.guide(VFO)).toBe('find');
    expect(session.action(VFO)).toBeNull();

    const on = session.target.rf;
    expect(Math.abs(on - VFO)).toBeGreaterThan(TUNE_TOLERANCE_HZ);
    expect(session.guide(on)).toBe('call');
    const call = session.action(on);
    expect(call?.id).toBe('call');
    expect(call?.text).toContain(ME);

    const afterCall = session.onTransmit(call!.text, on);
    expect(afterCall.phase).toBe('report');
    expect(afterCall.reply).toBeTruthy();
    expect(session.guide(on)).toBe('report');

    const report = session.action(on);
    expect(report?.id).toBe('report');
    const afterReport = session.onTransmit(report!.text, on);
    expect(afterReport.phase).toBe('done');
    expect(session.guide(on)).toBe('done');
  });

  it('rejects a call that is off frequency', () => {
    const session = new DemoSession(seeded(5));
    session.start(VFO, ME);
    const text = `${session.info.call} DE ${ME} ${ME} K`;
    const result = session.onTransmit(text, VFO);
    expect(result.heard).toBe(false);
    expect(result.issue).toBe('off-frequency');
    expect(session.phase).toBe('cq');
  });
});
