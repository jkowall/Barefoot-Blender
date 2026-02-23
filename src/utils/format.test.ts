import { expect, test, describe } from "bun:test";
import { formatPercentage, formatPressure, formatDepth, formatNumber } from "./format";
import type { PressureUnit, DepthUnit } from "../state/settings";

describe("formatPercentage", () => {
  test("formats number with default decimals (1)", () => {
    expect(formatPercentage(10.123)).toBe("10.1%");
  });

  test("formats number with custom decimals", () => {
    expect(formatPercentage(10.123, 2)).toBe("10.12%");
  });

  test("rounds number correctly", () => {
    expect(formatPercentage(10.156)).toBe("10.2%"); // Round half up
    expect(formatPercentage(10.144)).toBe("10.1%"); // Round down
  });

  test("handles negative numbers", () => {
    expect(formatPercentage(-10.123)).toBe("-10.1%");
  });

  test("handles zero", () => {
    expect(formatPercentage(0)).toBe("0%");
  });

  test("handles non-finite numbers (defaults to 0)", () => {
    expect(formatPercentage(Infinity)).toBe("0%");
    expect(formatPercentage(NaN)).toBe("0%");
  });
});

describe("formatNumber", () => {
  test("formats number with default decimals (1)", () => {
    expect(formatNumber(10.123)).toBe("10.1");
  });

  test("formats number with custom decimals", () => {
    expect(formatNumber(10.123, 2)).toBe("10.12");
  });

  test("rounds number correctly", () => {
    expect(formatNumber(10.156)).toBe("10.2");
  });

  test("handles negative numbers", () => {
    expect(formatNumber(-10.123)).toBe("-10.1");
  });

  test("handles zero", () => {
    expect(formatNumber(0)).toBe("0");
  });

  test("handles non-finite numbers (defaults to 0)", () => {
    expect(formatNumber(Infinity)).toBe("0");
    expect(formatNumber(NaN)).toBe("0");
  });
});

describe("formatPressure", () => {
  const PSI: PressureUnit = "psi";
  const BAR: PressureUnit = "bar";

  test("formats PSI with default decimals (0)", () => {
    expect(formatPressure(3000, PSI)).toBe("3000 PSI");
  });

  test("formats PSI with custom decimals", () => {
    expect(formatPressure(3000.5, PSI, 1)).toBe("3000.5 PSI");
  });

  test("formats BAR correctly (converts from PSI)", () => {
    // 3000 PSI / 14.5037738 ≈ 206.84 bar
    expect(formatPressure(3000, BAR)).toBe("207 BAR");
  });

  test("formats BAR with decimals", () => {
    // 3000 PSI / 14.5037738 ≈ 206.842 bar
    expect(formatPressure(3000, BAR, 1)).toBe("206.8 BAR");
  });

  test("handles zero PSI", () => {
    expect(formatPressure(0, PSI)).toBe("0 PSI");
  });

  test("handles zero BAR", () => {
    expect(formatPressure(0, BAR)).toBe("0 BAR");
  });

  test("handles non-finite numbers", () => {
    expect(formatPressure(Infinity, PSI)).toBe("0 PSI");
    expect(formatPressure(NaN, BAR)).toBe("0 BAR");
  });
});

describe("formatDepth", () => {
  const FEET: DepthUnit = "ft";
  const METERS: DepthUnit = "m";

  test("formats Feet with default decimals (0)", () => {
    expect(formatDepth(100, FEET)).toBe("100 ft");
  });

  test("formats Feet with custom decimals", () => {
    expect(formatDepth(100.5, FEET, 1)).toBe("100.5 ft");
  });

  test("formats Meters correctly (converts from Feet)", () => {
    // 100 ft / 3.2808399 ≈ 30.48 m
    expect(formatDepth(100, METERS)).toBe("30 m");
  });

  test("formats Meters with decimals", () => {
    // 100 ft / 3.2808399 ≈ 30.48 m
    expect(formatDepth(100, METERS, 1)).toBe("30.5 m");
  });

  test("handles zero Feet", () => {
    expect(formatDepth(0, FEET)).toBe("0 ft");
  });

  test("handles zero Meters", () => {
    expect(formatDepth(0, METERS)).toBe("0 m");
  });

  test("handles non-finite numbers", () => {
    expect(formatDepth(Infinity, FEET)).toBe("0 ft");
    expect(formatDepth(NaN, METERS)).toBe("0 m");
  });
});
