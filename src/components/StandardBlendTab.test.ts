import { describe, expect, test } from "vitest";
import {
  realGasResultToBlendResult,
  resolveRealGasStageTemperatureRows,
  resolveHistoryStageTemperatureTouched,
  resolveInputStageTemperatures,
  resolveInputTankContext,
  resolveStageTemperatureDisplayF,
  stageTemperaturesForEdit,
  updateStageTemperatureState
} from "./StandardBlendTab";
import type { RealGasBlendResult } from "../utils/realGasBlend";

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
