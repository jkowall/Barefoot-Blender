import { expect, test, describe } from "bun:test";
import {
  toDisplayPressure,
  fromDisplayPressure,
  toDisplayDepth,
  fromDisplayDepth,
  depthPerAtm,
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
