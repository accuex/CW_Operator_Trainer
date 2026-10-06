'use client';

import { useEffect, useRef, useState } from 'react';
import { markCut } from '@/lib/radio/conditions';
import { DEMO_RIG_LEVELS, DEMO_WPM, DemoSession, type DemoGuideStep } from '@/lib/radio/modes/demoRun';
import { TUNE_TOLERANCE_HZ } from '@/lib/radio/qso';
import type { Rig } from './useRig';

export { DEMO_RIG_LEVELS };

const GUIDE: { id: DemoGuideStep; label: string }[] = [
  { id: 'find', label: 'CQ を探して同調' },
  { id: 'call', label: '呼ぶ' },
  { id: 'report', label: 'レポートを返す' },
  { id: 'done', label: '73 を聴く' },
];

interface Snap {
  step: DemoGuideStep;
  hint: string;
  offset: number;
  call: string;
  actionLabel: string | null;
  actionText: string | null;
  round: number;
}

/** Guided karaoke desk: tune, send the lit line, hear the reply. */
export function DemoDesk({ rig, myCall }: { rig: Rig; myCall: string }) {
  const { engineRef, setDecode, setFilter, transmit, txOn, powered, vfo, tune, newCapture } = rig;
  const sessionRef = useRef<DemoSession | null>(null);
  const captureRef = useRef(newCapture());
  const [snap, setSnap] = useState<Snap | null>(null);
  const [sent, setSent] = useState<string[]>([]);
  const [busyHint, setBusyHint] = useState<string | null>(null);

  useEffect(() => {
    setDecode({ on: true, lang: 'roman' });
    // Wide FIL so the jog pitch sweep (nyuuuiin) is audible; narrow later for QRM.
    setFilter(2400);
  }, [setDecode, setFilter]);

  useEffect(() => {
    let cancelled = false;
    let tries = 0;
    const boot = () => {
      if (cancelled) return;
      const engine = engineRef.current;
      if (!engine) {
        if (tries++ < 40) window.setTimeout(boot, 50);
        return;
      }
      const session = new DemoSession(Math.random);
      session.start(engine.vfo, myCall);
      sessionRef.current = session;
      captureRef.current = newCapture();
      engine.setStations(session.stations);
      setSent([]);
      setBusyHint(null);
    };
    boot();
    return () => {
      cancelled = true;
      sessionRef.current = null;
    };
  }, [engineRef, myCall, newCapture]);

  useEffect(() => {
    const write = () => {
      const engine = engineRef.current;
      const session = sessionRef.current;
      if (!engine || !session) return;
      const hz = engine.vfo;
      const step = session.guide(hz);
      const action = session.action(hz);
      const next: Snap = {
        step,
        hint: busyHint ?? session.hint(hz, engine.powered),
        offset: session.offsetHz(hz),
        call: session.info.call,
        actionLabel: action?.label ?? null,
        actionText: action?.text ?? null,
        round: session.round,
      };
      setSnap((current) => {
        if (
          current
          && current.step === next.step
          && current.hint === next.hint
          && current.offset === next.offset
          && current.call === next.call
          && current.actionLabel === next.actionLabel
          && current.round === next.round
        ) {
          return current;
        }
        return next;
      });
    };
    write();
    const timer = window.setInterval(write, 120);
    return () => clearInterval(timer);
  }, [engineRef, busyHint, vfo, powered]);

  const sendScript = async () => {
    const engine = engineRef.current;
    const session = sessionRef.current;
    if (!engine || !session || txOn) return;
    const action = session.action(engine.vfo);
    if (!action) return;
    if (!engine.powered) {
      setBusyHint('先に POWER を入れてください');
      return;
    }
    setBusyHint(null);
    const text = action.text;
    setSent((list) => [...list, text]);
    const onKeyed = (span: { start: number; end: number }) => {
      session.onKeying(span, engine.vfo);
    };
    if (!(await transmit(text, DEMO_WPM, onKeyed))) return;
    if (sessionRef.current !== session) return;
    const reply = session.onTransmit(text, engine.vfo);
    setBusyHint(reply.issue || !reply.reply ? reply.hint : null);
    if (!reply.reply) return;
    const now = engine.now();
    engine.cut(session.target);
    markCut(captureRef.current.rx, engine.epoch, now, session.target.id);
    engine.send(session.target, reply.reply, 0.7);
  };

  const nextScenario = () => {
    const engine = engineRef.current;
    const session = sessionRef.current;
    if (!engine || !session) return;
    session.nextRound(engine.vfo);
    captureRef.current = newCapture();
    engine.setStations(session.stations);
    setSent([]);
    setBusyHint(null);
  };

  const step = snap?.step ?? 'find';
  const stepIndex = GUIDE.findIndex((item) => item.id === step);

  return (
    <div className="qso-side">
      <div className="panel panel-pad qso-status">
        <p className="section-kicker">TUTORIAL · #{snap?.round ?? 1}</p>
        <h2 className="demo-desk-title">手順を手で覚える</h2>
        <ol className="qso-steps demo-guide-steps">
          {GUIDE.map((item, index) => (
            <li
              key={item.id}
              className={step === 'done' || index < stepIndex ? 'done' : index === stepIndex ? 'current' : ''}
            >
              <b>{index + 1}</b>{item.label}
            </li>
          ))}
        </ol>
        <p className="qso-hint" role="status">{snap?.hint ?? '準備中…'}</p>
        <dl className="demo-desk-calls">
          <div>
            <dt>相手局</dt>
            <dd>{snap?.call ?? '—'}</dd>
          </div>
          <div>
            <dt>同調ずれ</dt>
            <dd className={snap && Math.abs(snap.offset) <= TUNE_TOLERANCE_HZ ? 'ok' : ''}>
              {snap ? `${snap.offset > 0 ? '+' : ''}${snap.offset} Hz` : '—'}
            </dd>
          </div>
        </dl>
      </div>

      <div className="panel panel-pad qso-tx">
        <div className="qso-panel-head">
          <h2>次の送信</h2>
          <small>{DEMO_WPM} WPM</small>
        </div>
        {snap?.actionText ? (
          <>
            <p className="demo-script mono">{snap.actionText}</p>
            <button
              type="button"
              className="btn btn-primary demo-send"
              disabled={txOn || !powered}
              onClick={() => void sendScript()}
            >
              {txOn ? '送信中…' : snap.actionLabel}
            </button>
          </>
        ) : step === 'done' ? (
          <button type="button" className="btn btn-primary demo-send" onClick={nextScenario}>
            次のシナリオ
          </button>
        ) : (
          <>
            <p className="qso-note">いちばん強いピークが CQ。滝をクリックするか、下のボタンで合わせます。</p>
            <button
              type="button"
              className="btn btn-primary demo-send"
              onClick={() => {
                const session = sessionRef.current;
                if (!session) return;
                setBusyHint(null);
                tune(session.target.rf, { jog: true });
              }}
            >
              CQに同調
            </button>
          </>
        )}
        {sent.length > 0 && (
          <ul className="qso-sent">
            {sent.map((line, index) => <li key={`${index}-${line}`}>{line}</li>)}
          </ul>
        )}
      </div>

      <div className="panel panel-pad">
        <div className="qso-panel-head"><h2>操作のコツ</h2></div>
        <ul className="demo-desk-tips">
          <li>いちばん強いピークをクリック（または「CQに同調」）</li>
          <li>同調のピッチ変化を聴いたら、FIL 2（500）に絞ると隣の QRM が聞きやすい</li>
          <li>ずれが大きいと相手は聞こえない（本物と同じ）</li>
          <li>DECODE は補助。耳で手順を追うのが本番</li>
        </ul>
      </div>
    </div>
  );
}
