import { expect, test, describe } from "bun:test";
import {
  calculateTopOffBlend,
  calculateBestMix,
  calculateStandardBlend,
  calculateGasCost,
  calculateFillCostEstimate,
  solveNGasBlend
} from "./calculations";
import type { GasSelection, TopOffResult } from "./calculations";
import type { StandardBlendInput } from "../state/session";

const air: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };
const oxygen: GasSelection = { id: "oxygen", name: "Oxygen", o2: 100, he: 0 };
const helium: GasSelection = { id: "helium", name: "Helium", o2: 0, he: 100 };

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
    const result = calculateBestMix(30, 1.4, 30, "m");
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
    const result = calculateBestMix(60, 1.4, 30, "m");
    expect(result.o2).toBeCloseTo(20, 1);
    expect(result.he).toBeCloseTo(34.9, 1);
  });

  test("Imperial Units: Depth 100ft, PPO2 1.4, END 100ft", () => {
    // 100ft ~ 4 ATA
    // O2 ~ 1.4 / 4 = 35%
    // END 100ft = Depth => N2 can be max
    // He should be 0
    const result = calculateBestMix(100, 1.4, 100, "ft");
    expect(result.o2).toBeCloseTo(34.7, 1);
    expect(result.he).toBeCloseTo(0, 1);
  });

  test("High END tolerance: Depth 60m, PPO2 1.4, END 60m", () => {
    // 60m = 7 ATA. Target PPO2 1.4 => 20% O2.
    // Air has 79% N2. END=Depth means we accept Air's N2 loading (79%).
    // Remaining space: 100 - 20 = 80%.
    // Allowed N2: 79%.
    // So we must use 1% He to avoid exceeding Air's N2 partial pressure.
    const result = calculateBestMix(60, 1.4, 60, "m");
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
    const result = calculateBestMix(30, 1.4, 10, "m");
    expect(result.o2).toBeCloseTo(35, 1);
    expect(result.he).toBeCloseTo(25.5, 1);
  });

  test("100% O2 Cap: Shallow depth", () => {
    // Depth 0m = 1 ATA
    // Target PPO2 1.4
    // Calc O2 = 1.4 / 1 = 140% => cap at 100%
    const result = calculateBestMix(0, 1.4, 30, "m");
    expect(result.o2).toBe(100);
    expect(result.he).toBe(0);
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
    expect(result.lines[1].unitPrice).toBeCloseTo(0.289, 3);
    expect(result.totalCost).toBeCloseTo(28.808, 3);
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
});
