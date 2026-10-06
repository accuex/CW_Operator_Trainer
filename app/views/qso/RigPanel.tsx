'use client';

import { useRef } from 'react';
import { formatFrequency, nearestStation } from '@/lib/radio/band';
import { FILTERS } from '@/lib/radio/rig';
import { hzAtRatio } from '@/lib/radio/scope';
import { Icon } from '@/app/components/icons';
import { DecodeStrip } from './DecodeStrip';
import type { PowerResult, Rig } from './useRig';

/** The receiver front panel: power, frequency, S-meter, scope/waterfall and keys. */
export function RigPanel({ rig, onPower }: { rig: Rig; onPower?: (result: PowerResult) => void }) {
  const { engineRef, scopeRef, fallRef, meterRef, powered, vfo, filter, span, hold, txOn, tune } = rig;
  const dragRef = useRef<{ x: number; vfo: number; moved: boolean; width: number } | null>(null);
  const freq = formatFrequency(vfo);

  const power = async () => {
    // Not `onPower?.(await …)`: without onPower that would skip powering altogether.
    const result = await rig.powerToggle();
    onPower?.(result);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, vfo: engineRef.current?.vfo ?? vfo, moved: false, width: event.currentTarget.getBoundingClientRect().width };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (drag.moved) tune(drag.vfo - (dx / drag.width) * span * 2);
  };
  const onPointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const engine = engineRef.current;
    if (!drag || drag.moved || !engine) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const hz = hzAtRatio((event.clientX - rect.left) / rect.width, engine.vfo, span);
    const near = nearestStation(engine.stations, hz, span * 0.1);
    tune(near ? near.rf : hz, { jog: true });
  };
  const onKey = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    const delta = event.shiftKey ? 50 : 10;
    if (event.key === 'ArrowLeft') { event.preventDefault(); tune(vfo - delta); }
    if (event.key === 'ArrowRight') { event.preventDefault(); tune(vfo + delta); }
  };
  const canvasEvents = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: () => { dragRef.current = null; },
  };

  return (
    <div className={`qso-rig ${powered ? 'on' : 'off'}`} tabIndex={0} onKeyDown={onKey} aria-label="受信機。左右キーで周波数を変えます">
      <div className="rig-top">
        <button type="button" className={`rig-power ${powered ? 'on' : ''}`} onClick={power} aria-pressed={powered}>
          <span aria-hidden="true" />POWER
        </button>
        <span className={`rig-lamp tx ${txOn ? 'on' : ''}`}>TX</span>
        <span className="rig-tag mode">CW</span>
        <span className="rig-tag">FIL {filter >= 1000 ? `${filter / 1000}k` : filter}</span>
        <div className="rig-freq" aria-live="off"><span>{freq.main}</span>.<small>{freq.sub}</small></div>
      </div>
      <div className="rig-meter">
        <span className="rig-meter-s">S</span>
        <div className="rig-meter-col">
          <div className="rig-scale" aria-hidden="true">
            {(['1', '3', '5', '7', '9', '+20', '+40'] as const).map((mark, index, marks) => (
              <span
                key={mark}
                className={index >= 5 ? 'over' : undefined}
                style={{ left: `${(index / (marks.length - 1)) * 100}%` }}
              >
                {mark}
              </span>
            ))}
          </div>
          <div className="rig-smeter"><i ref={meterRef} /></div>
        </div>
      </div>
      <div className="rig-scope-head"><span>−{span / 1000}k</span><span>SCOPE · CENTER</span><span>+{span / 1000}k</span></div>
      <canvas ref={scopeRef} className="rig-scope" {...canvasEvents} />
      <canvas ref={fallRef} className="rig-fall" {...canvasEvents} />
      {!powered && (
        <button type="button" className="rig-poweron" onClick={power}>
          <Icon name="volume" size={20} />電源を入れて受信する
        </button>
      )}
      <div className="rig-keys">
        {FILTERS.map((width, index) => (
          <button key={width} type="button" className={filter === width ? 'on' : ''} onClick={() => rig.setFilter(width)}>
            FIL{index + 1}<small>{width >= 1000 ? `${width / 1000}k` : width}</small>
          </button>
        ))}
        <button type="button" onClick={rig.cycleSpan}>SPAN<small>±{span / 1000}k</small></button>
        <button type="button" className={hold ? 'on' : ''} onClick={() => rig.setHold(!hold)}>HOLD<small>{hold ? 'ON' : 'OFF'}</small></button>
        <button type="button" onClick={() => tune(vfo - 50)} aria-label="50 Hz 下げる">◀<small>−50</small></button>
        <button type="button" onClick={() => tune(vfo + 50)} aria-label="50 Hz 上げる">▶<small>+50</small></button>
      </div>
      <DecodeStrip rig={rig} />
    </div>
  );
}
