import { describe, expect, test } from "bun:test";
import { formatDepth, formatNumber, formatPercentage, formatPressure, formatSignedPressure, sanitizeGasName } from "./format";

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

describe("formatPercentage", () => {
  test("formats percentage correctly", () => {
    expect(formatPercentage(32)).toBe("32%");
    expect(formatPercentage(32.1)).toBe("32.1%");
  });

  test("respects decimals", () => {
    expect(formatPercentage(32.123, 2)).toBe("32.12%");
    expect(formatPercentage(32, 0)).toBe("32%");
  });
});

describe("formatDepth", () => {
  test("formats feet correctly", () => {
    expect(formatDepth(100, "ft")).toBe("100 ft");
  });

  test("formats meters correctly", () => {
    // 1 meter = 3.2808399 feet
    const tenMetersFeet = 32.808399;
    expect(formatDepth(tenMetersFeet, "m")).toBe("10 m");
  });

  test("respects decimals", () => {
    expect(formatDepth(100.123, "ft", 1)).toBe("100.1 ft");
  });
});

describe("formatNumber", () => {
  test("formats number correctly", () => {
    expect(formatNumber(123.456)).toBe("123.5"); // default 1 decimal
  });

  test("respects decimals", () => {
    expect(formatNumber(123.456, 2)).toBe("123.46");
    expect(formatNumber(123.456, 0)).toBe("123");
  });

  test("handles non-finite values", () => {
    expect(formatNumber(NaN)).toBe("0");
    expect(formatNumber(Infinity)).toBe("0");
  });
});

describe("sanitizeGasName", () => {
  test("truncates long strings to 32 characters", () => {
    const longName = "A".repeat(50);
    expect(sanitizeGasName(longName)).toBe("A".repeat(32));
    expect(sanitizeGasName(longName).length).toBe(32);
  });

  test("keeps short strings as is", () => {
    expect(sanitizeGasName("Nitrox 32")).toBe("Nitrox 32");
  });

  test("handles empty strings", () => {
    expect(sanitizeGasName("")).toBe("");
  });
});
