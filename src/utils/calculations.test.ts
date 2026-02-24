import { expect, test, describe } from "bun:test";
import { calculateTopOffBlend, calculateGasCost } from "./calculations";
import type { GasSelection, TopOffResult } from "./calculations";

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
