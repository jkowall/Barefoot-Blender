import { describe, expect, test } from "vitest";
import { realGasResultToBlendResult, resolveStageTemperatureDisplayF } from "./StandardBlendTab";
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
  test("shows legacy fill temperature only when stage temperatures are absent", () => {
    expect(resolveStageTemperatureDisplayF("topoff", undefined, 70, 90)).toBe(90);
    expect(resolveStageTemperatureDisplayF("topoff", {}, 70, 90)).toBe(70);
    expect(resolveStageTemperatureDisplayF("topoff", { topoff: 100 }, 70, 90)).toBe(100);
  });
});
