import { expect, test, describe } from "bun:test";
import { calculateTopOffBlend, calculateEAD } from "./calculations";
import type { GasSelection, TopOffResult } from "./calculations";

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

describe("calculateEAD", () => {
  test("Air (21% O2) at 60ft", () => {
    // Air should have an EAD exactly equal to depth
    const result = calculateEAD(21, 60, "ft");
    expect(result).toBeCloseTo(60, 1);
  });

  test("EAN32 (32% O2) at 100ft", () => {
    // Should be shallower than actual depth
    // ~81.5ft
    const result = calculateEAD(32, 100, "ft");
    expect(result).toBeLessThan(100);
    expect(result).toBeCloseTo(81.5, 1);
  });

  test("EAN36 (36% O2) at 30m", () => {
    // Metric check
    // Ambient = 30/10 + 1 = 4 ATA
    // N2 fraction = 0.64
    // EAD = (4 * 0.64 / 0.79 - 1) * 10
    // = (3.24 - 1) * 10 = 22.4m
    const result = calculateEAD(36, 30, "m");
    expect(result).toBeLessThan(30);
    expect(result).toBeCloseTo(22.4, 1);
  });

  test("100% O2 at 20ft", () => {
    // Pure O2 has no nitrogen, so EAD calculation yields negative, clamped to 0
    // (ambient * 0 / 0.79 - 1) -> negative
    const result = calculateEAD(100, 20, "ft");
    expect(result).toBe(0);
  });

  test("Surface (0 depth)", () => {
    // At surface, ambient = 1 ATA.
    // Air: (1 * 0.79 / 0.79 - 1) = 0.
    const result = calculateEAD(21, 0, "ft");
    expect(result).toBe(0);
  });

  test("Hypoxic Mix (10% O2) at 100ft", () => {
    // Should be deeper than actual depth because N2 fraction (0.90) > 0.79
    // Ambient = 4.03 ATA
    // EAD = (4.03 * 0.90 / 0.79 - 1) * 33
    // = (4.59 - 1) * 33 = 118.5 ft
    const result = calculateEAD(10, 100, "ft");
    expect(result).toBeGreaterThan(100);
    expect(result).toBeCloseTo(118.5, 1);
  });
});
