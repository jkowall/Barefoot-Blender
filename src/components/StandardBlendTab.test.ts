import { describe, expect, test } from "vitest";
import {
  blendPlanStopPressures,
  buildStandardBlendFillCostPlan,
  realGasResultToBlendResult,
  selectStandardBlendResult,
  resolveRealGasStageTemperatureRows,
  resolveRealGasStopDisplay,
  resolveHistoryStageTemperatureTouched,
  resolveInputStageTemperatures,
  resolveInputTankContext,
  resolveStageTemperatureDisplayF,
  resolveBlendPlanStopPressures,
  resolveStandardBlendFields,
  stageTemperaturesForEdit,
  updateStageTemperatureState
} from "./StandardBlendTab";
import type { StandardBlendInput } from "../state/session";
import { calculateFillCostEstimate, calculateStandardBlend, summarizeBlendVolumes } from "../utils/calculations";
import { calculateRealGasStandardBlend, type RealGasBlendResult } from "../utils/realGasBlend";
import { fromDisplayPressure } from "../utils/units";

describe("realGasResultToBlendResult", () => {
  test("replaces a failed GERG primary result with current errors and no stale steps", () => {
    const failedResult: RealGasBlendResult = {
      success: false,
      steps: [
        {
          kind: "topoff",
          gasName: "Air",
          molesAdded: 1,
          stopPressurePsi: 3000,
          pressureChangePsi: 100,
          temperatureF: 70,
          z: 1
        }
      ],
      startHotPressurePsi: 3000,
      finalHotPressurePsi: 3000,
      targetSettledPressurePsi: 3000,
      warnings: ["Outside preferred GERG-2008 envelope."],
      errors: ["GERG-2008 correction requires removing gas or changing the top-off gas."]
    };

    const primaryResult = realGasResultToBlendResult(failedResult);

    expect(primaryResult.success).toBe(false);
    expect(primaryResult.steps).toHaveLength(0);
    expect(primaryResult.warnings).toEqual(failedResult.warnings);
    expect(primaryResult.errors).toEqual(failedResult.errors);
  });

  test("explains when a corrected result replaces an ideal no-op", () => {
    const correctedResult: RealGasBlendResult = {
      success: true,
      steps: [
        {
          kind: "topoff",
          gasName: "Air",
          molesAdded: 1,
          stopPressurePsi: 3100,
          pressureChangePsi: 100,
          temperatureF: 410,
          z: 1.02
        }
      ],
      startHotPressurePsi: 3000,
      finalHotPressurePsi: 3100,
      targetSettledPressurePsi: 3000,
      warnings: [],
      errors: []
    };

    const primaryResult = realGasResultToBlendResult(correctedResult);

    expect(primaryResult.warnings).toEqual([
      "Ideal partial-pressure plan has no pressure change; showing GERG-2008 corrected stop plan."
    ]);
  });
});

describe("selectStandardBlendResult", () => {
  test("selects the corrected result when ideal math misses a GERG-only fill", () => {
    const idealResult = {
      success: false,
      steps: [],
      warnings: [],
      errors: ["Target pressure matches start pressure."]
    };
    const correctedResult: RealGasBlendResult = {
      success: true,
      steps: [
        {
          kind: "topoff",
          gasName: "Air",
          molesAdded: 1,
          stopPressurePsi: 3100,
          pressureChangePsi: 100,
          temperatureF: 90,
          z: 1.02
        }
      ],
      startHotPressurePsi: 3000,
      finalHotPressurePsi: 3100,
      targetSettledPressurePsi: 3000,
      warnings: [],
      errors: []
    };

    const selection = selectStandardBlendResult(idealResult, correctedResult);

    expect(selection.source).toBe("realGas");
    expect(selection.result.success).toBe(true);
    expect(selection.result.steps).toEqual([
      { kind: "topoff", amount: 100, gasName: "Air" }
    ]);
  });

  test("keeps the ideal same-pressure error when the GERG correction also fails", () => {
    const idealResult = {
      success: false,
      steps: [],
      warnings: [],
      errors: ["Target pressure matches start pressure."]
    };
    const correctedResult: RealGasBlendResult = {
      success: false,
      steps: [],
      startHotPressurePsi: 3000,
      finalHotPressurePsi: 3000,
      targetSettledPressurePsi: 3000,
      warnings: [],
      errors: ["GERG-2008 correction failed."]
    };

    const selection = selectStandardBlendResult(idealResult, correctedResult);

    expect(selection.source).toBe("ideal");
    expect(selection.result).toBe(idealResult);
  });
});

describe("resolveStageTemperatureDisplayF", () => {
  test("shows legacy fill temperature only when the touched map is absent", () => {
    expect(resolveStageTemperatureDisplayF("topoff", undefined, undefined, 70, 90)).toBe(90);
    expect(resolveStageTemperatureDisplayF("topoff", {}, undefined, 70, 90)).toBe(90);
    expect(resolveStageTemperatureDisplayF("topoff", {}, {}, 70, 90)).toBe(70);
    expect(resolveStageTemperatureDisplayF("topoff", { topoff: 100 }, {}, 70, 90)).toBe(100);
  });

  test("keeps a cleared touched stage blank instead of falling back to the initial temperature", () => {
    expect(resolveStageTemperatureDisplayF("topoff", {}, { topoff: true }, 70, 90)).toBeUndefined();
    expect(resolveStageTemperatureDisplayF("oxygen", {}, { topoff: true }, 70, 90)).toBe(70);
  });
});

describe("resolveInputStageTemperatures", () => {
  test("seeds missing legacy stage temperatures from fill temperature", () => {
    expect(resolveInputStageTemperatures({ topGasId: "air", fillTemperatureF: 90, stageTemperaturesF: {} }, 70)).toEqual({
      helium: 90,
      oxygen: 90,
      topoff: 90
    });
    expect(resolveInputStageTemperatures({ topGasId: "air", fillTemperatureF: 90, stageTemperaturesF: { oxygen: 100 } }, 70)).toEqual({
      helium: 90,
      oxygen: 100,
      topoff: 90
    });
    expect(resolveInputStageTemperatures({ topGasId: "air", fillTemperatureF: 90, stageTemperaturesF: {}, stageTemperatureTouched: {} }, 70)).toEqual({
      helium: 70,
      oxygen: 70,
      topoff: 70
    });
  });
});

describe("resolveInputTankContext", () => {
  test("prefers input tank context over settings defaults", () => {
    expect(resolveInputTankContext({ tankSizeCuFt: 100, tankRatedPressurePsi: 3442 }, 80, 3000)).toEqual({
      tankSizeCuFt: 100,
      tankRatedPressurePsi: 3442
    });
  });

  test("falls back through settings defaults to standard aluminum 80 context", () => {
    expect(resolveInputTankContext({}, 95, 2640)).toEqual({
      tankSizeCuFt: 95,
      tankRatedPressurePsi: 2640
    });
    expect(resolveInputTankContext({}, undefined, undefined)).toEqual({
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000
    });
  });
});

describe("stageTemperaturesForEdit", () => {
  test("keeps untouched earlier new-schema stages unset during later edits", () => {
    const nextState = updateStageTemperatureState(
      stageTemperaturesForEdit({ topGasId: "air", stageTemperatureTouched: {} }, 70),
      {},
      "oxygen",
      100
    );

    expect(nextState.stageTemperaturesF).toEqual({
      oxygen: 100,
      topoff: 100
    });
    expect(nextState.stageTemperatureTouched).toEqual({
      oxygen: true
    });
  });

  test("seeds legacy edits from fill temperature before setting the edited stage", () => {
    const nextState = updateStageTemperatureState(
      stageTemperaturesForEdit({ topGasId: "air", fillTemperatureF: 90 }, 70),
      {},
      "oxygen",
      100
    );

    expect(nextState.stageTemperaturesF).toEqual({
      helium: 90,
      oxygen: 100,
      topoff: 100
    });
  });
});

describe("updateStageTemperatureState", () => {
  test("marks a cleared edited stage as touched so the input can remain blank", () => {
    const nextState = updateStageTemperatureState(
      { topoff: 79 },
      { topoff: true },
      "topoff",
      undefined
    );

    expect(nextState.stageTemperaturesF).toEqual({});
    expect(nextState.stageTemperatureTouched).toEqual({
      topoff: true
    });
    expect(resolveStageTemperatureDisplayF(
      "topoff",
      nextState.stageTemperaturesF,
      nextState.stageTemperatureTouched,
      70,
      undefined
    )).toBeUndefined();
  });

  test("stops propagation at the next touched stage", () => {
    const nextState = updateStageTemperatureState(
      { helium: 70, oxygen: 100, topoff: 100 },
      { oxygen: true },
      "helium",
      80
    );

    expect(nextState.stageTemperaturesF).toEqual({
      helium: 80,
      oxygen: 100,
      topoff: 100
    });
    expect(nextState.stageTemperatureTouched).toEqual({
      helium: true,
      oxygen: true
    });
  });

  test("propagates through later stages until a touched stage is reached", () => {
    const nextState = updateStageTemperatureState(
      { helium: 70, oxygen: 70, topoff: 110 },
      { topoff: true },
      "helium",
      90
    );

    expect(nextState.stageTemperaturesF).toEqual({
      helium: 90,
      oxygen: 90,
      topoff: 110
    });
    expect(nextState.stageTemperatureTouched).toEqual({
      helium: true,
      topoff: true
    });
  });
});

describe("resolveRealGasStageTemperatureRows", () => {
  test("keeps an editable stage temperature row when GERG has no corrected step", () => {
    const rows = resolveRealGasStageTemperatureRows(
      [{ kind: "topoff", amount: 3000, gasName: "Air" }],
      [],
      { id: "air", name: "Air", o2: 21, he: 0 }
    );

    expect(rows).toEqual([
      {
        kind: "topoff",
        gasName: "Air",
        correctedStep: undefined
      }
    ]);
  });

  test("keeps later planned temperature rows editable after a partial GERG failure", () => {
    const rows = resolveRealGasStageTemperatureRows(
      [
        { kind: "helium", amount: 500, gasName: "Helium" },
        { kind: "oxygen", amount: 400, gasName: "Oxygen" },
        { kind: "topoff", amount: 2100, gasName: "Air" }
      ],
      [
        {
          kind: "helium",
          gasName: "Helium",
          molesAdded: 1,
          stopPressurePsi: 500,
          pressureChangePsi: 500,
          temperatureF: 70,
          z: 1
        }
      ],
      { id: "air", name: "Air", o2: 21, he: 0 }
    );

    expect(rows.map((row) => row.kind)).toEqual(["helium", "oxygen", "topoff"]);
    expect(rows[0]?.correctedStep?.kind).toBe("helium");
    expect(rows[1]?.correctedStep).toBeUndefined();
    expect(rows[2]?.correctedStep).toBeUndefined();
  });
});

describe("resolveRealGasStopDisplay", () => {
  const air = { id: "air", name: "Air", o2: 21, he: 0 };
  const standardInput = (overrides: Partial<StandardBlendInput> = {}): StandardBlendInput => ({
    startPressure: 0,
    targetPressure: 3000,
    startO2: 21,
    startHe: 0,
    targetO2: 18,
    targetHe: 45,
    tankSizeCuFt: 80,
    tankRatedPressurePsi: 3000,
    startTemperatureF: 70,
    settledTemperatureF: 70,
    stageTemperaturesF: {},
    stageTemperatureTouched: {},
    topGasId: "air",
    ...overrides
  });
  const resolveFor = (inputs: StandardBlendInput) => {
    const idealResult = calculateStandardBlend({ pressureUnit: "psi" }, inputs, air);
    const realGasResult = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);
    return {
      idealResult,
      realGasResult,
      display: resolveRealGasStopDisplay(idealResult.success ? idealResult.steps : undefined, realGasResult, air)
    };
  };

  test("shows only the GERG error when the fill needs bleed-down first", () => {
    const { idealResult, realGasResult, display } = resolveFor(
      standardInput({ startPressure: 2000, startO2: 18, startHe: 45, targetO2: 32, targetHe: 0 })
    );

    expect(idealResult.success).toBe(true);
    expect(idealResult.steps.some((step) => step.kind !== "bleed")).toBe(true);
    expect(realGasResult.success).toBe(false);
    expect(realGasResult.errors[0]).toContain("Complete the bleed-down step");
    expect(display).toEqual({ rows: [] });
  });

  test("shows corrected stops and the residual warning when empty-cylinder start gas blocks the exact target", () => {
    const { idealResult, realGasResult, display } = resolveFor(standardInput({ targetO2: 100, targetHe: 0 }));

    expect(idealResult.success).toBe(true);
    expect(realGasResult.success).toBe(true);
    expect(realGasResult.residualAdjustedMix?.o2).toBeCloseTo(99.62, 1);
    expect(realGasResult.warnings.some((warning) => warning.includes("Purge the cylinder"))).toBe(true);
    expect(display.rows.map((row) => row.kind)).toEqual(["oxygen"]);
    expect(display.rows[0]?.correctedStep?.kind).toBe("oxygen");
    expect(display.footer).toBe("summary");
  });

  test("shows only the GERG error when the settled temperature is out of range", () => {
    const { idealResult, realGasResult, display } = resolveFor(standardInput({ settledTemperatureF: -400 }));

    expect(idealResult.success).toBe(true);
    expect(realGasResult.success).toBe(false);
    expect(display).toEqual({ rows: [] });
  });

  test("keeps editable stage rows and the temperature footer for a stage envelope failure", () => {
    const { realGasResult, display } = resolveFor(
      standardInput({
        stageTemperaturesF: { helium: 70, oxygen: -400, topoff: 70 },
        stageTemperatureTouched: { oxygen: true }
      })
    );

    expect(realGasResult.success).toBe(false);
    expect(display.rows.map((row) => row.kind)).toEqual(["helium", "oxygen", "topoff"]);
    expect(display.rows[0]?.correctedStep?.kind).toBe("helium");
    expect(display.rows[1]?.correctedStep).toBeUndefined();
    expect(display.rows[2]?.correctedStep).toBeUndefined();
    expect(display.footer).toBe("stageTemperature");
  });

  test("uses the summary footer for a successful correction", () => {
    const { realGasResult, display } = resolveFor(standardInput());

    expect(realGasResult.success).toBe(true);
    expect(display.rows.map((row) => row.kind)).toEqual(["helium", "oxygen", "topoff"]);
    expect(display.rows.every((row) => row.correctedStep !== undefined)).toBe(true);
    expect(display.footer).toBe("summary");
  });

  test("keeps a row per planned addition when a GERG-only fill fails at its first stage", () => {
    const display = resolveRealGasStopDisplay(
      undefined,
      {
        success: false,
        steps: [],
        startHotPressurePsi: 3000,
        finalHotPressurePsi: 3000,
        targetSettledPressurePsi: 3000,
        additions: [
          { kind: "helium", gasName: "Helium", moles: 1 },
          { kind: "oxygen", gasName: "Oxygen", moles: 1 },
          { kind: "topoff", gasName: "Air", moles: 1 }
        ],
        warnings: [],
        errors: ["GERG-2008 correction is limited to temperatures at or above 250 K."]
      },
      air
    );

    expect(display.rows).toEqual([
      { kind: "helium", gasName: "Helium", correctedStep: undefined },
      { kind: "oxygen", gasName: "Oxygen", correctedStep: undefined },
      { kind: "topoff", gasName: "Air", correctedStep: undefined }
    ]);
    expect(display.footer).toBe("stageTemperature");
  });

  test("keeps editable rows through the real GERG-only refresh path", () => {
    const inputs = standardInput({
      startPressure: 3000,
      targetPressure: 3000,
      startO2: 32,
      startHe: 0,
      targetO2: 32,
      targetHe: 0,
      startTemperatureF: 110,
      stageTemperaturesF: { oxygen: -400, topoff: -400 },
      stageTemperatureTouched: { oxygen: true, topoff: true }
    });
    const idealResult = calculateStandardBlend({ pressureUnit: "psi" }, inputs, air);
    const realGasResult = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);
    // The refresh path replaces the primary result with the failed GERG result, so no ideal steps remain.
    const primaryResult = realGasResultToBlendResult(realGasResult);

    expect(idealResult.success).toBe(false);
    expect(realGasResult.success).toBe(false);
    expect(realGasResult.steps).toHaveLength(0);
    expect(realGasResult.additions?.map((addition) => addition.kind)).toEqual(["oxygen", "topoff"]);

    const display = resolveRealGasStopDisplay(primaryResult.success ? primaryResult.steps : undefined, realGasResult, air);

    expect(display.rows.map((row) => row.kind)).toEqual(["oxygen", "topoff"]);
    expect(display.footer).toBe("stageTemperature");
  });

  test("orders a GERG-only planned stage between ideal stages", () => {
    const rows = resolveRealGasStageTemperatureRows(
      [
        { kind: "helium", amount: 1000, gasName: "Helium" },
        { kind: "topoff", amount: 2000, gasName: "Air" }
      ],
      [],
      air,
      [
        { kind: "helium", gasName: "Helium", moles: 1 },
        { kind: "oxygen", gasName: "Oxygen", moles: 0.01 },
        { kind: "topoff", gasName: "Air", moles: 1 }
      ]
    );

    expect(rows.map((row) => row.kind)).toEqual(["helium", "oxygen", "topoff"]);
  });

  test("renders nothing before a GERG result exists", () => {
    expect(resolveRealGasStopDisplay([{ kind: "topoff", amount: 3000, gasName: "Air" }], null, air)).toEqual({ rows: [] });
  });
});

describe("resolveHistoryStageTemperatureTouched", () => {
  test("leaves legacy history entries eligible for fill temperature fallback", () => {
    expect(resolveHistoryStageTemperatureTouched({})).toBeUndefined();
    expect(resolveHistoryStageTemperatureTouched({ stageTemperaturesF: {} })).toBeUndefined();
  });

  test("derives touched state only when stage temperature history exists", () => {
    expect(resolveHistoryStageTemperatureTouched({ stageTemperaturesF: { oxygen: 100 } })).toEqual({
      helium: false,
      oxygen: true,
      topoff: false
    });
    expect(resolveHistoryStageTemperatureTouched({ stageTemperaturesF: undefined, stageTemperatureTouched: { topoff: true } })).toEqual({
      topoff: true
    });
  });
});

describe("buildStandardBlendFillCostPlan", () => {
  const air = { id: "air", name: "Air", o2: 21, he: 0 };
  const costSettings = {
    tankSizeCuFt: 80,
    tankRatedPressure: 3000,
    pricePerCuFtO2: 1.0,
    pricePerCuFtHe: 3.5,
    pricePerCuFtTopOff: 0.1
  };
  const trimixInput = (overrides: Partial<StandardBlendInput> = {}): StandardBlendInput => ({
    startPressure: 0,
    targetPressure: 3000,
    startO2: 21,
    startHe: 0,
    targetO2: 21,
    targetHe: 35,
    tankSizeCuFt: 80,
    tankRatedPressurePsi: 3000,
    startTemperatureF: 70,
    settledTemperatureF: 70,
    stageTemperaturesF: { helium: 70, oxygen: 70, topoff: 70 },
    stageTemperatureTouched: {},
    topGasId: "air",
    ...overrides
  });
  const plansFor = (input: StandardBlendInput) => {
    const idealVolumes = summarizeBlendVolumes(calculateStandardBlend({ pressureUnit: "psi" }, input, air));
    const realGasResult = calculateRealGasStandardBlend({ pressureUnit: "psi" }, input, air);
    return { idealVolumes, realGasResult };
  };

  test("prices GERG-2008 moles as real-gas volumes in GERG mode", () => {
    const { idealVolumes, realGasResult } = plansFor(trimixInput());
    const plan = buildStandardBlendFillCostPlan(idealVolumes, realGasResult, "gerg2008", air, 80, 3000);
    const estimate = calculateFillCostEstimate(plan.additions, costSettings);

    expect(plan.basis).toBe("gerg2008");
    expect(estimate.lines.map((line) => line.label)).toEqual(["Oxygen", "Helium", "Air Top-Off"]);
    expect(estimate.lines[1].volumeCuFt).toBeCloseTo(25.431, 3);
    expect(estimate.lines[1].volumeCuFt).toBeLessThan(28);
  });

  test("keeps the ideal pressure ratio in ideal mode", () => {
    const { idealVolumes, realGasResult } = plansFor(trimixInput());
    const plan = buildStandardBlendFillCostPlan(idealVolumes, realGasResult, "ideal", air, 80, 3000);
    const estimate = calculateFillCostEstimate(plan.additions, costSettings);

    expect(plan.basis).toBe("ideal");
    expect(plan.additions.every((addition) => addition.volumeCuFt === undefined)).toBe(true);
    expect(estimate.lines[1].volumeCuFt).toBeCloseTo(28, 6);
  });

  test("still uses GERG-2008 volumes when a stage temperature is out of range", () => {
    const input = trimixInput({
      stageTemperaturesF: { helium: 70, oxygen: -40, topoff: 70 },
      stageTemperatureTouched: { oxygen: true }
    });
    const { idealVolumes, realGasResult } = plansFor(input);
    const plan = buildStandardBlendFillCostPlan(idealVolumes, realGasResult, "gerg2008", air, 80, 3000);

    expect(realGasResult.success).toBe(false);
    expect(plan.basis).toBe("gerg2008");
    expect(plan.additions[1].volumeCuFt).toBeCloseTo(25.431, 3);
  });

  test("falls back to labeled ideal volumes when GERG-2008 needs bleed-down first", () => {
    const input = trimixInput({ startPressure: 2000, startO2: 18, startHe: 45, targetO2: 32, targetHe: 0 });
    const { idealVolumes, realGasResult } = plansFor(input);
    const fallback = buildStandardBlendFillCostPlan(idealVolumes, realGasResult, "gerg2008", air, 80, 3000);
    const ideal = buildStandardBlendFillCostPlan(idealVolumes, realGasResult, "ideal", air, 80, 3000);
    const missing = buildStandardBlendFillCostPlan(idealVolumes, null, "gerg2008", air, 80, 3000);

    expect(fallback.basis).toBe("idealFallback");
    expect(missing.basis).toBe("idealFallback");
    expect(calculateFillCostEstimate(fallback.additions, costSettings).totalCost)
      .toBeCloseTo(calculateFillCostEstimate(ideal.additions, costSettings).totalCost, 9);
  });

  test("rescales GERG-2008 volumes when the tank context changes after calculation", () => {
    const { idealVolumes, realGasResult } = plansFor(trimixInput());
    const base = buildStandardBlendFillCostPlan(idealVolumes, realGasResult, "gerg2008", air, 80, 3000);
    const larger = buildStandardBlendFillCostPlan(idealVolumes, realGasResult, "gerg2008", air, 120, 3000);

    expect(larger.additions[1].volumeCuFt).toBeCloseTo((base.additions[1].volumeCuFt ?? 0) * 1.5, 9);
  });
});

describe("cleared Standard Blend fields", () => {
  const airTopGas = { id: "air", name: "Air", o2: 21, he: 0 };

  test("resolve to the solver defaults while a field is empty mid-edit, including 32% Target O2", () => {
    expect(resolveStandardBlendFields({ topGasId: "air" })).toEqual({
      topGasId: "air",
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      startO2: 21,
      startHe: 0,
      targetHe: 0
    });
    expect(resolveStandardBlendFields({ topGasId: "air", startPressure: 500, targetO2: 36 })).toMatchObject({
      startPressure: 500,
      targetO2: 36
    });
  });

  test.each([
    { pressureUnit: "psi" as const, targetPressure: 3000 },
    { pressureUnit: "bar" as const, targetPressure: 200 }
  ])("plan stops start from an empty cylinder when Start Pressure is cleared ($pressureUnit)", ({ pressureUnit, targetPressure }) => {
    const fields = resolveStandardBlendFields({ topGasId: "air", targetPressure, targetO2: 32 });
    const result = calculateStandardBlend({ pressureUnit }, fields, airTopGas);
    const stops = blendPlanStopPressures(result, fromDisplayPressure(fields.startPressure, pressureUnit));

    expect(result.success).toBe(true);
    expect(stops).toHaveLength(result.steps.length);
    expect(stops.every(Number.isFinite)).toBe(true);
    expect(stops[0]).toBeCloseTo(result.steps[0].amount, 9);
    expect(stops[stops.length - 1]).toBeCloseTo(fromDisplayPressure(targetPressure, pressureUnit), 6);
  });

  test("plan stops drain to the solved bleed pressure before adding gas", () => {
    const fields = resolveStandardBlendFields({
      topGasId: "air",
      startPressure: 1500,
      startHe: 35,
      targetHe: 10,
      targetPressure: 3000
    });
    const result = calculateStandardBlend({ pressureUnit: "psi" }, fields, airTopGas);
    const stops = blendPlanStopPressures(result, 1500);

    expect(result.steps[0].kind).toBe("bleed");
    expect(stops[0]).toBe(result.bleedPressure);
    for (let index = 1; index < stops.length; index += 1) {
      expect(stops[index]).toBeCloseTo(stops[index - 1] + result.steps[index].amount, 9);
    }
    expect(stops[stops.length - 1]).toBeCloseTo(3000, 6);
  });
});

describe("resolveBlendPlanStopPressures", () => {
  const airTopGas = { id: "air", name: "Air", o2: 21, he: 0 };

  test("keeps ideal stops on the start pressure the result was solved from", () => {
    const fields = resolveStandardBlendFields({ topGasId: "air", startPressure: 500, startO2: 32, targetPressure: 3000 });
    const result = calculateStandardBlend({ pressureUnit: "psi" }, fields, airTopGas);
    const stops = resolveBlendPlanStopPressures(result, "ideal", null, 500);

    expect(result.success).toBe(true);
    expect(stops[0]).toBeCloseTo(500 + result.steps[0].amount, 9);
    expect(stops[stops.length - 1]).toBeCloseTo(3000, 6);
  });

  test("uses solved GERG stop pressures when stage temperatures differ", () => {
    const inputs: StandardBlendInput = {
      topGasId: "air",
      startPressure: 0,
      startO2: 21,
      startHe: 0,
      targetPressure: 3000,
      targetO2: 21,
      targetHe: 35,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      settledTemperatureF: 70,
      stageTemperaturesF: { helium: 70, oxygen: 110, topoff: 130 },
      stageTemperatureTouched: { helium: true, oxygen: true, topoff: true }
    };
    const realGasResult = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, airTopGas);
    const realGasBlend = realGasResultToBlendResult(realGasResult);
    const stops = resolveBlendPlanStopPressures(realGasBlend, "realGas", realGasResult, 0);
    const summed = blendPlanStopPressures(realGasBlend, realGasResult.startHotPressurePsi);

    expect(realGasResult.success).toBe(true);
    expect(realGasResult.steps.length).toBeGreaterThan(1);
    expect(stops).toEqual(realGasResult.steps.map((step) => step.stopPressurePsi));
    // Summing per-stage pressure changes drifts once the stage temperature changes.
    expect(Math.abs(summed[summed.length - 1] - stops[stops.length - 1])).toBeGreaterThan(1);
  });
});
