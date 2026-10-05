'use client';

import { useEffect, useRef, useState } from 'react';
import type { Station } from '@/lib/radio/band';
import { pileupLevel, pileupParamsOf, PILEUP_LEVELS, type PileupLevelId } from '@/lib/radio/modes/pileupLevels';
import { PileupSession, type PileupResult } from '@/lib/radio/modes/pileupRun';
import type { RadioPort } from '@/lib/radio/modes/runCore';
import type { RigEngine } from '@/lib/radio/rig';
import { RigPanel } from '@/app/views/qso/RigPanel';
import { useRig, type Capture } from '@/app/views/qso/useRig';

/**
 * Stage 2.5: a bare desk to play the pileup engine by ear and judge each level — how the
 * overlaps sound, the tempo, how hard it is. Development only; not the pileup UI.
 * What the callers really are is hidden unless "正解を表示" is ticked.
 */

const ME = { call: 'JS2WDR', name: 'MASA', qth: 'NAGOYA' };
const LOOP_MS = 100;
/** The pileup simulator's band (PILEUP_BAND): a little noise, no QSB/QRN. */
const LEVELS = { af: 0.6, noise: 0.2, qrn: 0, qsb: 0 };

interface Live {
  run: PileupSession;
  level: PileupLevelId;
  capture: Capture;
  epoch: number;
  lastNow: number;
  startedAt: number | null;
  /** Keyed while we were still on the air: goes once we are clear. */
  queued: string | null;
  closed: boolean;
  /** What each station last keyed (the truth, for the debug table). */
  lastText: Map<number, string>;
}

interface Snapshot {
  t: number;
  phase: string;
  partner: string | null;
  arriving: number;
  waiting: number;
  holding: number;
  rounds: number;
  logged: number;
  callers: { id: number; call: string; state: string; offset: number; wpm: number; db: number; style: string; traits: string; reactions: string; last: string }[];
}

function sync(live: Live, engine: RigEngine) {
  const now = engine.now();
  if (engine.epoch !== live.epoch) {
    live.run.rebase(engine.epoch, now - live.lastNow);
    live.epoch = engine.epoch;
  }
  live.lastNow = now;
  return now;
}

const traitsOf = (agent: PileupSession['agents'][number]) => {
  const m = agent.manners;
  return [
    m.answersNearPartial ? `eager${Math.round(m.answersNearPartial * 100)}` : '',
    m.callsOnMismatch || m.callsOverQso ? 'lid' : '',
    m.tailEnd ? 'tail' : '',
    m.missesUs ? 'deaf' : '',
    m.holdsForTraffic ? '' : 'nohold',
  ].filter(Boolean).join(' ');
};

export function PileupLab() {
  const [pitch, setPitch] = useState(600);
  const rig = useRig({ pitch, stopEpoch: 0, levels: LEVELS });
  const { engineRef, tapRef, txOn, powered } = rig;
  const [level, setLevel] = useState<PileupLevelId>('intro');
  const [wpm, setWpm] = useState(pileupLevel('intro').axes.speed);
  const [call, setCall] = useState('');
  const [rst, setRst] = useState('');
  const [free, setFree] = useState('');
  const [sent, setSent] = useState<string[]>([]);
  const [message, setMessage] = useState('電源を入れ、レベルを選んで「CQ」で始めます');
  const [truth, setTruth] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [result, setResult] = useState<PileupResult | null>(null);
  const liveRef = useRef<Live | null>(null);
  const sendRef = useRef<(text: string) => void>(() => undefined);

  const newLive = (engine: RigEngine, id: PileupLevelId): Live => {
    const live = {} as Live;
    const radio: RadioPort = {
      now: () => engine.now(),
      send: (station, text, delay) => engine.send(station, text, delay),
      stationsChanged: (stations) => engine.setStations(stations),
    };
    const run = new PileupSession({ random: Math.random, me: ME, params: pileupParamsOf(pileupLevel(id).axes) }, radio);
    Object.assign(live, {
      run, level: id, capture: rig.newCapture(), epoch: engine.epoch, lastNow: engine.now(), startedAt: null, queued: null, closed: false, lastText: new Map(),
    } satisfies Live);
    run.rebase(engine.epoch, 0);
    engine.setStations([]);
    return live;
  };

  // One run per level choice; the rig taps every station message into its air.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    if (liveRef.current) liveRef.current.closed = true;
    liveRef.current = newLive(engine, level);
    tapRef.current = (station: Station, tx, epoch) => {
      const live = liveRef.current;
      if (!live || live.closed) return;
      live.run.onStationTransmission(station, tx, epoch);
      live.lastText.set(station.id, tx.text);
    };
    return () => { tapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a new run when the level changes (or on 新しいラン)
  }, [engineRef, tapRef, level]);

  // The run's clock, the queued message, and the debug snapshot.
  useEffect(() => {
    let lastSnap = 0;
    const timer = setInterval(() => {
      const engine = engineRef.current;
      const live = liveRef.current;
      if (!engine || !live || live.closed) return;
      const now = sync(live, engine);
      live.run.tick(now);
      live.run.drainNotes();
      if (live.queued && engine.powered && !live.run.keying(now) && live.run.keyedUntil <= now) {
        const text = live.queued;
        live.queued = null;
        sendRef.current(text);
      }
      if (Date.now() - lastSnap < 250) return;
      lastSnap = Date.now();
      const { run } = live;
      const count = (state: string) => run.agents.filter((agent) => agent.state === state).length;
      setSnap({
        t: live.startedAt ? (Date.now() - live.startedAt) / 1000 : 0,
        phase: run.phase,
        partner: run.partnerCall,
        arriving: count('arriving'),
        waiting: count('waiting'),
        holding: count('holding'),
        rounds: run.rounds,
        logged: run.log.length,
        callers: run.agents.filter((agent) => !agent.gone).map((agent) => ({
          id: agent.id,
          call: agent.call,
          state: agent.hijacked ? `${agent.state}(hijack)` : agent.state,
          offset: Math.round(agent.station.rf - engine.vfo),
          wpm: agent.station.wpm,
          db: Math.round(20 * Math.log10(agent.station.strength)),
          style: agent.persona.style,
          traits: traitsOf(agent),
          reactions: agent.reactions.map((reaction) => reaction.kind).join(','),
          last: live.lastText.get(agent.id) ?? '',
        })),
      });
    }, LOOP_MS);
    return () => clearInterval(timer);
  }, [engineRef]);

  const send = (raw: string) => {
    const engine = engineRef.current;
    const live = liveRef.current;
    const text = raw.toUpperCase().replace(/\s+/g, ' ').trim();
    if (!engine || !live || live.closed || !text) return;
    if (!engine.powered) { setMessage('先に電源を入れてください'); return; }
    const now = sync(live, engine);
    if (live.run.keyedUntil > now) { live.queued = text; return; }
    setSent((list) => [...list.slice(-30), text]);
    void rig.transmit(text, wpm, (span) => {
      if (live.closed) return;
      sync(live, engine);
      live.run.transmit(text, { start: span.start, end: span.end, rf: engine.vfo });
      live.startedAt ??= Date.now();
    });
  };
  useEffect(() => { sendRef.current = send; });

  const callField = call.trim().toUpperCase();
  const complete = () => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live || live.closed) return;
    if (callField) live.run.logEntry({ call: callField, rst: rst.trim().toUpperCase(), name: '', qth: '' }, engine.now());
    send(`TU ${ME.call}`);
    setCall('');
    setRst('');
  };

  const qrt = () => {
    const engine = engineRef.current;
    const live = liveRef.current;
    if (!engine || !live || live.closed) return;
    const now = sync(live, engine);
    live.closed = true;
    setResult(live.run.finish(now));
    engine.setStations([]);
    setMessage('QRT しました。結果を確認し、「新しいラン」で続けます');
  };

  const restart = (id = level) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (liveRef.current) liveRef.current.closed = true;
    liveRef.current = newLive(engine, id);
    setResult(null);
    setSent([]);
    setCall('');
    setRst('');
    setMessage('「CQ」で始めます');
  };

  const chooseLevel = (id: PileupLevelId) => {
    setWpm(pileupLevel(id).axes.speed);
    if (id === level) restart(id);
    else {
      setLevel(id);
      setResult(null);
      setSent([]);
    }
  };

  const params = pileupParamsOf(pileupLevel(level).axes);

  return (
    <main className="pileup-lab" style={{ maxWidth: 1180, margin: '0 auto', padding: 16 }}>
      <h1 style={{ fontSize: 18, margin: '0 0 4px' }}>Pileup 校正（開発用・Stage 2.5）</h1>
      <p className="qso-note">正式な UI ではありません。各レベルを耳で試し、難易度・混信の聞こえ方・テンポを評価するためのものです。記録は保存しません。</p>
      <div className="qso-grid">
        <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
          <RigPanel rig={rig} />
          <div className="panel panel-pad">
            <div className="qso-panel-head"><h2>レベル</h2><small>{params.rounds ? 'ラウンド制' : '連続補充'}・呼ぶ局 {params.pile}・±{params.stack} Hz・強弱差 {params.even} dB・荒れ {params.manners}・一斉度 {params.timing}・{params.speed} WPM</small></div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {PILEUP_LEVELS.map((item) => (
                <button key={item.id} type="button" className={`btn btn-sm ${item.id === level ? 'btn-primary' : 'btn-ghost'}`} onClick={() => chooseLevel(item.id)}>{item.label}</button>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => restart()}>新しいラン</button>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 10 }}>
              <label className="run-interval">自局の速さ <b>{wpm} WPM</b><input type="range" min={10} max={35} value={wpm} onChange={(event) => setWpm(Number(event.target.value))} /></label>
              <label className="run-interval">ピッチ <b>{pitch} Hz</b><input type="range" min={400} max={900} step={10} value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></label>
            </div>
          </div>
        </div>

        <div className="qso-side">
          <div className="panel panel-pad">
            <div className="qso-panel-head"><h2>送信</h2><small>{wpm} WPM{txOn ? '・送信中' : ''}{powered ? '' : '・電源オフ'}</small></div>
            <p className="qso-hint" role="status">{message}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => send(`CQ DE ${ME.call} ${ME.call} K`)} disabled={!!result}>CQ</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => send('QRZ?')} disabled={!!result}>QRZ?</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => send('AGN?')} disabled={!!result}>AGN?</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => send('QRS')} disabled={!!result}>QRS</button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => send('QRX')} disabled={!!result}>QRX</button>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); send(callField); }} className="qso-tx-row" style={{ marginTop: 10 }}>
              <input value={call} onChange={(event) => setCall(event.target.value.toUpperCase())} placeholder="CALL / 部分（3AB?）" aria-label="CALL" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
              <button type="submit" className="btn btn-ghost" disabled={!callField || !!result}>CALL 送信</button>
            </form>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => send(callField ? `${callField} 5NN` : '5NN')} disabled={!!result}>RST 送信（{callField ? `${callField} 5NN` : '5NN'}）</button>
              <input value={rst} onChange={(event) => setRst(event.target.value.toUpperCase())} placeholder="受信 RST" aria-label="受信 RST" style={{ width: 90 }} autoCapitalize="characters" autoComplete="off" spellCheck={false} />
              <button type="button" className="btn btn-success btn-sm" onClick={complete} disabled={!!result}>QSO 完了（ログ＋TU {ME.call}）</button>
            </div>
            <form onSubmit={(event) => { event.preventDefault(); send(free); setFree(''); }} className="qso-tx-row" style={{ marginTop: 10 }}>
              <input value={free} onChange={(event) => setFree(event.target.value.toUpperCase())} placeholder="自由に送る文（例: 3AB AGN?）" aria-label="自由に送る文" autoCapitalize="characters" autoComplete="off" spellCheck={false} />
              <button type="submit" className="btn btn-ghost" disabled={!free.trim() || !!result}>送信</button>
            </form>
            {sent.length > 0 && <ul className="qso-sent">{sent.slice(-6).map((line, index) => <li key={index}>{line}</li>)}</ul>}
            <button type="button" className="btn btn-danger btn-sm" style={{ marginTop: 10 }} onClick={qrt} disabled={!!result}>QRT（終了して結果）</button>
          </div>

          <div className="panel panel-pad">
            <div className="qso-panel-head"><h2>debug</h2><label className="qso-auto"><input type="checkbox" checked={truth} onChange={(event) => setTruth(event.target.checked)} />正解を表示</label></div>
            {snap && (
              <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', margin: 0, fontSize: 13 }}>
                <dt>経過</dt><dd>{Math.floor(snap.t / 60)}:{String(Math.floor(snap.t % 60)).padStart(2, '0')}</dd>
                <dt>待ち局</dt><dd><b>{snap.arriving + snap.waiting + snap.holding}</b>（呼出中 {snap.waiting}・待機 {snap.holding}・到着中 {snap.arriving}）</dd>
                <dt>phase</dt><dd>{snap.phase}{truth && snap.partner ? `・相手 ${snap.partner}` : ''}</dd>
                <dt>ラウンド</dt><dd>{snap.rounds}</dd>
                <dt>ログ</dt><dd>{snap.logged}{snap.t >= 60 ? `（${Math.round((snap.logged * 3600) / snap.t)}/h）` : ''}</dd>
              </dl>
            )}
          </div>
        </div>
      </div>

      {truth && snap && snap.callers.length > 0 && (
        <div className="panel panel-pad" style={{ marginTop: 14, overflowX: 'auto' }}>
          <div className="qso-panel-head"><h2>周波数上の局（正解）</h2><small>offset は VFO から</small></div>
          <table style={{ width: '100%', fontSize: 12, fontFamily: 'var(--font-mono)', borderCollapse: 'collapse' }}>
            <thead><tr>{['call', 'state', 'offset', 'wpm', 'dB', 'style', 'manners', 'reactions', '最後の送信'].map((head) => <th key={head} style={{ textAlign: 'left', padding: '2px 6px' }}>{head}</th>)}</tr></thead>
            <tbody>
              {snap.callers.map((row) => (
                <tr key={row.id}>
                  <td style={{ padding: '2px 6px' }}><b>{row.call}</b></td><td>{row.state}</td><td>{row.offset > 0 ? '+' : ''}{row.offset}</td><td>{row.wpm}</td><td>{row.db}</td><td>{row.style}</td><td>{row.traits}</td><td>{row.reactions}</td><td>{row.last}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && <LabResult result={result} />}
    </main>
  );
}

function LabResult({ result }: { result: PileupResult }) {
  const { stats } = result;
  return (
    <div className="panel panel-pad" style={{ marginTop: 14 }}>
      <div className="qso-panel-head"><h2>結果</h2></div>
      <p style={{ fontSize: 13 }}>
        {Math.round(stats.seconds)} 秒・交信 {stats.contacts}・{Math.round(stats.rate)}/h・呼んできた局 {stats.callers}・ラウンド {stats.rounds}・
        部分コール {stats.partials}・訂正 {stats.corrections}・BUST {stats.busts}・NIL {stats.nil}・未記入 {stats.unlogged}・ダブり {stats.doublings}・hijack {stats.hijacks}（解消 {stats.released}）
      </p>
      <table style={{ width: '100%', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
        <thead><tr><th style={{ textAlign: 'left' }}>正解</th><th style={{ textAlign: 'left' }}>送ったコール</th><th style={{ textAlign: 'left' }}>ログ</th><th style={{ textAlign: 'left' }}>結果</th></tr></thead>
        <tbody>
          {result.contacts.map((contact) => (
            <tr key={contact.id}>
              <td>{contact.truth.call}</td>
              <td>{contact.sentCalls.join(' → ')}</td>
              <td>{result.log.filter((entry) => contact.logIds.includes(entry.id)).map((entry) => `${entry.fields.call} ${entry.fields.rst}`).join(', ')}</td>
              <td>{contact.outcome}</td>
            </tr>
          ))}
          {result.log.filter((entry) => entry.verdict !== 'ok').map((entry) => (
            <tr key={entry.id}><td>—</td><td /><td>{entry.fields.call}</td><td>{entry.verdict}</td></tr>
          ))}
        </tbody>
      </table>
      {result.missed.length > 0 && (
        <p style={{ fontSize: 12 }}>拾えなかった局: {result.missed.map((caller) => `${caller.call}（${caller.offsetHz > 0 ? '+' : ''}${caller.offsetHz} Hz・${caller.wpm} WPM・${caller.reason}）`).join('、')}</p>
      )}
    </div>
  );
}
