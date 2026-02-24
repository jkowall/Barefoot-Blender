import { describe, expect, test } from "bun:test";
import { formatPressure, formatSignedPressure } from "./format";

describe("formatPressure", () => {
  test("formats psi correctly", () => {
    expect(formatPressure(100, "psi")).toBe("100 PSI");
    expect(formatPressure(100.4, "psi")).toBe("100 PSI");
    expect(formatPressure(100.5, "psi")).toBe("101 PSI");
  });

  test("formats bar correctly", () => {
    // 1 bar = 14.5037738 psi
    const oneBarPsi = 14.5037738;
    expect(formatPressure(oneBarPsi, "bar")).toBe("1 BAR");
    expect(formatPressure(oneBarPsi * 2, "bar")).toBe("2 BAR");
  });

  test("respects decimals", () => {
    expect(formatPressure(100.123, "psi", 2)).toBe("100.12 PSI");
  });
});

describe("formatSignedPressure", () => {
  test("formats positive psi", () => {
    expect(formatSignedPressure(100, "psi")).toBe("+100 PSI");
  });

  test("formats negative psi", () => {
    expect(formatSignedPressure(-100, "psi")).toBe("-100 PSI");
  });

  test("formats zero psi", () => {
    expect(formatSignedPressure(0, "psi")).toBe("0 PSI");
  });

  test("formats small positive psi", () => {
    // 0.0001 psi -> +0 PSI with 0 decimals
    expect(formatSignedPressure(0.0001, "psi")).toBe("+0 PSI");
  });

  test("formats small negative psi", () => {
    // -0.0001 psi -> -0 PSI with 0 decimals
    expect(formatSignedPressure(-0.0001, "psi")).toBe("-0 PSI");
  });
});
