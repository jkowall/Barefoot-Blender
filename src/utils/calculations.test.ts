import { expect, test, describe } from "vitest";
import {
  calculateTopOffBlend,
  solveTopOffBleedForTargetPercent,
  calculateBestMix,
  calculateMultiGasBlend,
  calculateStandardBlend,
  calculateGasCost,
  calculateFillCostEstimate,
  generateBlendAlternatives,
  solveNGasBlend,
  calculateEND,
  calculateDensity,
  calculateMOD,
  calculateEAD,
  getRecommendedFillOrder,
  orderBlendStepsForFill,
  applyFillOrderToAlternative,
  listTopOffOptions,
  clampPressure,
  clampDepth,
  clampPercent,
  calculatePsiPerCuFt,
  cuFtToLiters,
  cuFtToPressure,
  litersToCuFt,
  pressureToCuFt,
  summarizeBlendVolumes
} from "./calculations";
import type { GasSelection, BlendResult, BlendAlternative } from "./calculations";
import type { MultiGasInput, StandardBlendInput } from "../state/session";
import type { GasDefinition } from "../state/settings";

const air: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };
const oxygen: GasSelection = { id: "oxygen", name: "Oxygen", o2: 100, he: 0 };

describe("Clamping Utilities", () => {
  test("clampPressure correctly handles values", () => {
    expect(clampPressure(100)).toBe(100);
    expect(clampPressure(0)).toBe(0);
    expect(clampPressure(-10)).toBe(0);
  });

  test("clampDepth correctly handles values", () => {
    expect(clampDepth(30)).toBe(30);
    expect(clampDepth(0)).toBe(0);
    expect(clampDepth(-5)).toBe(0);
  });

  test("clampPercent correctly handles values", () => {
    expect(clampPercent(50)).toBe(50);
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(-10)).toBe(0);
    expect(clampPercent(100)).toBe(100);
    expect(clampPercent(110)).toBe(100);
  });
});

describe("Tank volume conversions", () => {
  test("calculates PSI per cubic foot", () => {
    expect(calculatePsiPerCuFt(80, 3000)).toBeCloseTo(37.5, 3);
  });

  test("converts pressure to cubic feet", () => {
    expect(pressureToCuFt(500, 80, 3000)).toBeCloseTo(13.333, 3);
  });

  test("converts cubic feet to pressure", () => {
    expect(cuFtToPressure(10, 80, 3000)).toBeCloseTo(375, 3);
  });

  test("converts cubic feet to free gas liters", () => {
    expect(cuFtToLiters(80)).toBeCloseTo(2265.35, 2);
    expect(litersToCuFt(2265.34772736)).toBeCloseTo(80, 3);
  });

  test("returns safe zero values for invalid tanks", () => {
    expect(calculatePsiPerCuFt(0, 3000)).toBe(0);
    expect(calculatePsiPerCuFt(80, 0)).toBe(0);
    expect(pressureToCuFt(500, 0, 3000)).toBe(0);
    expect(pressureToCuFt(500, 80, 0)).toBe(0);
    expect(cuFtToPressure(10, 0, 3000)).toBe(0);
    expect(cuFtToPressure(10, 80, 0)).toBe(0);
  });
});

describe("calculateStandardBlend", () => {
  const settingsPsi = { pressureUnit: "psi" as const };
  const settingsBar = { pressureUnit: "bar" as const };

  test("Standard EAN32 from empty (PSI)", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsPsi, inputs, air);

    expect(result.success).toBe(true);
    // EAN32 = 32% O2. Air has 21% O2.
    // Target O2 = 3000 * 0.32 = 960.
    // Let X be O2 added, Y be Air added. X + Y = 3000.
    // O2 content: X * 1.0 + Y * 0.21 = 960.
    // X + (3000 - X) * 0.21 = 960
    // X + 630 - 0.21X = 960
    // 0.79X = 330
    // X = 330 / 0.79 = 417.72...
    // Y = 3000 - 417.72... = 2582.27...
    const steps = result.steps;
    const oxygenStep = steps.find(s => s.kind === "oxygen");
    const topoffStep = steps.find(s => s.kind === "topoff");

    expect(oxygenStep).toBeDefined();
    expect(oxygenStep?.amount).toBeCloseTo(417.72, 1);
    expect(topoffStep).toBeDefined();
    expect(topoffStep?.amount).toBeCloseTo(2582.28, 1);
    expect(result.errors).toHaveLength(0);
  });

  test("Standard EAN32 with partial start (PSI)", () => {
    const inputs: StandardBlendInput = {
      startPressure: 500,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0, // Air start
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsPsi, inputs, air);

    expect(result.success).toBe(true);
    // Already have 500 PSI Air (105 O2). Need 960 total O2.
    // Added 2500 PSI. Let X be O2 added.
    // 105 + X + (2500 - X) * 0.21 = 960
    // 105 + X + 525 - 0.21X = 960
    // 630 + 0.79X = 960
    // 0.79X = 330
    // X = 330 / 0.79 = 417.72... (Same amount of O2 added as empty case because we are effectively just adding on top of existing air to reach same target mix/pressure, and the "Air" portion is just extending the existing Air).

    const oxygenStep = result.steps.find(s => s.kind === "oxygen");
    expect(oxygenStep?.amount).toBeCloseTo(417.72, 1);
  });

  test("Trimix 21/35 from empty (PSI)", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 21,
      targetHe: 35,
      startO2: 21,
      startHe: 0,
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsPsi, inputs, air);

    expect(result.success).toBe(true);
    // Target: 21% O2, 35% He, 44% N2.
    // 3000 PSI total.
    // He needed: 1050 PSI.
    // O2 needed: 630 PSI.
    // N2 needed: 1320 PSI.
    // Top off with Air (21/0/79).
    // N2 only comes from Air.
    // Air amount = N2 / 0.79 = 1320 / 0.79 = 1670.88...
    // Air contains 1670.88 * 0.21 = 350.88 O2.
    // O2 to add = 630 - 350.88 = 279.12...
    // He to add = 1050.

    const heStep = result.steps.find(s => s.kind === "helium");
    const o2Step = result.steps.find(s => s.kind === "oxygen");
    const topStep = result.steps.find(s => s.kind === "topoff");

    expect(heStep?.amount).toBeCloseTo(1050, 1);
    expect(o2Step?.amount).toBeCloseTo(279.12, 1);
    expect(topStep?.amount).toBeCloseTo(1670.88, 1);
  });

  test("Bleed Required: Start pressure > Target pressure", () => {
    const inputs: StandardBlendInput = {
      startPressure: 2000,
      targetPressure: 1000,
      targetO2: 21, // Target Air
      targetHe: 0,
      startO2: 21, // Start Air
      startHe: 0,
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsPsi, inputs, air);

    expect(result.success).toBe(true);
    const bleedStep = result.steps.find(s => s.kind === "bleed");
    expect(bleedStep).toBeDefined();
    expect(bleedStep?.amount).toBeCloseTo(1000, 1); // Bleed 2000 -> 1000
    // It might have tiny add steps due to binary search precision, which is acceptable.
    // Just verify the bleed step accounts for most of the pressure drop.
  });

  test("Bleed Required: Composition requires drain", () => {
    // Start with EAN50, want Air. Must drain almost completely.
    const inputs: StandardBlendInput = {
      startPressure: 2000,
      targetPressure: 3000,
      targetO2: 21,
      targetHe: 0,
      startO2: 50,
      startHe: 0,
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsPsi, inputs, air);

    expect(result.success).toBe(true);
    const bleedStep = result.steps.find(s => s.kind === "bleed");
    expect(bleedStep).toBeDefined();
    // It should bleed down to 0 because any amount of EAN50 makes mix > 21%.
    expect(bleedStep?.amount).toBeCloseTo(2000, 1);

    const topStep = result.steps.find(s => s.kind === "topoff");
    expect(topStep).toBeDefined();
    expect(topStep?.amount).toBeCloseTo(3000, 1); // Fill fully with Air
  });

  test("Bleed Required: Composition requires partial bleed", () => {
    const inputs: StandardBlendInput = {
      startPressure: 3000,
      targetPressure: 3000,
      startO2: 32,
      startHe: 0,
      targetO2: 25,
      targetHe: 0,
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsPsi, inputs, air);

    expect(result.success).toBe(true);
    const bleedStep = result.steps.find(s => s.kind === "bleed");
    expect(bleedStep).toBeDefined();
    expect(result.bleedPressure).toBeCloseTo(1090.9, 1);
    expect(bleedStep?.amount).toBeCloseTo(1909.1, 1);
  });

  test("Impossible Target: O2 + He > 100%", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 80,
      targetHe: 30, // 110%
      startO2: 21,
      startHe: 0,
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsPsi, inputs, air);

    expect(result.success).toBe(false);
    expect(result.errors).toContain("O2% + He% must be 100% or less.");
  });

  test("Warnings: Hypoxic Mix", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 15,
      targetHe: 30, // 15/30/55. Air topoff possible.
      startO2: 21,
      startHe: 0,
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsPsi, inputs, air);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Hypoxic mix (<18% O2).");
  });

  test("Warnings: High O2", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 50,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsPsi, inputs, air);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("High O2 - fire risk (>40% O2).");
  });

  test("Bar Units Support", () => {
    const inputs: StandardBlendInput = {
      startPressure: 100, // bar
      targetPressure: 200, // bar
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsBar, inputs, air);

    expect(result.success).toBe(true);

    const o2Step = result.steps.find(s => s.kind === "oxygen");
    const o2Bar = 27.848;
    const expectedPsi = o2Bar * 14.5037738;

    // Allow small rounding differences (within 1 PSI) due to unit conversions
    expect(o2Step?.amount).toBeCloseTo(expectedPsi, 0);
  });
});

describe("calculateMultiGasBlend", () => {
  const settings = { pressureUnit: "psi" as const };

  test("rejects unreachable helium targets when both source gases have no helium", () => {
    const inputs: MultiGasInput = {
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 10,
      startPressure: 0,
      startO2: 21,
      startHe: 0,
      selectedAlternativeIndex: 0
    };

    const result = calculateMultiGasBlend(settings, inputs, oxygen, air);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Selected sources cannot meet the target helium percentage.");
  });

  test("searches the fallback around the default 32% O2 when target O2 is omitted", () => {
    const inputs: MultiGasInput = {
      targetPressure: 3000,
      targetHe: 3,
      startPressure: 0,
      startO2: 21,
      startHe: 0,
      selectedAlternativeIndex: 0
    };

    const result = calculateMultiGasBlend(settings, inputs, oxygen, air);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Selected sources cannot meet the target helium percentage.");
    expect(result.fallback).toBeDefined();
    expect(result.fallback?.finalO2).toBeCloseTo(32, 6);
    expect(result).toEqual(calculateMultiGasBlend(settings, { ...inputs, targetO2: 32 }, oxygen, air));
  });

  test("reports the default 32% O2 as the final mix when target O2 is omitted and the blend succeeds", () => {
    const inputs: MultiGasInput = {
      targetPressure: 3000,
      targetHe: 0,
      startPressure: 0,
      startO2: 21,
      startHe: 0,
      selectedAlternativeIndex: 0
    };

    const result = calculateMultiGasBlend(settings, inputs, oxygen, air);

    expect(result.success).toBe(true);
    expect(result.finalO2).toBe(32);
    expect(result.finalHe).toBe(0);
    expect(result).toEqual(calculateMultiGasBlend(settings, { ...inputs, targetO2: 32 }, oxygen, air));
  });
});

describe("calculateGasCost", () => {
  test("Happy path: Standard inputs", () => {
    // 80 cuft tank at 3000 psi
    // Added 500 psi O2 and 500 psi He
    const oxygenPsi = 500;
    const heliumPsi = 500;
    const tankSizeCuFt = 80;
    const tankRatedPressure = 3000;
    const pricePerCuFtO2 = 0.5;
    const pricePerCuFtHe = 1.0;

    const result = calculateGasCost(
      oxygenPsi,
      heliumPsi,
      tankSizeCuFt,
      tankRatedPressure,
      pricePerCuFtO2,
      pricePerCuFtHe
    );

    // Volume per 500 psi = (500 / 3000) * 80 = 13.333... cuft
    const expectedVolume = (500 / 3000) * 80;
    expect(result.oxygenCuFt).toBeCloseTo(expectedVolume, 3);
    expect(result.heliumCuFt).toBeCloseTo(expectedVolume, 3);

    const expectedO2Cost = expectedVolume * 0.5;
    const expectedHeCost = expectedVolume * 1.0;
    expect(result.oxygenCost).toBeCloseTo(expectedO2Cost, 3);
    expect(result.heliumCost).toBeCloseTo(expectedHeCost, 3);
    expect(result.totalCost).toBeCloseTo(expectedO2Cost + expectedHeCost, 3);
  });

  test("Zero pressure results in zero cost", () => {
    const result = calculateGasCost(0, 0, 80, 3000, 0.5, 1.0);
    expect(result.oxygenCuFt).toBe(0);
    expect(result.heliumCuFt).toBe(0);
    expect(result.oxygenCost).toBe(0);
    expect(result.heliumCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("Zero price results in zero cost with volume", () => {
    const result = calculateGasCost(1000, 1000, 80, 3000, 0, 0);
    const expectedVolume = (1000 / 3000) * 80;
    expect(result.oxygenCuFt).toBeCloseTo(expectedVolume, 3);
    expect(result.heliumCuFt).toBeCloseTo(expectedVolume, 3);
    expect(result.oxygenCost).toBe(0);
    expect(result.heliumCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("Safety check: Zero rated pressure returns zero volume", () => {
    const result = calculateGasCost(500, 500, 80, 0, 0.5, 1.0);
    expect(result.oxygenCuFt).toBe(0);
    expect(result.heliumCuFt).toBe(0);
    expect(result.oxygenCost).toBe(0);
    expect(result.heliumCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("Safety check: Negative rated pressure returns zero volume", () => {
    const result = calculateGasCost(500, 500, 80, -3000, 0.5, 1.0);
    expect(result.oxygenCuFt).toBe(0);
    expect(result.heliumCuFt).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("Zero tank size results in zero volume", () => {
    const result = calculateGasCost(500, 500, 0, 3000, 0.5, 1.0);
    expect(result.oxygenCuFt).toBe(0);
    expect(result.heliumCuFt).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("Mixed inputs: Only O2 added", () => {
    const result = calculateGasCost(600, 0, 100, 3000, 0.3, 2.0);
    // (600/3000)*100 = 20 cuft
    expect(result.oxygenCuFt).toBeCloseTo(20, 3);
    expect(result.heliumCuFt).toBe(0);
    expect(result.oxygenCost).toBeCloseTo(20 * 0.3, 3);
    expect(result.heliumCost).toBe(0);
    expect(result.totalCost).toBeCloseTo(6, 3);
  });
});

describe("calculateGasCost", () => {
  test("Happy path: Standard inputs", () => {
    // 80 cuft tank at 3000 psi
    // Added 500 psi O2 and 500 psi He
    const oxygenPsi = 500;
    const heliumPsi = 500;
    const tankSizeCuFt = 80;
    const tankRatedPressure = 3000;
    const pricePerCuFtO2 = 0.5;
    const pricePerCuFtHe = 1.0;

    const result = calculateGasCost(
      oxygenPsi,
      heliumPsi,
      tankSizeCuFt,
      tankRatedPressure,
      pricePerCuFtO2,
      pricePerCuFtHe
    );

    // Volume per 500 psi = (500 / 3000) * 80 = 13.333... cuft
    const expectedVolume = (500 / 3000) * 80;
    expect(result.oxygenCuFt).toBeCloseTo(expectedVolume, 3);
    expect(result.heliumCuFt).toBeCloseTo(expectedVolume, 3);

    const expectedO2Cost = expectedVolume * 0.5;
    const expectedHeCost = expectedVolume * 1.0;
    expect(result.oxygenCost).toBeCloseTo(expectedO2Cost, 3);
    expect(result.heliumCost).toBeCloseTo(expectedHeCost, 3);
    expect(result.totalCost).toBeCloseTo(expectedO2Cost + expectedHeCost, 3);
  });

  test("Zero pressure results in zero cost", () => {
    const result = calculateGasCost(0, 0, 80, 3000, 0.5, 1.0);
    expect(result.oxygenCuFt).toBe(0);
    expect(result.heliumCuFt).toBe(0);
    expect(result.oxygenCost).toBe(0);
    expect(result.heliumCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("Zero price results in zero cost with volume", () => {
    const result = calculateGasCost(1000, 1000, 80, 3000, 0, 0);
    const expectedVolume = (1000 / 3000) * 80;
    expect(result.oxygenCuFt).toBeCloseTo(expectedVolume, 3);
    expect(result.heliumCuFt).toBeCloseTo(expectedVolume, 3);
    expect(result.oxygenCost).toBe(0);
    expect(result.heliumCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("Safety check: Zero rated pressure returns zero volume", () => {
    const result = calculateGasCost(500, 500, 80, 0, 0.5, 1.0);
    expect(result.oxygenCuFt).toBe(0);
    expect(result.heliumCuFt).toBe(0);
    expect(result.oxygenCost).toBe(0);
    expect(result.heliumCost).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("Safety check: Negative rated pressure returns zero volume", () => {
    const result = calculateGasCost(500, 500, 80, -3000, 0.5, 1.0);
    expect(result.oxygenCuFt).toBe(0);
    expect(result.heliumCuFt).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("Zero tank size results in zero volume", () => {
    const result = calculateGasCost(500, 500, 0, 3000, 0.5, 1.0);
    expect(result.oxygenCuFt).toBe(0);
    expect(result.heliumCuFt).toBe(0);
    expect(result.totalCost).toBe(0);
  });

  test("Mixed inputs: Only O2 added", () => {
    const result = calculateGasCost(600, 0, 100, 3000, 0.3, 2.0);
    // (600/3000)*100 = 20 cuft
    expect(result.oxygenCuFt).toBeCloseTo(20, 3);
    expect(result.heliumCuFt).toBe(0);
    expect(result.oxygenCost).toBeCloseTo(20 * 0.3, 3);
    expect(result.heliumCost).toBe(0);
    expect(result.totalCost).toBeCloseTo(6, 3);
  });
});

describe("calculateBestMix", () => {
  test("Standard Nitrox: Depth 30m, PPO2 1.4, END 30m", () => {
    // 30m = 4 ATA
    // Max O2 = 1.4 / 4 = 0.35 => 35%
    // END 30m = 4 ATA
    // Safe N2 = (4) * 0.79 = 3.16 ATA
    // Max N2 fraction = 3.16 / 4 = 0.79
    // He = 1 - 0.35 - 0.79 = -0.14 => 0
    const result = calculateBestMix(30, 1.4, 30, "m", false);
    expect(result.o2).toBeCloseTo(35, 1);
    expect(result.he).toBeCloseTo(0, 1);
  });

  test("Deep Trimix: Depth 60m, PPO2 1.4, END 30m", () => {
    // 60m = 7 ATA
    // Max O2 = 1.4 / 7 = 0.20 => 20%
    // END 30m = 4 ATA
    // Safe N2 = 4 * 0.79 = 3.16 ATA
    // Max N2 fraction = 3.16 / 7 = 0.4514
    // He = 1 - 0.20 - 0.4514 = 0.3486 => ~35%
    const result = calculateBestMix(60, 1.4, 30, "m", false);
    expect(result.o2).toBeCloseTo(20, 1);
    expect(result.he).toBeCloseTo(34.9, 1);
  });

  test("Imperial Units: Depth 100ft, PPO2 1.4, END 100ft", () => {
    // 100ft ~ 4 ATA
    // O2 ~ 1.4 / 4 = 35%
    // END 100ft = Depth => N2 can be max
    // He should be 0
    const result = calculateBestMix(100, 1.4, 100, "ft", false);
    expect(result.o2).toBeCloseTo(34.7, 1);
    expect(result.he).toBeCloseTo(0, 1);
  });

  test("High END tolerance: Depth 60m, PPO2 1.4, END 60m", () => {
    // 60m = 7 ATA. Target PPO2 1.4 => 20% O2.
    // Air has 79% N2. END=Depth means we accept Air's N2 loading (79%).
    // Remaining space: 100 - 20 = 80%.
    // Allowed N2: 79%.
    // So we must use 1% He to avoid exceeding Air's N2 partial pressure.
    const result = calculateBestMix(60, 1.4, 60, "m", false);
    expect(result.o2).toBeCloseTo(20, 1);
    expect(result.he).toBeCloseTo(1, 1);
  });

  test("Low END tolerance: Depth 30m, PPO2 1.4, END 10m", () => {
    // 30m = 4 ATA
    // O2 = 35%
    // END 10m = 2 ATA
    // Safe N2 = 2 * 0.79 = 1.58 ATA
    // Max N2 fraction = 1.58 / 4 = 0.395
    // He = 1 - 0.35 - 0.395 = 0.255 => 25.5%
    const result = calculateBestMix(30, 1.4, 10, "m", false);
    expect(result.o2).toBeCloseTo(35, 1);
    expect(result.he).toBeCloseTo(25.5, 1);
  });

  test("100% O2 Cap: Shallow depth", () => {
    // Depth 0m = 1 ATA
    // Target PPO2 1.4
    // Calc O2 = 1.4 / 1 = 140% => cap at 100%
    const result = calculateBestMix(0, 1.4, 30, "m", false);
    expect(result.o2).toBe(100);
    expect(result.he).toBe(0);
  });

  test("Oxygen narcotic: Depth 60m, PPO2 1.4, END 30m needs more helium", () => {
    // 60m = 7 ATA, END 30m = 4 ATA. Air is 100% narcotic, so O2 + N2 <= 4 / 7 = 0.5714.
    // He = 1 - 0.5714 = 0.4286 => 42.86% (N2-only planning gives 34.86%).
    const result = calculateBestMix(60, 1.4, 30, "m", true);
    expect(result.o2).toBeCloseTo(20, 2);
    expect(result.he).toBeCloseTo(42.86, 2);
  });

  test.each([false, true])("Best Mix meets its max END when oxygen narcotic is %s", (oxygenIsNarcotic) => {
    const result = calculateBestMix(60, 1.4, 30, "m", oxygenIsNarcotic);
    expect(result.maxEndMet).toBe(true);
    expect(calculateEND(result.o2, result.he, 60, "m", oxygenIsNarcotic)).toBeCloseTo(30, 6);
  });

  test("Oxygen narcotic: fills with helium when O2 alone exceeds the END limit", () => {
    // 30m = 4 ATA, O2 = 35%. END 0m allows O2 + N2 <= 1 / 4 = 0.25, below the O2 alone.
    const result = calculateBestMix(30, 1.4, 0, "m", true);
    expect(result.o2).toBeCloseTo(35, 6);
    expect(result.he).toBeCloseTo(65, 6);
    expect(result.maxEndMet).toBe(false);
    // The mix reaches END (4 * 0.35 - 1) * 10 = 4m, not the requested 0m.
    expect(calculateEND(result.o2, result.he, 30, "m", true)).toBeCloseTo(4, 6);
  });
});

describe("calculateMOD", () => {
  test("Standard Air (21%): Metric", () => {
    // 1.4 / 0.21 = 6.666... ATA. 6.666 - 1 = 5.666... ATA depth.
    // 5.666... * 10m/ATA = 56.66...m
    const result = calculateMOD(21, 1.4, 1.6, "m");
    expect(result.mod).toBeCloseTo(56.67, 1);
    expect(result.contingency).toBeCloseTo(66.19, 1);
  });

  test("Standard Air (21%): Imperial", () => {
    // 1.4 / 0.21 = 6.666... ATA. 6.666 - 1 = 5.666... ATA depth.
    // 5.666... * 33ft/ATA = 187ft
    const result = calculateMOD(21, 1.4, 1.6, "ft");
    expect(result.mod).toBeCloseTo(187.0, 1);
    expect(result.contingency).toBeCloseTo(218.4, 1);
  });

  test("Pure Oxygen (100%): Metric", () => {
    // 1.4 / 1.0 = 1.4 ATA. 1.4 - 1 = 0.4 ATA depth.
    // 0.4 * 10m/ATA = 4m
    const result = calculateMOD(100, 1.4, 1.6, "m");
    expect(result.mod).toBeCloseTo(4.0, 1);
    expect(result.contingency).toBeCloseTo(6.0, 1);
  });

  test("Hypoxic Mix (10%): Metric", () => {
    // 1.4 / 0.10 = 14 ATA. 14 - 1 = 13 ATA depth.
    // 13 * 10m/ATA = 130m
    const result = calculateMOD(10, 1.4, 1.6, "m");
    expect(result.mod).toBeCloseTo(130.0, 1);
    expect(result.contingency).toBeCloseTo(150.0, 1);
  });

  test("Edge Case: 0% Oxygen", () => {
    const result = calculateMOD(0, 1.4, 1.6, "m");
    expect(result.mod).toBe(0);
    expect(result.contingency).toBe(0);
  });

  test("Edge Case: Target PPO2 less than oxygen fraction (negative depth)", () => {
    // If we have 100% O2 but want 0.5 PPO2, we should already be at 0m (1 ATA).
    // The calculation would give (0.5/1 - 1) * 10 = -5m.
    // We expect it to be capped at 0m.
    const result = calculateMOD(100, 0.5, 0.8, "m");
    expect(result.mod).toBe(0);
    expect(result.contingency).toBe(0);
  });
});
describe("solveTopOffBleedForTargetPercent", () => {
  const solve = (overrides: Partial<Parameters<typeof solveTopOffBleedForTargetPercent>[0]> = {}) =>
    solveTopOffBleedForTargetPercent({
      targetPercent: 26,
      startPercent: 32,
      topPercent: 21,
      finalPressure: 3000,
      pressureUnit: "psi",
      startPressurePsi: 1500,
      ...overrides
    });

  test("bleeds 32% at 1500 psi to 1363.6 psi so an Air top-off to 3000 psi lands on 26%", () => {
    // P_start_adj = 3000 * (0.26 - 0.21) / (0.32 - 0.21)
    expect(solve()).toBeCloseTo(1500 - (3000 * 0.05) / 0.11, 9);
  });

  test("converts a bar Final Pressure before solving", () => {
    expect(solve({ finalPressure: 200, pressureUnit: "bar" })).toBeCloseTo(1500 - (200 * 14.5037738 * 0.05) / 0.11, 6);
  });

  test.each(["psi", "bar"] as const)("solves an empty Final Pressure against 3000 psi, not 3000 %s", (pressureUnit) => {
    expect(solve({ finalPressure: undefined, pressureUnit })).toBeCloseTo(1500 - (3000 * 0.05) / 0.11, 6);
  });

  test("clamps the bleed between none and the whole start pressure", () => {
    // 31% would need more 32% gas than the tank holds, so no bleed helps.
    expect(solve({ targetPercent: 31 })).toBe(0);
    // A target at or below the top-off O2 needs an empty tank, so bleed everything.
    expect(solve({ targetPercent: 20, startPressurePsi: 100 })).toBe(100);
  });

  test("returns null when the start and top-off fractions match", () => {
    expect(solve({ startPercent: 21 })).toBeNull();
  });
});

describe("calculateTopOffBlend", () => {
  const settingsPsi = { pressureUnit: "psi" as const };
  const settingsBar = { pressureUnit: "bar" as const };

  test("Happy path: Topping off Air with Air (PSI)", () => {
    const inputs = {
      startO2: 21,
      startHe: 0,
      startPressure: 500,
      finalPressure: 3000,
      topGasId: "air"
    };
    const topGas: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };

    const result = calculateTopOffBlend(settingsPsi, inputs, topGas);

    expect(result.success).toBe(true);
    expect(result.finalO2).toBeCloseTo(21, 1);
    expect(result.finalHe).toBeCloseTo(0, 1);
    expect(result.finalPressure).toBe(3000);
    expect(result.addedPressure).toBe(2500);
    expect(result.errors).toHaveLength(0);
  });

  test("Happy path: Topping off EAN32 with Air (PSI)", () => {
    const inputs = {
      startO2: 32,
      startHe: 0,
      startPressure: 500,
      finalPressure: 3000,
      topGasId: "air"
    };
    const topGas: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };

    // Final O2 = (500 * 0.32 + 2500 * 0.21) / 3000
    // Final O2 = (160 + 525) / 3000 = 685 / 3000 = 0.228333... => 22.83%
    const result = calculateTopOffBlend(settingsPsi, inputs, topGas);

    expect(result.success).toBe(true);
    expect(result.finalO2).toBeCloseTo(22.83, 2);
    expect(result.finalHe).toBeCloseTo(0, 1);
    expect(result.addedPressure).toBe(2500);
  });

  test("Happy path: Topping off Trimix (PSI)", () => {
    const inputs = {
      startO2: 21,
      startHe: 35,
      startPressure: 1000,
      finalPressure: 3000,
      topGasId: "trimix"
    };
    const topGas: GasSelection = { id: "trimix", name: "21/35", o2: 21, he: 35 };

    const result = calculateTopOffBlend(settingsPsi, inputs, topGas);

    expect(result.success).toBe(true);
    expect(result.finalO2).toBeCloseTo(21, 1);
    expect(result.finalHe).toBeCloseTo(35, 1);
    expect(result.addedPressure).toBe(2000);
  });

  test("Error: Final pressure <= 0", () => {
    const inputs = {
      startO2: 21,
      startHe: 0,
      startPressure: 500,
      finalPressure: 0,
      topGasId: "air"
    };
    const topGas: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };

    const result = calculateTopOffBlend(settingsPsi, inputs, topGas);

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Final pressure must be greater than zero.");
  });

  test("Error: Start pressure < 0", () => {
    const inputs = {
      startO2: 21,
      startHe: 0,
      startPressure: -10,
      finalPressure: 3000,
      topGasId: "air"
    };
    const topGas: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };

    const result = calculateTopOffBlend(settingsPsi, inputs, topGas);

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Start pressure cannot be negative.");
  });

  test("Error: Final pressure < start pressure", () => {
    const inputs = {
      startO2: 21,
      startHe: 0,
      startPressure: 1000,
      finalPressure: 500,
      topGasId: "air"
    };
    const topGas: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };

    const result = calculateTopOffBlend(settingsPsi, inputs, topGas);

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Final pressure is below current pressure. Bleed-down required.");
  });

  test("Error: Invalid start mix", () => {
    const inputs = {
      startO2: 60,
      startHe: 50,
      startPressure: 500,
      finalPressure: 3000,
      topGasId: "air"
    };
    const topGas: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };

    const result = calculateTopOffBlend(settingsPsi, inputs, topGas);

    expect(result.success).toBe(false);
    expect(result.errors).toContain("O2% + He% must be 100% or less.");
  });

  test("Warning: Hypoxic mix", () => {
    const inputs = {
      startO2: 10,
      startHe: 70,
      startPressure: 1000,
      finalPressure: 3000,
      topGasId: "trimix"
    };
    const topGas: GasSelection = { id: "trimix", name: "10/70", o2: 10, he: 70 };

    const result = calculateTopOffBlend(settingsPsi, inputs, topGas);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Hypoxic mix (<18% O2).");
  });

  test("Warning: High O2 risk", () => {
    const inputs = {
      startO2: 50,
      startHe: 0,
      startPressure: 1000,
      finalPressure: 3000,
      topGasId: "ean50"
    };
    const topGas: GasSelection = { id: "ean50", name: "EAN50", o2: 50, he: 0 };

    const result = calculateTopOffBlend(settingsPsi, inputs, topGas);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("High O2 - fire risk (>40% O2).");
  });

  test("BAR units support", () => {
    const inputs = {
      startO2: 21,
      startHe: 0,
      startPressure: 50, // bar
      finalPressure: 200, // bar
      topGasId: "air"
    };
    const topGas: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };

    const result = calculateTopOffBlend(settingsBar, inputs, topGas);

    expect(result.success).toBe(true);
    expect(result.finalO2).toBeCloseTo(21, 1);
    // addedPressure is in PSI internally
    // 150 bar * 14.5037738 = 2175.56 PSI
    expect(result.addedPressure).toBeCloseTo(150 * 14.5037738, 2);
  });

  test("No gas added (start pressure = final pressure)", () => {
    const inputs = {
      startO2: 32,
      startHe: 0,
      startPressure: 3000,
      finalPressure: 3000,
      topGasId: "air"
    };
    const topGas: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };

    const result = calculateTopOffBlend(settingsPsi, inputs, topGas);

    expect(result.success).toBe(true);
    expect(result.finalO2).toBe(32);
    expect(result.addedPressure).toBe(0);
  });
});

describe("calculateFillCostEstimate", () => {
  test("prices a precomputed real-gas volume instead of the pressure ratio", () => {
    const result = calculateFillCostEstimate(
      [
        { label: "Helium", gas: { id: "helium", name: "Helium", o2: 0, he: 100 }, pressurePsi: 1050, volumeCuFt: 25.3 },
        { label: "Oxygen", gas: oxygen, pressurePsi: 0, volumeCuFt: 6.7 },
        { label: "Air Top-Off", gas: air, pressurePsi: 1500, volumeCuFt: 0 }
      ],
      {
        tankSizeCuFt: 80,
        tankRatedPressure: 3000,
        pricePerCuFtO2: 1.0,
        pricePerCuFtHe: 3.5,
        pricePerCuFtTopOff: 0.1
      }
    );

    expect(result.lines.map((line) => line.label)).toEqual(["Helium", "Oxygen"]);
    expect(result.lines[0].volumeCuFt).toBeCloseTo(25.3, 9);
    expect(result.lines[0].volumeLiters).toBeCloseTo(cuFtToLiters(25.3), 9);
    expect(result.lines[0].cost).toBeCloseTo(88.55, 6);
    expect(result.lines[1].cost).toBeCloseTo(6.7, 6);
    expect(result.totalCost).toBeCloseTo(95.25, 6);
  });

  test("includes top-off gas pricing component", () => {
    const result = calculateFillCostEstimate(
      [
        { label: "Oxygen", gas: { id: "oxygen", name: "Oxygen", o2: 100, he: 0 }, pressurePsi: 300 },
        { label: "Air Top-Off", gas: { id: "air", name: "Air", o2: 21, he: 0 }, pressurePsi: 2700 }
      ],
      {
        tankSizeCuFt: 80,
        tankRatedPressure: 3000,
        pricePerCuFtO2: 1.0,
        pricePerCuFtHe: 3.5,
        pricePerCuFtTopOff: 0.1
      }
    );

    // Oxygen: (300/3000)*80 = 8 cuft @ $1.00
    // Air unit price: 0.21*$1.00 + 0.79*$0.10 = $0.289
    // Air top-off: (2700/3000)*80 = 72 cuft @ $0.289
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0].cost).toBeCloseTo(8, 3);
    expect(result.lines[0].volumeCuFt).toBeCloseTo(8, 3);
    expect(result.lines[0].volumeLiters).toBeCloseTo(226.535, 3);
    expect(result.lines[1].unitPrice).toBeCloseTo(0.289, 3);
    expect(result.totalCost).toBeCloseTo(28.808, 3);
  });

  test("uses Top-Off result pressure for a one-line fill estimate", () => {
    const topOff = calculateTopOffBlend(
      { pressureUnit: "psi" },
      {
        startO2: 32,
        startHe: 0,
        startPressure: 500,
        finalPressure: 3000,
        topGasId: "air"
      },
      air
    );

    expect(topOff.success).toBe(true);
    expect(topOff.addedPressure).toBeCloseTo(2500, 3);

    const estimate = calculateFillCostEstimate(
      [
        {
          label: "Air Top-Off",
          gas: air,
          pressurePsi: topOff.addedPressure
        }
      ],
      {
        tankSizeCuFt: 80,
        tankRatedPressure: 3000,
        pricePerCuFtO2: 1.0,
        pricePerCuFtHe: 3.5,
        pricePerCuFtTopOff: 0.1
      }
    );

    expect(estimate.lines).toHaveLength(1);
    expect(estimate.lines[0].volumeCuFt).toBeCloseTo(66.667, 3);
    expect(estimate.lines[0].volumeLiters).toBeCloseTo(1887.79, 2);
    expect(estimate.totalCost).toBeCloseTo(19.267, 3);
  });
});

describe("solveNGasBlend bank limits", () => {
  const settings = { pressureUnit: "psi" as const };
  const costSettings = {
    tankSizeCuFt: 80,
    tankRatedPressure: 3000,
    pricePerCuFtO2: 1,
    pricePerCuFtHe: 3.5,
    pricePerCuFtTopOff: 0.1
  };

  test("fails when required gas exceeds available bank pressure", () => {
    const result = solveNGasBlend(
      settings,
      3000,
      40,
      0,
      0,
      21,
      0,
      [
        { id: "oxygen", name: "Oxygen", o2: 100, he: 0, maxPressurePsi: 500 },
        { id: "air", name: "Air", o2: 21, he: 0 }
      ],
      costSettings
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("bank pressure limits");
  });

  test("succeeds when bank pressure limits are sufficient", () => {
    const result = solveNGasBlend(
      settings,
      3000,
      40,
      0,
      0,
      21,
      0,
      [
        { id: "oxygen", name: "Oxygen", o2: 100, he: 0, maxPressurePsi: 800 },
        { id: "air", name: "Air", o2: 21, he: 0 }
      ],
      costSettings
    );

    expect(result.success).toBe(true);
    expect(result.alternatives.length).toBeGreaterThan(0);
    const oxygenStep = result.alternatives[0].steps.find((step) => step.gas.id === "oxygen");
    expect(oxygenStep).toBeDefined();
    expect(oxygenStep?.amount).toBeLessThanOrEqual(800.01);
  });

  test("returns a viable simple air-fill alternative", () => {
    const result = solveNGasBlend(
      settings,
      3000,
      21,
      0,
      0,
      21,
      0,
      [{ id: "air", name: "Air", o2: 21, he: 0 }],
      costSettings
    );

    expect(result.success).toBe(true);
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.alternatives[0].finalO2).toBeCloseTo(21, 1);
    expect(result.alternatives[0].finalHe).toBeCloseTo(0, 1);
  });

  test("returns a closest-match alternative within tolerance when exact target is impossible", () => {
    const result = solveNGasBlend(
      settings,
      3000,
      25,
      25,
      0,
      21,
      0,
      [
        { id: "ean36", name: "EAN36", o2: 36, he: 0 },
        { id: "tmx1050", name: "10/50", o2: 10, he: 50 }
      ],
      costSettings
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Exact target cannot be made; showing closest blend within +/-1% O2 / +/-5% He.");

    const alternative = result.alternatives[0];
    expect(alternative).toBeDefined();
    if (!alternative) return;

    expect(alternative.finalO2).toBeCloseTo(25.6, 1);
    expect(alternative.finalHe).toBeCloseTo(20, 1);
    expect(Math.abs(alternative.deviationO2)).toBeLessThanOrEqual(1);
    expect(Math.abs(alternative.deviationHe)).toBeLessThanOrEqual(5);
    expect(alternative.steps.reduce((sum, step) => sum + step.amount, 0)).toBeCloseTo(3000, 1);
  });

  test("keeps closest-match fills at the target pressure", () => {
    const result = solveNGasBlend(
      settings,
      3000,
      18,
      45,
      0,
      21,
      0,
      [
        { id: "ean32", name: "32", o2: 32, he: 0 },
        { id: "tmx1070", name: "10/70", o2: 10, he: 70 }
      ],
      costSettings
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Exact target cannot be made; showing closest blend within +/-1% O2 / +/-5% He.");

    const alternative = result.alternatives[0];
    expect(alternative).toBeDefined();
    if (!alternative) return;

    expect(alternative.finalO2).toBeCloseTo(17.9, 1);
    expect(alternative.finalHe).toBeCloseTo(44.8, 1);
    expect(Math.abs(alternative.deviationO2)).toBeLessThanOrEqual(1);
    expect(Math.abs(alternative.deviationHe)).toBeLessThanOrEqual(5);
    expect(alternative.steps.reduce((sum, step) => sum + step.amount, 0)).toBeCloseTo(3000, 1);
  });

  test("rejects invalid target compositions", () => {
    const result = solveNGasBlend(
      settings,
      3000,
      60,
      60,
      0,
      21,
      0,
      [{ id: "air", name: "Air", o2: 21, he: 0 }],
      costSettings
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("100% or less");
  });
});

describe("solveNGasBlend bleed-down search", () => {
  const settings = { pressureUnit: "psi" as const };
  const costSettings = {
    tankSizeCuFt: 80,
    tankRatedPressure: 3000,
    pricePerCuFtO2: 1,
    pricePerCuFtHe: 3.5,
    pricePerCuFtTopOff: 0.1
  };
  const trimixSources = (airMaxPressurePsi?: number) => [
    { id: "oxygen", name: "Oxygen", o2: 100, he: 0 },
    { id: "helium", name: "Helium", o2: 0, he: 100 },
    { id: "air", name: "Air", o2: 21, he: 0, maxPressurePsi: airMaxPressurePsi }
  ];

  // 2000 psi of 10/70 into 21/35 at 3000 psi: He balance needs start <= 1500 psi,
  // and the Air cap needs start >= ~1465 psi (1300) or ~1485 psi (1295), so the
  // feasible start range excludes 0 and a plain bisection over [0, 2000] misses it.
  test.each([1300, 1295])("finds the bleed window that a %i psi Air cap leaves above 0", (airCap) => {
    const result = solveNGasBlend(settings, 3000, 21, 35, 2000, 10, 70, trimixSources(airCap), costSettings);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Bleed-down required to achieve target mix.");

    const alternative = result.alternatives[0];
    expect(alternative).toBeDefined();
    if (!alternative) return;

    expect(alternative.fillOrder[0].gas).toBe("Bleed Tank");
    expect(alternative.fillOrder[0].amount).toBeCloseTo(-500, 1);
    expect(alternative.costBreakdown[0].gas).toBe("Bleed to 1500 psi");
    expect(alternative.costBreakdown[0].amount).toBeCloseTo(500, 1);

    const airStep = alternative.steps.find((step) => step.gas.id === "air");
    expect(airStep?.amount).toBeLessThanOrEqual(airCap + 1e-6);
    expect(alternative.finalO2).toBeCloseTo(21, 2);
    expect(alternative.finalHe).toBeCloseTo(35, 2);

    const addedPressure = alternative.steps.reduce((sum, step) => sum + step.amount, 0);
    expect(2000 + alternative.fillOrder[0].amount + addedPressure).toBeCloseTo(3000, 1);
  });

  const cappedBanks = (caps: { oxygen?: number; helium?: number; air?: number; ean32?: number }) => [
    { id: "oxygen", name: "Oxygen", o2: 100, he: 0, maxPressurePsi: caps.oxygen },
    { id: "helium", name: "Helium", o2: 0, he: 100, maxPressurePsi: caps.helium },
    { id: "air", name: "Air", o2: 21, he: 0, maxPressurePsi: caps.air },
    { id: "ean32", name: "EAN32", o2: 32, he: 0, maxPressurePsi: caps.ean32 }
  ];
  // `mixDigits` is loose for 2-gas plans, which accept a 0.5 psi pressure residual.
  const expectBleedTo = (
    result: ReturnType<typeof solveNGasBlend>,
    startPsi: number,
    bleedToPsi: number,
    o2: number,
    he: number,
    mixDigits = 2
  ) => {
    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Bleed-down required to achieve target mix.");
    const alternative = result.alternatives[0];
    expect(alternative).toBeDefined();
    if (!alternative) return;
    expect(alternative.fillOrder[0].gas).toBe("Bleed Tank");
    expect(startPsi + alternative.fillOrder[0].amount).toBeCloseTo(bleedToPsi, 1);
    expect(alternative.finalO2).toBeCloseTo(o2, mixDigits);
    expect(alternative.finalHe).toBeCloseTo(he, mixDigits);
    const addedPressure = alternative.steps.reduce((sum, step) => sum + step.amount, 0);
    expect(Math.abs(startPsi + alternative.fillOrder[0].amount + addedPressure - 3000)).toBeLessThanOrEqual(0.5 + 1e-6);
  };

  test("finds a capped-bank bleed window narrower than 10 psi", () => {
    // Only starts of ~491-499 psi work; the old 10 psi scan stepped over them.
    const sources = cappedBanks({ oxygen: 1193, air: 1081, ean32: 381 });
    const result = solveNGasBlend(settings, 3000, 19, 44, 2188, 46, 51, sources, costSettings);

    expectBleedTo(result, 2188, 499.04, 19, 44);
    expect(result.alternatives[0]?.costBreakdown[0].gas).toBe("Bleed to 499 psi");
  });

  test("picks the higher of two nearby capped-bank bleed windows", () => {
    // Windows of ~1727.5-1836 psi and 1839-1848 psi; the old scan bled to 1836.
    const sources = cappedBanks({ oxygen: 1183, helium: 1180, air: 1928, ean32: 545 });
    const result = solveNGasBlend(settings, 3000, 38, 52, 2768, 62, 22, sources, costSettings);

    expectBleedTo(result, 2768, 1848, 38, 52, 0);
    expect(result.alternatives[0]?.costBreakdown[0].gas).toBe("Bleed to 1848 psi");
  });

  test("keeps the uncapped minimum bleed unchanged", () => {
    // Pinned from the bisection-only search before the scan was added.
    const result = solveNGasBlend(settings, 3000, 21, 35, 2500, 18, 45, trimixSources(), costSettings);

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(["Bleed-down required to achieve target mix."]);
    expect(result.alternatives).toHaveLength(1);

    const [alternative] = result.alternatives;
    expect(alternative.fillOrder.map((step) => step.gas)).toEqual(["Bleed Tank", "Oxygen", "Air"]);
    expect(alternative.fillOrder[0].amount).toBeCloseTo(-166.667, 2);
    expect(alternative.fillOrder[1].amount).toBeCloseTo(88.608, 2);
    expect(alternative.fillOrder[2].amount).toBeCloseTo(578.059, 2);
    expect(alternative.costBreakdown.map((line) => line.gas)).toEqual(["Bleed to 2333 psi", "Air", "Oxygen"]);
    expect(alternative.costBreakdown[0].cost).toBe(0);
    expect(alternative.estimatedCost).toBeCloseTo(6.8178, 3);
    expect(alternative.finalO2).toBeCloseTo(21, 2);
    expect(alternative.finalHe).toBeCloseTo(35, 2);
  });
});

describe("solveNGasBlend helium pairs with the same O2:He ratio", () => {
  const settings = { pressureUnit: "psi" as const };
  const costSettings = {
    tankSizeCuFt: 80,
    tankRatedPressure: 3000,
    pricePerCuFtO2: 1,
    pricePerCuFtHe: 3.5,
    pricePerCuFtTopOff: 0.1
  };
  const parallelBanks = [
    { id: "lean", name: "10/25", o2: 10, he: 25 },
    { id: "rich", name: "20/50", o2: 20, he: 50 }
  ];

  test("fills 15/37.5 from equal parts of 10/25 and 20/50", () => {
    const result = solveNGasBlend(settings, 3000, 15, 37.5, 0, 21, 0, parallelBanks, costSettings);

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual(["Hypoxic mix (<18% O2)."]);
    const [alternative] = result.alternatives;
    expect(alternative.steps.find((step) => step.gas.id === "lean")?.amount).toBeCloseTo(1500, 6);
    expect(alternative.steps.find((step) => step.gas.id === "rich")?.amount).toBeCloseTo(1500, 6);
    expect(alternative.finalO2).toBeCloseTo(15, 6);
    expect(alternative.finalHe).toBeCloseTo(37.5, 6);
  });

  test("bleeds an off-ratio start to the edge of the helium balance tolerance", () => {
    // Air is off the 10/25-20/50 line. The pair is solved on helium, which differs more, and only
    // starts up to 0.5 / 0.21 = 2.38 psi keep the O2 balance within 0.5 psi.
    const result = solveNGasBlend(settings, 3000, 15, 37.5, 2000, 21, 0, parallelBanks, costSettings);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("Bleed-down required to achieve target mix.");
    const [alternative] = result.alternatives;
    const bleedToPsi = 2000 + alternative.fillOrder[0].amount;
    expect(bleedToPsi).toBeCloseTo(0.5 / 0.21, 2);
    expect(alternative.finalO2).toBeCloseTo(15, 1);
    expect(alternative.finalHe).toBeCloseTo(37.5, 1);
  });
});

describe("generateBlendAlternatives deduplication", () => {
  const costSettings = {
    tankSizeCuFt: 80,
    tankRatedPressure: 3000,
    pricePerCuFtO2: 1,
    pricePerCuFtHe: 3.5,
    pricePerCuFtTopOff: 0.1
  };

  test("removes duplicate air/oxygen alternatives produced by the three-gas path", () => {
    const alternatives = generateBlendAlternatives(
      3000,
      32,
      0,
      0,
      21,
      0,
      [
        { id: "air", name: "Air", o2: 21, he: 0 },
        { id: "oxygen", name: "Oxygen", o2: 100, he: 0 },
        { id: "helium", name: "Helium", o2: 0, he: 100 }
      ],
      costSettings,
      10
    );

    expect(alternatives).toHaveLength(1);
    expect(alternatives[0].steps).toHaveLength(2);
    expect(alternatives[0].steps.map((step) => step.gas.id).sort()).toEqual(["air", "oxygen"]);
  });
});

describe("calculateEND", () => {
  test("Air at 30m (Oxygen not narcotic)", () => {
    // 30m = 4 ATA. Air is 79% N2.
    // END = (4 * 0.79 / 0.79 - 1) * 10 = 30m
    const result = calculateEND(21, 0, 30, "m", false);
    expect(result).toBeCloseTo(30, 1);
  });

  test("Air at 30m (Oxygen narcotic)", () => {
    // 30m = 4 ATA. Air is 100% narcotic, and so is the air reference.
    // END = (4 * 1.0 / 1.0 - 1) * 10 = 30m
    const result = calculateEND(21, 0, 30, "m", true);
    expect(result).toBeCloseTo(30, 6);
  });

  test.each([21, 32, 36, 50])("Nitrox %i at 30m has END equal to depth when oxygen is narcotic", (o2) => {
    expect(calculateEND(o2, 0, 30, "m", true)).toBeCloseTo(30, 6);
  });

  test("Trimix with oxygen narcotic matches (D + 33)(1 - He) - 33", () => {
    // 100ft = 4.0303 ATA; 21/35 narcotic fraction 0.65 => (4.0303 * 0.65 - 1) * 33 = 53.45ft
    expect(calculateEND(21, 35, 100, "ft", true)).toBeCloseTo(53.45, 2);
    // 200ft = 7.0606 ATA; 18/45 narcotic fraction 0.55 => (7.0606 * 0.55 - 1) * 33 = 95.15ft
    expect(calculateEND(18, 45, 200, "ft", true)).toBeCloseTo(95.15, 2);
    // 60m = 7 ATA; 21/35 => (7 * 0.65 - 1) * 10 = 35.5m
    expect(calculateEND(21, 35, 60, "m", true)).toBeCloseTo(35.5, 6);
  });

  test("Trimix 21/35 at 100ft (Oxygen not narcotic) is unchanged", () => {
    // (4.0303 * 0.44 / 0.79 - 1) * 33 = 41.08ft
    expect(calculateEND(21, 35, 100, "ft", false)).toBeCloseTo(41.08, 2);
  });

  test("Trimix 21/35 at 60m (Oxygen not narcotic)", () => {
    // 60m = 7 ATA. N2 = 44%.
    // END = (7 * 0.44 / 0.79 - 1) * 10 = 28.99m
    const result = calculateEND(21, 35, 60, "m", false);
    expect(result).toBeCloseTo(28.99, 2);
  });

  test("Trimix 21/35 at 200ft (Oxygen not narcotic)", () => {
    // 200ft = 7.06 ATA. N2 = 44%.
    // END = (7.06 * 0.44 / 0.79 - 1) * 33 = 96.77ft
    const result = calculateEND(21, 35, 200, "ft", false);
    expect(result).toBeCloseTo(96.77, 2);
  });

  test("Surface air (0m)", () => {
    const result = calculateEND(21, 0, 0, "m", false);
    expect(result).toBe(0);
  });

  test("Negative depth returns 0", () => {
    const result = calculateEND(21, 0, -10, "m", false);
    expect(result).toBe(0);
  });

  test("Pure Helium at depth returns 0 (hypothetical)", () => {
    // 0% N2, 0% O2, 100% He.
    // Narcotic fraction = 0.
    // END = (ambient * 0 / 0.79 - 1) * 10 = -10 => 0
    const result = calculateEND(0, 100, 50, "m", false);
    expect(result).toBe(0);
  });
});

describe("calculateDensity", () => {
  test("Air at surface (0m)", () => {
    // 1 ATA
    // Density: 0.21 * 1.429 + 0.79 * 1.2506 = 1.288064
    const result = calculateDensity(21, 0, 0, "m");
    expect(result).toBeCloseTo(1.288, 3);
  });

  test("Air at 10m depth", () => {
    // 2 ATA
    // Density: 1.288064 * 2 = 2.576128
    const result = calculateDensity(21, 0, 10, "m");
    expect(result).toBeCloseTo(2.576, 3);
  });

  test("Air at 33ft depth", () => {
    // 2 ATA
    // Density: 1.288064 * 2 = 2.576128
    const result = calculateDensity(21, 0, 33, "ft");
    expect(result).toBeCloseTo(2.576, 3);
  });

  test("Pure Oxygen at surface", () => {
    const result = calculateDensity(100, 0, 0, "m");
    expect(result).toBeCloseTo(1.429, 3);
  });

  test("Pure Helium at surface", () => {
    const result = calculateDensity(0, 100, 0, "m");
    expect(result).toBeCloseTo(0.1785, 4);
  });

  test("Trimix 18/45 at 60m", () => {
    // Surface density: 0.18 * 1.429 + 0.45 * 0.1785 + 0.37 * 1.2506 = 0.800267
    // 60m = 7 ATA
    // 0.800267 * 7 = 5.601869
    const result = calculateDensity(18, 45, 60, "m");
    expect(result).toBeCloseTo(5.602, 3);
  });
});

describe("listTopOffOptions", () => {
  const helium: GasSelection = { id: "helium", name: "Helium", o2: 0, he: 100 };

  test("returns only the default gases when no custom gases are provided", () => {
    expect(listTopOffOptions([])).toEqual([air, oxygen, helium]);
  });

  test("appends custom gases after the defaults in their saved order", () => {
    const customGases: GasDefinition[] = [
      { id: "ean32", name: "EAN32", o2: 32, he: 0 },
      { id: "trimix-21-35", name: "21/35", o2: 21, he: 35 }
    ];

    expect(listTopOffOptions(customGases)).toEqual([
      air,
      oxygen,
      helium,
      { id: "ean32", name: "EAN32", o2: 32, he: 0 },
      { id: "trimix-21-35", name: "21/35", o2: 21, he: 35 }
    ]);
  });

  test("returns copies so callers cannot mutate saved custom gases", () => {
    const customGas: GasDefinition = { id: "ean36", name: "EAN36", o2: 36, he: 0 };
    const options = listTopOffOptions([customGas]);

    expect(options[3]).toEqual(customGas);
    expect(options[3]).not.toBe(customGas);
  });
});

describe("generateBlendAlternatives deduplication", () => {
  const air = { id: "air", name: "Air", o2: 21, he: 0 };
  const oxygen = { id: "oxygen", name: "Oxygen", o2: 100, he: 0 };
  const helium = { id: "helium", name: "Helium", o2: 0, he: 100 };
  const costSettings = {
    tankSizeCuFt: 80,
    tankRatedPressure: 3000,
    pricePerCuFtO2: 1,
    pricePerCuFtHe: 3.5,
    pricePerCuFtTopOff: 0.1
  };

  test("removes duplicate air/oxygen alternatives produced by the three-gas path", () => {
    const alternatives = generateBlendAlternatives(
      3000,
      32,
      0,
      0,
      21,
      0,
      [oxygen, helium, air],
      costSettings,
      10
    );

    expect(alternatives).toHaveLength(1);
    expect(alternatives[0].steps).toHaveLength(2);
    expect(alternatives[0].steps.map((step) => step.gas.id).sort()).toEqual(["air", "oxygen"]);
  });
});

describe("calculateEAD", () => {
  test("Air at 30m (Expected: 30m)", () => {
    // 30m = 4 ATA. Air is 79% N2.
    // EAD = (4 * 0.79 / 0.79 - 1) * 10 = 30m
    const result = calculateEAD(21, 30, "m");
    expect(result).toBeCloseTo(30, 1);
  });

  test("Nitrox 32% at 30m (Expected: ~24.43m)", () => {
    // 30m = 4 ATA. N2 = 68%.
    // EAD = (4 * 0.68 / 0.79 - 1) * 10 = 24.43m
    const result = calculateEAD(32, 30, "m");
    expect(result).toBeCloseTo(24.43, 2);
  });

  test("Nitrox 36% at 30m (Expected: ~22.41m)", () => {
    // 30m = 4 ATA. N2 = 64%.
    // EAD = (4 * 0.64 / 0.79 - 1) * 10 = 22.41m
    const result = calculateEAD(36, 30, "m");
    expect(result).toBeCloseTo(22.41, 2);
  });

  test("Imperial: Nitrox 32% at 100ft (Expected: ~81.48ft)", () => {
    // 100ft = 4.03 ATA. N2 = 68%.
    // EAD = (4.03 * 0.68 / 0.79 - 1) * 33 = 81.48ft
    const result = calculateEAD(32, 100, "ft");
    expect(result).toBeCloseTo(81.48, 2);
  });

  test("100% Oxygen at 10m (Expected: 0m)", () => {
    // 10m = 2 ATA. N2 = 0%.
    // EAD = (2 * 0 / 0.79 - 1) * 10 = -10 => 0 (clamped)
    const result = calculateEAD(100, 10, "m");
    expect(result).toBe(0);
  });

  test("0% Oxygen (Pure N2/He) at 30m (Expected: ~40.63m)", () => {
    // 30m = 4 ATA. N2 = 100%.
    // EAD = (4 * 1.0 / 0.79 - 1) * 10 = 40.63m
    const result = calculateEAD(0, 30, "m");
    expect(result).toBeCloseTo(40.63, 2);
  });

  test("Surface air (0m) (Expected: 0m)", () => {
    const result = calculateEAD(21, 0, "m");
    expect(result).toBe(0);
  });

  test("Negative depth returns 0", () => {
    const result = calculateEAD(21, -10, "m");
    expect(result).toBe(0);
  });
});

describe("getRecommendedFillOrder", () => {
  const pureHe = { id: "he", name: "Helium", o2: 0, he: 100 };
  const pureO2 = { id: "o2", name: "Oxygen", o2: 100, he: 0 };
  const ean32 = { id: "ean32", name: "EAN32", o2: 32, he: 0 };
  const trimix21_35 = { id: "tx2135", name: "21/35", o2: 21, he: 35 };
  const trimix18_45 = { id: "tx1845", name: "18/45", o2: 18, he: 45 };
  const air = { id: "air", name: "Air", o2: 21, he: 0 };

  test("sorts pure Helium first", () => {
    const steps = [
      { gas: pureO2, amount: 100 },
      { gas: pureHe, amount: 100 },
      { gas: air, amount: 100 }
    ];
    const result = getRecommendedFillOrder(steps);
    expect(result[0].gas).toBe("Helium");
  });

  test("sorts pure Oxygen after pure Helium", () => {
    const steps = [
      { gas: air, amount: 100 },
      { gas: pureO2, amount: 100 },
      { gas: pureHe, amount: 100 }
    ];
    const result = getRecommendedFillOrder(steps);
    expect(result[0].gas).toBe("Helium");
    expect(result[1].gas).toBe("Oxygen");
    expect(result[2].gas).toBe("Air");
  });

  test("sorts by Helium content descending", () => {
    const steps = [
      { gas: trimix21_35, amount: 100 },
      { gas: trimix18_45, amount: 100 },
      { gas: air, amount: 100 }
    ];
    const result = getRecommendedFillOrder(steps);
    // 18/45 has more He than 21/35
    expect(result[0].gas).toBe("18/45");
    expect(result[1].gas).toBe("21/35");
    expect(result[2].gas).toBe("Air");
  });

  test("sorts by Oxygen content descending when Helium content is equal", () => {
    const steps = [
      { gas: air, amount: 100 },
      { gas: ean32, amount: 100 }
    ];
    const result = getRecommendedFillOrder(steps);
    // Both have 0 He, but EAN32 has more O2
    expect(result[0].gas).toBe("EAN32");
    expect(result[1].gas).toBe("Air");
  });

  test("filters out steps with negligible amounts", () => {
    const steps = [
      { gas: pureHe, amount: 100 },
      { gas: pureO2, amount: 0.0000001 }, // 1e-7, below tolerance 1e-6
      { gas: air, amount: 100 }
    ];
    const result = getRecommendedFillOrder(steps);
    expect(result).toHaveLength(2);
    expect(result.map(r => r.gas)).toEqual(["Helium", "Air"]);
  });

  test("complex mix: pure He, high He, low He, pure O2, Air", () => {
    const steps = [
      { gas: air, amount: 100 },
      { gas: trimix21_35, amount: 100 },
      { gas: pureO2, amount: 100 },
      { gas: trimix18_45, amount: 100 },
      { gas: pureHe, amount: 100 }
    ];
    // Expected: He (100 He), O2 (100 O2), 18/45 (45 He), 21/35 (35 He), Air (21 O2, 0 He)
    const result = getRecommendedFillOrder(steps);
    expect(result.map(r => r.gas)).toEqual([
      "Helium",
      "Oxygen",
      "18/45",
      "21/35",
      "Air"
    ]);
  });

  test("handles empty input", () => {
    const result = getRecommendedFillOrder([]);
    expect(result).toEqual([]);
  });
});

describe("summarizeBlendVolumes", () => {
  test("returns zeroed summary if result is unsuccessful", () => {
    const result: BlendResult = {
      success: false,
      steps: [
        { kind: "helium", amount: 100, gasName: "Helium" },
        { kind: "oxygen", amount: 50, gasName: "Oxygen" },
        { kind: "topoff", amount: 200, gasName: "Air" }
      ],
      warnings: [],
      errors: ["Something went wrong"]
    };

    const summary = summarizeBlendVolumes(result);

    expect(summary.helium).toBe(0);
    expect(summary.oxygen).toBe(0);
    expect(summary.topoff).toBe(0);
  });

  test("returns zeroed summary if result has no steps", () => {
    const result: BlendResult = {
      success: true,
      steps: [],
      warnings: [],
      errors: []
    };

    const summary = summarizeBlendVolumes(result);

    expect(summary.helium).toBe(0);
    expect(summary.oxygen).toBe(0);
    expect(summary.topoff).toBe(0);
  });

  test("correctly sums volumes for helium, oxygen, and topoff steps", () => {
    const result: BlendResult = {
      success: true,
      steps: [
        { kind: "helium", amount: 100, gasName: "Helium" },
        { kind: "oxygen", amount: 50, gasName: "Oxygen" },
        { kind: "topoff", amount: 200, gasName: "Air" }
      ],
      warnings: [],
      errors: []
    };

    const summary = summarizeBlendVolumes(result);

    expect(summary.helium).toBe(100);
    expect(summary.oxygen).toBe(50);
    expect(summary.topoff).toBe(200);
  });

  test("ignores bleed steps", () => {
    const result: BlendResult = {
      success: true,
      steps: [
        { kind: "bleed", amount: 500, gasName: "Bleed" },
        { kind: "helium", amount: 100, gasName: "Helium" },
        { kind: "topoff", amount: 200, gasName: "Air" }
      ],
      warnings: [],
      errors: []
    };

    const summary = summarizeBlendVolumes(result);

    expect(summary.helium).toBe(100);
    expect(summary.oxygen).toBe(0);
    expect(summary.topoff).toBe(200);
  });

  test("handles multiple steps of the same kind by summing them", () => {
    const result: BlendResult = {
      success: true,
      steps: [
        { kind: "helium", amount: 100, gasName: "Helium" },
        { kind: "helium", amount: 50, gasName: "Helium" },
        { kind: "oxygen", amount: 30, gasName: "Oxygen" },
        { kind: "oxygen", amount: 20, gasName: "Oxygen" },
        { kind: "topoff", amount: 100, gasName: "Air" },
        { kind: "topoff", amount: 150, gasName: "EAN32" }
      ],
      warnings: [],
      errors: []
    };

    const summary = summarizeBlendVolumes(result);

    expect(summary.helium).toBe(150);
    expect(summary.oxygen).toBe(50);
    expect(summary.topoff).toBe(250);
  });
});

describe("Multi-Gas fill order modes", () => {
  const pureHe = { id: "he-0", name: "Helium", o2: 0, he: 100 };
  const pureO2 = { id: "o2-1", name: "Oxygen", o2: 100, he: 0 };
  const airSource = { id: "air-2", name: "Air", o2: 21, he: 0 };
  const steps = [
    { gas: airSource, amount: 1700 },
    { gas: pureO2, amount: 250 },
    { gas: pureHe, amount: 1050 },
    { gas: { id: "ean32-3", name: "EAN32", o2: 32, he: 0 }, amount: 0 }
  ];

  test("auto order matches the recommended fill order and drops zero amounts", () => {
    const ordered = orderBlendStepsForFill(steps, "auto", []);
    expect(ordered.map((step) => ({ gas: step.gas.name, amount: step.amount }))).toEqual(getRecommendedFillOrder(steps));
  });

  test("manual order follows the source list and leaves unknown ids last", () => {
    const ordered = orderBlendStepsForFill(steps, "manual", ["air-2", "he-0"]);
    expect(ordered.map((step) => step.gas.name)).toEqual(["Air", "Helium", "Oxygen"]);
    expect(ordered.map((step) => step.amount)).toEqual([1700, 1050, 250]);
  });

  test("applyFillOrderToAlternative returns the same alternative in auto mode", () => {
    const alternative: BlendAlternative = {
      steps,
      finalO2: 21,
      finalHe: 35,
      deviationO2: 0,
      deviationHe: 0,
      estimatedCost: 10,
      costBreakdown: [],
      fillOrder: [{ gas: "Bleed Tank", amount: -500 }, ...getRecommendedFillOrder(steps)]
    };
    expect(applyFillOrderToAlternative(alternative, "auto", ["air-2"])).toBe(alternative);
  });

  test("manual mode keeps the bleed step first and the amounts unchanged", () => {
    const alternative: BlendAlternative = {
      steps,
      finalO2: 21,
      finalHe: 35,
      deviationO2: 0,
      deviationHe: 0,
      estimatedCost: 10,
      costBreakdown: [],
      fillOrder: [{ gas: "Bleed Tank", amount: -500 }, ...getRecommendedFillOrder(steps)]
    };
    const reordered = applyFillOrderToAlternative(alternative, "manual", ["o2-1", "air-2", "he-0"]);
    expect(reordered.fillOrder).toEqual([
      { gas: "Bleed Tank", amount: -500 },
      { gas: "Oxygen", amount: 250 },
      { gas: "Air", amount: 1700 },
      { gas: "Helium", amount: 1050 }
    ]);
    expect(reordered.steps).toBe(alternative.steps);
    expect(alternative.fillOrder[1]).toEqual({ gas: "Helium", amount: 1050 });
  });
});
