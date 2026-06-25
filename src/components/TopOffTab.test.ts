import { describe, expect, test } from "vitest";
import {
  copyTopOffResultToStartInput,
  defaultTopOffResultTemperatureState,
  defaultTopOffStartTemperatureState,
  resolveTopOffResultTemperatureF,
  resolveTopOffStartTemperatureF,
  updateTopOffStartTemperatureState,
  updateTopOffResultTemperatureState
} from "./TopOffTab";

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
  test("copies the rounded result mix and goal pressure into the start tank", () => {
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
  });
});
