import { describe, expect, it } from "vitest";

import { analyzePpg } from "./signal";
import type { PpgSample } from "./types";

function syntheticSignal(bpm: number, duration = 24, sampleRate = 30): PpgSample[] {
  return Array.from({ length: duration * sampleRate }, (_, index) => {
    const time = index / sampleRate;
    const pulse = Math.sin((2 * Math.PI * bpm * time) / 60);
    const harmonic = 0.35 * Math.sin((4 * Math.PI * bpm * time) / 60 + 0.5);
    const drift = 0.2 * Math.sin(2 * Math.PI * 0.12 * time);
    const noise = 0.08 * Math.sin(2 * Math.PI * 7.3 * time);
    const value = 185 + pulse * 3.2 + harmonic + drift + noise;

    return { time, red: value, green: 82 + pulse * 0.3, value };
  });
}

describe("analyzePpg", () => {
  it.each([52, 72, 96, 132])("estimates a clean synthetic %i BPM pulse", (bpm) => {
    const result = analyzePpg(syntheticSignal(bpm));

    expect(result.valid, JSON.stringify({ ...result, filtered: undefined })).toBe(true);
    expect(result.bpm).toBeGreaterThanOrEqual(bpm - 4);
    expect(result.bpm).toBeLessThanOrEqual(bpm + 4);
  });

  it("rejects a flat signal instead of inventing a value", () => {
    const samples = syntheticSignal(72).map((sample) => ({
      ...sample,
      red: 180,
      value: 180,
    }));
    const result = analyzePpg(samples);

    expect(result.valid).toBe(false);
    expect(result.bpm).toBeNull();
  });
});
