import { describe, expect, test } from "vitest";
import {
  GERG_MAX_PRESSURE_KPA,
  GERG_MIN_TEMPERATURE_K,
  absoluteKpaToGaugePsi,
  gasFractionsFromPercents,
  gaugePsiToAbsoluteKpa,
  gergDensityFromPressure,
  gergMolarMass,
  gergPressureFromDensity,
  normalizeGergFractions
} from "./gerg2008";
import { fahrenheitToKelvin } from "./temperature";

const airFractions = gasFractionsFromPercents(21, 0);

// Fixed outputs were generated with NIST's AGA8 C GERG2008.cpp at commit
// 3bdb9ab8ff317c618b0b59d1b704c2c86ddc5fce. The decimal tolerances below
// allow only floating-point implementation noise; they are not derived from
// this TypeScript implementation.
// https://github.com/usnistgov/AGA8/blob/3bdb9ab8ff317c618b0b59d1b704c2c86ddc5fce/AGA8CODE/C/GERG2008.cpp
const NIST_DENSITY_DECIMALS = 9;
const NIST_Z_DECIMALS = 12;

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

  test.each([
    {
      name: "pure nitrogen at 300 bar absolute and 25 C",
      temperatureK: 298.15,
      pressureKpa: 30000,
      o2Percent: 0,
      hePercent: 0,
      densityMolPerLiter: 10.59574264209987,
      z: 1.1421426904047447
    },
    {
      name: "pure oxygen at 300 bar absolute and 25 C",
      temperatureK: 298.15,
      pressureKpa: 30000,
      o2Percent: 100,
      hePercent: 0,
      densityMolPerLiter: 12.284086688834501,
      z: 0.9851648164518457
    },
    {
      name: "pure helium at 300 bar absolute and 25 C",
      temperatureK: 298.15,
      pressureKpa: 30000,
      o2Percent: 0,
      hePercent: 100,
      densityMolPerLiter: 10.641953863885544,
      z: 1.1371830927733086
    },
    {
      name: "50/50 nitrogen-helium at the cold high-pressure boundary",
      temperatureK: 250,
      pressureKpa: 40000,
      o2Percent: 0,
      hePercent: 50,
      densityMolPerLiter: 14.753686870553803,
      z: 1.3043217781219316
    },
    {
      name: "trimix 10/70 at the cold high-pressure boundary",
      temperatureK: 250,
      pressureKpa: 40000,
      o2Percent: 10,
      hePercent: 70,
      densityMolPerLiter: 14.988642865826316,
      z: 1.2838757494669319
    }
  ])("matches the independent NIST reference for $name", ({
    temperatureK,
    pressureKpa,
    o2Percent,
    hePercent,
    densityMolPerLiter,
    z
  }) => {
    const result = gergDensityFromPressure(
      temperatureK,
      pressureKpa,
      gasFractionsFromPercents(o2Percent, hePercent)
    );

    expect(result.success).toBe(true);
    expect(result.densityMolPerLiter).toBeCloseTo(densityMolPerLiter, NIST_DENSITY_DECIMALS);
    expect(result.z).toBeCloseTo(z, NIST_Z_DECIMALS);
  });

  test("accepts and round-trips the exact 250 K and 400 bar boundary", () => {
    const density = gergDensityFromPressure(
      GERG_MIN_TEMPERATURE_K,
      GERG_MAX_PRESSURE_KPA,
      airFractions
    );

    expect(density.success).toBe(true);

    const pressure = gergPressureFromDensity(
      GERG_MIN_TEMPERATURE_K,
      density.densityMolPerLiter,
      airFractions
    );

    expect(pressure.success).toBe(true);
    expect(Math.abs(pressure.pressureKpa - GERG_MAX_PRESSURE_KPA)).toBeLessThan(1e-6);
  });

  test("warns but remains successful above the normal scuba temperature range", () => {
    const result = gergDensityFromPressure(401, 1000, airFractions);

    expect(result.success).toBe(true);
    expect(result.warnings).toContain(
      "GERG-2008 correction is outside the normal scuba fill temperature range above 400 K."
    );
  });

  test.each([
    {
      name: "zero absolute temperature",
      temperatureK: 0,
      error: "Temperature must be a positive absolute temperature."
    },
    {
      name: "non-finite absolute temperature",
      temperatureK: Number.NaN,
      error: "Temperature must be a positive absolute temperature."
    },
    {
      name: "temperature below the supported envelope",
      temperatureK: GERG_MIN_TEMPERATURE_K - 0.001,
      error: "GERG-2008 correction is limited to temperatures at or above 250 K."
    }
  ])("rejects $name", ({ temperatureK, error }) => {
    const result = gergDensityFromPressure(temperatureK, 1000, airFractions);

    expect(result.success).toBe(false);
    expect(result.errors).toContain(error);
  });

  test.each([
    { name: "negative pressure", pressureKpa: -1 },
    { name: "NaN pressure", pressureKpa: Number.NaN },
    { name: "infinite pressure", pressureKpa: Number.POSITIVE_INFINITY }
  ])("rejects $name", ({ pressureKpa }) => {
    const result = gergDensityFromPressure(298.15, pressureKpa, airFractions);

    expect(result.success).toBe(false);
    expect(result.errors).toContain("Pressure must be zero or greater.");
  });

  test.each([
    { name: "negative density", densityMolPerLiter: -1, error: "Density must be zero or greater." },
    {
      name: "negative infinite density",
      densityMolPerLiter: Number.NEGATIVE_INFINITY,
      error: "Density must be a finite value."
    },
    {
      name: "positive infinite density",
      densityMolPerLiter: Number.POSITIVE_INFINITY,
      error: "Density must be a finite value."
    },
    { name: "NaN density", densityMolPerLiter: Number.NaN, error: "Density must be a finite value." }
  ])("rejects $name", ({ densityMolPerLiter, error }) => {
    const result = gergPressureFromDensity(298.15, densityMolPerLiter, airFractions);

    expect(result.success).toBe(false);
    expect(result.errors).toContain(error);
  });

  test("returns the ideal limiting state at zero pressure and zero density", () => {
    const density = gergDensityFromPressure(298.15, 0, airFractions);
    const pressure = gergPressureFromDensity(298.15, 0, airFractions);

    expect(density).toMatchObject({ success: true, pressureKpa: 0, densityMolPerLiter: 0, z: 1 });
    expect(pressure).toMatchObject({ success: true, pressureKpa: 0, densityMolPerLiter: 0, z: 1 });
    expect(pressure.dPdD).toBeGreaterThan(0);
  });

  test.each([
    {
      name: "an all-zero composition",
      fractions: { o2: 0, he: 0, n2: 0 },
      error: "At least one gas fraction is required."
    },
    {
      name: "a negative component",
      fractions: { o2: 0.5, he: 0.6, n2: -0.1 },
      error: "Gas fractions cannot be negative."
    },
    {
      name: "a non-finite component",
      fractions: { o2: Number.NaN, he: 0, n2: 1 },
      error: "Gas fractions must be finite values."
    }
  ])("rejects $name in both pressure and density entry points", ({ fractions, error }) => {
    const results = [
      gergDensityFromPressure(298.15, 1000, fractions),
      gergPressureFromDensity(298.15, 1, fractions)
    ];

    for (const result of results) {
      expect(result.success).toBe(false);
      expect(result.errors).toContain(error);
    }
  });

  test("round-trips pressure and density across the supported scuba envelope", () => {
    const mixes = [
      { name: "air", fractions: gasFractionsFromPercents(21, 0) },
      { name: "EAN32", fractions: gasFractionsFromPercents(32, 0) },
      { name: "trimix 18/45", fractions: gasFractionsFromPercents(18, 45) },
      { name: "trimix 10/70", fractions: gasFractionsFromPercents(10, 70) },
      { name: "heliox 50/50", fractions: gasFractionsFromPercents(50, 50) }
    ];
    const temperaturesK = [250, 298.15, 400];
    const pressuresKpa = [101.325, 10000, 30000, 40000];

    for (const mix of mixes) {
      for (const temperatureK of temperaturesK) {
        let previousDensity = 0;
        for (const pressureKpa of pressuresKpa) {
          const label = `${mix.name}, ${temperatureK} K, ${pressureKpa} kPa`;
          const density = gergDensityFromPressure(temperatureK, pressureKpa, mix.fractions);

          expect(density.success, label).toBe(true);
          expect(Number.isFinite(density.densityMolPerLiter), label).toBe(true);
          expect(Number.isFinite(density.z), label).toBe(true);
          expect(density.densityMolPerLiter, label).toBeGreaterThan(previousDensity);
          expect(density.z, label).toBeGreaterThan(0);

          const recovered = gergPressureFromDensity(
            temperatureK,
            density.densityMolPerLiter,
            mix.fractions
          );
          const relativePressureError = Math.abs(recovered.pressureKpa - pressureKpa) / pressureKpa;

          expect(recovered.success, label).toBe(true);
          expect(relativePressureError, label).toBeLessThan(1e-10);
          expect(recovered.z, label).toBeCloseTo(density.z, 12);
          expect(recovered.dPdD, label).toBeGreaterThan(0);
          previousDensity = density.densityMolPerLiter;
        }
      }
    }
  });

  test.each([
    { name: "air", temperatureK: 298.15, pressureKpa: 20000, fractions: gasFractionsFromPercents(21, 0) },
    { name: "trimix 18/45", temperatureK: 250, pressureKpa: 30000, fractions: gasFractionsFromPercents(18, 45) },
    { name: "heliox 50/50", temperatureK: 400, pressureKpa: 30000, fractions: gasFractionsFromPercents(50, 50) }
  ])("matches the analytic dPdD to a finite difference for $name", ({ temperatureK, pressureKpa, fractions }) => {
    const density = gergDensityFromPressure(temperatureK, pressureKpa, fractions);
    expect(density.success).toBe(true);

    const densityStep = density.densityMolPerLiter * 1e-5;
    const center = gergPressureFromDensity(temperatureK, density.densityMolPerLiter, fractions);
    const lower = gergPressureFromDensity(temperatureK, density.densityMolPerLiter - densityStep, fractions);
    const upper = gergPressureFromDensity(temperatureK, density.densityMolPerLiter + densityStep, fractions);
    const finiteDifference = (upper.pressureKpa - lower.pressureKpa) / (2 * densityStep);
    const relativeDerivativeError = Math.abs(center.dPdD - finiteDifference) / Math.abs(finiteDifference);

    expect(center.success).toBe(true);
    expect(lower.success).toBe(true);
    expect(upper.success).toBe(true);
    expect(center.dPdD).toBeGreaterThan(0);
    expect(relativeDerivativeError).toBeLessThan(1e-8);
  });

  test("preserves pressure, composition, and molar-mass helper invariants", () => {
    expect(gaugePsiToAbsoluteKpa(0)).toBeCloseTo(101.325, 6);
    for (const pressurePsi of [0, 500, 3000]) {
      expect(absoluteKpaToGaugePsi(gaugePsiToAbsoluteKpa(pressurePsi))).toBeCloseTo(pressurePsi, 10);
    }

    const fromPercents = gasFractionsFromPercents(18, 45);
    expect(fromPercents.o2).toBeCloseTo(0.18, 12);
    expect(fromPercents.he).toBeCloseTo(0.45, 12);
    expect(fromPercents.n2).toBeCloseTo(0.37, 12);

    const normalized = normalizeGergFractions({ o2: 18, he: 45, n2: 37 });
    expect(normalized.o2).toBeCloseTo(fromPercents.o2, 12);
    expect(normalized.he).toBeCloseTo(fromPercents.he, 12);
    expect(normalized.n2).toBeCloseTo(fromPercents.n2, 12);

    expect(gergMolarMass({ o2: 1, he: 0, n2: 0 })).toBeCloseTo(31.9988, 8);
    expect(gergMolarMass({ o2: 0, he: 1, n2: 0 })).toBeCloseTo(4.002602, 8);
    expect(gergMolarMass({ o2: 0, he: 0, n2: 1 })).toBeCloseTo(28.0134, 8);
  });
});
