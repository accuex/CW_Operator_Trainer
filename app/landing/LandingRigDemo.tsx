'use client';

import { useEffect } from 'react';
import { isKeyed, makeQrm, qrmMessage, type Station } from '@/lib/radio/band';
import { RigPanel } from '@/app/views/qso/RigPanel';
import { START_VFO, useRig } from '@/app/views/qso/useRig';

function demoSet(random: () => number, vfo: number): Station[] {
  const count = 6 + Math.floor(random() * 4);
  const stations = makeQrm(random, count, vfo);
  for (const station of stations) {
    station.loop = null;
    const overs = random() < 0.4 ? 2 : 1;
    station.queue = Array.from({ length: overs }, () => qrmMessage(station.call, random));
    station.nextAt = random() * 2.5;
  }
  return stations;
}

function demoQuiet(stations: readonly Station[], now: number) {
  if (!stations.length) return true;
  return stations.every((station) => (
    station.queue.length === 0
    && !station.loop
    && station.busyUntil <= now
    && !isKeyed(station, now)
  ));
}

/** Visual (and optional audio) slice of the QSO receiver. No scoring, no log. */
export function LandingRigDemo() {
  const rig = useRig({
    pitch: 770,
    stopEpoch: 0,
    levels: { af: 0.45, noise: 0.28, qrn: 0.22, qsb: 0.35 },
  });

  useEffect(() => {
    let frame = 0;
    let poll: ReturnType<typeof setInterval> | undefined;
    let rest: ReturnType<typeof setTimeout> | undefined;
    let waiting = false;

    const load = () => {
      const engine = rig.engineRef.current;
      if (!engine) return;
      waiting = false;
      engine.setStations(demoSet(Math.random, engine.vfo || START_VFO));
    };

    const place = () => {
      const engine = rig.engineRef.current;
      if (!engine) {
        frame = requestAnimationFrame(place);
        return;
      }
      load();
      poll = setInterval(() => {
        const live = rig.engineRef.current;
        if (!live || waiting) return;
        if (!demoQuiet(live.stations, live.now())) return;
        waiting = true;
        rest = setTimeout(load, 900);
      }, 700);
    };
    place();

    return () => {
      cancelAnimationFrame(frame);
      if (poll) clearInterval(poll);
      if (rest) clearTimeout(rest);
    };
  }, [rig.engineRef]);

  return (
    <div className="lp-rig">
      <RigPanel rig={rig} />
      <p className="lp-rig-note">滝は電源オフでも動きます。音を出すときは POWER（ブラウザが自動再生を止めます）。局が一段落すると、次のランダムな混信が始まります。</p>
    </div>
  );
}
