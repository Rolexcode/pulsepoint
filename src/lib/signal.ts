import type { PpgSample, SignalAnalysis } from "./types";

const MIN_BPM = 45;
const MAX_BPM = 180;
const STARTUP_TRIM_SECONDS = 3;
const MIN_QUALITY_SCORE = 35;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0;
  const average = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function movingAverage(values: number[], windowSize: number): number[] {
  const result = new Array<number>(values.length);
  let sum = 0;

  for (let index = 0; index < values.length; index += 1) {
    sum += values[index];
    if (index >= windowSize) sum -= values[index - windowSize];
    result[index] = sum / Math.min(index + 1, windowSize);
  }

  return result;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

function resample(samples: PpgSample[], sampleRate: number): number[] {
  const duration = samples.at(-1)!.time - samples[0].time;
  const pointCount = Math.max(2, Math.floor(duration * sampleRate));
  const values = new Array<number>(pointCount);
  let sourceIndex = 0;

  for (let index = 0; index < pointCount; index += 1) {
    const targetTime = samples[0].time + index / sampleRate;
    while (
      sourceIndex < samples.length - 2 &&
      samples[sourceIndex + 1].time < targetTime
    ) {
      sourceIndex += 1;
    }

    const left = samples[sourceIndex];
    const right = samples[Math.min(sourceIndex + 1, samples.length - 1)];
    const span = Math.max(0.0001, right.time - left.time);
    const weight = clamp((targetTime - left.time) / span, 0, 1);
    values[index] = left.value + (right.value - left.value) * weight;
  }

  return values;
}

function autocorrelation(
  values: number[],
  sampleRate: number,
): { bpm: number; score: number } {
  const minLag = Math.max(2, Math.floor((sampleRate * 60) / MAX_BPM));
  const maxLag = Math.min(
    values.length - 2,
    Math.ceil((sampleRate * 60) / MIN_BPM),
  );
  let bestLag = minLag;
  let bestScore = -1;
  const scores = new Map<number, number>();

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let numerator = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;

    for (let index = 0; index < values.length - lag; index += 1) {
      const left = values[index];
      const right = values[index + lag];
      numerator += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }

    const score = numerator / Math.sqrt(leftEnergy * rightEnergy + Number.EPSILON);
    scores.set(lag, score);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  const strongPeakThreshold = bestScore * 0.86;
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    const score = scores.get(lag) ?? -1;
    if (
      score >= strongPeakThreshold &&
      score >= (scores.get(lag - 1) ?? -1) &&
      score > (scores.get(lag + 1) ?? -1)
    ) {
      bestLag = lag;
      bestScore = score;
      break;
    }
  }

  return {
    bpm: (60 * sampleRate) / bestLag,
    score: clamp(bestScore, 0, 1),
  };
}

function peakEstimate(
  values: number[],
  sampleRate: number,
): { bpm: number | null; stability: number } {
  const deviation = standardDeviation(values);
  const threshold = deviation * 0.15;
  const minimumDistance = Math.floor((sampleRate * 60) / MAX_BPM);
  const peaks: number[] = [];

  for (let index = 2; index < values.length - 2; index += 1) {
    const isLocalPeak =
      values[index] > values[index - 1] &&
      values[index] >= values[index + 1] &&
      values[index] > threshold;
    const isFarEnough =
      peaks.length === 0 || index - peaks[peaks.length - 1] >= minimumDistance;

    if (isLocalPeak && isFarEnough) peaks.push(index);
  }

  if (peaks.length < 4) return { bpm: null, stability: 0 };

  const intervals = peaks.slice(1).map((peak, index) => peak - peaks[index]);
  const medianInterval = median(intervals);
  const deviations = intervals.map((interval) => Math.abs(interval - medianInterval));
  const relativeMad = median(deviations) / Math.max(1, medianInterval);
  const bpm = (60 * sampleRate) / medianInterval;

  return {
    bpm: bpm >= MIN_BPM && bpm <= MAX_BPM ? bpm : null,
    stability: clamp(1 - relativeMad * 4, 0, 1),
  };
}

function rejected(
  partial: Omit<SignalAnalysis, "quality" | "qualityScore" | "reason" | "valid">,
  reason: string,
  qualityScore = 0,
): SignalAnalysis {
  return {
    ...partial,
    bpm: null,
    quality: "poor",
    qualityScore: Math.round(qualityScore),
    reason,
    valid: false,
  };
}

export function analyzePpg(samples: PpgSample[]): SignalAnalysis {
  const fallback = {
    bpm: null,
    duration: 0,
    filtered: [] as number[],
    meanRed: 0,
    periodicity: 0,
    sampleRate: 0,
    saturationRatio: 0,
  };

  if (samples.length < 100) {
    return rejected(fallback, "Not enough camera data was captured. Keep your finger still and try again.");
  }

  const firstTime = samples[0].time;
  const stabilizedSamples = samples.filter(
    (sample) => sample.time - firstTime >= STARTUP_TRIM_SECONDS,
  );
  const analysisSamples = stabilizedSamples.length >= 100 ? stabilizedSamples : samples;

  const duration = analysisSamples.at(-1)!.time - analysisSamples[0].time;
  const sampleRate = clamp((analysisSamples.length - 1) / Math.max(duration, 0.001), 1, 60);
  const redValues = analysisSamples.map((sample) => sample.red);
  const meanRed = mean(redValues);
  const saturationRatio =
    redValues.filter((value) => value >= 252).length / redValues.length;
  const rawValues = resample(analysisSamples, sampleRate);
  const slowTrend = movingAverage(rawValues, Math.max(3, Math.round(sampleRate * 0.8)));
  const detrended = rawValues.map((value, index) => value - slowTrend[index]);
  const filtered = movingAverage(detrended, Math.max(2, Math.round(sampleRate * 0.1)));
  const rawVariation = standardDeviation(filtered);
  const partial = {
    bpm: null,
    duration,
    filtered,
    meanRed,
    periodicity: 0,
    sampleRate,
    saturationRatio,
  };

  if (duration < 15 || sampleRate < 10) {
    return rejected(partial, "The recording was too short or frames were dropped. Keep this tab active and retry.");
  }
  if (meanRed < 55) {
    return rejected(partial, "The lens is not fully covered. Place your fingertip over the rear camera and flash.");
  }
  if (saturationRatio > 0.9) {
    return rejected(partial, "The image is saturated. Rest your fingertip lightly instead of pressing hard.");
  }
  if (rawVariation < 0.08) {
    return rejected(partial, "No clear pulse variation was found. Hold still, warm your hand, and try again.");
  }

  const centered = filtered.map((value) => value - mean(filtered));
  const auto = autocorrelation(centered, sampleRate);
  const peak = peakEstimate(centered, sampleRate);
  const agreement = peak.bpm
    ? clamp(1 - Math.abs(auto.bpm - peak.bpm) / 20, 0, 1)
    : 0.35;
  const bpm = peak.bpm && agreement > 0.45 ? (auto.bpm + peak.bpm) / 2 : auto.bpm;
  const brightnessScore = clamp((meanRed - 55) / 75, 0, 1);
  const saturationScore = clamp(1 - saturationRatio / 0.65, 0, 1);
  const densityScore = clamp(sampleRate / 24, 0, 1);
  const qualityScore = Math.round(
    100 *
      (auto.score * 0.42 +
        peak.stability * 0.2 +
        agreement * 0.16 +
        brightnessScore * 0.1 +
        saturationScore * 0.07 +
        densityScore * 0.05),
  );
  const withPeriodicity = { ...partial, periodicity: auto.score };

  if (auto.score < 0.15 || bpm < MIN_BPM || bpm > MAX_BPM || qualityScore < MIN_QUALITY_SCORE) {
    return rejected(
      withPeriodicity,
      `The signal was too noisy to estimate a pulse reliably (quality ${qualityScore}/100). Keep still, use light fingertip pressure, and retry.`,
      qualityScore,
    );
  }

  const quality = qualityScore >= 72 ? "good" : "fair";
  return {
    ...withPeriodicity,
    bpm: Math.round(bpm),
    quality,
    qualityScore,
    reason:
      quality === "good"
        ? "A steady pulse pattern was detected."
        : "A pulse pattern was detected, but the signal had some noise.",
    valid: true,
  };
}
