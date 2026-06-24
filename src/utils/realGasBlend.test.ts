import { describe, expect, test } from "vitest";
import type { StandardBlendInput } from "../state/session";
import type { GasSelection } from "./calculations";
import { calculateStandardBlend } from "./calculations";
import { calculateRealGasStandardBlend, calculateRealGasTopOff } from "./realGasBlend";

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
      settledTemperatureF: 70,
      stageTemperaturesF: {
        oxygen: 70,
        topoff: 70
      },
      stageTemperatureTouched: {},
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

  test("raises the final stage stop when stage temperature is above settled temperature", () => {
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
      settledTemperatureF: 70,
      stageTemperaturesF: {
        oxygen: 90,
        topoff: 90
      },
      stageTemperatureTouched: {},
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.finalHotPressurePsi).toBeGreaterThan(3000);
    expect(corrected.targetSettledPressurePsi).toBe(3000);
  });

  test("uses independent stage temperatures for intermediate stop pressure", () => {
    const coolOxygenInputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      settledTemperatureF: 70,
      stageTemperaturesF: {
        oxygen: 70,
        topoff: 100
      },
      stageTemperatureTouched: {},
      topGasId: "air"
    };
    const hotOxygenInputs: StandardBlendInput = {
      ...coolOxygenInputs,
      stageTemperaturesF: {
        oxygen: 100,
        topoff: 100
      }
    };

    const coolOxygen = calculateRealGasStandardBlend({ pressureUnit: "psi" }, coolOxygenInputs, air);
    const hotOxygen = calculateRealGasStandardBlend({ pressureUnit: "psi" }, hotOxygenInputs, air);

    expect(coolOxygen.success).toBe(true);
    expect(hotOxygen.success).toBe(true);
    expect(coolOxygen.steps[0]?.stopPressurePsi).toBeLessThan(hotOxygen.steps[0]?.stopPressurePsi ?? 0);
    expect(coolOxygen.steps[0]?.pressureChangePsi).toBeLessThan(hotOxygen.steps[0]?.pressureChangePsi ?? 0);
    expect(coolOxygen.steps[0]?.temperatureF).toBe(70);
    expect(coolOxygen.steps[1]?.temperatureF).toBe(100);
    expect(coolOxygen.steps[1]?.stopPressurePsi).toBeCloseTo(hotOxygen.steps[1]?.stopPressurePsi ?? 0, 6);
    expect(coolOxygen.steps[1]?.pressureChangePsi).toBeCloseTo(hotOxygen.steps[1]?.pressureChangePsi ?? 0, 6);
  });

  test("falls back to legacy fill temperature when stage temperatures are absent", () => {
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
    expect(corrected.steps[0]?.temperatureF).toBe(90);
    expect(corrected.steps[1]?.temperatureF).toBe(90);
    expect(corrected.finalHotPressurePsi).toBeGreaterThan(3000);
  });

  test("falls back to legacy fill temperature when the touched map is absent", () => {
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
      stageTemperaturesF: {},
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.steps[0]?.temperatureF).toBe(90);
    expect(corrected.steps[1]?.temperatureF).toBe(90);
    expect(corrected.finalHotPressurePsi).toBeGreaterThan(3000);
  });

  test("defaults missing new-schema stage temperatures to start temperature", () => {
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
      stageTemperaturesF: {},
      stageTemperatureTouched: {},
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.steps[0]?.temperatureF).toBe(70);
    expect(corrected.steps[1]?.temperatureF).toBe(70);
    expect(corrected.finalHotPressurePsi).toBeCloseTo(3000, 1);
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
      settledTemperatureF: 70,
      stageTemperaturesF: {
        topoff: 90
      },
      stageTemperatureTouched: {},
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

  test("measures GERG-only stage pressure deltas at the stage temperature", () => {
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
      settledTemperatureF: 70,
      stageTemperaturesF: {
        topoff: 70
      },
      stageTemperatureTouched: {},
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.steps).toHaveLength(1);
    expect(corrected.steps[0]?.kind).toBe("topoff");
    expect(corrected.steps[0]?.stopPressurePsi).toBeCloseTo(3000, 1);
    expect(corrected.steps[0]?.pressureChangePsi).toBeGreaterThan(50);
    expect(corrected.startHotPressurePsi).toBeCloseTo(
      (corrected.steps[0]?.stopPressurePsi ?? 0) - (corrected.steps[0]?.pressureChangePsi ?? 0),
      6
    );
    expect(corrected.startHotPressurePsi).toBeLessThan(3000);
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
      settledTemperatureF: 70,
      stageTemperaturesF: {
        topoff: 70
      },
      stageTemperatureTouched: {},
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(false);
    expect(corrected.errors[0]).toContain("Complete the bleed-down step");
  });
});

describe("calculateRealGasTopOff", () => {
  test("keeps result pressure close to goal when start and result temperatures match", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      {
        startPressure: 500,
        finalPressure: 3000,
        startO2: 32,
        startHe: 0,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        resultTemperatureF: 70,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(true);
    expect(corrected.goalPressurePsi).toBe(3000);
    expect(corrected.resultPressurePsi).toBeCloseTo(3000, 1);
    expect(corrected.addedPressure).toBeCloseTo(2500, 6);
    expect(corrected.finalO2).toBeGreaterThan(22);
    expect(corrected.finalHe).toBeCloseTo(0, 6);
  });

  test("raises result pressure at higher result temperature without changing final mix", () => {
    const baseInput = {
      startPressure: 500,
      finalPressure: 3000,
      startO2: 32,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      topGasId: "air"
    };

    const settled = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      { ...baseInput, resultTemperatureF: 70 },
      air
    );
    const hot = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      { ...baseInput, resultTemperatureF: 100 },
      air
    );

    expect(settled.success).toBe(true);
    expect(hot.success).toBe(true);
    expect(hot.resultPressurePsi).toBeGreaterThan(settled.resultPressurePsi);
    expect(hot.finalO2).toBeCloseTo(settled.finalO2, 8);
    expect(hot.finalHe).toBeCloseTo(settled.finalHe, 8);
    expect(hot.topOffMoles).toBeCloseTo(settled.topOffMoles, 8);
  });

  test("changing start temperature changes solved top-off moles", () => {
    const baseInput = {
      startPressure: 500,
      finalPressure: 3000,
      startO2: 32,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      resultTemperatureF: 70,
      topGasId: "air"
    };

    const coolStart = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      { ...baseInput, startTemperatureF: 70 },
      air
    );
    const warmStart = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      { ...baseInput, startTemperatureF: 90 },
      air
    );

    expect(coolStart.success).toBe(true);
    expect(warmStart.success).toBe(true);
    expect(warmStart.topOffMoles).not.toBeCloseTo(coolStart.topOffMoles, 5);
  });

  test("rejects invalid start mix", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      {
        startPressure: 500,
        finalPressure: 3000,
        startO2: 60,
        startHe: 50,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        resultTemperatureF: 70,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors[0]).toContain("Gas fractions");
  });

  test("rejects goal pressure below start pressure", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      {
        startPressure: 3000,
        finalPressure: 500,
        startO2: 32,
        startHe: 0,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        resultTemperatureF: 70,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain("Goal pressure is below current pressure. Bleed-down required.");
  });

  test("requires tank context", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      {
        startPressure: 500,
        finalPressure: 3000,
        startO2: 32,
        startHe: 0,
        startTemperatureF: 70,
        resultTemperatureF: 70,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain("Tank size and rated pressure are required for GERG-2008 correction.");
  });

  test("supports bar inputs and returns PSI internally", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "bar" },
      {
        startPressure: 50,
        finalPressure: 200,
        startO2: 21,
        startHe: 0,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        resultTemperatureF: 70,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(true);
    expect(corrected.goalPressurePsi).toBeCloseTo(200 * 14.5037738, 3);
    expect(corrected.resultPressurePsi).toBeCloseTo(200 * 14.5037738, 1);
  });

  test("surfaces GERG envelope errors for out-of-range result temperature", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      {
        startPressure: 500,
        finalPressure: 3000,
        startO2: 32,
        startHe: 0,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        resultTemperatureF: -400,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain("GERG-2008 correction is limited to temperatures at or above 250 K.");
  });
});
