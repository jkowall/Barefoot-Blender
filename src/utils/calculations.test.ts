import { expect, test, describe } from "bun:test";
import {
  calculateTopOffBlend,
  rankGasesByCost,
  calculateBestMix,
  calculateStandardBlend,
  calculateGasCost
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
    const oxygenStep = result.steps.find(s => s.kind === "oxygen");
    const topoffStep = result.steps.find(s => s.kind === "topoff");

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
      targetO2: 21,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      topGasId: "air"
    };

    const result = calculateStandardBlend(settingsPsi, inputs, air);

    expect(result.success).toBe(true);
    const bleedStep = result.steps.find(s => s.kind === "bleed");
    expect(bleedStep).toBeDefined();
    expect(bleedStep?.amount).toBeCloseTo(1000, 1);
  });

  test("Bleed Required: Composition requires drain", () => {
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
    expect(bleedStep?.amount).toBeCloseTo(2000, 1);

    const topStep = result.steps.find(s => s.kind === "topoff");
    expect(topStep).toBeDefined();
    expect(topStep?.amount).toBeCloseTo(3000, 1);
  });

  test("Impossible Target: O2 + He > 100%", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 80,
      targetHe: 30,
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
      targetHe: 30,
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
    expect(o2Step?.amount).toBeCloseTo(expectedPsi, 0);
  });
});

describe("calculateGasCost", () => {
  test("Happy path: Standard inputs", () => {
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
    expect(result.oxygenCuFt).toBeCloseTo(20, 3);
    expect(result.heliumCuFt).toBe(0);
    expect(result.oxygenCost).toBeCloseTo(20 * 0.3, 3);
    expect(result.heliumCost).toBe(0);
    expect(result.totalCost).toBeCloseTo(6, 3);
  });
});

describe("calculateBestMix", () => {
  test("Standard Nitrox: Depth 30m, PPO2 1.4, END 30m", () => {
    const result = calculateBestMix(30, 1.4, 30, "m");
    expect(result.o2).toBeCloseTo(35, 1);
    expect(result.he).toBeCloseTo(0, 1);
  });

  test("Deep Trimix: Depth 60m, PPO2 1.4, END 30m", () => {
    const result = calculateBestMix(60, 1.4, 30, "m");
    expect(result.o2).toBeCloseTo(20, 1);
    expect(result.he).toBeCloseTo(34.9, 1);
  });

  test("Imperial Units: Depth 100ft, PPO2 1.4, END 100ft", () => {
    const result = calculateBestMix(100, 1.4, 100, "ft");
    expect(result.o2).toBeCloseTo(34.7, 1);
    expect(result.he).toBeCloseTo(0, 1);
  });

  test("High END tolerance: Depth 60m, PPO2 1.4, END 60m", () => {
    const result = calculateBestMix(60, 1.4, 60, "m");
    expect(result.o2).toBeCloseTo(20, 1);
    expect(result.he).toBeCloseTo(1, 1);
  });

  test("Low END tolerance: Depth 30m, PPO2 1.4, END 10m", () => {
    const result = calculateBestMix(30, 1.4, 10, "m");
    expect(result.o2).toBeCloseTo(35, 1);
    expect(result.he).toBeCloseTo(25.5, 1);
  });

  test("100% O2 Cap: Shallow depth", () => {
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

describe("rankGasesByCost", () => {
  const costSettings = {
    pricePerCuFtO2: 0.5,
    pricePerCuFtHe: 2.0,
    tankSizeCuFt: 80,
    tankRatedPressure: 3000,
  };

  test("Sorts gases by cost (cheapest first)", () => {
    const gases: GasSelection[] = [
      { id: "g1", name: "Expensive (He)", o2: 10, he: 50 },
      { id: "g2", name: "Cheap (Air)", o2: 21, he: 0 },
      { id: "g3", name: "Medium (Nitrox)", o2: 32, he: 0 },
    ];

    const sorted = rankGasesByCost(gases, costSettings);

    expect(sorted[0].id).toBe("g2");
    expect(sorted[1].id).toBe("g3");
    expect(sorted[2].id).toBe("g1");
  });

  test("Sorts gases by cost with custom reference pressure", () => {
    const gases: GasSelection[] = [
      { id: "g1", name: "Expensive (He)", o2: 10, he: 50 },
      { id: "g2", name: "Cheap (Air)", o2: 21, he: 0 },
      { id: "g3", name: "Medium (Nitrox)", o2: 32, he: 0 },
    ];

    // Using a large reference pressure shouldn't change the order for linear costs
    const sorted = rankGasesByCost(gases, costSettings, 5000);

    expect(sorted[0].id).toBe("g2");
    expect(sorted[1].id).toBe("g3");
    expect(sorted[2].id).toBe("g1");
  });
});
