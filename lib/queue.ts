import type { QueueInputResult, QueueMetrics } from './types';

const multiplierFor = (depth: number) => [0.5, 1, 1.5, 2.2, 2.5, 2.7][Math.max(0, Math.min(5, Math.round(depth)))] ?? 2.7;

export class QueueEvaluator {
  private outputIndex = 0;
  private results: QueueInputResult[] = [];
  private inputTimes: number[] = [];
  private stableRun = 0;
  private longestStableRun = 0;
  private bursts = 0;
  private burstActive = false;
  private drops = 0;

  constructor(readonly sequence: string[], readonly target: number) {}

  input(symbol: string, receivedCount: number, inputTime: number, stimulusTimes: number[]): QueueInputResult | null {
    if (this.outputIndex >= this.sequence.length) return null;
    const expected = this.sequence[this.outputIndex];
    const actualDepth = Math.max(0, receivedCount - this.outputIndex - 1);
    const isEarly = actualDepth < this.target;
    const isCorrect = symbol.toUpperCase() === expected.toUpperCase();
    const responseLatency = Math.max(0, inputTime - (stimulusTimes[this.outputIndex] ?? inputTime));
    // Misses must not consume the FIFO slot — otherwise the correct retry never matches.
    const stable = isCorrect && !isEarly && actualDepth === this.target;
    this.stableRun = stable ? this.stableRun + 1 : 0;
    this.longestStableRun = Math.max(this.longestStableRun, this.stableRun);

    const previous = this.inputTimes.at(-1);
    const inBurst = previous !== undefined && inputTime - previous < 0.12;
    if (inBurst && !this.burstActive) this.bursts += 1;
    this.burstActive = inBurst;
    this.inputTimes.push(inputTime);

    const result = { expected, input: symbol.toUpperCase(), isCorrect, isEarly, actualDepth, responseLatency, stableRun: this.stableRun };
    this.results.push(result);
    if (isCorrect) this.outputIndex += 1;
    return result;
  }

  registerProgress(receivedCount: number) {
    const allowableOutputs = Math.max(0, receivedCount - this.target);
    if (allowableOutputs - this.outputIndex > 1) this.drops = Math.max(this.drops, allowableOutputs - this.outputIndex - 1);
  }

  get answered() { return this.outputIndex; }
  get history() { return [...this.results]; }

  metrics(): QueueMetrics {
    const depths = this.results.map((result) => result.actualDepth);
    const sorted = [...depths].sort((a, b) => a - b);
    const meanDepth = depths.length ? depths.reduce((sum, value) => sum + value, 0) / depths.length : 0;
    const medianDepth = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const stable = depths.filter((depth, index) => depth === this.target && !this.results[index].isEarly).length;
    const intervals = this.inputTimes.slice(1).map((time, index) => time - this.inputTimes[index]);
    const meanInterval = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
    const variance = intervals.length ? intervals.reduce((sum, value) => sum + (value - meanInterval) ** 2, 0) / intervals.length : 0;
    const cadenceStability = meanInterval > 0 ? Math.max(0, 1 - Math.sqrt(variance) / meanInterval) : 0;
    const stableDepth = this.longestStableRun >= 3 && this.bursts === 0
      ? this.target
      : Math.min(Math.max(0, this.target - 1), Math.floor(medianDepth));
    return {
      target: this.target,
      answered: this.results.length,
      correct: this.results.filter((result) => result.isCorrect).length,
      earlyCopies: this.results.filter((result) => result.isEarly).length,
      queueDrops: this.drops,
      burstOutputs: this.bursts,
      meanDepth,
      medianDepth,
      stableDepth,
      stableRate: this.results.length ? stable / this.results.length : 0,
      longestStableRun: this.longestStableRun,
      cadenceStability,
      scoreMultiplier: multiplierFor(stableDepth),
    };
  }
}

export function scoreQueue(metrics: QueueMetrics): number {
  if (!metrics.answered) return 0;
  const accuracy = metrics.correct / metrics.answered;
  const timing = Math.max(0, 1 - metrics.earlyCopies / metrics.answered);
  const burstPenalty = Math.max(0.55, 1 - metrics.burstOutputs * 0.08);
  return Math.round(1000 * accuracy * timing * (0.55 + metrics.cadenceStability * 0.45) * metrics.scoreMultiplier * burstPenalty);
}
