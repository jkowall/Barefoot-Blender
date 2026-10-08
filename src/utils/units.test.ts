import { expect, test, describe } from "vitest";
import {
  toDisplayPressure,
  fromDisplayPressure,
  toDisplayDepth,
  fromDisplayDepth,
  depthPerAtm,
  resolveFillPressureDisplay,
  DEFAULT_FILL_PRESSURE_PSI,
  PSI_PER_BAR,
  FEET_PER_METER,
  FEET_PER_ATM,
  METERS_PER_ATM
} from "./units";

describe("Unit Conversions", () => {
  // Pressure Tests
  describe("Pressure", () => {
    test("toDisplayPressure: psi (identity)", () => {
      expect(toDisplayPressure(100, "psi")).toBe(100);
    });

    test("toDisplayPressure: bar (conversion)", () => {
      const inputPsi = 100;
      const expectedBar = inputPsi / PSI_PER_BAR;
      expect(toDisplayPressure(inputPsi, "bar")).toBeCloseTo(expectedBar, 5);
    });

    test("fromDisplayPressure: psi (identity)", () => {
      expect(fromDisplayPressure(100, "psi")).toBe(100);
    });

    test("fromDisplayPressure: bar (conversion)", () => {
      const inputBar = 10;
      const expectedPsi = inputBar * PSI_PER_BAR;
      expect(fromDisplayPressure(inputBar, "bar")).toBeCloseTo(expectedPsi, 5);
    });

    test("resolveFillPressureDisplay: an empty field falls back to 3000 psi in the display unit", () => {
      expect(DEFAULT_FILL_PRESSURE_PSI).toBe(3000);
      expect(resolveFillPressureDisplay(undefined, "psi")).toBe(3000);
      expect(resolveFillPressureDisplay(undefined, "bar")).toBeCloseTo(206.84, 2);
      expect(fromDisplayPressure(resolveFillPressureDisplay(undefined, "bar"), "bar")).toBeCloseTo(3000, 9);
    });

    test("resolveFillPressureDisplay: typed values, including 0, are kept as entered", () => {
      expect(resolveFillPressureDisplay(232, "bar")).toBe(232);
      expect(resolveFillPressureDisplay(3442, "psi")).toBe(3442);
      expect(resolveFillPressureDisplay(0, "bar")).toBe(0);
    });
  });

  // Depth Tests
  describe("Depth", () => {
    test("toDisplayDepth: ft (identity)", () => {
      expect(toDisplayDepth(100, "ft")).toBe(100);
    });

    test("toDisplayDepth: m (conversion)", () => {
      const inputFeet = 100;
      const expectedMeters = inputFeet / FEET_PER_METER;
      expect(toDisplayDepth(inputFeet, "m")).toBeCloseTo(expectedMeters, 5);
    });

    test("fromDisplayDepth: ft (identity)", () => {
      expect(fromDisplayDepth(100, "ft")).toBe(100);
    });

    test("fromDisplayDepth: m (conversion)", () => {
      const inputMeters = 30;
      const expectedFeet = inputMeters * FEET_PER_METER;
      expect(fromDisplayDepth(inputMeters, "m")).toBeCloseTo(expectedFeet, 5);
    });
  });

  // depthPerAtm Tests
  describe("depthPerAtm", () => {
    test("ft returns FEET_PER_ATM", () => {
      expect(depthPerAtm("ft")).toBe(FEET_PER_ATM);
      expect(depthPerAtm("ft")).toBe(33);
    });

    test("m returns METERS_PER_ATM", () => {
      expect(depthPerAtm("m")).toBe(METERS_PER_ATM);
      expect(depthPerAtm("m")).toBe(10);
    });
  });
});
