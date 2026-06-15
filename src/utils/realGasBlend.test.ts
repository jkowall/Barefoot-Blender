import { describe, expect, test } from "vitest";
import type { StandardBlendInput } from "../state/session";
import type { GasSelection } from "./calculations";
import { calculateStandardBlend } from "./calculations";
import { calculateRealGasStandardBlend } from "./realGasBlend";

const air: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };

describe("calculateRealGasStandardBlend", () => {
  test("adds corrected stop pressures for a standard EAN32 fill", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      fillTemperatureF: 70,
      settledTemperatureF: 70,
      topGasId: "air"
    };

    const ideal = calculateStandardBlend({ pressureUnit: "psi" }, inputs, air);
    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(ideal.success).toBe(true);
    expect(corrected.success).toBe(true);
    expect(corrected.steps).toHaveLength(2);
    expect(corrected.steps[0]?.kind).toBe("oxygen");
    expect(corrected.steps[1]?.kind).toBe("topoff");
    expect(corrected.finalHotPressurePsi).toBeCloseTo(3000, 1);
    expect(corrected.steps[0]?.stopPressurePsi).not.toBeCloseTo(417.72, 1);
  });

  test("raises the final hot stop when fill temperature is above settled temperature", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      fillTemperatureF: 90,
      settledTemperatureF: 70,
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.finalHotPressurePsi).toBeGreaterThan(3000);
    expect(corrected.targetSettledPressurePsi).toBe(3000);
  });

  test("allows a GERG-only top-off when displayed start and target pressures match", () => {
    const inputs: StandardBlendInput = {
      startPressure: 3000,
      targetPressure: 3000,
      targetO2: 21,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 90,
      fillTemperatureF: 90,
      settledTemperatureF: 70,
      topGasId: "air"
    };

    const ideal = calculateStandardBlend({ pressureUnit: "psi" }, inputs, air);
    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(ideal.success).toBe(false);
    expect(ideal.errors[0]).toBe("Target pressure matches start pressure.");
    expect(corrected.success).toBe(true);
    expect(corrected.steps).toHaveLength(1);
    expect(corrected.steps[0]?.kind).toBe("topoff");
    expect(corrected.finalHotPressurePsi).toBeGreaterThan(3000);
  });

  test("rejects direct real-gas correction when the target needs bleed-down first", () => {
    const inputs: StandardBlendInput = {
      startPressure: 2000,
      targetPressure: 3000,
      targetO2: 21,
      targetHe: 0,
      startO2: 50,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      fillTemperatureF: 70,
      settledTemperatureF: 70,
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(false);
    expect(corrected.errors[0]).toContain("Complete the bleed-down step");
  });
});
