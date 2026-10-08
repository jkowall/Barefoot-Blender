import { describe, expect, test } from "vitest";
import { calculateFillCostEstimate, solveTopOffBleedForTargetPercent, type GasSelection } from "../utils/calculations";
import {
  buildTopOffFillCostPlan,
  calculateTopOffBleedPreview,
  calculateTopOffForModel,
  copyTopOffResultToStartInput,
  defaultTopOffResultTemperatureState,
  defaultTopOffStartTemperatureState,
  resolveTopOffResultTemperatureF,
  resolveTopOffSelectedGas,
  resolveTopOffStartMix,
  resolveTopOffStartPressurePsi,
  resolveTopOffStartTemperatureF,
  syncTopOffInputSelectedGas,
  updateTopOffInputField,
  updateTopOffStartTemperatureState,
  updateTopOffResultTemperatureState
} from "./TopOffTab";
import type { TopOffInput } from "../state/session";
import { toDisplayPressure } from "../utils/units";

const topOffOptions = [
  { id: "air", name: "Air", o2: 21, he: 0 },
  { id: "oxygen", name: "Oxygen", o2: 100, he: 0 }
];

describe("calculateTopOffForModel", () => {
  const input = {
    startO2: 18,
    startHe: 45,
    startPressure: 1000,
    finalPressure: 3000,
    tankSizeCuFt: 80,
    tankRatedPressurePsi: 3000,
    startTemperatureF: 70,
    resultTemperatureF: 70,
    topGasId: "air"
  };

  test("uses GERG-2008 for a bleed preview when GERG mode is selected", () => {
    const preview = calculateTopOffBleedPreview(
      {
        pressureUnit: "psi",
        gasModel: "gerg2008",
        defaultTankSizeCuFt: 80,
        tankRatedPressure: 3000
      },
      input,
      topOffOptions[0],
      500
    );
    const idealPreview = calculateTopOffBleedPreview(
      {
        pressureUnit: "psi",
        gasModel: "ideal",
        defaultTankSizeCuFt: 80,
        tankRatedPressure: 3000
      },
      input,
      topOffOptions[0],
      500
    );

    expect(preview.success).toBe(true);
    expect(preview.model).toBe("gerg2008");
    expect(idealPreview.model).toBe("ideal");
    expect(preview.finalHe).not.toBeCloseTo(idealPreview.finalHe, 5);
    if (preview.model === "gerg2008") {
      expect(preview.topOffMoles).toBeGreaterThan(0);
    }
  });

  test("keeps the 1 atm residual when the GERG bleed preview drains to 0 PSI", () => {
    const settings = {
      pressureUnit: "psi" as const,
      gasModel: "gerg2008" as const,
      defaultTankSizeCuFt: 80,
      tankRatedPressure: 3000
    };
    const fullBleed = calculateTopOffBleedPreview(settings, input, topOffOptions[0], 0);
    const nearlyFullBleed = calculateTopOffBleedPreview(settings, input, topOffOptions[0], 0.01);

    expect(fullBleed.success).toBe(true);
    expect(fullBleed.model).toBe("gerg2008");
    // 1 atm of the 18/45 residual stays in the cylinder, so the air top-off carries trace helium.
    expect(fullBleed.finalHe).toBeGreaterThan(0.2);
    expect(Math.abs(nearlyFullBleed.finalHe - fullBleed.finalHe)).toBeLessThan(1e-3);
  });

  test("reports a GERG temperature error instead of falling back to ideal math", () => {
    const result = calculateTopOffForModel(
      {
        pressureUnit: "psi",
        gasModel: "gerg2008",
        defaultTankSizeCuFt: 80,
        tankRatedPressure: 3000
      },
      {
        ...input,
        startTemperatureF: undefined,
        startTemperatureTouched: true
      },
      topOffOptions[0]
    );

    expect(result.model).toBe("gerg2008");
    expect(result.success).toBe(false);
    expect(result.errors).toContain("Start temperature is required for GERG-2008 top-off correction.");
  });

  test("preserves warnings from the GERG bleed-preview calculation", () => {
    const result = calculateTopOffBleedPreview(
      {
        pressureUnit: "psi",
        gasModel: "gerg2008",
        defaultTankSizeCuFt: 80,
        tankRatedPressure: 3000
      },
      {
        ...input,
        startTemperatureF: 300,
        resultTemperatureF: 300
      },
      topOffOptions[0],
      500
    );

    expect(result.model).toBe("gerg2008");
    expect(result.success).toBe(true);
    expect(result.warnings).toContain(
      "GERG-2008 correction is outside the normal scuba fill temperature range above 400 K."
    );
  });
});

describe("resolveTopOffStartTemperatureF", () => {
  test("defaults start temperature before user edit", () => {
    expect(resolveTopOffStartTemperatureF({})).toBe(70);
    expect(resolveTopOffStartTemperatureF({ startTemperatureF: 80 })).toBe(80);
  });

  test("keeps touched blank start temperature blank", () => {
    expect(resolveTopOffStartTemperatureF({ startTemperatureTouched: true })).toBeUndefined();
  });
});

describe("resolveTopOffResultTemperatureF", () => {
  test("defaults result temperature to start temperature before user edit", () => {
    expect(resolveTopOffResultTemperatureF({}, 70)).toBe(70);
    expect(resolveTopOffResultTemperatureF({ resultTemperatureF: 90 }, 70)).toBe(70);
  });

  test("uses touched result temperature after user edit", () => {
    expect(resolveTopOffResultTemperatureF({ resultTemperatureF: 90, resultTemperatureTouched: true }, 70)).toBe(90);
  });

  test("keeps touched blank result temperature blank", () => {
    expect(resolveTopOffResultTemperatureF({ resultTemperatureTouched: true }, 70)).toBeUndefined();
  });
});

describe("resolveTopOffSelectedGas", () => {
  test("uses the persisted gas id when it is still available", () => {
    expect(resolveTopOffSelectedGas("oxygen", topOffOptions)?.id).toBe("oxygen");
  });

  test("falls back to the first gas when persisted gas id is unavailable", () => {
    expect(resolveTopOffSelectedGas("removed-bank", topOffOptions)?.id).toBe("air");
  });
});

describe("syncTopOffInputSelectedGas", () => {
  test("keeps the input object when the selected gas is already persisted", () => {
    const input = {
      startO2: 32,
      startHe: 0,
      startPressure: 500,
      finalPressure: 3000,
      topGasId: "air"
    };

    expect(syncTopOffInputSelectedGas(input, topOffOptions[0])).toBe(input);
  });

  test("updates the persisted gas id to the displayed fallback gas", () => {
    const input = {
      startO2: 32,
      startHe: 0,
      startPressure: 500,
      finalPressure: 3000,
      topGasId: "removed-bank"
    };

    expect(syncTopOffInputSelectedGas(input, topOffOptions[0])).toEqual({
      ...input,
      topGasId: "air"
    });
  });
});

describe("updateTopOffStartTemperatureState", () => {
  test("marks edited start temperature as touched", () => {
    expect(updateTopOffStartTemperatureState(85)).toEqual({
      startTemperatureF: 85,
      startTemperatureTouched: true
    });
  });

  test("marks a cleared start temperature as touched so the input stays blank", () => {
    expect(updateTopOffStartTemperatureState(undefined)).toEqual({
      startTemperatureF: undefined,
      startTemperatureTouched: true
    });
  });
});

describe("defaultTopOffStartTemperatureState", () => {
  test("restores the default start temperature after a blank edit", () => {
    expect(defaultTopOffStartTemperatureState()).toEqual({
      startTemperatureF: 70,
      startTemperatureTouched: false
    });
  });
});

describe("updateTopOffResultTemperatureState", () => {
  test("marks edited result temperature as touched", () => {
    expect(updateTopOffResultTemperatureState(95)).toEqual({
      resultTemperatureF: 95,
      resultTemperatureTouched: true
    });
  });

  test("marks a cleared result temperature as touched so the input stays blank", () => {
    expect(updateTopOffResultTemperatureState(undefined)).toEqual({
      resultTemperatureF: undefined,
      resultTemperatureTouched: true
    });
  });
});

describe("defaultTopOffResultTemperatureState", () => {
  test("restores result temperature fallback to start temperature after a blank edit", () => {
    expect(defaultTopOffResultTemperatureState()).toEqual({
      resultTemperatureF: undefined,
      resultTemperatureTouched: false
    });
  });
});

describe("copyTopOffResultToStartInput", () => {
  test("copies the rounded result mix and goal pressure into the start tank and keeps the exact mix", () => {
    const input = {
      startO2: 32,
      startHe: 0,
      startPressure: 500,
      finalPressure: 3000,
      topGasId: "air"
    };

    const result = {
      success: true,
      finalO2: 22.833333,
      finalHe: 0.004,
      finalN2: 77.162667,
      finalPressure: 3000,
      addedPressure: 2500,
      warnings: [],
      errors: [],
      model: "ideal" as const,
      goalPressurePsi: 3000,
      resultPressurePsi: 3000
    };

    expect(copyTopOffResultToStartInput(input, result, "psi")).toEqual({
      ...input,
      startO2: 22.83,
      startHe: 0,
      startMixExact: { o2: 22.833333, he: 0.004 },
      startPressure: 3000
    });
  });

  test("copies the GERG goal temperature instead of the adjusted result temperature", () => {
    const input = {
      startO2: 32,
      startHe: 0,
      startPressure: 500,
      finalPressure: 3000,
      startTemperatureF: 70,
      startTemperatureTouched: true,
      resultTemperatureF: 95,
      resultTemperatureTouched: true,
      topGasId: "air"
    };

    const result = {
      success: true,
      finalO2: 22.833333,
      finalHe: 0,
      finalN2: 77.166667,
      startPressurePsi: 500,
      goalPressurePsi: 3000,
      resultPressurePsi: 3260,
      addedPressure: 2500,
      startTemperatureF: 72,
      resultTemperatureF: 95,
      topOffMoles: 120,
      z: 1.01,
      warnings: [],
      errors: [],
      model: "gerg2008" as const
    };

    expect(copyTopOffResultToStartInput(input, result, "psi")).toEqual({
      ...input,
      startO2: 22.83,
      startHe: 0,
      startMixExact: { o2: 22.833333, he: 0 },
      startPressure: 3000,
      startTemperatureF: 72,
      startTemperatureTouched: true
    });
  });

  test("keeps rounded copied mixes at or below 100 percent", () => {
    const input = {
      startO2: 50,
      startHe: 50,
      startPressure: 1000,
      finalPressure: 3200,
      topGasId: "oxygen"
    };

    const result = {
      success: true,
      finalO2: 84.375,
      finalHe: 15.625,
      finalN2: 0,
      finalPressure: 3200,
      addedPressure: 2200,
      warnings: [],
      errors: [],
      model: "ideal" as const,
      goalPressurePsi: 3200,
      resultPressurePsi: 3200
    };

    const copied = copyTopOffResultToStartInput(input, result, "psi");

    expect(copied.startO2).toBe(84.38);
    expect(copied.startHe).toBe(15.62);
    expect((copied.startO2 ?? 0) + (copied.startHe ?? 0)).toBeLessThanOrEqual(100);
    expect(resolveTopOffStartMix(copied)).toEqual({ o2: 84.375, he: 15.625 });
  });

  test("chains GERG-2008 top-offs through the copied start tank without 2-decimal drift", () => {
    // Field report: 2577 psi of 15.7/55 at 73.5 F, Air to 2752.5, a 15.2/56 bank to 3074.5, Helium to 3300.
    // Re-entering each stop at 2 decimals ended at 15.0073/55.0065 (15.01/55.01 shown) instead of 15/55.
    const settings = {
      pressureUnit: "psi" as const,
      gasModel: "gerg2008" as const,
      defaultTankSizeCuFt: 80,
      tankRatedPressure: 3000
    };
    const stages: Array<[number, GasSelection, number, number]> = [
      [2752.5, { id: "air", name: "Air", o2: 21, he: 0 }, 16.01, 51.82],
      [3074.5, { id: "bank", name: "Bank 15.2/56", o2: 15.2, he: 56 }, 15.93, 52.2],
      [3300, { id: "helium", name: "Helium", o2: 0, he: 100 }, 15, 55]
    ];
    let input: TopOffInput = {
      startO2: 15.7,
      startHe: 55,
      startPressure: 2577,
      finalPressure: 2752.5,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 73.5,
      startTemperatureTouched: true,
      topGasId: "air"
    };
    let exactStart = { pressure: 2577, o2: 15.7, he: 55 };
    let result = calculateTopOffForModel(settings, input, stages[0][1]);

    for (const [finalPressure, gas, shownO2, shownHe] of stages) {
      input = { ...input, finalPressure, topGasId: gas.id };
      result = calculateTopOffForModel(settings, input, gas);
      const unrounded = calculateTopOffForModel(
        settings,
        { ...input, startPressure: exactStart.pressure, startO2: exactStart.o2, startHe: exactStart.he, startMixExact: undefined },
        gas
      );

      expect(result.success).toBe(true);
      expect(result.finalO2).toBeCloseTo(unrounded.finalO2, 9);
      expect(result.finalHe).toBeCloseTo(unrounded.finalHe, 9);

      input = copyTopOffResultToStartInput(input, result, "psi");
      // The Start O2/He fields still show 2 decimals.
      expect(input.startO2).toBe(shownO2);
      expect(input.startHe).toBe(shownHe);
      exactStart = { pressure: finalPressure, o2: result.finalO2, he: result.finalHe };
    }

    expect(result.finalO2).toBeCloseTo(15, 3);
    expect(result.finalHe).toBeCloseTo(55, 2);
    expect(result.finalO2.toFixed(2)).toBe("15.00");
    expect(result.finalHe.toFixed(2)).toBe("55.00");
  });
});

describe("resolveTopOffStartMix", () => {
  const exactInput = {
    startO2: 16.01,
    startHe: 51.82,
    startMixExact: { o2: 16.006646, he: 51.817824 }
  };

  test("uses the exact copied mix while the start fields show its rounded copy", () => {
    expect(resolveTopOffStartMix(exactInput)).toEqual({ o2: 16.006646, he: 51.817824 });
  });

  test("uses the typed start fields once they no longer match the copied mix", () => {
    expect(resolveTopOffStartMix({ ...exactInput, startO2: 16 })).toEqual({ o2: 16, he: 51.82 });
    expect(resolveTopOffStartMix({ ...exactInput, startHe: undefined })).toEqual({ o2: 16.01, he: 0 });
  });

  test("defaults the start mix without a copied mix and ignores a non-finite one", () => {
    expect(resolveTopOffStartMix({})).toEqual({ o2: 32, he: 0 });
    expect(resolveTopOffStartMix({ startO2: 0, startHe: 0, startMixExact: { o2: Number.NaN, he: 0 } }))
      .toEqual({ o2: 0, he: 0 });
  });
});

describe("updateTopOffInputField", () => {
  const input: TopOffInput = {
    startO2: 16.01,
    startHe: 51.82,
    startMixExact: { o2: 16.006646, he: 51.817824 },
    startPressure: 2752.5,
    finalPressure: 3074.5,
    topGasId: "bank"
  };

  test("drops the exact copied mix when Start O2 or He changes", () => {
    expect(updateTopOffInputField(input, "startO2", 16).startMixExact).toBeUndefined();
    expect(updateTopOffInputField(input, "startHe", 51.8).startMixExact).toBeUndefined();
  });

  test("keeps the exact copied mix for an unchanged blur or other field edits", () => {
    expect(updateTopOffInputField(input, "startO2", 16.01).startMixExact).toEqual(input.startMixExact);
    expect(updateTopOffInputField(input, "startPressure", 2700).startMixExact).toEqual(input.startMixExact);
    expect(updateTopOffInputField(input, "finalPressure", 3300)).toEqual({ ...input, finalPressure: 3300 });
  });
});

describe("buildTopOffFillCostPlan", () => {
  const input = {
    startO2: 32,
    startHe: 0,
    startPressure: 500,
    finalPressure: 3000,
    tankSizeCuFt: 80,
    tankRatedPressurePsi: 3000,
    startTemperatureF: 70,
    resultTemperatureF: 70,
    topGasId: "air"
  };
  const settingsFor = (gasModel: "ideal" | "gerg2008") => ({
    pressureUnit: "psi" as const,
    gasModel,
    defaultTankSizeCuFt: 80,
    tankRatedPressure: 3000
  });
  const costSettings = {
    tankSizeCuFt: 80,
    tankRatedPressure: 3000,
    pricePerCuFtO2: 1.0,
    pricePerCuFtHe: 3.5,
    pricePerCuFtTopOff: 0.1
  };

  test("prices solved top-off moles in GERG mode, unaffected by Result Temp", () => {
    const result = calculateTopOffForModel(settingsFor("gerg2008"), input, topOffOptions[0]);
    const hotResult = calculateTopOffForModel(
      settingsFor("gerg2008"),
      { ...input, resultTemperatureF: 95, resultTemperatureTouched: true },
      topOffOptions[0]
    );
    const plan = buildTopOffFillCostPlan(result, topOffOptions[0], 80, 3000);
    const hotPlan = buildTopOffFillCostPlan(hotResult, topOffOptions[0], 80, 3000);
    const estimate = calculateFillCostEstimate(plan.additions, costSettings);

    expect(hotResult.model === "gerg2008" && hotResult.resultTemperatureF).toBe(95);
    expect(hotResult.resultPressurePsi).toBeGreaterThan(result.resultPressurePsi);
    expect(hotPlan.basis).toBe("gerg2008");
    expect(plan.basis).toBe("gerg2008");
    expect(estimate.lines[0].volumeCuFt).toBeCloseTo(64.05, 2);
    expect(hotPlan.additions[0].volumeCuFt).toBeCloseTo(plan.additions[0].volumeCuFt ?? 0, 9);
    expect(buildTopOffFillCostPlan(result, topOffOptions[0], 120, 3000).additions[0].volumeCuFt)
      .toBeCloseTo((plan.additions[0].volumeCuFt ?? 0) * 1.5, 9);
  });

  test("keeps the pressure-ratio volume in ideal mode", () => {
    const result = calculateTopOffForModel(settingsFor("ideal"), input, topOffOptions[0]);
    const plan = buildTopOffFillCostPlan(result, topOffOptions[0], 80, 3000);
    const estimate = calculateFillCostEstimate(plan.additions, costSettings);

    expect(plan.basis).toBe("ideal");
    expect(plan.additions[0].volumeCuFt).toBeUndefined();
    expect(estimate.lines[0].volumeCuFt).toBeCloseTo(66.667, 3);
  });
});

describe("cleared Top-Off fields", () => {
  const air = topOffOptions[0];
  const idealSettings = (pressureUnit: "psi" | "bar") => ({
    pressureUnit,
    gasModel: "ideal" as const,
    defaultTankSizeCuFt: 80,
    tankRatedPressure: 3000
  });

  test("a cleared Start Pressure is an empty cylinder in either unit", () => {
    expect(resolveTopOffStartPressurePsi(undefined, "psi")).toBe(0);
    expect(resolveTopOffStartPressurePsi(undefined, "bar")).toBe(0);
    expect(resolveTopOffStartPressurePsi(100, "bar")).toBeCloseTo(1450.37738, 4);
  });

  test.each([
    { pressureUnit: "psi" as const, startPressure: 1500, finalPressure: 3000 },
    { pressureUnit: "bar" as const, startPressure: 100, finalPressure: 200 }
  ])("reverse-solves the bleed with the 32/0 default when Start O2/He are cleared ($pressureUnit)", ({ pressureUnit, startPressure, finalPressure }) => {
    const input: TopOffInput = { topGasId: "air", startPressure, finalPressure };
    const startMix = resolveTopOffStartMix(input);
    const startPressurePsi = resolveTopOffStartPressurePsi(input.startPressure, pressureUnit);
    const bleedPsi = solveTopOffBleedForTargetPercent({
      targetPercent: 26,
      startPercent: startMix.o2,
      topPercent: air.o2,
      finalPressure: input.finalPressure,
      pressureUnit,
      startPressurePsi
    });

    expect(startMix).toEqual({ o2: 32, he: 0 });
    expect(bleedPsi).not.toBeNull();
    expect(Number.isFinite(bleedPsi)).toBe(true);
    const preview = calculateTopOffBleedPreview(idealSettings(pressureUnit), input, air, startPressurePsi - (bleedPsi ?? 0));
    expect(preview.finalO2).toBeCloseTo(26, 6);
  });

  test("reverse-solves against the same 3000 Final Pressure fallback the bleed preview uses", () => {
    const input: TopOffInput = { topGasId: "air", startPressure: 1500, startO2: 32, startHe: 0 };
    const solve = (finalPressure: number | undefined) => solveTopOffBleedForTargetPercent({
      targetPercent: 26,
      startPercent: 32,
      topPercent: air.o2,
      finalPressure,
      pressureUnit: "psi",
      startPressurePsi: 1500
    });
    const bleedPsi = solve(input.finalPressure);

    expect(bleedPsi).toBe(solve(3000));
    const preview = calculateTopOffBleedPreview(idealSettings("psi"), input, air, 1500 - (bleedPsi ?? 0));
    expect(preview.finalO2).toBeCloseTo(26, 6);
  });

  test.each([
    { pressureUnit: "psi" as const, gasModel: "ideal" as const },
    { pressureUnit: "bar" as const, gasModel: "ideal" as const },
    { pressureUnit: "psi" as const, gasModel: "gerg2008" as const },
    { pressureUnit: "bar" as const, gasModel: "gerg2008" as const }
  ])("a cleared Final Pressure tops off to 3000 psi, not 3000 $pressureUnit ($gasModel)", ({ pressureUnit, gasModel }) => {
    const settings = { ...idealSettings(pressureUnit), gasModel };
    const input: TopOffInput = {
      topGasId: "air",
      startPressure: toDisplayPressure(1500, pressureUnit),
      startO2: 32,
      startHe: 0,
      startTemperatureF: 70
    };
    const cleared = calculateTopOffForModel(settings, input, air);
    const typed = calculateTopOffForModel(settings, { ...input, finalPressure: toDisplayPressure(3000, pressureUnit) }, air);

    expect(cleared.success).toBe(true);
    expect(cleared.goalPressurePsi).toBeCloseTo(3000, 6);
    expect(cleared.finalO2).toBe(typed.finalO2);
    expect(cleared.addedPressure).toBe(typed.addedPressure);
  });

  test("reverse-solves a cleared Final Pressure in bar against the preview's 3000 psi fallback", () => {
    const input: TopOffInput = { topGasId: "air", startPressure: 100, startO2: 32, startHe: 0 };
    const startPressurePsi = resolveTopOffStartPressurePsi(input.startPressure, "bar");
    const solve = (finalPressure: number | undefined) => solveTopOffBleedForTargetPercent({
      targetPercent: 26,
      startPercent: 32,
      topPercent: air.o2,
      finalPressure,
      pressureUnit: "bar",
      startPressurePsi
    });
    const bleedPsi = solve(input.finalPressure);

    expect(bleedPsi).toBe(solve(toDisplayPressure(3000, "bar")));
    // 3000 bar would need a 19,777 psi start, so the old fallback clamped the bleed to 0.
    expect(bleedPsi).toBeCloseTo(86.7, 1);
    const preview = calculateTopOffBleedPreview(idealSettings("bar"), input, air, startPressurePsi - (bleedPsi ?? 0));
    expect(preview.goalPressurePsi).toBeCloseTo(3000, 6);
    expect(preview.finalO2).toBeCloseTo(26, 6);
  });

  test.each(["psi", "bar"] as const)("never produces a NaN bleed when every field is cleared (%s)", (pressureUnit) => {
    const input: TopOffInput = { topGasId: "air" };
    const startMix = resolveTopOffStartMix(input);
    const startPressurePsi = resolveTopOffStartPressurePsi(input.startPressure, pressureUnit);
    const solveFor = (gas: "o2" | "he") => solveTopOffBleedForTargetPercent({
      targetPercent: 26,
      startPercent: startMix[gas],
      topPercent: air[gas],
      finalPressure: input.finalPressure,
      pressureUnit,
      startPressurePsi
    });

    expect(solveFor("o2")).toBe(0);
    // Start and top-off He are both 0%, so bleeding cannot change He and the handler leaves the bleed alone.
    expect(solveFor("he")).toBeNull();
  });
});
