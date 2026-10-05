import { createHash } from 'node:crypto';
import { makeStation } from '../band';
import { DEFAULT_RUN_PARAMS, RunSession } from '../modes/cqRun';
import { seeded } from '../random';
import { HeadlessRadio, HUMAN_COPY, runSim, type SimAirEvent, type SimBand, type SimOptions } from './runSim';

/**
 * Golden snapshots of CQ runs: every transmission on the air (who, what, where, when),
 * every caller and resident, the books at QRT and the score. Taken from CQ Run v1
 * (6a1c74c); a refactor that changes nothing must reproduce them bit for bit.
 *
 * Station ids come from a global counter, so they are stored relative to the run's
 * first station; everything else is compared exactly (floats included).
 */

const CALM: SimBand = { noise: 0.2, qsb: 0.1, qrn: 0.05, qrm: 1 };
const ROUGH: SimBand = { noise: 0.45, qsb: 0.6, qrn: 0.5, qrm: 4 };

export interface GoldenScenario { name: string; seeds: number[]; options: Omit<SimOptions, 'seed'> }

const seeds = (from: number, count = 4) => Array.from({ length: count }, (_, index) => from + index);

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  { name: 'perfect', seeds: seeds(1, 6), options: {} },
  { name: 'calm-band-human', seeds: seeds(101), options: { placement: {}, band: CALM, bot: { copyErrors: HUMAN_COPY }, duration: 400, drain: 900 } },
  { name: 'rough-band-human', seeds: seeds(201), options: { placement: {}, band: ROUGH, params: { weak: 0.45 }, bot: { copyErrors: HUMAN_COPY }, duration: 400, drain: 900 } },
  { name: 'crowded', seeds: seeds(301), options: { placement: {}, band: CALM, params: { arrivals: 6, spread: 120 }, bot: { copyErrors: HUMAN_COPY }, duration: 400, drain: 1200 } },
  { name: 'sloppy-operator', seeds: seeds(401), options: { band: CALM, bot: { copyErrors: HUMAN_COPY, callErrorRate: 0.15, partialRate: 0.3, ignoreCorrections: true, phantomRate: 0.05 }, duration: 400, drain: 900 } },
  { name: 'call-errors-corrected', seeds: seeds(451), options: { bot: { callErrorRate: 0.5, partialRate: 0.3 } } },
  { name: 'wide-filter', seeds: seeds(501, 3), options: { placement: {}, band: { ...ROUGH, qrm: 6 }, bot: { copyErrors: HUMAN_COPY, filter: 2400 }, duration: 400, drain: 900 } },
  { name: 'no-qrl-blind-start', seeds: seeds(601), options: { placement: { onFrequency: true, nearby: 1 }, params: { busy: 0.5 }, bot: { qrl: false, blindStart: true } } },
  { name: 'short-listen', seeds: seeds(651), options: { placement: { onFrequency: true }, bot: { qrlListen: 1, cqListen: 1 } } },
  { name: 'busy-one-sided', seeds: seeds(701), options: { placement: { onFrequency: true, nearby: 2, oneSided: true } } },
  { name: 'long-tempo-slow-weak', seeds: seeds(751), options: { params: { tempo: 'long', speed: 12, weak: 0.6, spread: 200, arrivals: 3 } } },
  { name: 'cq-repeat-no-pick', seeds: seeds(801, 3), options: { bot: { pick: false, cqRepeat: 3 }, duration: 200, drain: 600 } },
  { name: 'cq-repeat-pick', seeds: seeds(851, 3), options: { bot: { cqRepeat: 5 }, params: { crowd: { patience: 0.5, recall: 0.5 } } } },
];

/** Ids relative to the run's first station; numbers kept exact. */
function relativeIds(base: number) {
  const ID_KEYS = new Set(['from', 'stationId', 'station', 'id', 'agent']);
  return (key: string, value: unknown) => (ID_KEYS.has(key) && typeof value === 'number' ? value - base : value);
}

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/** A probe station marks where this run's ids start (it never goes on the air). */
const idBase = () => makeStation(() => 0.5, { rf: 0 }).id;

export interface GoldenEntry {
  name: string;
  seed: number;
  digest: string;
  /** Readable headline numbers, to say what moved when the digest doesn't match. */
  summary: Record<string, unknown>;
}

export function snapshotSim(name: string, seed: number, options: GoldenScenario['options']): { entry: GoldenEntry; full: string } {
  const base = idBase();
  const air: SimAirEvent[] = [];
  const report = runSim({ seed, ...options, onAir: (event) => air.push(event) });
  const { result, run, score } = report;
  const snapshot = {
    air,
    agents: run.agents.map((agent) => ({
      id: agent.id,
      persona: agent.persona,
      rf: agent.station.rf,
      wpm: agent.station.wpm,
      listenRf: agent.listenRf(),
      arrivedAt: agent.arrivedAt,
      state: agent.state,
      goneReason: agent.goneReason,
      callsMade: agent.callsMade,
      attempts: agent.attempts,
      doublings: agent.doublings,
      corrections: agent.corrections,
      busted: agent.busted,
      addressedAs: agent.addressedAs,
      addressedAt: agent.addressedAt,
    })),
    residents: run.residents.map((agent) => ({ id: agent.id, call: agent.station.call, state: agent.state, rf: agent.station.rf, wpm: agent.station.wpm })),
    result,
    report: { tx: report.tx, cqs: report.cqs, qrtAt: report.qrtAt, qrls: report.qrls, qsys: report.qsys, issues: report.issues, waiting: report.waiting, settled: report.settled },
    score: score && { contacts: score.contacts, evidence: score.evidence },
    rx: report.rx.map((record) => ({ station: record.station, start: record.tx.start, length: record.tx.length, text: record.tx.text, cutAt: record.cutAt })),
  };
  const full = JSON.stringify(snapshot, relativeIds(base));
  const { stats } = result;
  return {
    full,
    entry: {
      name,
      seed,
      digest: digest(full),
      summary: {
        air: air.length,
        lastAirEnd: air.reduce((latest, event) => Math.max(latest, event.end), 0),
        callers: stats.callers,
        contacts: stats.contacts,
        outcomes: result.contacts.map((contact) => contact.outcome).join(','),
        log: result.log.map((entry) => `${entry.fields.call}:${entry.verdict}`).join(','),
        rate: stats.rate,
        seconds: stats.seconds,
        firstCallAccuracy: stats.firstCallAccuracy,
        busts: stats.busts,
        nil: stats.nil,
        partials: stats.partials,
        corrections: stats.corrections,
        doublings: stats.doublings,
        busyCqs: stats.busyCqs,
        frequencyChecks: stats.frequencyChecks,
        busyAvoided: stats.busyAvoided,
        missed: result.missed.length,
        issues: report.issues.length,
        settled: report.settled,
        clean: score ? score.evidence.clean : null,
      },
    },
  };
}

/**
 * The desk's side of a run that the sim never touches: phase, partner, the frequency
 * check, keying from the air, CQ-repeat timing, coaching notes, a tempo change, a power
 * cycle (rebase) and log edits — read every half second while a scripted operator works.
 * Odd seeds send the report alone (the caller asks for the rest), every third seed has no
 * name or QTH set, and every other contact gets an AGN? over its partner (a doubling in QSO).
 */
export function snapshotDesk(seed: number): { entry: GoldenEntry; full: string } {
  const base = idBase();
  const random = seeded(seed);
  const radio = new HeadlessRadio(random);
  const me = seed % 3 === 0 ? { call: 'JS2WDR', name: '', qth: '' } : { call: 'JS2WDR', name: 'MASA', qth: 'NAGOYA' };
  const reportOnly = seed % 2 === 1;
  const fields = [me.name && `NAME ${me.name}`, me.qth && `QTH ${me.qth}`].filter(Boolean).join(' ');
  const run = new RunSession({ random, me, params: { ...DEFAULT_RUN_PARAMS, busy: 0.5 } }, radio);
  const air: SimAirEvent[] = [];
  let epoch = 0;
  radio.onTransmission = (station, tx) => {
    air.push({ from: station.id, text: tx.text, rf: station.rf, start: tx.start, end: tx.start + tx.length, wpm: station.wpm });
    run.onStationTransmission(station, tx, epoch);
  };
  const vfo = 7_012_000;
  run.rebase(epoch, 0);
  run.populate(vfo, 0);
  const reads: unknown[] = [];
  const txLog: unknown[] = [];
  let busyUntil = 0;
  const send = (text: string) => {
    const start = radio.t + 0.05;
    const end = start + text.length * 0.12;
    busyUntil = end;
    air.push({ from: 'me', text, rf: vfo, start, end });
    txLog.push(run.transmit(text, { start, end, rf: vfo }));
  };
  let partner: { id: number; call: string; logged: string | null; overAt: number | null } | null = null;
  let worked = 0;
  let qrlAt = -1;
  let lastHeard = 0;
  for (let t = 0; t <= 420; t = Math.round((t + 0.1) * 1000) / 1000) {
    radio.advance(t);
    if (t === 260) {
      // Power cycle: a new epoch, agents' clocks shifted.
      epoch += 1;
      run.rebase(epoch, 0.25);
    }
    if (t === 150) run.setParams({ tempo: 'long' });
    const due = run.tick(t);
    for (const event of due) {
      if (event.from === 'me') continue;
      lastHeard = t;
      const agent = run.agents.find((item) => item.id === event.from);
      if (!agent) continue;
      if (partner && agent.id === partner.id) {
        if (/NAME [A-Z]/.test(event.text) && !partner.logged) {
          const entry = run.logEntry({ call: partner.call, rst: '599', name: agent.persona.name, qth: agent.persona.qth }, t);
          partner.logged = entry.id;
          if (entry.fields.call.length % 2) run.editLog(entry.id, { ...entry.fields, qth: `${entry.fields.qth}X` });
          if (t >= busyUntil) send(`R TU ${agent.persona.name} 73 DE ${me.call} QRZ?`);
        }
        if (/(NAME|QTH|RST)\?/.test(event.text) && t >= busyUntil) send(`UR 599 ${fields} BK`);
        if (/\bEE\b/.test(event.text)) partner = null;
      } else if (!partner && event.text.includes(agent.call) && t >= busyUntil) {
        worked += 1;
        partner = { id: agent.id, call: agent.call, logged: null, overAt: worked % 2 ? null : -1 };
        send(reportOnly ? `${agent.call} UR 599 BK` : `${agent.call} UR 599 ${fields} BK`);
      }
    }
    // Over the partner, once: it has been keying a while and has more than a second to go.
    if (partner && partner.overAt === -1 && t >= busyUntil) {
      const id = partner.id;
      const on = air.find((event) => event.from === id && event.start + 0.6 <= t && event.end > t + 1);
      if (on) {
        partner.overAt = t;
        send('AGN?');
      }
    }
    if (t >= busyUntil && !partner && t < 400) {
      const check = run.frequencyCheck(vfo, t);
      if (qrlAt < 0 && t > 2) {
        qrlAt = t;
        send(`QRL? DE ${me.call}`);
      } else if (check.state !== 'listening' && t - Math.max(lastHeard, run.callersQuietFrom(vfo, t), run.keyedUntil) > 6 && qrlAt >= 0) {
        send(`CQ DE ${me.call} ${me.call} K`);
      }
    }
    if (Math.abs(t * 2 - Math.round(t * 2)) < 1e-6) {
      reads.push({
        t,
        phase: run.phase,
        partner: run.partnerCall,
        check: run.frequencyCheck(vfo, t),
        keying: run.keying(t),
        keyedUntil: run.keyedUntil,
        quietFrom: run.callersQuietFrom(vfo, t),
        notes: run.drainNotes().map((note) => ({ ...note, agent: note.agent.id })),
        stations: run.stations.map((station) => station.id - base),
      });
    }
  }
  const result = run.finish(420);
  const full = JSON.stringify({ air, reads, txLog, result, missed: run.missed(), frequencies: run.frequencies, contacts: run.contacts, log: run.log }, relativeIds(base));
  return {
    full,
    entry: {
      name: 'desk-script',
      seed,
      digest: digest(full),
      summary: { air: air.length, reads: reads.length, contacts: result.stats.contacts, outcomes: result.contacts.map((contact) => contact.outcome).join(','), log: result.log.length, frequencies: result.frequencies.length, busyAvoided: result.stats.busyAvoided },
    },
  };
}

export const DESK_SEEDS = [11, 12, 13, 14, 15, 16];

/** Every golden snapshot, in a fixed order. */
export function allSnapshots() {
  const out: { entry: GoldenEntry; full: string }[] = [];
  for (const scenario of GOLDEN_SCENARIOS) for (const seed of scenario.seeds) out.push(snapshotSim(scenario.name, seed, scenario.options));
  for (const seed of DESK_SEEDS) out.push(snapshotDesk(seed));
  return out;
}
