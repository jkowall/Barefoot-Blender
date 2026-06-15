import { describe, expect, test } from "vitest";
import {
  GERG_MAX_PRESSURE_KPA,
  gasFractionsFromPercents,
  gaugePsiToAbsoluteKpa,
  gergDensityFromPressure,
  gergPressureFromDensity
} from "./gerg2008";
import { fahrenheitToKelvin } from "./temperature";

describe("GERG-2008 O2/N2/He subset", () => {
  test("matches NIST AGA8 reference for air at 3000 psig and 70 F", () => {
    const result = gergDensityFromPressure(
      fahrenheitToKelvin(70),
      gaugePsiToAbsoluteKpa(3000),
      gasFractionsFromPercents(21, 0)
    );

    expect(result.success).toBe(true);
    expect(result.densityMolPerLiter).toBeCloseTo(8.21744136564499, 9);
    expect(result.z).toBeCloseTo(1.03385192491412, 12);
  });

  test("matches NIST AGA8 reference for trimix 18/45 at 3000 psig and 70 F", () => {
    const result = gergDensityFromPressure(
      fahrenheitToKelvin(70),
      gaugePsiToAbsoluteKpa(3000),
      gasFractionsFromPercents(18, 45)
    );

    expect(result.success).toBe(true);
    expect(result.densityMolPerLiter).toBeCloseTo(7.60549452304008, 9);
    expect(result.z).toBeCloseTo(1.11703684066886, 12);
  });

  test("matches NIST AGA8 reference for heliox 50/50 at 250 bar absolute and 25 C", () => {
    const result = gergDensityFromPressure(
      298.15,
      25000,
      gasFractionsFromPercents(50, 50)
    );

    expect(result.success).toBe(true);
    expect(result.densityMolPerLiter).toBeCloseTo(8.92863706280638, 9);
    expect(result.z).toBeCloseTo(1.12949769777819, 12);
  });

  test("pressure calculation returns the reference pressure from a known molar density", () => {
    const result = gergPressureFromDensity(
      298.15,
      8.92863706280638,
      gasFractionsFromPercents(50, 50)
    );

    expect(result.success).toBe(true);
    expect(result.pressureKpa).toBeCloseTo(25000, 7);
    expect(result.z).toBeCloseTo(1.12949769777819, 12);
  });

  test("rejects states above the supported 400 bar absolute envelope", () => {
    const result = gergDensityFromPressure(
      fahrenheitToKelvin(70),
      GERG_MAX_PRESSURE_KPA + 1,
      gasFractionsFromPercents(21, 0)
    );

    expect(result.success).toBe(false);
    expect(result.errors).toContain("GERG-2008 correction is limited to pressures at or below 400 bar absolute.");
  });
});
