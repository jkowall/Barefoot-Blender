import { describe, expect, test } from "vitest";
import {
  formatDepth,
  formatFillCostBasis,
  formatGasCostDetail,
  formatGasOptionLabel,
  formatGasVolume,
  formatNumber,
  formatPercentage,
  formatPressure,
  formatSignedPressure,
  sanitizeGasName
} from "./format";

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

describe("formatGasOptionLabel", () => {
  test("shows the name with O2 and He fractions", () => {
    expect(formatGasOptionLabel({ name: "Air", o2: 21, he: 0 })).toBe("Air (21% O2 / 0% He)");
    expect(formatGasOptionLabel({ name: "Oxygen", o2: 100, he: 0 })).toBe("Oxygen (100% O2 / 0% He)");
    expect(formatGasOptionLabel({ name: "Helium", o2: 0, he: 100 })).toBe("Helium (0% O2 / 100% He)");
  });

  test("keeps tenths unchanged and shows analyzed hundredths", () => {
    expect(formatGasOptionLabel({ name: "Bank", o2: 15.2, he: 56 })).toBe("Bank (15.2% O2 / 56% He)");
    expect(formatGasOptionLabel({ name: "Bank", o2: 32.5, he: 12.5 })).toBe("Bank (32.5% O2 / 12.5% He)");
    // One decimal would show this analyzed air as 21%.
    expect(formatGasOptionLabel({ name: "Air 20.95", o2: 20.95, he: 0 })).toBe("Air 20.95 (20.95% O2 / 0% He)");
  });

  test("always adds fractions, including names that already contain the mix", () => {
    expect(formatGasOptionLabel({ name: "Trimix 15/55", o2: 15, he: 55 })).toBe("Trimix 15/55 (15% O2 / 55% He)");
    expect(formatGasOptionLabel({ name: "Bank (main)", o2: 36, he: 0 })).toBe("Bank (main) (36% O2 / 0% He)");
    const longName = "A".repeat(32);
    expect(formatGasOptionLabel({ name: longName, o2: 32.5, he: 12.5 })).toBe(`${longName} (32.5% O2 / 12.5% He)`);
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

describe("formatGasVolume", () => {
  test("formats cost volume before price math", () => {
    expect(formatGasVolume(3.85, 108.91)).toBe("3.85 cu ft, 108.91 L");
  });
});

describe("formatGasCostDetail", () => {
  test("omits pressure from the cost detail", () => {
    expect(formatGasCostDetail(3.85, 108.91, 1, 3.85)).toBe("3.85 cu ft, 108.91 L × $1.00 = $3.85");
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

describe("formatFillCostBasis", () => {
  test("labels GERG-2008 volumes with the free-gas reference in the display unit", () => {
    expect(formatFillCostBasis("gerg2008", "f")).toBe("Volumes: GERG-2008 real gas (Z-corrected), free gas at 1 atm and 70 F.");
    expect(formatFillCostBasis("gerg2008", "c")).toBe("Volumes: GERG-2008 real gas (Z-corrected), free gas at 1 atm and 21.1 C.");
  });

  test("labels ideal and fallback volumes", () => {
    expect(formatFillCostBasis("idealFallback", "f")).toBe("Volumes: ideal pressure ratio. GERG-2008 volumes are unavailable for this fill.");
    expect(formatFillCostBasis("ideal", "f")).toBe("Volumes: ideal pressure ratio of tank size to rated pressure.");
  });
});
