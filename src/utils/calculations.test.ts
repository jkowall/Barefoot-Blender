import { expect, test, describe } from "bun:test";
import { calculateTopOffBlend, calculateBestMix } from "./calculations";
import type { GasSelection, TopOffResult } from "./calculations";

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
