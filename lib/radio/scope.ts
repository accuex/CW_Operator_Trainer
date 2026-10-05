import { isKeyed, type Station } from './band';
import type { Crash } from './rig';

/**
 * Band scope + waterfall, drawn from the station model on the RF side (before the
 * IF filter) so stations outside the passband are still visible.
 */

export interface ScopeFrame {
  t: number;
  vfo: number;
  /** Half-width in Hz (±span). */
  span: number;
  filter: number;
  noise: number;
  stations: Station[];
  crashes: Crash[];
  hold: boolean;
  transmitting: boolean;
}

/** Waterfall palette: navy → blue → cyan → yellow → orange → red. */
const STOPS: [number, number, number, number][] = [
  [0, 4, 8, 40], [0.25, 18, 40, 160], [0.45, 30, 150, 225], [0.62, 215, 225, 90], [0.8, 248, 165, 35], [1, 255, 45, 35],
];
export function heatColor(value: number): [number, number, number] {
  const v = Math.max(0, Math.min(1, value));
  for (let index = 1; index < STOPS.length; index += 1) {
    if (v > STOPS[index][0]) continue;
    const [a, ...c0] = STOPS[index - 1];
    const [b, ...c1] = STOPS[index];
    const k = (v - a) / (b - a);
    return [0, 1, 2].map((j) => Math.round(c0[j] + (c1[j] - c0[j]) * k)) as [number, number, number];
  }
  const [, ...last] = STOPS[STOPS.length - 1];
  return last as [number, number, number];
}

/** Hz under a canvas x (0–1 across the width). */
export const hzAtRatio = (ratio: number, vfo: number, span: number) => vfo + (ratio - 0.5) * span * 2;

const PALETTE = Array.from({ length: 256 }, (_, index) => heatColor(index / 255));

export class ScopeRenderer {
  private sc: CanvasRenderingContext2D;
  private fc: CanvasRenderingContext2D;
  private smooth = new Float32Array(0);
  private lastRow = 0;
  private dpr = 1;

  constructor(private scope: HTMLCanvasElement, private fall: HTMLCanvasElement) {
    this.sc = scope.getContext('2d')!;
    this.fc = fall.getContext('2d')!;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const canvas of [this.scope, this.fall]) {
      const width = Math.max(1, Math.round(canvas.clientWidth * this.dpr));
      const height = Math.max(1, Math.round(canvas.clientHeight * this.dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    }
    this.fc.fillStyle = '#02030a';
    this.fc.fillRect(0, 0, this.fall.width, this.fall.height);
  }

  frame(frame: ScopeFrame) {
    const W = this.scope.width;
    const H = this.scope.height;
    if (W < 2 || H < 2) return;
    const { t, vfo, span, noise } = frame;
    const hzPerPx = (span * 2) / W;
    const col = new Float32Array(W);

    // Noise floor: exponential speckle (Rayleigh-like) with the odd spike.
    for (let x = 0; x < W; x += 1) col[x] = 0.1 + noise * 0.14 + Math.min(0.5, -Math.log(Math.random() + 1e-6) * (0.03 + noise * 0.06));

    for (const station of frame.stations) {
      if (!isKeyed(station, t)) continue;
      const x0 = (station.rf - vfo + span) / hzPerPx;
      const amp = (0.25 + 0.75 * station.strength ** 0.45) * station.fade;
      const w = Math.max(1.2, 18 / hzPerPx);
      const from = Math.max(0, Math.floor(x0 - w * 4));
      const to = Math.min(W, Math.ceil(x0 + w * 4));
      for (let x = from; x < to; x += 1) col[x] = Math.max(col[x], col[x] * 0.5 + amp * Math.exp(-((x - x0) ** 2) / (2 * w * w)));
    }
    // Our own carrier while transmitting.
    if (frame.transmitting) {
      const w = Math.max(1.5, 22 / hzPerPx);
      for (let x = Math.max(0, Math.floor(W / 2 - w * 4)); x < Math.min(W, W / 2 + w * 4); x += 1) col[x] = Math.max(col[x], 0.95 * Math.exp(-((x - W / 2) ** 2) / (2 * w * w)));
    }
    for (const crash of frame.crashes) {
      if (t < crash.t || t > crash.t + crash.dur) continue;
      for (let x = 0; x < W; x += 1) col[x] += crash.level * 0.35 * (0.6 + Math.random() * 0.4);
    }

    if (this.smooth.length !== W) this.smooth = new Float32Array(W);
    for (let x = 0; x < W; x += 1) this.smooth[x] = this.smooth[x] * 0.55 + col[x] * 0.45;

    this.drawSpectrum(frame, W, H, hzPerPx);
    if (!frame.hold && t - this.lastRow > 0.04) {
      this.lastRow = t;
      this.drawRow(col, W);
    }
  }

  private drawSpectrum(frame: ScopeFrame, W: number, H: number, hzPerPx: number) {
    const sc = this.sc;
    const dpr = this.dpr;
    sc.fillStyle = '#02030a';
    sc.fillRect(0, 0, W, H);
    const pass = frame.filter / hzPerPx;
    sc.fillStyle = 'rgba(96, 165, 250, .16)';
    sc.fillRect(W / 2 - pass / 2, 0, pass, H);

    sc.strokeStyle = 'rgba(120, 140, 200, .16)';
    sc.lineWidth = 1;
    sc.beginPath();
    for (let index = 1; index < 10; index += 1) { const x = Math.round((index * W) / 10) + 0.5; sc.moveTo(x, 0); sc.lineTo(x, H); }
    for (let index = 1; index < 4; index += 1) { const y = Math.round((index * H) / 4) + 0.5; sc.moveTo(0, y); sc.lineTo(W, y); }
    sc.stroke();

    sc.strokeStyle = frame.transmitting ? 'rgba(248, 113, 113, .9)' : 'rgba(255, 255, 255, .7)';
    sc.beginPath();
    sc.moveTo(W / 2 + 0.5, 0);
    sc.lineTo(W / 2 + 0.5, H);
    sc.stroke();

    const gradient = sc.createLinearGradient(0, 0, 0, H);
    gradient.addColorStop(0, 'rgba(110, 231, 183, .35)');
    gradient.addColorStop(1, 'rgba(110, 231, 183, 0)');
    sc.beginPath();
    sc.moveTo(0, H);
    for (let x = 0; x < W; x += 1) sc.lineTo(x, H - Math.min(0.97, this.smooth[x]) * H);
    sc.lineTo(W, H);
    sc.closePath();
    sc.fillStyle = gradient;
    sc.fill();
    sc.strokeStyle = '#6ee7b7';
    sc.lineWidth = 1.2 * dpr;
    sc.beginPath();
    for (let x = 0; x < W; x += 1) {
      const y = H - Math.min(0.97, this.smooth[x]) * H;
      if (x) sc.lineTo(x, y);
      else sc.moveTo(x, y);
    }
    sc.stroke();

    // kHz ticks every 1 kHz.
    sc.fillStyle = 'rgba(200, 210, 240, .65)';
    sc.font = `${10 * dpr}px ui-monospace, Menlo, monospace`;
    sc.textAlign = 'center';
    const low = frame.vfo - frame.span;
    for (let hz = Math.ceil(low / 1000) * 1000; hz <= frame.vfo + frame.span; hz += 1000) {
      const x = (hz - low) / hzPerPx;
      if (x < 18 * dpr || x > W - 18 * dpr) continue;
      sc.fillText(((hz % 100_000) / 1000).toFixed(0).padStart(2, '0'), x, H - 4 * dpr);
    }
  }

  private drawRow(col: Float32Array, W: number) {
    const fc = this.fc;
    const FH = this.fall.height;
    const rowH = Math.max(1, Math.round(this.dpr));
    fc.drawImage(this.fall, 0, 0, W, FH - rowH, 0, rowH, W, FH - rowH);
    const image = fc.createImageData(W, rowH);
    for (let x = 0; x < W; x += 1) {
      const [r, g, b] = PALETTE[Math.max(0, Math.min(255, Math.round((col[x] - 0.1) * 1.35 * 255)))];
      for (let y = 0; y < rowH; y += 1) {
        const index = (y * W + x) * 4;
        image.data[index] = r;
        image.data[index + 1] = g;
        image.data[index + 2] = b;
        image.data[index + 3] = 255;
      }
    }
    fc.putImageData(image, 0, 0);
  }
}
