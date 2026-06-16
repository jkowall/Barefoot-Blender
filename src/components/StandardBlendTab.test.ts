import { describe, expect, test } from "vitest";
import {
  realGasResultToBlendResult,
  resolveHistoryStageTemperatureTouched,
  resolveInputStageTemperatures,
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

describe("resolveHistoryStageTemperatureTouched", () => {
  test("leaves legacy history entries eligible for fill temperature fallback", () => {
    expect(resolveHistoryStageTemperatureTouched({})).toBeUndefined();
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
