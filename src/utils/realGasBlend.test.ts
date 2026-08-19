import { describe, expect, test } from "vitest";
import type { StandardBlendInput, TopOffInput } from "../state/session";
import type { GasSelection } from "./calculations";
import { calculateStandardBlend } from "./calculations";
import {
  ATM_PRESSURE_PSI,
  absoluteKpaToGaugePsi,
  gasFractionsFromPercents,
  gaugePsiToAbsoluteKpa,
  gergDensityFromPressure,
  gergPressureFromDensity,
  type GergGasFractions
} from "./gerg2008";
import {
  calculateRealGasStandardBlend,
  calculateRealGasTopOff,
  type RealGasBlendResult,
  type RealGasTopOffResult
} from "./realGasBlend";
import { fahrenheitToKelvin } from "./temperature";
import { toDisplayPressure } from "./units";

const air: GasSelection = { id: "air", name: "Air", o2: 21, he: 0 };
const CUFT_TO_LITERS = 28.316846592;

const standardTrimixInput = (overrides: Partial<StandardBlendInput> = {}): StandardBlendInput => ({
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
  stageTemperaturesF: { helium: 70, oxygen: 70, topoff: 70 },
  stageTemperatureTouched: {},
  topGasId: "air",
  ...overrides
});

const trimixTopOffInput = (overrides: Partial<TopOffInput> = {}): TopOffInput => ({
  startPressure: 1000,
  finalPressure: 3000,
  startO2: 18,
  startHe: 45,
  tankSizeCuFt: 80,
  tankRatedPressurePsi: 3000,
  startTemperatureF: 70,
  resultTemperatureF: 95,
  topGasId: "air",
  ...overrides
});

type ComponentMoles = {
  o2: number;
  he: number;
  n2: number;
};

const waterVolumeLiters = (tankSizeCuFt: number, tankRatedPressurePsi: number): number =>
  tankSizeCuFt * CUFT_TO_LITERS * ATM_PRESSURE_PSI / (tankRatedPressurePsi + ATM_PRESSURE_PSI);

const componentMoles = (total: number, fractions: GergGasFractions): ComponentMoles => ({
  o2: total * fractions.o2,
  he: total * fractions.he,
  n2: total * fractions.n2
});

const addComponents = (
  components: ComponentMoles,
  moles: number,
  fractions: GergGasFractions
): ComponentMoles => ({
  o2: components.o2 + moles * fractions.o2,
  he: components.he + moles * fractions.he,
  n2: components.n2 + moles * fractions.n2
});

const fractionsFromComponents = (components: ComponentMoles): GergGasFractions => {
  const total = components.o2 + components.he + components.n2;
  return {
    o2: components.o2 / total,
    he: components.he / total,
    n2: components.n2 / total
  };
};

const reconstructStandardFinalState = (
  inputs: StandardBlendInput,
  topGas: GasSelection,
  result: RealGasBlendResult
): { fractions: GergGasFractions; settledPressurePsi: number; totalMoles: number } => {
  const volume = waterVolumeLiters(inputs.tankSizeCuFt ?? 80, inputs.tankRatedPressurePsi ?? 3000);
  const startFractions = gasFractionsFromPercents(inputs.startO2 ?? 21, inputs.startHe ?? 0);
  const startPressurePsi = inputs.startPressure ?? 0;
  let components: ComponentMoles = { o2: 0, he: 0, n2: 0 };

  if (startPressurePsi > 0) {
    const startState = gergDensityFromPressure(
      fahrenheitToKelvin(inputs.startTemperatureF ?? 70),
      gaugePsiToAbsoluteKpa(startPressurePsi),
      startFractions
    );
    if (!startState.success) {
      throw new Error(startState.errors.join(" "));
    }
    components = componentMoles(startState.densityMolPerLiter * volume, startFractions);
  }

  for (const step of result.steps) {
    const fractions = step.kind === "helium"
      ? gasFractionsFromPercents(0, 100)
      : step.kind === "oxygen"
        ? gasFractionsFromPercents(100, 0)
        : gasFractionsFromPercents(topGas.o2, topGas.he);
    components = addComponents(components, step.molesAdded, fractions);
  }

  const totalMoles = components.o2 + components.he + components.n2;
  const fractions = fractionsFromComponents(components);
  const settledState = gergPressureFromDensity(
    fahrenheitToKelvin(inputs.settledTemperatureF ?? 70),
    totalMoles / volume,
    fractions
  );
  if (!settledState.success) {
    throw new Error(settledState.errors.join(" "));
  }

  return {
    fractions,
    settledPressurePsi: absoluteKpaToGaugePsi(settledState.pressureKpa),
    totalMoles
  };
};

const reconstructTopOffFinalState = (
  inputs: Parameters<typeof calculateRealGasTopOff>[1],
  topGas: GasSelection,
  result: RealGasTopOffResult
): { fractions: GergGasFractions; resultPressurePsi: number } => {
  const volume = waterVolumeLiters(inputs.tankSizeCuFt ?? 0, inputs.tankRatedPressurePsi ?? 0);
  const startFractions = gasFractionsFromPercents(inputs.startO2 ?? 21, inputs.startHe ?? 0);
  const startPressurePsi = inputs.startPressure ?? 0;
  let components: ComponentMoles = { o2: 0, he: 0, n2: 0 };

  if (startPressurePsi > 0) {
    const startState = gergDensityFromPressure(
      fahrenheitToKelvin(inputs.startTemperatureF ?? 70),
      gaugePsiToAbsoluteKpa(startPressurePsi),
      startFractions
    );
    if (!startState.success) {
      throw new Error(startState.errors.join(" "));
    }
    components = componentMoles(startState.densityMolPerLiter * volume, startFractions);
  }

  components = addComponents(
    components,
    result.topOffMoles,
    gasFractionsFromPercents(topGas.o2, topGas.he)
  );
  const fractions = fractionsFromComponents(components);
  const totalMoles = components.o2 + components.he + components.n2;
  const resultState = gergPressureFromDensity(
    fahrenheitToKelvin(inputs.resultTemperatureF ?? inputs.startTemperatureF ?? 70),
    totalMoles / volume,
    fractions
  );
  if (!resultState.success) {
    throw new Error(resultState.errors.join(" "));
  }

  return {
    fractions,
    resultPressurePsi: absoluteKpaToGaugePsi(resultState.pressureKpa)
  };
};

describe("calculateRealGasStandardBlend", () => {
  test("adds corrected stop pressures for a standard EAN32 fill", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      settledTemperatureF: 70,
      stageTemperaturesF: {
        oxygen: 70,
        topoff: 70
      },
      stageTemperatureTouched: {},
      topGasId: "air"
    };

    const ideal = calculateStandardBlend({ pressureUnit: "psi" }, inputs, air);
    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(ideal.success).toBe(true);
    expect(corrected.success).toBe(true);
    expect(corrected.steps).toHaveLength(2);
    expect(corrected.steps[0]?.kind).toBe("oxygen");
    expect(corrected.steps[1]?.kind).toBe("topoff");
    expect(corrected.finalHotPressurePsi).toBeCloseTo(3000, 1);
    expect(corrected.steps[0]?.stopPressurePsi).not.toBeCloseTo(417.72, 1);
  });

  test.each([
    {
      label: "21/35",
      targetO2: 21,
      targetHe: 35,
      expectedStopsPsi: [970.319836, 1251.509233, 3000]
    },
    {
      label: "18/45",
      targetO2: 18,
      targetHe: 45,
      expectedStopsPsi: [1250.890336, 1503.617938, 3000]
    }
  ])("matches the representative empty-cylinder $label trimix vector", ({ targetO2, targetHe, expectedStopsPsi }) => {
    const inputs = standardTrimixInput({ targetO2, targetHe });

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.steps.map((step) => step.kind)).toEqual(["helium", "oxygen", "topoff"]);
    corrected.steps.forEach((step, index) => {
      expect(step.stopPressurePsi).toBeCloseTo(expectedStopsPsi[index] ?? 0, 3);
      expect(step.molesAdded).toBeGreaterThan(0);
      expect(step.pressureChangePsi).toBeGreaterThan(0);
    });

    const reconstructed = reconstructStandardFinalState(inputs, air, corrected);
    expect(reconstructed.fractions.o2).toBeCloseTo(targetO2 / 100, 10);
    expect(reconstructed.fractions.he).toBeCloseTo(targetHe / 100, 10);
    expect(reconstructed.fractions.n2).toBeCloseTo(1 - (targetO2 + targetHe) / 100, 10);
    expect(reconstructed.settledPressurePsi).toBeCloseTo(3000, 6);
  });

  test("reconstructs the target mix and settled pressure from a nonzero trimix residual", () => {
    const inputs = standardTrimixInput({
      startPressure: 500,
      startHe: 35,
      startO2: 21
    });

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.steps.map((step) => step.kind)).toEqual(["helium", "oxygen", "topoff"]);
    expect(corrected.startHotPressurePsi).toBeCloseTo(500, 6);
    const reconstructed = reconstructStandardFinalState(inputs, air, corrected);
    expect(reconstructed.fractions.o2).toBeCloseTo(0.18, 10);
    expect(reconstructed.fractions.he).toBeCloseTo(0.45, 10);
    expect(reconstructed.fractions.n2).toBeCloseTo(0.37, 10);
    expect(reconstructed.settledPressurePsi).toBeCloseTo(3000, 6);
  });

  test("produces equivalent Standard Blend results from PSI and bar inputs", () => {
    const psiInputs = standardTrimixInput({
      startPressure: 500,
      startHe: 35
    });
    const barInputs: StandardBlendInput = {
      ...psiInputs,
      startPressure: toDisplayPressure(500, "bar"),
      targetPressure: toDisplayPressure(3000, "bar")
    };

    const psiResult = calculateRealGasStandardBlend({ pressureUnit: "psi" }, psiInputs, air);
    const barResult = calculateRealGasStandardBlend({ pressureUnit: "bar" }, barInputs, air);

    expect(psiResult.success).toBe(true);
    expect(barResult.success).toBe(true);
    expect(barResult.steps.map((step) => step.kind)).toEqual(psiResult.steps.map((step) => step.kind));
    barResult.steps.forEach((step, index) => {
      expect(step.molesAdded).toBeCloseTo(psiResult.steps[index]?.molesAdded ?? 0, 10);
      expect(step.stopPressurePsi).toBeCloseTo(psiResult.steps[index]?.stopPressurePsi ?? 0, 8);
      expect(step.pressureChangePsi).toBeCloseTo(psiResult.steps[index]?.pressureChangePsi ?? 0, 8);
    });
    expect(barResult.finalHotPressurePsi).toBeCloseTo(psiResult.finalHotPressurePsi, 8);
  });

  test("scales component moles with tank volume without changing corrected stops", () => {
    const baseInputs = standardTrimixInput({
      targetO2: 21,
      targetHe: 35
    });

    const aluminum80 = calculateRealGasStandardBlend({ pressureUnit: "psi" }, baseInputs, air);
    const largerTank = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      { ...baseInputs, tankSizeCuFt: 120 },
      air
    );

    expect(aluminum80.success).toBe(true);
    expect(largerTank.success).toBe(true);
    largerTank.steps.forEach((step, index) => {
      expect(step.molesAdded).toBeCloseTo((aluminum80.steps[index]?.molesAdded ?? 0) * 1.5, 9);
      expect(step.stopPressurePsi).toBeCloseTo(aluminum80.steps[index]?.stopPressurePsi ?? 0, 8);
      expect(step.pressureChangePsi).toBeCloseTo(aluminum80.steps[index]?.pressureChangePsi ?? 0, 8);
    });
  });

  test("raises the final stage stop when stage temperature is above settled temperature", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      settledTemperatureF: 70,
      stageTemperaturesF: {
        oxygen: 90,
        topoff: 90
      },
      stageTemperatureTouched: {},
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.finalHotPressurePsi).toBeGreaterThan(3000);
    expect(corrected.targetSettledPressurePsi).toBe(3000);
  });

  test("uses independent stage temperatures for intermediate stop pressure", () => {
    const coolOxygenInputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      settledTemperatureF: 70,
      stageTemperaturesF: {
        oxygen: 70,
        topoff: 100
      },
      stageTemperatureTouched: {},
      topGasId: "air"
    };
    const hotOxygenInputs: StandardBlendInput = {
      ...coolOxygenInputs,
      stageTemperaturesF: {
        oxygen: 100,
        topoff: 100
      }
    };

    const coolOxygen = calculateRealGasStandardBlend({ pressureUnit: "psi" }, coolOxygenInputs, air);
    const hotOxygen = calculateRealGasStandardBlend({ pressureUnit: "psi" }, hotOxygenInputs, air);

    expect(coolOxygen.success).toBe(true);
    expect(hotOxygen.success).toBe(true);
    expect(coolOxygen.steps[0]?.stopPressurePsi).toBeLessThan(hotOxygen.steps[0]?.stopPressurePsi ?? 0);
    expect(coolOxygen.steps[0]?.pressureChangePsi).toBeLessThan(hotOxygen.steps[0]?.pressureChangePsi ?? 0);
    expect(coolOxygen.steps[0]?.temperatureF).toBe(70);
    expect(coolOxygen.steps[1]?.temperatureF).toBe(100);
    expect(coolOxygen.steps[1]?.stopPressurePsi).toBeCloseTo(hotOxygen.steps[1]?.stopPressurePsi ?? 0, 6);
    expect(coolOxygen.steps[1]?.pressureChangePsi).toBeCloseTo(hotOxygen.steps[1]?.pressureChangePsi ?? 0, 6);
  });

  test("uses the helium-stage temperature without changing later fixed-temperature stops", () => {
    const baseInputs = standardTrimixInput({
      stageTemperaturesF: { helium: 70, oxygen: 100, topoff: 100 },
    });
    const coolHelium = calculateRealGasStandardBlend({ pressureUnit: "psi" }, baseInputs, air);
    const hotHelium = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      { ...baseInputs, stageTemperaturesF: { helium: 100, oxygen: 100, topoff: 100 } },
      air
    );

    expect(coolHelium.success).toBe(true);
    expect(hotHelium.success).toBe(true);
    expect(coolHelium.steps[0]?.kind).toBe("helium");
    expect(coolHelium.steps[0]?.stopPressurePsi).toBeLessThan(hotHelium.steps[0]?.stopPressurePsi ?? 0);
    expect(coolHelium.steps[1]?.stopPressurePsi).toBeCloseTo(hotHelium.steps[1]?.stopPressurePsi ?? 0, 8);
    expect(coolHelium.steps[2]?.stopPressurePsi).toBeCloseTo(hotHelium.steps[2]?.stopPressurePsi ?? 0, 8);
  });

  test("allows a lower settled target pressure when hotter initial gas still needs added moles", () => {
    const inputs = standardTrimixInput({
      startPressure: 3000,
      targetPressure: 2800,
      targetO2: 21,
      targetHe: 0,
      startTemperatureF: 200,
      stageTemperaturesF: { topoff: 70 }
    });

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.steps.map((step) => step.kind)).toEqual(["topoff"]);
    expect(corrected.steps[0]?.molesAdded).toBeGreaterThan(0);
    expect(corrected.startHotPressurePsi).toBeLessThan(2800);
    expect(corrected.finalHotPressurePsi).toBeCloseTo(2800, 6);
    expect(reconstructStandardFinalState(inputs, air, corrected).settledPressurePsi).toBeCloseTo(2800, 6);
  });

  test("uses settled temperature to determine target moles independently of stage temperature", () => {
    const baseInputs = standardTrimixInput();
    const coolSettled = calculateRealGasStandardBlend({ pressureUnit: "psi" }, baseInputs, air);
    const warmSettledInputs = { ...baseInputs, settledTemperatureF: 100 };
    const warmSettled = calculateRealGasStandardBlend({ pressureUnit: "psi" }, warmSettledInputs, air);

    expect(coolSettled.success).toBe(true);
    expect(warmSettled.success).toBe(true);
    const coolMoles = coolSettled.steps.reduce((sum, step) => sum + step.molesAdded, 0);
    const warmMoles = warmSettled.steps.reduce((sum, step) => sum + step.molesAdded, 0);
    expect(warmMoles).toBeLessThan(coolMoles);
    expect(warmSettled.finalHotPressurePsi).toBeLessThan(coolSettled.finalHotPressurePsi);
    expect(reconstructStandardFinalState(warmSettledInputs, air, warmSettled).settledPressurePsi).toBeCloseTo(3000, 6);
  });

  test("falls back to legacy fill temperature when stage temperatures are absent", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      fillTemperatureF: 90,
      settledTemperatureF: 70,
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.steps[0]?.temperatureF).toBe(90);
    expect(corrected.steps[1]?.temperatureF).toBe(90);
    expect(corrected.finalHotPressurePsi).toBeGreaterThan(3000);
  });

  test("falls back to legacy fill temperature when the touched map is absent", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      fillTemperatureF: 90,
      settledTemperatureF: 70,
      stageTemperaturesF: {},
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.steps[0]?.temperatureF).toBe(90);
    expect(corrected.steps[1]?.temperatureF).toBe(90);
    expect(corrected.finalHotPressurePsi).toBeGreaterThan(3000);
  });

  test("defaults missing new-schema stage temperatures to start temperature", () => {
    const inputs: StandardBlendInput = {
      startPressure: 0,
      targetPressure: 3000,
      targetO2: 32,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      fillTemperatureF: 90,
      settledTemperatureF: 70,
      stageTemperaturesF: {},
      stageTemperatureTouched: {},
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.steps[0]?.temperatureF).toBe(70);
    expect(corrected.steps[1]?.temperatureF).toBe(70);
    expect(corrected.finalHotPressurePsi).toBeCloseTo(3000, 1);
  });

  test("allows a GERG-only top-off when displayed start and target pressures match", () => {
    const inputs: StandardBlendInput = {
      startPressure: 3000,
      targetPressure: 3000,
      targetO2: 21,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 90,
      settledTemperatureF: 70,
      stageTemperaturesF: {
        topoff: 90
      },
      stageTemperatureTouched: {},
      topGasId: "air"
    };

    const ideal = calculateStandardBlend({ pressureUnit: "psi" }, inputs, air);
    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(ideal.success).toBe(false);
    expect(ideal.errors[0]).toBe("Target pressure matches start pressure.");
    expect(corrected.success).toBe(true);
    expect(corrected.steps).toHaveLength(1);
    expect(corrected.steps[0]?.kind).toBe("topoff");
    expect(corrected.finalHotPressurePsi).toBeGreaterThan(3000);
  });

  test("measures GERG-only stage pressure deltas at the stage temperature", () => {
    const inputs: StandardBlendInput = {
      startPressure: 3000,
      targetPressure: 3000,
      targetO2: 21,
      targetHe: 0,
      startO2: 21,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 90,
      settledTemperatureF: 70,
      stageTemperaturesF: {
        topoff: 70
      },
      stageTemperatureTouched: {},
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.steps).toHaveLength(1);
    expect(corrected.steps[0]?.kind).toBe("topoff");
    expect(corrected.steps[0]?.stopPressurePsi).toBeCloseTo(3000, 1);
    expect(corrected.steps[0]?.pressureChangePsi).toBeGreaterThan(50);
    expect(corrected.startHotPressurePsi).toBeCloseTo(
      (corrected.steps[0]?.stopPressurePsi ?? 0) - (corrected.steps[0]?.pressureChangePsi ?? 0),
      6
    );
    expect(corrected.startHotPressurePsi).toBeLessThan(3000);
  });

  test.each([
    {
      label: "EAN32 bank",
      topGas: { id: "ean32", name: "EAN32", o2: 32, he: 0 },
      targetO2: 36,
      targetHe: 0,
      expectedKinds: ["oxygen", "topoff"]
    },
    {
      label: "15/40 trimix bank",
      topGas: { id: "tx1540", name: "15/40", o2: 15, he: 40 },
      targetO2: 18,
      targetHe: 45,
      expectedKinds: ["helium", "oxygen", "topoff"]
    }
  ])("balances pure additions around a custom $label", ({ topGas, targetO2, targetHe, expectedKinds }) => {
    const inputs = standardTrimixInput({
      targetO2,
      targetHe,
      topGasId: topGas.id
    });

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, topGas);

    expect(corrected.success).toBe(true);
    expect(corrected.steps.map((step) => step.kind)).toEqual(expectedKinds);
    const reconstructed = reconstructStandardFinalState(inputs, topGas, corrected);
    expect(reconstructed.fractions.o2).toBeCloseTo(targetO2 / 100, 10);
    expect(reconstructed.fractions.he).toBeCloseTo(targetHe / 100, 10);
    expect(reconstructed.settledPressurePsi).toBeCloseTo(3000, 6);
  });

  test("supports an N2-free target without a nitrogen-bearing top gas", () => {
    const oxygen: GasSelection = { id: "oxygen", name: "Oxygen", o2: 100, he: 0 };
    const inputs = standardTrimixInput({
      targetO2: 50,
      targetHe: 50,
      stageTemperaturesF: { helium: 70, oxygen: 70 },
      topGasId: oxygen.id
    });

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, oxygen);

    expect(corrected.success).toBe(true);
    expect(corrected.steps.map((step) => step.kind)).toEqual(["helium", "oxygen"]);
    const reconstructed = reconstructStandardFinalState(inputs, oxygen, corrected);
    expect(reconstructed.fractions.o2).toBeCloseTo(0.5, 10);
    expect(reconstructed.fractions.he).toBeCloseTo(0.5, 10);
    expect(reconstructed.fractions.n2).toBeCloseTo(0, 10);
  });

  test("rejects an N2-free top gas when the target requires nitrogen", () => {
    const oxygen: GasSelection = { id: "oxygen", name: "Oxygen", o2: 100, he: 0 };
    const corrected = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardTrimixInput({
        targetO2: 32,
        targetHe: 0,
        stageTemperaturesF: { oxygen: 70 },
        topGasId: oxygen.id
      }),
      oxygen
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain("Selected top-off gas has no nitrogen and cannot reach the target N2 fraction.");
  });

  test("rejects an invalid custom top-gas composition", () => {
    const invalidTopGas: GasSelection = { id: "invalid", name: "Invalid", o2: 60, he: 50 };
    const corrected = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardTrimixInput({
        targetO2: 32,
        targetHe: 0,
        stageTemperaturesF: { oxygen: 70, topoff: 70 },
        topGasId: invalidTopGas.id
      }),
      invalidTopGas
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain("Gas fractions must be between 0% and 100%, and O2% + He% must not exceed 100%.");
  });

  test.each([
    { label: "negative start pressure", patch: { startPressure: -1 }, error: "Start pressure cannot be negative." },
    { label: "zero target pressure", patch: { targetPressure: 0 }, error: "Target pressure must be greater than zero." },
    { label: "nonfinite start pressure", patch: { startPressure: Number.POSITIVE_INFINITY }, error: "Start pressure must be a finite value." },
    { label: "nonfinite target pressure", patch: { targetPressure: Number.NaN }, error: "Target pressure must be a finite value." },
    { label: "nonfinite tank size", patch: { tankSizeCuFt: Number.NaN }, error: "Tank size and rated pressure are required for GERG-2008 correction." },
    { label: "overflowing tank size", patch: { tankSizeCuFt: Number.MAX_VALUE }, error: "Tank size and rated pressure are required for GERG-2008 correction." },
    { label: "nonfinite rated pressure", patch: { tankRatedPressurePsi: Number.POSITIVE_INFINITY }, error: "Tank size and rated pressure are required for GERG-2008 correction." }
  ])("rejects $label", ({ patch, error }) => {
    const corrected = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardTrimixInput({
        targetO2: 32,
        targetHe: 0,
        stageTemperaturesF: { oxygen: 70, topoff: 70 },
        ...patch
      }),
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.steps).toHaveLength(0);
    expect(corrected.errors).toContain(error);
  });

  test.each([
    { label: "residual state", patch: { startPressure: 500, startTemperatureF: -400 } },
    { label: "settled target", patch: { settledTemperatureF: -400 } },
    { label: "helium stage", patch: { stageTemperaturesF: { helium: -400, oxygen: 70, topoff: 70 } } }
  ])("surfaces GERG envelope errors for an invalid $label temperature", ({ patch }) => {
    const corrected = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardTrimixInput({
        ...patch
      }),
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain("GERG-2008 correction is limited to temperatures at or above 250 K.");
  });

  test.each([
    { targetO2: 17, targetHe: 50, warning: "Hypoxic mix (<18% O2)." },
    { targetO2: 45, targetHe: 0, warning: "High O2 - fire risk (>40% O2)." }
  ])("preserves target-mix safety warnings for $targetO2/$targetHe", ({ targetO2, targetHe, warning }) => {
    const corrected = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardTrimixInput({
        targetO2,
        targetHe
      }),
      air
    );

    expect(corrected.success).toBe(true);
    expect(corrected.warnings).toContain(warning);
  });

  test("deduplicates repeated GERG envelope warnings across hot fill stages", () => {
    const corrected = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardTrimixInput({
        stageTemperaturesF: { helium: 300, oxygen: 300, topoff: 300 },
      }),
      air
    );

    expect(corrected.success).toBe(true);
    expect(corrected.warnings.filter((warning) => warning.includes("above 400 K"))).toHaveLength(1);
  });

  test("rejects direct real-gas correction when the target needs bleed-down first", () => {
    const inputs: StandardBlendInput = {
      startPressure: 2000,
      targetPressure: 3000,
      targetO2: 21,
      targetHe: 0,
      startO2: 50,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      settledTemperatureF: 70,
      stageTemperaturesF: {
        topoff: 70
      },
      stageTemperatureTouched: {},
      topGasId: "air"
    };

    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(false);
    expect(corrected.errors[0]).toContain("Complete the bleed-down step");
  });
});

describe("calculateRealGasTopOff", () => {
  test("keeps result pressure close to goal when start and result temperatures match", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      {
        startPressure: 500,
        finalPressure: 3000,
        startO2: 32,
        startHe: 0,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        resultTemperatureF: 70,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(true);
    expect(corrected.goalPressurePsi).toBe(3000);
    expect(corrected.resultPressurePsi).toBeCloseTo(3000, 1);
    expect(corrected.addedPressure).toBeCloseTo(2500, 6);
    expect(corrected.finalO2).toBeGreaterThan(22);
    expect(corrected.finalHe).toBeCloseTo(0, 6);
  });

  test("reconstructs a trimix top-off with an arbitrary helium-bearing source", () => {
    const topGas: GasSelection = { id: "tx2135", name: "21/35", o2: 21, he: 35 };
    const inputs = trimixTopOffInput({
      topGasId: topGas.id
    });

    const corrected = calculateRealGasTopOff({ pressureUnit: "psi" }, inputs, topGas);

    expect(corrected.success).toBe(true);
    expect(corrected.finalO2).toBeGreaterThan(18);
    expect(corrected.finalO2).toBeLessThan(21);
    expect(corrected.finalHe).toBeGreaterThan(35);
    expect(corrected.finalHe).toBeLessThan(45);
    expect(corrected.finalO2 + corrected.finalHe + corrected.finalN2).toBeCloseTo(100, 10);
    const reconstructed = reconstructTopOffFinalState(inputs, topGas, corrected);
    expect(corrected.finalO2).toBeCloseTo(reconstructed.fractions.o2 * 100, 10);
    expect(corrected.finalHe).toBeCloseTo(reconstructed.fractions.he * 100, 10);
    expect(corrected.finalN2).toBeCloseTo(reconstructed.fractions.n2 * 100, 10);
    expect(corrected.resultPressurePsi).toBeCloseTo(reconstructed.resultPressurePsi, 8);
    expect(corrected.resultPressurePsi).toBeGreaterThan(corrected.goalPressurePsi);
  });

  test("produces equivalent Top-Off results from PSI and bar inputs", () => {
    const topGas: GasSelection = { id: "tx2135", name: "21/35", o2: 21, he: 35 };
    const psiInputs = trimixTopOffInput({
      topGasId: topGas.id
    });
    const barInputs = {
      ...psiInputs,
      startPressure: toDisplayPressure(1000, "bar"),
      finalPressure: toDisplayPressure(3000, "bar")
    };

    const psiResult = calculateRealGasTopOff({ pressureUnit: "psi" }, psiInputs, topGas);
    const barResult = calculateRealGasTopOff({ pressureUnit: "bar" }, barInputs, topGas);

    expect(psiResult.success).toBe(true);
    expect(barResult.success).toBe(true);
    expect(barResult.topOffMoles).toBeCloseTo(psiResult.topOffMoles, 9);
    expect(barResult.finalO2).toBeCloseTo(psiResult.finalO2, 10);
    expect(barResult.finalHe).toBeCloseTo(psiResult.finalHe, 10);
    expect(barResult.goalPressurePsi).toBeCloseTo(psiResult.goalPressurePsi, 8);
    expect(barResult.resultPressurePsi).toBeCloseTo(psiResult.resultPressurePsi, 8);
  });

  test("preserves the mix while temperature changes pressure on a no-add top-off", () => {
    const inputs = trimixTopOffInput({
      startPressure: 3000,
      finalPressure: 3000,
      resultTemperatureF: 100,
      topGasId: "air"
    });

    const corrected = calculateRealGasTopOff({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.topOffMoles).toBe(0);
    expect(corrected.addedPressure).toBe(0);
    expect(corrected.finalO2).toBeCloseTo(18, 10);
    expect(corrected.finalHe).toBeCloseTo(45, 10);
    expect(corrected.finalN2).toBeCloseTo(37, 10);
    expect(corrected.resultPressurePsi).toBeGreaterThan(corrected.goalPressurePsi);
    expect(corrected.resultPressurePsi).toBeCloseTo(
      reconstructTopOffFinalState(inputs, air, corrected).resultPressurePsi,
      8
    );
  });

  test.each([
    { startO2: 10, startHe: 70, warning: "Hypoxic mix (<18% O2)." },
    { startO2: 45, startHe: 0, warning: "High O2 - fire risk (>40% O2)." }
  ])("preserves $warning on a same-pressure top-off", ({ startO2, startHe, warning }) => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      trimixTopOffInput({
        startPressure: 3000,
        finalPressure: 3000,
        startO2,
        startHe,
        resultTemperatureF: 100
      }),
      air
    );

    expect(corrected.success).toBe(true);
    expect(corrected.topOffMoles).toBe(0);
    expect(corrected.warnings).toContain(warning);
  });

  test("raises result pressure at higher result temperature without changing final mix", () => {
    const baseInput = {
      startPressure: 500,
      finalPressure: 3000,
      startO2: 32,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      startTemperatureF: 70,
      topGasId: "air"
    };

    const settled = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      { ...baseInput, resultTemperatureF: 70 },
      air
    );
    const hot = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      { ...baseInput, resultTemperatureF: 100 },
      air
    );

    expect(settled.success).toBe(true);
    expect(hot.success).toBe(true);
    expect(hot.resultPressurePsi).toBeGreaterThan(settled.resultPressurePsi);
    expect(hot.finalO2).toBeCloseTo(settled.finalO2, 8);
    expect(hot.finalHe).toBeCloseTo(settled.finalHe, 8);
    expect(hot.topOffMoles).toBeCloseTo(settled.topOffMoles, 8);
  });

  test("changing start temperature changes solved top-off moles", () => {
    const baseInput = {
      startPressure: 500,
      finalPressure: 3000,
      startO2: 32,
      startHe: 0,
      tankSizeCuFt: 80,
      tankRatedPressurePsi: 3000,
      resultTemperatureF: 70,
      topGasId: "air"
    };

    const coolStart = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      { ...baseInput, startTemperatureF: 70 },
      air
    );
    const warmStart = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      { ...baseInput, startTemperatureF: 90 },
      air
    );

    expect(coolStart.success).toBe(true);
    expect(warmStart.success).toBe(true);
    expect(warmStart.topOffMoles).not.toBeCloseTo(coolStart.topOffMoles, 5);
  });

  test("rejects invalid start mix", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      {
        startPressure: 500,
        finalPressure: 3000,
        startO2: 60,
        startHe: 50,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        resultTemperatureF: 70,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors[0]).toContain("Gas fractions");
  });

  test("rejects goal pressure below start pressure", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      {
        startPressure: 3000,
        finalPressure: 500,
        startO2: 32,
        startHe: 0,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        resultTemperatureF: 70,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain("Goal pressure is below current pressure. Bleed-down required.");
  });

  test.each([
    {
      label: "nonfinite start pressure",
      patch: { startPressure: Number.NaN },
      error: "Start pressure must be a finite value."
    },
    {
      label: "nonfinite goal pressure",
      patch: { finalPressure: Number.POSITIVE_INFINITY },
      error: "Goal pressure must be a finite value."
    },
    {
      label: "nonfinite tank size",
      patch: { tankSizeCuFt: Number.NaN },
      error: "Tank size and rated pressure are required for GERG-2008 correction."
    },
    {
      label: "nonfinite rated pressure",
      patch: { tankRatedPressurePsi: Number.POSITIVE_INFINITY },
      error: "Tank size and rated pressure are required for GERG-2008 correction."
    }
  ])("rejects $label", ({ patch, error }) => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      trimixTopOffInput(patch),
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain(error);
  });

  test("requires tank context", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      {
        startPressure: 500,
        finalPressure: 3000,
        startO2: 32,
        startHe: 0,
        startTemperatureF: 70,
        resultTemperatureF: 70,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain("Tank size and rated pressure are required for GERG-2008 correction.");
  });

  test("supports bar inputs and returns PSI internally", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "bar" },
      {
        startPressure: 50,
        finalPressure: 200,
        startO2: 21,
        startHe: 0,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        resultTemperatureF: 70,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(true);
    expect(corrected.goalPressurePsi).toBeCloseTo(200 * 14.5037738, 3);
    expect(corrected.resultPressurePsi).toBeCloseTo(200 * 14.5037738, 1);
  });

  test("surfaces GERG envelope errors for out-of-range result temperature", () => {
    const corrected = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      {
        startPressure: 500,
        finalPressure: 3000,
        startO2: 32,
        startHe: 0,
        tankSizeCuFt: 80,
        tankRatedPressurePsi: 3000,
        startTemperatureF: 70,
        resultTemperatureF: -400,
        topGasId: "air"
      },
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain("GERG-2008 correction is limited to temperatures at or above 250 K.");
  });
});
