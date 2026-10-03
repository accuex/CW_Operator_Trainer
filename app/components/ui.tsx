'use client';

import { useRef } from 'react';
import { SPEED_WPM_MAX, SPEED_WPM_MIN, nextSpeedFromCharacter, nextSpeedFromEffective, speedThumbLeft } from '@/lib/speed';
import type { AudioSettings } from '@/lib/types';
import { Icon, type IconName } from '@/app/components/icons';

export function Metric({ label, value, suffix, trend }: { label: string; value: string; suffix?: string; trend?: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong>{suffix && <small>{suffix}</small>}{trend && <em>{trend}</em>}</div>;
}

export function SpeedPairControls({
  settings,
  setSettings,
  compact = false,
}: {
  settings: AudioSettings;
  setSettings: (settings: AudioSettings) => void;
  compact?: boolean;
}) {
  const notchRef = useRef(false);
  const setCharacter = (raw: number) => {
    notchRef.current = false;
    setSettings({ ...settings, ...nextSpeedFromCharacter(settings.characterSpeed, settings.effectiveSpeed, raw) });
  };
  const setEffective = (raw: number) => {
    const next = nextSpeedFromEffective(
      settings.characterSpeed,
      settings.effectiveSpeed,
      raw,
      notchRef.current,
    );
    notchRef.current = next.stoppedAtNotch;
    setSettings({ ...settings, characterSpeed: next.characterSpeed, effectiveSpeed: next.effectiveSpeed });
  };
  const charLeft = speedThumbLeft(settings.characterSpeed);
  const effectiveLeft = speedThumbLeft(settings.effectiveSpeed);
  return (
    <div className={`speed-pair ${compact ? 'compact' : ''}`}>
      <label className="header-speed" title="文字速度 — 符号そのものの速さ (Character Speed)">
        <span className="speed-caption">
          <span>文字速度</span>
          <span className="speed-caption-value"><b>{settings.characterSpeed}</b> <i>WPM</i></span>
        </span>
        <span className="speed-track">
          <b className="speed-thumb-value" style={{ left: charLeft }} aria-hidden="true">{settings.characterSpeed}</b>
          <input
            type="range"
            min={SPEED_WPM_MIN}
            max={SPEED_WPM_MAX}
            value={settings.characterSpeed}
            aria-label="文字速度 WPM"
            onChange={(event) => setCharacter(Number(event.target.value))}
          />
        </span>
      </label>
      <label className="header-speed" title="実効速度 — 間隔込みの速さ。文字速度を超えると文字速度も上がります (Effective Speed)">
        <span className="speed-caption">
          <span>実効速度</span>
          <span className="speed-caption-value"><b>{settings.effectiveSpeed}</b> <i>WPM</i></span>
        </span>
        <span className="speed-track has-char-mark">
          <b className="speed-thumb-value" style={{ left: effectiveLeft }} aria-hidden="true">{settings.effectiveSpeed}</b>
          <i
            className="speed-char-mark"
            style={{ left: charLeft }}
            aria-hidden="true"
            title={`文字速度 ${settings.characterSpeed} WPM`}
          />
          <input
            type="range"
            min={SPEED_WPM_MIN}
            max={SPEED_WPM_MAX}
            value={settings.effectiveSpeed}
            aria-label="実効速度 WPM"
            aria-valuetext={`${settings.effectiveSpeed} WPM（文字速度 ${settings.characterSpeed}）`}
            onChange={(event) => setEffective(Number(event.target.value))}
          />
        </span>
      </label>
    </div>
  );
}

export function AudioControls({ settings, setSettings }: { settings: AudioSettings; setSettings: (settings: AudioSettings) => void }) {
  return <div className="audio-controls">
    <SpeedPairControls settings={settings} setSettings={setSettings} />
    <label>PITCH <b>{settings.pitch} Hz</b><input type="range" min="400" max="1000" step="10" value={settings.pitch} onChange={(event) => setSettings({ ...settings, pitch: Number(event.target.value) })} /></label>
  </div>;
}

export function Segmented({ value, options, onChange, label }: { value: string; options: [string, string][]; onChange: (value: string) => void; label?: string }) {
  return <div className="segmented" role="group" aria-label={label}>{options.map(([id, text]) => <button key={id} type="button" aria-pressed={value === id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>{text}</button>)}</div>;
}

export function EmptyState({ title, body, action, onClick, icon = 'sparkle' }: { title: string; body: string; action: string; onClick: () => void; icon?: IconName }) {
  return <div className="empty-state"><div className="empty-icon"><Icon name={icon} size={32} /></div><h3>{title}</h3><p>{body}</p><button type="button" className="btn btn-primary" onClick={onClick}>{action}<Icon name="chevron-right" size={16} /></button></div>;
}

export function ProgressBar({ value, tone = 'mint', label }: { value: number; tone?: 'mint' | 'gold' | 'sky'; label?: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return <div className={`progress-bar ${tone}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(clamped * 100)}><i style={{ width: `${clamped * 100}%` }} /></div>;
}

/** Circular progress. `value` is 0–1. */
export function Ring({ value, size = 64, stroke = 7, tone = 'var(--gold)', children }: { value: number; size?: number; stroke?: number; tone?: string; children?: React.ReactNode }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <span className="progress-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dashoffset .6s var(--ease-out)' }}
        />
      </svg>
      {children && <span className="progress-ring-label">{children}</span>}
    </span>
  );
}
