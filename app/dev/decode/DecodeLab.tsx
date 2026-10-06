'use client';

import { useEffect, useState } from 'react';
import { compareDecode, type DecodeOverTrace } from '@/lib/radio/decode/assist';
import { DECODE_PRESETS, DECODE_PRESET_IDS, type DecodePresetId } from '@/lib/radio/decode/presets';
import { simStations } from '@/lib/radio/decode/sim';
import { seeded } from '@/lib/radio/random';
import type { FilterWidth } from '@/lib/radio/rig';
import { RigPanel } from '@/app/views/qso/RigPanel';
import { useRig } from '@/app/views/qso/useRig';

/**
 * A bare desk for DECODE: a QA preset's stations on the real rig (the same keying every
 * time from its seed), the rig's DECODE as the app shows it, and — dev only — each over
 * against what DECODE printed, with its confidence and reasons, and the decoder's cost.
 */

const REFRESH_MS = 500;

interface Perf { ticks: number; avg: number; max: number; samples: number; stationSamples: number; flushes: number }

export function DecodeLab() {
  const [id, setId] = useState<DecodePresetId>('decode-clean');
  const preset = DECODE_PRESETS[id];
  const sim = preset.sim as { filter?: number; noise?: number; qsb?: number; qrn?: number };
  const [levels, setLevels] = useState({ af: 0.6, noise: 0.2, qrn: 0, qsb: 0 });
  const rig = useRig({ pitch: 600, stopEpoch: 0, levels });
  const [truth, setTruth] = useState(false);
  const [overs, setOvers] = useState<DecodeOverTrace[]>([]);
  const [perf, setPerf] = useState<Perf | null>(null);

  const start = () => {
    const engine = rig.engineRef.current;
    if (!engine) return;
    setLevels({ af: 0.6, noise: sim.noise ?? 0.2, qrn: sim.qrn ?? 0, qsb: sim.qsb ?? 0 });
    rig.setFilter((sim.filter ?? 500) as FilterWidth);
    rig.tune(7_012_000);
    rig.newCapture();
    engine.setStations(simStations(seeded(preset.sim.seed), preset.sim.stations, engine.vfo, engine.now()));
    Object.assign(rig.decodePerfRef.current, { ticks: 0, ms: 0, maxMs: 0, samples: 0, stationSamples: 0, flushes: 0 });
    setOvers([]);
  };

  useEffect(() => {
    const timer = setInterval(() => {
      const capture = rig.captureRef.current;
      const p = rig.decodePerfRef.current;
      setPerf({ ticks: p.ticks, avg: p.ticks ? p.ms / p.ticks : 0, max: p.maxMs, samples: p.samples, stationSamples: p.stationSamples, flushes: p.flushes });
      if (capture && truth) setOvers(compareDecode(capture.rx.map((record) => ({ tx: record.tx, station: record.station, epoch: record.epoch })), capture.decode.chars));
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [rig.captureRef, rig.decodePerfRef, truth]);

  const calls = new Map(preset.sim.stations.map((spec, index) => [index, spec.call]));
  const stationCall = (stationId: number) => {
    const index = rig.engineRef.current?.stations.findIndex((station) => station.id === stationId) ?? -1;
    return calls.get(index) ?? `#${stationId}`;
  };

  return (
    <main style={{ maxWidth: 880, margin: '0 auto', padding: 16, display: 'grid', gap: 12, fontSize: 13 }}>
      <h1 style={{ fontSize: 18, margin: 0 }}>DECODE lab（開発用）</h1>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <select value={id} onChange={(event) => setId(event.target.value as DecodePresetId)} aria-label="preset">
          {DECODE_PRESET_IDS.map((presetId) => <option key={presetId} value={presetId}>{presetId} — {DECODE_PRESETS[presetId].label}</option>)}
        </select>
        <button type="button" className="btn btn-primary btn-sm" onClick={start} disabled={!rig.powered}>この局を出す</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void rig.transmit('TEST DE JS2WDR K', 20)} disabled={!rig.powered || rig.txOn}>TX テスト</button>
        <label><input type="checkbox" checked={truth} onChange={(event) => setTruth(event.target.checked)} /> 正解と比較</label>
      </div>
      <p style={{ margin: 0, color: 'var(--muted)' }}>
        seed {preset.sim.seed} ・ {preset.station} ・ {preset.wpm} WPM ・ {preset.condition}<br />聞きどころ: {preset.listen}
      </p>
      <RigPanel rig={rig} />
      {perf && (
        <p style={{ margin: 0, fontFamily: 'var(--font-mono)' }} data-testid="decode-perf">
          perf: ticks {perf.ticks} ・ avg {perf.avg.toFixed(3)} ms ・ max {perf.max.toFixed(2)} ms ・ samples {perf.samples} ・ station-samples {perf.stationSamples} ・ flushes {perf.flushes}
        </p>
      )}
      {truth && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-mono)', fontSize: 12 }} data-testid="decode-compare">
          <thead><tr><th align="left">局</th><th align="left">送信（正解）</th><th align="left">DECODE</th><th>conf</th><th>?/弱</th><th>WPM</th><th>offset</th><th>FIL</th><th align="left">理由</th></tr></thead>
          <tbody>
            {overs.map((over) => (
              <tr key={`${over.station}-${over.start}`} style={{ borderTop: '1px solid var(--line)', verticalAlign: 'top' }}>
                <td>{stationCall(over.station)}</td>
                <td>{over.truth}</td>
                <td>{over.decoded}</td>
                <td align="center">{over.conf.toFixed(2)}</td>
                <td align="center">{over.unknown}/{over.unsure}</td>
                <td align="center">{over.wpm ? Math.round(over.wpm) : '–'}</td>
                <td align="center">{over.offset === null ? '–' : Math.round(over.offset)}</td>
                <td align="center">{over.filter ?? '–'}</td>
                <td>{Object.entries(over.reasons).map(([reason, count]) => `${reason}×${count}`).join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
