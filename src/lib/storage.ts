import type { Baseline, StoredReading } from "./types";

const STORAGE_KEY = "pulseprint:readings:v1";
const MAX_READINGS = 5;

function isReading(value: unknown): value is StoredReading {
  if (!value || typeof value !== "object") return false;
  const reading = value as Partial<StoredReading>;

  return (
    typeof reading.id === "string" &&
    typeof reading.recordedAt === "string" &&
    typeof reading.bpm === "number" &&
    Number.isFinite(reading.bpm) &&
    typeof reading.qualityScore === "number" &&
    typeof reading.sampleRate === "number" &&
    (reading.quality === "good" || reading.quality === "fair")
  );
}

export function loadReadings(): StoredReading[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(isReading).slice(0, MAX_READINGS);
  } catch {
    return [];
  }
}

export function saveReading(reading: StoredReading): StoredReading[] {
  const next = [reading, ...loadReadings()].slice(0, MAX_READINGS);

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The measurement remains usable when private browsing blocks storage.
  }

  return next;
}

export function clearReadings(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Treat unavailable local storage as already cleared.
  }
}

export function calculateBaseline(readings: StoredReading[]): Baseline | null {
  if (readings.length < 2) return null;

  const bpms = readings.map((reading) => reading.bpm);
  const average = bpms.reduce((sum, value) => sum + value, 0) / bpms.length;
  const variance =
    bpms.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    Math.max(1, bpms.length - 1);
  const spread = Math.max(3, Math.sqrt(variance) * 1.5);

  return {
    average: Math.round(average),
    low: Math.round(average - spread),
    high: Math.round(average + spread),
  };
}
