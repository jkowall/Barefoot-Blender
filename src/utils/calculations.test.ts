import { expect, test, describe } from "bun:test";
import { calculateTopOffBlend, calculateMOD } from "./calculations";
import type { GasSelection, TopOffResult } from "./calculations";

describe("calculateMOD", () => {
  test("Standard Air (21%) at 1.4/1.6 ppO2 (Imperial)", () => {
    const result = calculateMOD(21, 1.4, 1.6, "ft");
    // MOD: (1.4 / 0.21 - 1) * 33 = (20/3 - 1) * 33 = 17/3 * 33 = 187
    expect(result.mod).toBeCloseTo(187, 1);
    // Contingency: (1.6 / 0.21 - 1) * 33 = (160/21 - 1) * 33 = 139/21 * 33 = 139 * 11 / 7 ≈ 218.43
    expect(result.contingency).toBeCloseTo(218.43, 1);
  });

  test("Standard Air (21%) at 1.4/1.6 ppO2 (Metric)", () => {
    const result = calculateMOD(21, 1.4, 1.6, "m");
    // MOD: (1.4 / 0.21 - 1) * 10 ≈ 56.67
    expect(result.mod).toBeCloseTo(56.67, 1);
    // Contingency: (1.6 / 0.21 - 1) * 10 ≈ 66.19
    expect(result.contingency).toBeCloseTo(66.19, 1);
  });

  test("Pure Oxygen (100%) at 1.6 ppO2 (Imperial)", () => {
    const result = calculateMOD(100, 1.6, 1.6, "ft");
    // MOD: (1.6 / 1.0 - 1) * 33 = 0.6 * 33 = 19.8
    expect(result.mod).toBeCloseTo(19.8, 1);
    expect(result.contingency).toBeCloseTo(19.8, 1);
  });

  test("Pure Oxygen (100%) at 1.6 ppO2 (Metric)", () => {
    const result = calculateMOD(100, 1.6, 1.6, "m");
    // MOD: (1.6 / 1.0 - 1) * 10 = 6
    expect(result.mod).toBeCloseTo(6, 1);
  });

  test("Hypoxic Trimix (10%) at 1.2/1.4 ppO2 (Imperial)", () => {
    const result = calculateMOD(10, 1.2, 1.4, "ft");
    // MOD: (1.2 / 0.10 - 1) * 33 = 11 * 33 = 363
    expect(result.mod).toBeCloseTo(363, 1);
    // Contingency: (1.4 / 0.10 - 1) * 33 = 13 * 33 = 429
    expect(result.contingency).toBeCloseTo(429, 1);
  });

  test("0% O2 returns 0 depth", () => {
    const result = calculateMOD(0, 1.4, 1.6, "ft");
    expect(result.mod).toBe(0);
    expect(result.contingency).toBe(0);
  });

  test("Negative O2 returns 0 depth", () => {
    const result = calculateMOD(-10, 1.4, 1.6, "ft");
    expect(result.mod).toBe(0);
    expect(result.contingency).toBe(0);
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
