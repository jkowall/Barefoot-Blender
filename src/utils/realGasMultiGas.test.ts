import { describe, expect, test } from "vitest";
import {
  MULTI_GAS_BANK_LIMIT_ERROR,
  MULTI_GAS_SIMILAR_BLEND_WARNING,
  solveNGasBlend,
  type CostSettings
} from "./calculations";
import {
  ATM_PRESSURE_PSI,
  absoluteKpaToGaugePsi,
  gergDensityFromPressure,
  gergPressureFromDensity,
  gaugePsiToAbsoluteKpa,
  type GergGasFractions
} from "./gerg2008";
import {
  BANK_LIMITS_EXCLUDE_ALL_WARNING,
  BLEED_REQUIRED_WARNING,
  START_MATCHES_TARGET_ERROR,
  TARGET_BELOW_RESIDUAL_ERROR,
  calculateRealGasMultiGasBlend,
  bleedSubsetSolutions,
  isolatedBleedStartAmounts,
  resolveMultiGasStageTemperaturesF,
  type RealGasMultiGasAlternative,
  type RealGasMultiGasInput,
  type RealGasMultiGasSource
} from "./realGasMultiGas";
import { calculateRealGasStandardBlend, realGasMolesToFreeGasCuFt } from "./realGasBlend";
import type { StandardBlendInput } from "../state/session";

const helium: RealGasMultiGasSource = { id: "helium-0", name: "Helium", o2: 0, he: 100 };
const oxygen: RealGasMultiGasSource = { id: "oxygen-1", name: "Oxygen", o2: 100, he: 0 };
const air: RealGasMultiGasSource = { id: "air-2", name: "Air", o2: 21, he: 0 };
const trimix2135: RealGasMultiGasSource = { id: "trimix-2135-3", name: "Trimix 21/35", o2: 21, he: 35 };
const prices: CostSettings = { pricePerCuFtO2: 1, pricePerCuFtHe: 3.5, pricePerCuFtTopOff: 0.1 };
const psi = { pressureUnit: "psi" as const };

const multiGasInput = (overrides: Partial<RealGasMultiGasInput> = {}): RealGasMultiGasInput => ({
  startPressure: 0,
  targetPressure: 3000,
  startO2: 21,
  startHe: 0,
  targetO2: 21,
  targetHe: 35,
  tankSizeCuFt: 80,
  tankRatedPressurePsi: 3000,
  startTemperatureF: 70,
  settledTemperatureF: 70,
  sources: [helium, oxygen, air],
  fillOrderMode: "auto",
  ...overrides
});

const standardInput = (overrides: Partial<StandardBlendInput> = {}): StandardBlendInput => ({
  startPressure: 0,
  targetPressure: 3000,
  startO2: 21,
  startHe: 0,
  targetO2: 21,
  targetHe: 35,
  tankSizeCuFt: 80,
  tankRatedPressurePsi: 3000,
  startTemperatureF: 70,
  settledTemperatureF: 70,
  stageTemperatureTouched: {},
  topGasId: "air",
  ...overrides
});

// Independent replay: GERG start state, add each step's moles, GERG pressure at each temperature.
const fahrenheitToKelvin = (valueF: number): number => (valueF + 459.67) * 5 / 9;
const waterVolumeLiters = (tankSizeCuFt: number, ratedPsi: number): number =>
  tankSizeCuFt * 28.316846592 * ATM_PRESSURE_PSI / ratedPsi;
const fractionsOf = (o2: number, he: number): GergGasFractions => ({ o2: o2 / 100, he: he / 100, n2: 1 - o2 / 100 - he / 100 });
type Moles = { o2: number; he: number; n2: number };
const total = (moles: Moles): number => moles.o2 + moles.he + moles.n2;
const fractionsFromMoles = (moles: Moles): GergGasFractions => ({
  o2: moles.o2 / total(moles),
  he: moles.he / total(moles),
  n2: moles.n2 / total(moles)
});
const gaugeAt = (moles: Moles, temperatureF: number, volume: number): number => {
  const state = gergPressureFromDensity(fahrenheitToKelvin(temperatureF), total(moles) / volume, fractionsFromMoles(moles));
  expect(state.success).toBe(true);
  return absoluteKpaToGaugePsi(state.pressureKpa);
};

const replay = (input: RealGasMultiGasInput, alternative: RealGasMultiGasAlternative) => {
  const volume = waterVolumeLiters(input.tankSizeCuFt, input.tankRatedPressurePsi);
  const bleed = alternative.steps.find((step) => step.kind === "bleed");
  const startPressurePsi = bleed ? bleed.stopPressurePsi : input.startPressure;
  const startFractions = fractionsOf(input.startO2, input.startHe);
  const startDensity = gergDensityFromPressure(
    fahrenheitToKelvin(input.startTemperatureF),
    gaugePsiToAbsoluteKpa(startPressurePsi),
    startFractions
  );
  expect(startDensity.success).toBe(true);
  const startMoles = startDensity.densityMolPerLiter * volume;
  let moles: Moles = { o2: startMoles * startFractions.o2, he: startMoles * startFractions.he, n2: startMoles * startFractions.n2 };
  const stops: number[] = [];
  for (const step of alternative.steps.filter((entry) => entry.kind === "add")) {
    const fractions = fractionsOf(step.gas?.o2 ?? 0, step.gas?.he ?? 0);
    moles = {
      o2: moles.o2 + step.molesAdded * fractions.o2,
      he: moles.he + step.molesAdded * fractions.he,
      n2: moles.n2 + step.molesAdded * fractions.n2
    };
    stops.push(gaugeAt(moles, step.temperatureF, volume));
  }
  const fractions = fractionsFromMoles(moles);
  return {
    stops,
    o2: fractions.o2 * 100,
    he: fractions.he * 100,
    settledPressurePsi: gaugeAt(moles, input.settledTemperatureF, volume)
  };
};

const expectExactReplay = (input: RealGasMultiGasInput, alternative: RealGasMultiGasAlternative): void => {
  const replayed = replay(input, alternative);
  expect(replayed.o2).toBeCloseTo(input.targetO2, 2);
  expect(replayed.he).toBeCloseTo(input.targetHe, 2);
  expect(replayed.settledPressurePsi).toBeCloseTo(input.targetPressure, 2);
  const addSteps = alternative.steps.filter((step) => step.kind === "add");
  replayed.stops.forEach((stop, index) => expect(addSteps[index].stopPressurePsi).toBeCloseTo(stop, 6));
};

const addSteps = (alternative: RealGasMultiGasAlternative) => alternative.steps.filter((step) => step.kind === "add");
const molesBySource = (alternative: RealGasMultiGasAlternative): Record<string, number> =>
  Object.fromEntries(addSteps(alternative).map((step) => [step.sourceId ?? "", step.molesAdded]));

describe("calculateRealGasMultiGasBlend", () => {
  test.each([
    [21, 35],
    [18, 45]
  ])("O2, He, and Air reproduce the Standard Blend GERG plan for %i/%i", (targetO2, targetHe) => {
    const result = calculateRealGasMultiGasBlend(psi, multiGasInput({ targetO2, targetHe }), prices);
    const standard = calculateRealGasStandardBlend(psi, standardInput({ targetO2, targetHe }), { id: "air", name: "Air", o2: 21, he: 0 });

    expect(result.success).toBe(true);
    expect(result.match).toBe("exact");
    const plan = result.alternatives[0];
    expect(addSteps(plan).map((step) => step.gasName)).toEqual(["Helium", "Oxygen", "Air"]);
    addSteps(plan).forEach((step, index) => {
      expect(step.molesAdded / standard.steps[index].molesAdded).toBeCloseTo(1, 9);
      expect(step.stopPressurePsi).toBeCloseTo(standard.steps[index].stopPressurePsi, 4);
      expect(step.z).toBeCloseTo(standard.steps[index].z, 9);
    });
    expect(plan.startZ).toBeCloseTo(standard.startZ ?? 0, 9);
  });

  test("pins the 21/35 empty-start stops", () => {
    const plan = calculateRealGasMultiGasBlend(psi, multiGasInput(), prices).alternatives[0];
    expect(addSteps(plan).map((step) => step.stopPressurePsi)).toEqual([
      expect.closeTo(986.968075, 3),
      expect.closeTo(1267.856321, 3),
      expect.closeTo(3000, 3)
    ]);
  });

  test("solves Air, Helium, and a trimix bank over a 12/76 residual in one pass", () => {
    const input = multiGasInput({
      startPressure: 500,
      startO2: 12,
      startHe: 76,
      targetO2: 15,
      targetHe: 55,
      fillOrderMode: "manual",
      sources: [
        { ...air, id: "air-0", stageTemperatureF: 80 },
        { ...helium, id: "helium-1", stageTemperatureF: 90 },
        { ...trimix2135, id: "trimix-2135-2" }
      ]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.success).toBe(true);
    expect(result.match).toBe("exact");
    expect(result.alternatives).toHaveLength(1);
    const plan = result.alternatives[0];
    expect(plan.steps.map((step) => step.gasName)).toEqual(["Air", "Helium", "Trimix 21/35"]);
    expect(plan.steps.map((step) => step.temperatureF)).toEqual([80, 90, 90]);
    expect(plan.steps.map((step) => step.stopPressurePsi)).toEqual([
      expect.closeTo(594.51, 1),
      expect.closeTo(1219.07, 1),
      expect.closeTo(3121.75, 1)
    ]);
    expect(plan.finalO2).toBeCloseTo(15, 6);
    expect(plan.finalHe).toBeCloseTo(55, 6);
    expect(plan.settledPressurePsi).toBeCloseTo(3000, 2);
    expectExactReplay(input, plan);

    // The ideal pressure-point plan adds about 65 psi of Air; real gas needs a larger Air rise.
    const ideal = solveNGasBlend(psi, 3000, 15, 55, 500, 12, 76, input.sources, prices);
    const idealAir = ideal.alternatives[0].steps.find((step) => step.gas.id === "air-0")?.amount ?? 0;
    expect(idealAir).toBeCloseTo(65.31, 1);
    expect(plan.steps[0].pressureChangePsi).toBeGreaterThan(idealAir + 15);
  });

  test("fill order changes stop pressures but not the moles of each source", () => {
    const auto = calculateRealGasMultiGasBlend(psi, multiGasInput(), prices).alternatives[0];
    const manual = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ fillOrderMode: "manual", sources: [air, oxygen, helium] }),
      prices
    ).alternatives[0];

    expect(addSteps(manual).map((step) => step.gasName)).toEqual(["Air", "Oxygen", "Helium"]);
    const autoMoles = molesBySource(auto);
    const manualMoles = molesBySource(manual);
    for (const id of Object.keys(autoMoles)) {
      expect(manualMoles[id]).toBeCloseTo(autoMoles[id], 9);
    }
    expect(Math.abs(addSteps(manual)[0].stopPressurePsi - addSteps(auto)[0].stopPressurePsi)).toBeGreaterThan(1);
    expect(manual.finalHotPressurePsi).toBeCloseTo(auto.finalHotPressurePsi, 6);
  });

  test("bleeds down to the helium-limited pressure before an exact fill", () => {
    const input = multiGasInput({ startPressure: 2000, startO2: 12, startHe: 76 });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.success).toBe(true);
    expect(result.match).toBe("bleed");
    expect(result.warnings).toContain(BLEED_REQUIRED_WARNING);
    const plan = result.alternatives[0];
    expect(plan.steps[0].kind).toBe("bleed");
    expect(plan.steps[0].stopPressurePsi).toBe(result.bleedToPsi);

    // The smallest bleed leaves exactly the target's helium moles in the cylinder.
    const volume = waterVolumeLiters(80, 3000);
    const targetDensity = gergDensityFromPressure(fahrenheitToKelvin(70), gaugePsiToAbsoluteKpa(3000), fractionsOf(21, 35));
    const heliumLimitedMoles = targetDensity.densityMolPerLiter * volume * 0.35 / 0.76;
    const heliumLimitedPsi = gaugeAt(
      { o2: heliumLimitedMoles * 0.12, he: heliumLimitedMoles * 0.76, n2: heliumLimitedMoles * 0.12 },
      70,
      volume
    );
    expect(result.bleedToPsi ?? 0).toBeCloseTo(heliumLimitedPsi, 1);
    expectExactReplay(input, plan);
  });

  test("finds the smallest bleed when bank limits exclude both the top and an empty cylinder", () => {
    // A nitrogen-rich start needs more oxygen the higher it stays, so an oxygen limit forces a
    // deeper bleed, while an Air limit rules out draining far.
    const input = multiGasInput({
      startPressure: 2500,
      startO2: 10,
      startHe: 0,
      targetO2: 32,
      targetHe: 0,
      sources: [
        { ...oxygen, maxPressurePsi: 600 },
        { ...air, maxPressurePsi: 1300 }
      ]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);
    const uncapped = calculateRealGasMultiGasBlend(psi, multiGasInput({ ...input, sources: [oxygen, air] }), prices);

    expect(result.match).toBe("bleed");
    expect(uncapped.match).toBe("bleed");
    expect(uncapped.bleedToPsi ?? 0).toBeGreaterThan(2200);
    expect(result.bleedToPsi ?? 0).toBeCloseTo(1466.54, 0);
    const plan = result.alternatives[0];
    const oxygenStep = plan.steps.find((step) => step.sourceId === oxygen.id);
    const airStep = plan.steps.find((step) => step.sourceId === air.id);
    expect(oxygenStep?.pressureChangePsi ?? 0).toBeLessThanOrEqual(600.01);
    expect(oxygenStep?.pressureChangePsi ?? 0).toBeGreaterThan(599.9);
    expect(airStep?.pressureChangePsi ?? 0).toBeLessThanOrEqual(1300.01);
    expectExactReplay(input, plan);
  });

  test("plans pure oxygen over 1 atm of air like Standard Blend", () => {
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ targetO2: 100, targetHe: 0, sources: [oxygen, air] }),
      prices
    );
    const standard = calculateRealGasStandardBlend(psi, standardInput({ targetO2: 100, targetHe: 0 }), {
      id: "air",
      name: "Air",
      o2: 21,
      he: 0
    });

    expect(result.match).toBe("residualAdjusted");
    const plan = result.alternatives[0];
    expect(plan.residualAdjustedMix?.o2).toBeCloseTo(standard.residualAdjustedMix?.o2 ?? 0, 9);
    expect(plan.residualAdjustedMix?.n2).toBeCloseTo(standard.residualAdjustedMix?.n2 ?? 0, 9);
    expect(addSteps(plan)[0].molesAdded).toBeCloseTo(standard.steps[0].molesAdded, 9);
    const residualWarning = standard.warnings.find((warning) => warning.startsWith("An empty cylinder"));
    expect(plan.warnings).toContain(residualWarning);
    expect(plan.warnings).toContain("High O2 - fire risk (>40% O2).");
  });

  test("plans heliox over 1 atm of air like Standard Blend", () => {
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ targetO2: 50, targetHe: 50, sources: [helium, oxygen] }),
      prices
    );
    const standard = calculateRealGasStandardBlend(psi, standardInput({ targetO2: 50, targetHe: 50 }), {
      id: "air",
      name: "Air",
      o2: 21,
      he: 0
    });

    expect(result.match).toBe("residualAdjusted");
    const plan = result.alternatives[0];
    expect(plan.residualAdjustedMix?.o2).toBeCloseTo(standard.residualAdjustedMix?.o2 ?? 0, 9);
    expect(plan.residualAdjustedMix?.he).toBeCloseTo(standard.residualAdjustedMix?.he ?? 0, 9);
    addSteps(plan).forEach((step, index) => {
      expect(step.stopPressurePsi).toBeCloseTo(standard.steps[index].stopPressurePsi, 6);
    });
  });

  test("drains to 0 before a residual-adjusted plan when no partial bleed works", () => {
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ startPressure: 500, targetO2: 100, targetHe: 0, sources: [oxygen] }),
      prices
    );

    expect(result.match).toBe("residualAdjusted");
    expect(result.bleedToPsi).toBe(0);
    expect(result.warnings).toContain(BLEED_REQUIRED_WARNING);
    const plan = result.alternatives[0];
    expect(plan.steps[0]).toMatchObject({ kind: "bleed", stopPressurePsi: 0, pressureChangePsi: -500 });
    expect(plan.finalO2).toBeCloseTo(99.637, 2);
  });

  test("does not accept a near-match single source as exact", () => {
    // A lone 18/45 bank over 1 atm of air ends near 18.02/44.75, so it is not listed as exact.
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({
        targetO2: 18,
        targetHe: 45,
        sources: [helium, oxygen, air, { id: "trimix-1845-3", name: "Trimix 18/45", o2: 18, he: 45 }]
      }),
      prices
    );

    expect(result.match).toBe("exact");
    expect(result.alternatives.length).toBeGreaterThanOrEqual(2);
    for (const alternative of result.alternatives) {
      expect(alternative.finalO2).toBeCloseTo(18, 2);
      expect(alternative.finalHe).toBeCloseTo(45, 2);
      expect(alternative.settledPressurePsi).toBeCloseTo(3000, 2);
    }
    const costs = result.alternatives.map((alternative) => alternative.estimatedCost);
    expect(costs).toEqual([...costs].sort((a, b) => a - b));
  });

  describe("bank limits", () => {
    test("rejects every option when a limit is below the real pressure rise", () => {
      const result = calculateRealGasMultiGasBlend(
        psi,
        multiGasInput({ targetO2: 40, targetHe: 0, sources: [{ ...oxygen, maxPressurePsi: 500 }, air] }),
        prices
      );

      expect(result.success).toBe(false);
      expect(result.failure).toBe("noBlend");
      expect(result.errors).toEqual([MULTI_GAS_BANK_LIMIT_ERROR]);
      expect(result.warnings).toContain(BANK_LIMITS_EXCLUDE_ALL_WARNING);
    });

    test("measures the limit as the real-gas pressure rise, not the ideal amount", () => {
      // EAN40 from empty: ideal oxygen is about 721.5 psi, the real rise over 1 atm of air about 694.6.
      const ideal = solveNGasBlend(psi, 3000, 40, 0, 0, 21, 0, [{ ...oxygen, maxPressurePsi: 710 }, air], prices);
      const result = calculateRealGasMultiGasBlend(
        psi,
        multiGasInput({ targetO2: 40, targetHe: 0, sources: [{ ...oxygen, maxPressurePsi: 710 }, air] }),
        prices
      );

      // Ideal mode cannot hit EAN40 under this limit and falls back to a nearby mix.
      expect(ideal.warnings).toContain(MULTI_GAS_SIMILAR_BLEND_WARNING);
      expect(result.match).toBe("exact");
      const oxygenStep = result.alternatives[0].steps.find((step) => step.sourceId === oxygen.id);
      expect(oxygenStep?.pressureChangePsi ?? 0).toBeCloseTo(694.64, 1);
    });

    test("still finds a closest blend deep in the candidate list", () => {
      // With helium limited to 400 psi, 15/55 cannot be made; the first option that fits the limits
      // sits far down the closest-blend list.
      const result = calculateRealGasMultiGasBlend(
        psi,
        multiGasInput({
          targetO2: 15,
          targetHe: 55,
          sources: [
            { ...helium, maxPressurePsi: 400 },
            oxygen,
            { ...air, maxPressurePsi: 900 },
            { id: "bank-36-3", name: "EAN36", o2: 36, he: 0 },
            { ...trimix2135, id: "trimix-2135-4" },
            { id: "trimix-1845-5", name: "Trimix 18/45", o2: 18, he: 45 }
          ]
        }),
        prices
      );

      expect(result.match).toBe("closest");
      expect(result.alternatives.length).toBeGreaterThan(0);
      for (const alternative of result.alternatives) {
        const heliumStep = alternative.steps.find((step) => step.sourceId === helium.id);
        const airStep = alternative.steps.find((step) => step.sourceId === air.id);
        expect(heliumStep?.pressureChangePsi ?? 0).toBeLessThanOrEqual(400.01);
        expect(airStep?.pressureChangePsi ?? 0).toBeLessThanOrEqual(900.01);
        expect(alternative.settledPressurePsi).toBeCloseTo(3000, 2);
      }
    });

    test("depends on fill order because the real rise does", () => {
      // Helium rises about 987 psi when added first and about 1267 psi when added last.
      const cappedHelium = { ...helium, maxPressurePsi: 1100 };
      const first = calculateRealGasMultiGasBlend(psi, multiGasInput({ sources: [cappedHelium, oxygen, air] }), prices);
      const last = calculateRealGasMultiGasBlend(
        psi,
        multiGasInput({ fillOrderMode: "manual", sources: [oxygen, air, cappedHelium] }),
        prices
      );

      expect(first.match).toBe("exact");
      expect(last.match).not.toBe("exact");
    });
  });

  test("prices real-gas moles at the 70 F free-gas reference", () => {
    const result = calculateRealGasMultiGasBlend(psi, multiGasInput(), prices);
    const plan = result.alternatives[0];
    const unitPrice: Record<string, number> = { "helium-0": 3.5, "oxygen-1": 1, "air-2": 0.21 * 1 + 0.79 * 0.1 };
    const volume = result.waterVolumeLiters;
    let expectedCost = 0;
    for (const step of addSteps(plan)) {
      const cuFt = realGasMolesToFreeGasCuFt(step.molesAdded, volume, 80, 3000);
      expect(step.volumeCuFt).toBeCloseTo(cuFt, 9);
      expectedCost += cuFt * unitPrice[step.sourceId ?? ""];
    }
    expect(plan.estimatedCost).toBeCloseTo(expectedCost, 9);
    expect(addSteps(plan).map((step) => step.volumeCuFt)).toEqual([
      expect.closeTo(25.431, 3),
      expect.closeTo(6.76, 3),
      expect.closeTo(40.077, 3)
    ]);
  });

  test("shows the closest blend when the sources cannot make the target", () => {
    const input = multiGasInput({
      targetO2: 25,
      targetHe: 25,
      sources: [
        { id: "bank-36-0", name: "EAN36", o2: 36, he: 0 },
        { id: "custom-1", name: "10/50", o2: 10, he: 50 }
      ]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("closest");
    expect(result.warnings).toContain(MULTI_GAS_SIMILAR_BLEND_WARNING);
    for (const alternative of result.alternatives) {
      expect(Math.abs(alternative.deviationO2)).toBeLessThanOrEqual(1 + 1e-6);
      expect(Math.abs(alternative.deviationHe)).toBeLessThanOrEqual(5 + 1e-6);
      expect(alternative.settledPressurePsi).toBeCloseTo(3000, 2);
    }
  });

  test("gives the same plan for psi and bar inputs", () => {
    const psiPlan = calculateRealGasMultiGasBlend(psi, multiGasInput(), prices).alternatives[0];
    const barPlan = calculateRealGasMultiGasBlend(
      { pressureUnit: "bar" },
      multiGasInput({ targetPressure: 3000 / 14.5037738 }),
      prices
    ).alternatives[0];

    addSteps(psiPlan).forEach((step, index) => {
      expect(addSteps(barPlan)[index].molesAdded).toBeCloseTo(step.molesAdded, 8);
      expect(addSteps(barPlan)[index].stopPressurePsi).toBeCloseTo(step.stopPressurePsi, 6);
    });
  });

  test("keeps stop pressures and scales moles with tank size", () => {
    const small = calculateRealGasMultiGasBlend(psi, multiGasInput(), prices).alternatives[0];
    const large = calculateRealGasMultiGasBlend(psi, multiGasInput({ tankSizeCuFt: 120 }), prices).alternatives[0];

    addSteps(small).forEach((step, index) => {
      expect(addSteps(large)[index].stopPressurePsi).toBeCloseTo(step.stopPressurePsi, 6);
      expect(addSteps(large)[index].molesAdded / step.molesAdded).toBeCloseTo(1.5, 9);
    });
  });

  test("tops up gas that cooled from a hot start", () => {
    const input = multiGasInput({
      startPressure: 3000,
      startO2: 32,
      startHe: 0,
      targetO2: 32,
      targetHe: 0,
      startTemperatureF: 100,
      sources: [oxygen, air]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("exact");
    const plan = result.alternatives[0];
    expect(plan.steps.every((step) => step.temperatureF === 100)).toBe(true);
    expect(plan.finalHotPressurePsi).toBeGreaterThan(3200);
    expectExactReplay(input, plan);
  });

  test("reports a start that already matches the target", () => {
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ startPressure: 3000, startO2: 32, startHe: 0, targetO2: 32, targetHe: 0, sources: [oxygen, air] }),
      prices
    );

    expect(result.success).toBe(false);
    expect(result.failure).toBe("input");
    expect(result.errors).toEqual([START_MATCHES_TARGET_ERROR]);
  });

  describe("input and envelope errors", () => {
    test.each([
      [{ targetPressure: 0 }, "Target pressure must be greater than zero."],
      [{ startPressure: -1 }, "Start pressure cannot be negative."],
      [{ targetO2: 70, targetHe: 40 }, "O2 + He must be 100% or less."],
      [{ sources: [] }, "No gas sources available."],
      [{ tankSizeCuFt: 0 }, "Tank size and rated pressure are required for GERG-2008 correction."],
      [{ startTemperatureF: -400 }, "GERG-2008 correction is limited to temperatures at or above 250 K."],
      [{ sources: [{ ...helium, stageTemperatureF: -20 }, oxygen, air] }, "GERG-2008 correction is limited to temperatures at or above 250 K."]
    ])("rejects %o", (overrides, error) => {
      const result = calculateRealGasMultiGasBlend(psi, multiGasInput(overrides), prices);
      expect(result.success).toBe(false);
      expect(result.failure).toBe("input");
      expect(result.errors).toEqual([error]);
    });

    test("fails on targets above 400 bar", () => {
      const result = calculateRealGasMultiGasBlend(psi, multiGasInput({ targetPressure: 6000 }), prices);
      expect(result.failure).toBe("gerg");
      expect(result.errors).toEqual(["GERG-2008 correction is limited to pressures at or below 400 bar absolute."]);
    });

    test("fails when a hot stage would pass 400 bar during the fill", () => {
      const result = calculateRealGasMultiGasBlend(
        psi,
        multiGasInput({ targetPressure: 5600, sources: [{ ...helium, stageTemperatureF: 200 }, oxygen, air] }),
        prices
      );
      expect(result.failure).toBe("gerg");
      expect(result.errors).toEqual(["GERG-2008 correction is limited to pressures at or below 400 bar absolute."]);
    });
  });
});

describe("calculateRealGasMultiGasBlend edge cases", () => {
  const ean36: RealGasMultiGasSource = { id: "bank-36-0", name: "EAN36", o2: 36, he: 0 };
  const nearEan32: RealGasMultiGasSource = { id: "custom-0", name: "Custom (31.6 O2 / 0.0 He)", o2: 31.6, he: 0 };

  test("rejects a target that holds less gas than the 1 atm left in an empty cylinder", () => {
    // 1 psi of air at 200 F is fewer moles than 0 psi of air at 70 F.
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ targetPressure: 1, targetO2: 21, targetHe: 0, settledTemperatureF: 200, sources: [air] }),
      prices
    );

    expect(result.success).toBe(false);
    expect(result.failure).toBe("input");
    expect(result.errors).toEqual([TARGET_BELOW_RESIDUAL_ERROR]);
  });

  test.each([
    ["exact", multiGasInput()],
    ["bleed", multiGasInput({ startPressure: 2000, startO2: 12, startHe: 76 })],
    ["residual", multiGasInput({ targetO2: 50, targetHe: 50, sources: [helium, oxygen] })],
    [
      "closest",
      multiGasInput({
        targetO2: 25,
        targetHe: 25,
        sources: [ean36, { id: "custom-1", name: "10/50", o2: 10, he: 50 }]
      })
    ],
    ["hot settle", multiGasInput({ settledTemperatureF: 110, sources: [{ ...helium, stageTemperatureF: 120 }, oxygen, air] })]
  ])("every %s option settles on the target pressure", (_name, input) => {
    const result = calculateRealGasMultiGasBlend(psi, input, prices);
    expect(result.alternatives.length).toBeGreaterThan(0);
    for (const alternative of result.alternatives) {
      expect(Math.abs(alternative.settledPressurePsi - input.targetPressure)).toBeLessThanOrEqual(0.05);
    }
  });

  test("solves the retained start amount for one- and two-source bleeds", () => {
    // Air plus EAN36 makes EAN32 only when 80/3 % of the target is kept from the air start.
    expect(isolatedBleedStartAmounts(3000, { o2: 32, he: 0 }, { o2: 21, he: 0 }, [ean36])).toEqual([
      expect.closeTo(800, 9)
    ]);
    // A mix that does not lie between the start and the source has no single-source answer.
    expect(isolatedBleedStartAmounts(3000, { o2: 32, he: 10 }, { o2: 21, he: 0 }, [ean36])).toEqual([]);
  });

  test("finds an air-to-EAN32 bleed with a single EAN36 bank", () => {
    // The only exact fill drains to one pressure between the bleed scan's sample points.
    const input = multiGasInput({ startPressure: 2000, targetO2: 32, targetHe: 0, sources: [ean36] });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("bleed");
    expect(result.bleedToPsi ?? 0).toBeCloseTo(763.56, 1);
    expect(result.alternatives[0].steps.map((step) => step.gasName)).toEqual(["Bleed Tank", "EAN36"]);
    expectExactReplay(input, result.alternatives[0]);
  });

  test("finds an isolated two-source bleed from an EAN40 start", () => {
    const input = multiGasInput({
      startPressure: 1120.923,
      startO2: 40,
      startHe: 0,
      sources: [air, helium]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("bleed");
    expect(result.bleedToPsi ?? 0).toBeCloseTo(1019.02, 1);
    expectExactReplay(input, result.alternatives[0]);
  });

  test("shows a near-match single source as the closest blend, not a residual plan", () => {
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ targetO2: 32, targetHe: 0, sources: [nearEan32] }),
      prices
    );

    expect(result.match).toBe("closest");
    expect(result.warnings).toContain(MULTI_GAS_SIMILAR_BLEND_WARNING);
    const plan = result.alternatives[0];
    expect(plan.residualAdjustedMix).toBeUndefined();
    expect(plan.warnings.some((warning) => warning.startsWith("An empty cylinder"))).toBe(false);
    expect(plan.steps.some((step) => step.kind === "bleed")).toBe(false);
  });

  test("drains to 0 for a closest blend only when no nearby mix is reachable from the start", () => {
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ startPressure: 500, targetO2: 32, targetHe: 0, sources: [nearEan32] }),
      prices
    );

    expect(result.match).toBe("closest");
    expect(result.bleedToPsi).toBe(0);
    expect(result.warnings).toEqual(expect.arrayContaining([BLEED_REQUIRED_WARNING, MULTI_GAS_SIMILAR_BLEND_WARNING]));
    const plan = result.alternatives[0];
    expect(plan.steps[0]).toMatchObject({ kind: "bleed", stopPressurePsi: 0 });
    expect(plan.residualAdjustedMix).toBeUndefined();
    expect(plan.finalO2).toBeCloseTo(31.55, 1);
  });
});

describe("calculateRealGasMultiGasBlend limits after scaling", () => {
  test("checks bank limits on residual-adjusted amounts, not the empty-cylinder plan", () => {
    // Pure oxygen to 5 psi over 1 atm of air: the empty-cylinder plan is about 19.7 psi of oxygen,
    // but the cylinder already holds 1 atm, so the real rise is 5 psi.
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ targetPressure: 5, targetO2: 100, targetHe: 0, sources: [{ ...oxygen, maxPressurePsi: 6 }] }),
      prices
    );

    expect(result.match).toBe("residualAdjusted");
    const oxygenStep = result.alternatives[0].steps.find((step) => step.sourceId === oxygen.id);
    expect(oxygenStep?.pressureChangePsi ?? 0).toBeCloseTo(5, 2);
    expect(result.alternatives[0].settledPressurePsi).toBeCloseTo(5, 2);
  });

  test("keeps closest blends inside +/-1% O2 and +/-5% He after settling", () => {
    // Over a helium residual this source refines to just past 5 points of helium below target.
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({
        startO2: 0,
        startHe: 100,
        targetO2: 18,
        targetHe: 50,
        sources: [{ id: "custom-0", name: "18/44.698", o2: 18, he: 44.69823348 }]
      }),
      prices
    );

    for (const alternative of result.alternatives) {
      expect(Math.abs(alternative.deviationO2)).toBeLessThanOrEqual(1 + 1e-6);
      expect(Math.abs(alternative.deviationHe)).toBeLessThanOrEqual(5 + 1e-6);
    }
    expect(result.match).not.toBe("closest");
  });
});

describe("calculateRealGasMultiGasBlend bleeds between two bank limits", () => {
  test("describes nitrox pairs and three-source helium subsets as ranges of kept start gas", () => {
    const ean36 = { id: "bank-36", name: "EAN36", o2: 36, he: 0 };
    const nitroxPair = bleedSubsetSolutions(3000, { o2: 32, he: 0 }, { o2: 10, he: 0 }, [oxygen, air]);
    const pairLine = nitroxPair.find((solution) => solution.kind === "line");
    expect(pairLine).toBeDefined();
    if (pairLine?.kind === "line") {
      // Keeping r of EAN10 leaves 960 - 0.1r of O2 to add from Oxygen and Air.
      const retained = 1500;
      const additions = pairLine.offsets.map((offset, index) => offset - pairLine.slopes[index] * retained);
      expect(retained + additions[0] + additions[1]).toBeCloseTo(3000, 9);
      expect(retained * 0.1 + additions[0] + additions[1] * 0.21).toBeCloseTo(960, 9);
      // Air runs out when 0.9r of the start's nitrogen covers the target's 2040.
      expect(pairLine.maxRetained).toBeCloseTo(2040 / 0.9, 6);
    }

    const heliumTriple = bleedSubsetSolutions(3000, { o2: 21, he: 35 }, { o2: 10, he: 0 }, [helium, oxygen, air]);
    expect(heliumTriple.some((solution) => solution.kind === "line" && solution.sources.length === 3)).toBe(true);
    const single = bleedSubsetSolutions(3000, { o2: 32, he: 0 }, { o2: 21, he: 0 }, [ean36]);
    expect(single).toHaveLength(1);
    expect(single[0].kind).toBe("point");
    expect(single[0].kind === "point" ? single[0].retained : 0).toBeCloseTo(800, 9);
  });

  test("finds a narrow window where an oxygen limit caps the bleed from above and an Air limit from below", () => {
    const input = multiGasInput({
      startPressure: 2500,
      startO2: 10,
      startHe: 0,
      targetO2: 32,
      targetHe: 0,
      sources: [
        { ...oxygen, maxPressurePsi: 600 },
        { ...air, maxPressurePsi: 935 }
      ]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("bleed");
    expect(result.bleedToPsi ?? 0).toBeGreaterThan(1465);
    expect(result.bleedToPsi ?? 0).toBeLessThan(1467);
    const plan = result.alternatives[0];
    expect(plan.steps.find((step) => step.sourceId === oxygen.id)?.pressureChangePsi ?? 0).toBeLessThanOrEqual(600.01);
    expect(plan.steps.find((step) => step.sourceId === air.id)?.pressureChangePsi ?? 0).toBeLessThanOrEqual(935.01);
    expectExactReplay(input, plan);
  });

  test("finds a narrow three-source window with oxygen and Air limits", () => {
    const input = multiGasInput({
      startPressure: 2000,
      startO2: 10,
      startHe: 0,
      targetO2: 21,
      targetHe: 35,
      sources: [
        helium,
        { ...oxygen, maxPressurePsi: 451.2 },
        { ...air, maxPressurePsi: 424.7 }
      ]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("bleed");
    expect(result.bleedToPsi ?? 0).toBeGreaterThan(995);
    expect(result.bleedToPsi ?? 0).toBeLessThan(1010);
    const plan = result.alternatives[0];
    expect(plan.steps.find((step) => step.sourceId === oxygen.id)?.pressureChangePsi ?? 0).toBeLessThanOrEqual(451.21);
    expect(plan.steps.find((step) => step.sourceId === air.id)?.pressureChangePsi ?? 0).toBeLessThanOrEqual(424.71);
    expectExactReplay(input, plan);
  });
});

describe("calculateRealGasMultiGasBlend start temperature warnings", () => {
  test("keeps the above-400 K warning for a hot start when every stage is at 70 F", () => {
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({
        startPressure: 500,
        startTemperatureF: 300,
        sources: [
          { ...helium, stageTemperatureF: 70 },
          { ...oxygen, stageTemperatureF: 70 },
          { ...air, stageTemperatureF: 70 }
        ]
      }),
      prices
    );

    expect(result.success).toBe(true);
    expect(result.warnings).toContain("GERG-2008 correction is outside the normal scuba fill temperature range above 400 K.");
  });
});

describe("calculateRealGasMultiGasBlend fourth review cases", () => {
  test("solves banks that share the start's helium fraction as a range on the O2 balance", () => {
    // 10/35 start with 15/35 and 30/35 banks: every gas is 35% helium, so the helium balance only
    // repeats the total and the pair leaves a range of kept start gas.
    const input = multiGasInput({
      startPressure: 2000,
      startO2: 10,
      startHe: 35,
      targetO2: 21,
      targetHe: 35,
      fillOrderMode: "manual",
      sources: [
        { id: "custom-0", name: "15/35", o2: 15, he: 35, maxPressurePsi: 343.688 },
        { id: "custom-1", name: "30/35", o2: 30, he: 35, maxPressurePsi: 1656.352 }
      ]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("bleed");
    expect(result.bleedToPsi ?? 0).toBeCloseTo(1000, 0);
    const plan = result.alternatives[0];
    expect(plan.steps.find((step) => step.sourceId === "custom-0")?.pressureChangePsi ?? 0).toBeLessThanOrEqual(343.698);
    expect(plan.steps.find((step) => step.sourceId === "custom-1")?.pressureChangePsi ?? 0).toBeLessThanOrEqual(1656.362);
    expectExactReplay(input, plan);
  });

  test("bounds a fixed helium amount by its real rise, which still changes with the residual", () => {
    // The start has no helium, so the helium moles are the same at every bleed, but their rise is not.
    const input = multiGasInput({
      startPressure: 2000,
      startO2: 10,
      startHe: 0,
      sources: [
        { ...helium, maxPressurePsi: 1127.26 },
        oxygen,
        { ...air, maxPressurePsi: 422.01 }
      ]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("bleed");
    expect(result.bleedToPsi ?? 0).toBeGreaterThan(999);
    expect(result.bleedToPsi ?? 0).toBeLessThan(1002);
    const plan = result.alternatives[0];
    expect(plan.steps.find((step) => step.sourceId === helium.id)?.pressureChangePsi ?? 0).toBeLessThanOrEqual(1127.27);
    expect(plan.steps.find((step) => step.sourceId === air.id)?.pressureChangePsi ?? 0).toBeLessThanOrEqual(422.02);
    expectExactReplay(input, plan);
  });

  test("drains excess start gas that already has the target mix", () => {
    const input = multiGasInput({
      startPressure: 3000,
      startO2: 32,
      startHe: 0,
      targetPressure: 2000,
      targetO2: 32,
      targetHe: 0,
      sources: [air]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("bleed");
    expect(result.bleedToPsi ?? 0).toBeCloseTo(2000, 2);
    const plan = result.alternatives[0];
    expect(plan.steps).toHaveLength(1);
    expect(plan.steps[0]).toMatchObject({ kind: "bleed" });
    expect(plan.settledPressurePsi).toBeCloseTo(2000, 2);
    expect(plan.estimatedCost).toBe(0);
  });

  test("reports a GERG failure, not no blend, when a required bleed breaks the envelope", () => {
    // Only Oxygen and Air: the 76% helium start must be drained, and a 120 F Air stage then passes
    // 400 bar on the way to 5600 psi.
    const hot = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({
        startPressure: 5000,
        startO2: 12,
        startHe: 76,
        targetPressure: 5600,
        sources: [oxygen, { ...air, stageTemperatureF: 120 }]
      }),
      prices
    );
    expect(hot.success).toBe(false);
    expect(hot.failure).toBe("gerg");
    expect(hot.errors).toEqual(["GERG-2008 correction is limited to pressures at or below 400 bar absolute."]);

    const normal = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ startPressure: 5000, startO2: 12, startHe: 76, targetPressure: 5600, sources: [oxygen, air] }),
      prices
    );
    expect(normal.match).toBe("bleed");
  });
});

describe("calculateRealGasMultiGasBlend fifth review cases", () => {
  test("fills from two helium banks with the same O2:He ratio", () => {
    // 10/25 and 20/50 are parallel in O2/He, so the pair is solved on the total and O2 and the
    // helium balance is checked.
    const input = multiGasInput({
      startPressure: 0,
      startO2: 15,
      startHe: 37.5,
      targetO2: 15,
      targetHe: 37.5,
      sources: [
        { id: "custom-0", name: "10/25", o2: 10, he: 25 },
        { id: "custom-1", name: "20/50", o2: 20, he: 50 }
      ]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("exact");
    const plan = result.alternatives[0];
    const lean = plan.steps.find((step) => step.sourceId === "custom-0")?.molesAdded ?? 0;
    const rich = plan.steps.find((step) => step.sourceId === "custom-1")?.molesAdded ?? 0;
    expect(lean).toBeGreaterThan(0);
    expect(rich / lean).toBeCloseTo(1, 9);
    expectExactReplay(input, plan);
  });

  test("reports a GERG failure when the only cap-feasible candidates break the envelope", () => {
    // A 21/35 bank capped at 0 psi is rejected by its limit while every Helium/Oxygen/Air plan
    // passes 400 bar at a 200 F helium stage, so GERG-2008 cannot evaluate the fill.
    const sources = [
      { ...helium, stageTemperatureF: 200 },
      oxygen,
      air,
      { id: "custom-0", name: "21/35", o2: 21, he: 35, maxPressurePsi: 0 }
    ];
    const result = calculateRealGasMultiGasBlend(psi, multiGasInput({ targetPressure: 5600, sources }), prices);

    expect(result.success).toBe(false);
    expect(result.failure).toBe("gerg");
    expect(result.errors).toEqual(["GERG-2008 correction is limited to pressures at or below 400 bar absolute."]);

    const capsOnly = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ targetPressure: 5600, sources: [{ id: "custom-0", name: "21/35", o2: 21, he: 35, maxPressurePsi: 0 }] }),
      prices
    );
    expect(capsOnly.failure).toBe("noBlend");
  });
});

describe("calculateRealGasMultiGasBlend sixth review cases", () => {
  test("bleeds an EAN40 start for two helium banks with the same O2:He ratio", () => {
    // Keeping 8.75% of the target moles as EAN40 and adding 7.5% of 10/20 and 83.75% of 20/40 makes 21/35.
    const input = multiGasInput({
      startPressure: 2000,
      startO2: 40,
      startHe: 0,
      sources: [
        { id: "custom-0", name: "10/20", o2: 10, he: 20 },
        { id: "custom-1", name: "20/40", o2: 20, he: 40 }
      ]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("bleed");
    const plan = result.alternatives[0];
    const lean = plan.steps.find((step) => step.sourceId === "custom-0")?.molesAdded ?? 0;
    const rich = plan.steps.find((step) => step.sourceId === "custom-1")?.molesAdded ?? 0;
    expect(lean).toBeGreaterThan(0);
    expect(rich / lean).toBeCloseTo(83.75 / 7.5, 2);
    expectExactReplay(input, plan);
  });

  test("solves banks that share the start's nitrogen fraction as a range", () => {
    // 10/80 start, 21/69 target, and 15/75 and 30/60 banks are all 10% nitrogen, so the O2 and He
    // balances only repeat the total between them and the pair leaves a range of kept start gas.
    const input = multiGasInput({
      startPressure: 2000,
      startO2: 10,
      startHe: 80,
      targetO2: 21,
      targetHe: 69,
      fillOrderMode: "manual",
      sources: [
        { id: "custom-0", name: "15/75", o2: 15, he: 75, maxPressurePsi: 343.15 },
        { id: "custom-1", name: "30/60", o2: 30, he: 60, maxPressurePsi: 1656.89 }
      ]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("bleed");
    expect(result.bleedToPsi ?? 0).toBeGreaterThan(990);
    expect(result.bleedToPsi ?? 0).toBeLessThan(1010);
    const plan = result.alternatives[0];
    expect(plan.steps.find((step) => step.sourceId === "custom-0")?.pressureChangePsi ?? 0).toBeLessThanOrEqual(343.16);
    expect(plan.steps.find((step) => step.sourceId === "custom-1")?.pressureChangePsi ?? 0).toBeLessThanOrEqual(1656.9);
    expectExactReplay(input, plan);
  });

  test("describes a constant-nitrogen pair as a range of kept start gas", () => {
    const solutions = bleedSubsetSolutions(3000, { o2: 21, he: 69 }, { o2: 10, he: 80 }, [
      { id: "custom-0", name: "15/75", o2: 15, he: 75 },
      { id: "custom-1", name: "30/60", o2: 30, he: 60 }
    ]);
    // 30/60 alone works at one kept amount; the pair works over a range.
    expect(solutions.map((solution) => [solution.kind, solution.sources.map((gas) => gas.name)])).toEqual([
      ["point", ["30/60"]],
      ["line", ["15/75", "30/60"]]
    ]);
  });
});

describe("calculateRealGasMultiGasBlend seventh review cases", () => {
  test.each([
    [18, 17.995, "Hypoxic mix (<18% O2)."],
    [40, 40.005, "High O2 - fire risk (>40% O2)."]
  ])("flags the O2 an exact plan actually reaches: target %s, reached %s", (targetO2, reachedO2, flag) => {
    const gas = { id: "custom-0", name: "Bank", o2: reachedO2, he: 0 };
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({ startO2: reachedO2, targetO2, targetHe: 0, sources: [gas] }),
      prices
    );

    expect(result.match).toBe("exact");
    expect(result.alternatives[0].finalO2).toBeCloseTo(reachedO2, 6);
    expect(result.warnings).toContain(flag);
  });

  test("judges a bank limit at the refined scale, not the first estimate", () => {
    // 15/75 over a 15/75 start cannot make 15/80, but it is within the closest-blend limits. Sized for
    // 15/80's moles, the first estimate rises about 108 psi; settling at 3000 psi needs only 100.
    const input = multiGasInput({
      startPressure: 2900,
      startO2: 15,
      startHe: 75,
      targetO2: 15,
      targetHe: 80,
      sources: [{ id: "custom-0", name: "15/75", o2: 15, he: 75, maxPressurePsi: 101 }]
    });
    const result = calculateRealGasMultiGasBlend(psi, input, prices);

    expect(result.match).toBe("closest");
    const plan = result.alternatives[0];
    expect(plan.steps[0].pressureChangePsi).toBeLessThanOrEqual(101.01);
    expect(plan.finalHe).toBeCloseTo(75, 6);
    expect(plan.settledPressurePsi).toBeCloseTo(3000, 2);
  });
});

describe("calculateRealGasMultiGasBlend eighth review cases", () => {
  test("reports no blend when only bank limits stop a bleed whose uncapped probes break the envelope", () => {
    // The only source is capped at 0 psi; the uncapped bleed probe's 200 F stage passes 400 bar.
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({
        startPressure: 500,
        startO2: 21,
        startHe: 35,
        targetPressure: 5600,
        sources: [{ id: "custom-0", name: "21/35", o2: 21, he: 35, maxPressurePsi: 0, stageTemperatureF: 200 }]
      }),
      prices
    );
    expect(result.success).toBe(false);
    expect(result.failure).toBe("noBlend");
  });

  test("counts a bank limit a completed stage broke before a later stage fails", () => {
    // Oxygen (capped at 0 psi) fills before the 200 F Air stage passes 400 bar.
    const result = calculateRealGasMultiGasBlend(
      psi,
      multiGasInput({
        startPressure: 1000,
        startO2: 10,
        startHe: 0,
        targetPressure: 5600,
        targetO2: 32,
        targetHe: 0,
        sources: [{ ...oxygen, maxPressurePsi: 0 }, { ...air, stageTemperatureF: 200 }]
      }),
      prices
    );
    expect(result.success).toBe(false);
    expect(result.failure).toBe("noBlend");
  });
});

describe("resolveMultiGasStageTemperaturesF", () => {
  test("inherits the previous stage, then Start Temp", () => {
    expect(
      resolveMultiGasStageTemperaturesF(
        [{}, { stageTemperatureF: 90 }, {}, { stageTemperatureF: 80 }, {}],
        70
      )
    ).toEqual([70, 90, 90, 80, 80]);
  });
});
