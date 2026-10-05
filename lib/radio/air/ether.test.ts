import { describe, expect, it } from 'vitest';
import { Ether, type AirListener } from './ether';

const listener = (key: number, rf: number, rxWidth = 400): AirListener => ({ key, listenRf: () => rf, rxWidth });
const send = (ether: Ether, from: 'me' | number, rf: number, start: number, end: number) =>
  ether.emit({ from, text: 'TEST', intent: null, rf, start, end });

describe('Ether', () => {
  it('reaches listeners inside their passband only', () => {
    const ether = new Ether();
    const event = send(ether, 'me', 7_012_000, 0, 2);
    expect(ether.hears(listener(1, 7_012_150), event)).toBe(true);
    expect(ether.hears(listener(1, 7_012_250), event)).toBe(false);
    expect(ether.hears(listener(1, 7_012_250, 600), event)).toBe(true);
  });

  it('is lost on a listener keying over its head', () => {
    const ether = new Ether();
    send(ether, 1, 7_012_000, 0, 1);
    const ours = send(ether, 'me', 7_012_000, 0.2, 3);
    expect(ether.hears(listener(1, 7_012_000), ours)).toBe(false);

    const later = new Ether();
    later.emit({ from: 1, text: 'X', intent: null, rf: 7_012_000, start: 1, end: 2 });
    const heard = later.emit({ from: 'me', text: 'Y', intent: null, rf: 7_012_000, start: 0, end: 3 });
    // Started keying after our first half second: it still knows what we sent.
    expect(later.hears(listener(1, 7_012_000), heard)).toBe(true);
  });

  it('never delivers a station its own transmission', () => {
    const ether = new Ether();
    const event = send(ether, 1, 7_012_000, 0, 1);
    expect(ether.hears(listener(1, 7_012_000), event)).toBe(false);
  });

  it('delivers each event once, when it ends, in end order', () => {
    const ether = new Ether();
    send(ether, 'me', 7_012_000, 0, 3);
    send(ether, 1, 7_012_000, 0.5, 2);
    expect(ether.deliver(1)).toEqual([]);
    expect(ether.deliver(3).map((event) => event.end)).toEqual([2, 3]);
    expect(ether.deliver(4)).toEqual([]);
  });

  it('drops events from an old epoch', () => {
    const ether = new Ether();
    send(ether, 'me', 7_012_000, 0, 1);
    ether.setEpoch(1);
    expect(ether.deliver(5)).toEqual([]);
    const stale = ether.emit({ from: 'me', text: 'X', intent: null, rf: 7_012_000, start: 0, end: 1, epoch: 0 });
    expect(ether.hears(listener(1, 7_012_000), stale)).toBe(false);
    expect(ether.deliver(5)).toEqual([]);
  });

  it('knows who is keying before the message is over', () => {
    const ether = new Ether();
    send(ether, 'me', 7_012_000, 0, 5);
    send(ether, 2, 7_013_000, 0, 5);
    const near = listener(1, 7_012_100);
    expect(ether.hearsKeying(near, 'me', 2)).toBe(true);
    expect(ether.hearsKeying(near, 'me', 6)).toBe(false);
    expect(ether.hearsKeying(near, 2, 2)).toBe(false);
    expect(ether.hearsKeying(near, undefined, 2)).toBe(true);
    expect(ether.activeNear(7_013_050, 100, 0)).toBe(true);
  });
});
