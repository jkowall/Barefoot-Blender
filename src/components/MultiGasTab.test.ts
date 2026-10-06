import { describe, expect, test } from "vitest";
import {
  MAX_GAS_SOURCES,
  findMatchingIdealAlternative,
  moveGasSource,
  resolveMultiGasSources,
  selectMultiGasPlanModel
} from "./MultiGasTab";
import type { GasSourceInput } from "../state/session";
import { listTopOffOptions, solveNGasBlend, type GasSelection } from "../utils/calculations";
import { calculateRealGasMultiGasBlend, type RealGasMultiGasResult } from "../utils/realGasMultiGas";

const gasOptions: GasSelection[] = [
  ...listTopOffOptions([{ id: "bank-36", name: "Bank 36", o2: 36, he: 0 }]),
  { id: "trimix-2135", name: "Trimix 21/35", o2: 21, he: 35 }
];

describe("resolveMultiGasSources", () => {
  const rows: GasSourceInput[] = [
    { id: "helium", enabled: true, stageTemperatureF: 90 },
    { id: "air", enabled: false },
    { id: "custom", customO2: 50, customHe: 60, enabled: true, maxPressure: 20 },
    { id: "deleted-bank", enabled: true },
    { id: "air", enabled: true }
  ];

  test("keeps the ideal ids and names and skips disabled or unknown rows", () => {
    const resolved = resolveMultiGasSources(rows, gasOptions, "bar");

    expect(resolved.idealSources.map((gas) => gas.id)).toEqual(["helium-0", "custom-1", "air-3"]);
    expect(resolved.idealSources[1]).toMatchObject({ name: "Custom (50.0 O2 / 50.0 He)", o2: 50, he: 50 });
    expect(resolved.idealSources[1].maxPressurePsi).toBeCloseTo(290.075, 2);
    expect(resolved.idealSources.every((gas) => !("stageTemperatureF" in gas))).toBe(true);
  });

  test("carries stage temperatures and maps ids back to their rows", () => {
    const resolved = resolveMultiGasSources(rows, gasOptions, "psi");

    expect(resolved.realGasSources.map((gas) => gas.stageTemperatureF)).toEqual([90, undefined, undefined]);
    expect(resolved.rowIndexById.get("helium-0")).toBe(0);
    expect(resolved.rowIndexById.get("custom-1")).toBe(2);
    expect(resolved.rowIndexById.get("air-3")).toBe(4);
  });
});

describe("moveGasSource", () => {
  test("swaps a row with its neighbor along with its row key", () => {
    expect(moveGasSource(["a", "b", "c"], ["ka", "kb", "kc"], 2, -1)).toEqual({
      sources: ["a", "c", "b"],
      rowKeys: ["ka", "kc", "kb"]
    });
  });

  test("leaves the list unchanged at either end", () => {
    const sources = ["a", "b"];
    const rowKeys = ["ka", "kb"];
    expect(moveGasSource(sources, rowKeys, 0, -1).sources).toBe(sources);
    expect(moveGasSource(sources, rowKeys, 1, 1).rowKeys).toBe(rowKeys);
  });

  test("allows six sources", () => {
    expect(MAX_GAS_SOURCES).toBe(6);
  });
});

describe("selectMultiGasPlanModel", () => {
  const failure = (overrides: Partial<RealGasMultiGasResult>): RealGasMultiGasResult => ({
    success: false,
    alternatives: [],
    waterVolumeLiters: 11.1,
    warnings: [],
    errors: [],
    ...overrides
  });

  test("uses ideal math when the ideal model is selected", () => {
    expect(selectMultiGasPlanModel("ideal", null)).toBe("ideal");
  });

  test("shows GERG-2008 plans and GERG no-blend results", () => {
    expect(selectMultiGasPlanModel("gerg2008", failure({ success: true }))).toBe("gerg2008");
    expect(selectMultiGasPlanModel("gerg2008", failure({ failure: "noBlend", errors: ["No valid blend"] }))).toBe("gerg2008");
  });

  test("falls back to the ideal plan when GERG-2008 cannot evaluate the inputs", () => {
    expect(selectMultiGasPlanModel(
      "gerg2008",
      failure({ failure: "gerg", errors: ["GERG-2008 correction is limited to pressures at or below 400 bar absolute."] })
    )).toBe("idealFallback");
    expect(selectMultiGasPlanModel(
      "gerg2008",
      failure({ failure: "input", errors: ["GERG-2008 correction is limited to temperatures at or above 250 K."] })
    )).toBe("idealFallback");
    expect(selectMultiGasPlanModel(
      "gerg2008",
      failure({ failure: "input", errors: ["Target pressure must be greater than zero."] })
    )).toBe("gerg2008");
  });
});

describe("findMatchingIdealAlternative", () => {
  test("finds the ideal option that adds the same gases as the corrected plan", () => {
    const { idealSources, realGasSources } = resolveMultiGasSources(
      [
        { id: "helium", enabled: true },
        { id: "oxygen", enabled: true },
        { id: "air", enabled: true },
        { id: "trimix-2135", enabled: true }
      ],
      gasOptions,
      "psi"
    );
    const ideal = solveNGasBlend({ pressureUnit: "psi" }, 3000, 18, 45, 0, 21, 0, idealSources, {});
    const realGas = calculateRealGasMultiGasBlend(
      { pressureUnit: "psi" },
      {
        startPressure: 0,
        targetPressure: 3000,
        startO2: 21,
        startHe: 0,
        targetO2: 18,
        targetHe: 45,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        settledTemperatureF: 70,
        sources: realGasSources,
        fillOrderMode: "auto"
      },
      {}
    );

    for (const alternative of realGas.alternatives) {
      const match = findMatchingIdealAlternative(ideal.alternatives, alternative);
      expect(match?.steps.map((step) => step.gas.id).sort()).toEqual(alternative.sourceIds);
    }
  });
});
