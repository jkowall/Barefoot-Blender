import { describe, expect, test } from "vitest";
import {
  realGasResultToBlendResult,
  selectStandardBlendResult,
  resolveRealGasStageTemperatureRows,
  resolveRealGasStopDisplay,
  resolveHistoryStageTemperatureTouched,
  resolveInputStageTemperatures,
  resolveInputTankContext,
  resolveStageTemperatureDisplayF,
  stageTemperaturesForEdit,
  updateStageTemperatureState
} from "./StandardBlendTab";
import type { StandardBlendInput } from "../state/session";
import { calculateStandardBlend } from "../utils/calculations";
import { calculateRealGasStandardBlend, type RealGasBlendResult } from "../utils/realGasBlend";

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
  const failedResult = (overrides: Partial<RealGasBlendResult>): RealGasBlendResult => ({
    success: false,
    steps: [],
    startHotPressurePsi: 2000,
    finalHotPressurePsi: 3000,
    targetSettledPressurePsi: 3000,
    warnings: [],
    errors: ["GERG-2008 correction failed."],
    ...overrides
  });

  test("shows only the GERG error when the fill needs bleed-down first", () => {
    const inputs: StandardBlendInput = {
      startPressure: 2000,
      targetPressure: 3000,
      startO2: 18,
      startHe: 45,
      targetO2: 32,
      targetHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      settledTemperatureF: 70,
      stageTemperaturesF: {},
      stageTemperatureTouched: {},
      topGasId: "air"
    };
    const idealResult = calculateStandardBlend({ pressureUnit: "psi" }, inputs, air);
    const realGasResult = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(idealResult.success).toBe(true);
    expect(idealResult.steps.some((step) => step.kind !== "bleed")).toBe(true);
    expect(realGasResult.success).toBe(false);
    expect(realGasResult.errors[0]).toContain("Complete the bleed-down step");

    const display = resolveRealGasStopDisplay(idealResult.steps, realGasResult, air);

    expect(display.rows).toEqual([]);
    expect(display.footer).toBeUndefined();
  });

  test("hides stage rows for pre-solve failures even when the ideal plan has gas additions", () => {
    const display = resolveRealGasStopDisplay(
      [
        { kind: "oxygen", amount: 400, gasName: "Oxygen" },
        { kind: "topoff", amount: 2600, gasName: "Air" }
      ],
      failedResult({ errors: ["GERG-2008 correction is limited to temperatures at or above 250 K."] }),
      air
    );

    expect(display).toEqual({ rows: [] });
  });

  test("keeps editable stage rows and the temperature footer for a stage envelope failure", () => {
    const display = resolveRealGasStopDisplay(
      [
        { kind: "helium", amount: 1350, gasName: "Helium" },
        { kind: "oxygen", amount: 200, gasName: "Oxygen" },
        { kind: "topoff", amount: 1450, gasName: "Air" }
      ],
      failedResult({
        steps: [
          {
            kind: "helium",
            gasName: "Helium",
            molesAdded: 1,
            stopPressurePsi: 1350,
            pressureChangePsi: 1350,
            temperatureF: 70,
            z: 1
          }
        ],
        errors: ["GERG-2008 correction is limited to temperatures at or above 250 K."],
        failedStage: "oxygen"
      }),
      air
    );

    expect(display.rows.map((row) => row.kind)).toEqual(["helium", "oxygen", "topoff"]);
    expect(display.rows[0]?.correctedStep?.kind).toBe("helium");
    expect(display.rows[1]?.correctedStep).toBeUndefined();
    expect(display.rows[2]?.correctedStep).toBeUndefined();
    expect(display.footer).toBe("stageTemperature");
  });

  test("uses the summary footer for a successful correction", () => {
    const display = resolveRealGasStopDisplay(
      [{ kind: "topoff", amount: 3000, gasName: "Air" }],
      {
        success: true,
        steps: [
          {
            kind: "topoff",
            gasName: "Air",
            molesAdded: 1,
            stopPressurePsi: 3000,
            pressureChangePsi: 3000,
            temperatureF: 70,
            z: 1
          }
        ],
        startHotPressurePsi: 0,
        finalHotPressurePsi: 3000,
        targetSettledPressurePsi: 3000,
        warnings: [],
        errors: []
      },
      air
    );

    expect(display.rows).toHaveLength(1);
    expect(display.rows[0]?.correctedStep?.stopPressurePsi).toBe(3000);
    expect(display.footer).toBe("summary");
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
