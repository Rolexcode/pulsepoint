export type SignalQuality = "good" | "fair" | "poor";

export interface PpgSample {
  time: number;
  red: number;
  green: number;
  value: number;
}

export interface SignalAnalysis {
  bpm: number | null;
  duration: number;
  filtered: number[];
  meanRed: number;
  periodicity: number;
  quality: SignalQuality;
  qualityScore: number;
  reason: string;
  sampleRate: number;
  saturationRatio: number;
  valid: boolean;
}

export interface StoredReading {
  bpm: number;
  id: string;
  quality: Exclude<SignalQuality, "poor">;
  qualityScore: number;
  recordedAt: string;
  sampleRate: number;
}

export interface Baseline {
  average: number;
  high: number;
  low: number;
}
