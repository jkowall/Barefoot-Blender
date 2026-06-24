import { describe, expect, test } from "vitest";
import {
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
