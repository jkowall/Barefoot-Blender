import { describe, expect, test } from "vitest";
import { useSessionStore } from "./session";

describe("session defaults", () => {
  test("leaves stage temperature schema fields unset for legacy fallback semantics", () => {
    const standardBlend = useSessionStore.getState().standardBlend;

    expect(standardBlend.fillTemperatureF).toBeUndefined();
    expect(standardBlend.stageTemperaturesF).toBeUndefined();
    expect(standardBlend.stageTemperatureTouched).toBeUndefined();
  });
});

describe("multi-gas session defaults", () => {
  test("starts with auto fill order, 70 F temperatures, and no stage temperatures", () => {
    const multiGas = useSessionStore.getState().multiGas;

    expect(multiGas.fillOrderMode).toBe("auto");
    expect(multiGas.startTemperatureF).toBe(70);
    expect(multiGas.settledTemperatureF).toBe(70);
    expect(multiGas.gasSources?.every((source) => source.stageTemperatureF === undefined)).toBe(true);
  });
});
