import { describe, expect, test } from "vitest";
import type { StandardBlendInput, TopOffInput } from "../state/session";
import type { GasSelection } from "./calculations";
import { calculateStandardBlend } from "./calculations";
import {
  ATM_PRESSURE_PSI,
  KPA_PER_PSI,
  R_GERG,
  absoluteKpaToGaugePsi,
  gasFractionsFromPercents,
  gaugePsiToAbsoluteKpa,
  gergDensityFromPressure,
  gergPressureFromDensity,
  type GergGasFractions
} from "./gerg2008";
import {
  FREE_GAS_LITERS_PER_MOLE,
  calculateRealGasStandardBlend,
  calculateRealGasTopOff,
  realGasMolesToFreeGasCuFt,
  tankWaterVolumeLiters,
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
  tankSizeCuFt * CUFT_TO_LITERS * ATM_PRESSURE_PSI / tankRatedPressurePsi;

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
  // 0 gauge still holds 1 atm absolute of the start mix.
  const startState = gergDensityFromPressure(
    fahrenheitToKelvin(inputs.startTemperatureF ?? 70),
    gaugePsiToAbsoluteKpa(inputs.startPressure ?? 0),
    startFractions
  );
  if (!startState.success) {
    throw new Error(startState.errors.join(" "));
  }
  let components = componentMoles(startState.densityMolPerLiter * volume, startFractions);

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
  // 0 gauge still holds 1 atm absolute of the start mix.
  const startState = gergDensityFromPressure(
    fahrenheitToKelvin(inputs.startTemperatureF ?? 70),
    gaugePsiToAbsoluteKpa(inputs.startPressure ?? 0),
    startFractions
  );
  if (!startState.success) {
    throw new Error(startState.errors.join(" "));
  }
  let components = componentMoles(startState.densityMolPerLiter * volume, startFractions);

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
      expectedStopsPsi: [986.968075, 1267.856321, 3000]
    },
    {
      label: "18/45",
      targetO2: 18,
      targetHe: 45,
      expectedStopsPsi: [1268.114594, 1520.508394, 3000]
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

  test.each([
    { label: "21/35", targetO2: 21, targetHe: 35 },
    { label: "32/0", targetO2: 32, targetHe: 0 }
  ])("treats a 0 PSI $label start as 1 atm of start mix, continuous with small residuals", ({ targetO2, targetHe }) => {
    const solve = (startPressure: number): RealGasBlendResult =>
      calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardTrimixInput({ targetO2, targetHe, startPressure }), air);

    const empty = solve(0);
    const nearEmpty = solve(1e-6);
    const smallResidual = solve(0.01);

    expect(empty.success).toBe(true);
    expect(nearEmpty.success).toBe(true);
    expect(smallResidual.success).toBe(true);
    expect(empty.startHotPressurePsi).toBeCloseTo(0, 9);
    empty.steps.forEach((step, index) => {
      expect(step.stopPressurePsi).toBeCloseTo(nearEmpty.steps[index]?.stopPressurePsi ?? 0, 4);
      expect(step.molesAdded).toBeCloseTo(nearEmpty.steps[index]?.molesAdded ?? 0, 4);
      // 0.01 PSI more residual moves each stop by about 0.01 PSI, not by a full atmosphere.
      expect(Math.abs((smallResidual.steps[index]?.stopPressurePsi ?? 0) - step.stopPressurePsi)).toBeLessThan(0.02);
    });
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

  test("infers water volume so free-gas moles follow the gauge tank-size ratio", () => {
    const inputs = standardTrimixInput({ targetO2: 21, targetHe: 0 });
    const temperatureK = fahrenheitToKelvin(70);
    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);
    const startZ = gergDensityFromPressure(temperatureK, gaugePsiToAbsoluteKpa(0), gasFractionsFromPercents(21, 0)).z;
    const finalStep = corrected.steps[0];

    expect(corrected.success).toBe(true);
    expect(corrected.steps.map((step) => step.kind)).toEqual(["topoff"]);
    const freeGasCuFt =
      (finalStep?.molesAdded ?? 0) * R_GERG * temperatureK / (ATM_PRESSURE_PSI * KPA_PER_PSI) / CUFT_TO_LITERS;
    // n R T / P_atm = V / P_atm * (P2_abs / Z2 - P1_abs / Z1); with Z = 1 this is 80 * 3000 / 3000.
    expect(freeGasCuFt).toBeCloseTo(
      80 * ((3000 + ATM_PRESSURE_PSI) / (finalStep?.z ?? 1) - ATM_PRESSURE_PSI / startZ) / 3000,
      9
    );
    // An aluminum 80 is about 11.1 L; a 0 PSI air fill to 3000 PSI holds about its 77.4 cu ft real-gas label.
    expect(waterVolumeLiters(80, 3000)).toBeCloseTo(11.097, 3);
    expect(freeGasCuFt).toBeCloseTo(77.37, 2);
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
      startO2: 50,
      startHe: 50,
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

  test.each([
    { label: "heliox", topGas: { id: "oxygen", name: "Oxygen", o2: 100, he: 0 }, targetO2: 50, targetHe: 50 },
    { label: "pure oxygen", topGas: air, targetO2: 100, targetHe: 0 },
    { label: "EAN32 bank top-off over an EAN36 residual", topGas: { id: "ean32", name: "EAN32", o2: 32, he: 0 }, targetO2: 32, targetHe: 0, startO2: 36 },
    { label: "10/50 bank top-off over an air residual", topGas: { id: "tx1050", name: "10/50", o2: 10, he: 50 }, targetO2: 10, targetHe: 50 },
    { label: "air top-off to 21/0 over an EAN32 residual", topGas: air, targetO2: 21, targetHe: 0, startO2: 32 }
  ])("plans a 0 PSI $label fill the residual blocks and reports the mix it reaches", ({ topGas, targetO2, targetHe, startO2 }) => {
    const inputs = standardTrimixInput({ targetO2, targetHe, startO2: startO2 ?? 21, startHe: 0, topGasId: topGas.id });
    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, topGas);

    expect(corrected.success).toBe(true);
    expect(corrected.errors).toEqual([]);
    expect(corrected.additions?.length).toBeGreaterThan(0);
    const mix = corrected.residualAdjustedMix;
    expect(mix).toBeDefined();
    const reconstructed = reconstructStandardFinalState(inputs, topGas, corrected);
    expect(reconstructed.fractions.o2 * 100).toBeCloseTo(mix?.o2 ?? 0, 9);
    expect(reconstructed.fractions.he * 100).toBeCloseTo(mix?.he ?? 0, 9);
    // The residual shifts the mix only slightly and the plan still lands near the target pressure.
    expect(Math.abs((mix?.o2 ?? 0) - targetO2)).toBeLessThan(0.5);
    expect(Math.abs((mix?.he ?? 0) - targetHe)).toBeLessThan(0.5);
    expect(reconstructed.settledPressurePsi).toBeCloseTo(3000, 1);
    expect(corrected.warnings.some((warning) => warning.startsWith("An empty cylinder still holds 1 atm of the start mix"))).toBe(true);
  });

  test("ends a pure oxygen fill over 1 atm of air near 99.6% O2", () => {
    const corrected = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardTrimixInput({ targetO2: 100, targetHe: 0 }),
      air
    );

    expect(corrected.residualAdjustedMix?.o2).toBeCloseTo(99.62, 1);
    expect(corrected.residualAdjustedMix?.n2).toBeCloseTo(0.38, 1);
    expect(corrected.warnings).toContain(
      `An empty cylinder still holds 1 atm of the start mix, so this plan ends at ${corrected.residualAdjustedMix?.o2.toFixed(2)}% O2 instead of the exact target. Purge the cylinder and set the start mix to the purge gas to reach the target exactly.`
    );
  });

  test.each([
    { label: "an EAN40 bank over an oxygen residual", startO2: 100, startHe: 0, topGas: { id: "ean40", name: "EAN40", o2: 40, he: 0 }, targetO2: 40, targetHe: 0, flag: "High O2 - fire risk (>40% O2)." },
    { label: "an 18/45 bank over a 10/70 residual", startO2: 10, startHe: 70, topGas: { id: "tx1845", name: "18/45", o2: 18, he: 45 }, targetO2: 18, targetHe: 45, flag: "Hypoxic mix (<18% O2)." }
  ])("flags the reached mix, not the target, for $label", ({ startO2, startHe, topGas, targetO2, targetHe, flag }) => {
    const corrected = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardTrimixInput({ startO2, startHe, targetO2, targetHe, topGasId: topGas.id }),
      topGas
    );

    expect(corrected.success).toBe(true);
    expect(corrected.residualAdjustedMix).toBeDefined();
    expect(corrected.warnings).toContain(flag);
  });

  test("refines a residual-adjusted plan near the 400 bar envelope without leaving it", () => {
    const inputs = standardTrimixInput({ targetO2: 100, targetHe: 0, targetPressure: 5650 });
    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, inputs, air);

    expect(corrected.success).toBe(true);
    expect(corrected.residualAdjustedMix).toBeDefined();
    expect(reconstructStandardFinalState(inputs, air, corrected).settledPressurePsi).toBeCloseTo(5650, 1);
  });

  test("still rejects an empty start whose top-off gas cannot make the target even from vacuum", () => {
    const ean32: GasSelection = { id: "ean32", name: "EAN32", o2: 32, he: 0 };
    const corrected = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardTrimixInput({ targetO2: 21, targetHe: 0, topGasId: ean32.id }),
      ean32
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toEqual(["GERG-2008 correction requires removing gas or changing the top-off gas."]);
    expect(corrected.residualAdjustedMix).toBeUndefined();
  });

  test("leaves an exact empty-start plan unadjusted", () => {
    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardTrimixInput({ targetO2: 21, targetHe: 35 }), air);

    expect(corrected.success).toBe(true);
    expect(corrected.residualAdjustedMix).toBeUndefined();
    expect(corrected.warnings.some((warning) => warning.startsWith("An empty cylinder"))).toBe(false);
  });

  test.each([
    { label: "bleed-down", patch: { startPressure: 500, startO2: 18, startHe: 45, targetO2: 32, targetHe: 0 }, topGas: air, error: "GERG-2008 correction currently supports direct fills only. Complete the bleed-down step, then recalculate from the post-bleed state." },
    { label: "split", patch: { startPressure: 500, startO2: 36, startHe: 0, targetO2: 32, targetHe: 0, topGasId: "ean32" }, topGas: { id: "ean32", name: "EAN32", o2: 32, he: 0 }, error: "GERG-2008 correction requires removing gas or changing the top-off gas." }
  ])("still rejects a $label failure above 0 PSI", ({ patch, topGas, error }) => {
    const corrected = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardTrimixInput(patch), topGas);

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toEqual([error]);
    expect(corrected.additions).toBeUndefined();
    expect(corrected.residualAdjustedMix).toBeUndefined();
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
    { label: "residual state", patch: { startPressure: 500, startTemperatureF: -400 }, stageFailure: false },
    { label: "settled target", patch: { settledTemperatureF: -400 }, stageFailure: false },
    { label: "helium stage", patch: { stageTemperaturesF: { helium: -400, oxygen: 70, topoff: 70 } }, stageFailure: true }
  ])("surfaces GERG envelope errors for an invalid $label temperature", ({ patch, stageFailure }) => {
    const corrected = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardTrimixInput({
        ...patch
      }),
      air
    );

    expect(corrected.success).toBe(false);
    expect(corrected.errors).toContain("GERG-2008 correction is limited to temperatures at or above 250 K.");
    // Standard Blend shows per-stage temperature rows only when moles were solved.
    expect(corrected.additions !== undefined).toBe(stageFailure);
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

  test("treats a 0 PSI start as 1 atm of start mix, continuous with small residuals", () => {
    const solve = (startPressure: number): RealGasTopOffResult =>
      calculateRealGasTopOff(
        { pressureUnit: "psi" },
        trimixTopOffInput({ startPressure, startO2: 32, startHe: 0, resultTemperatureF: 70 }),
        air
      );

    const empty = solve(0);
    const nearEmpty = solve(1e-6);
    const smallResidual = solve(0.01);

    expect(empty.success).toBe(true);
    expect(nearEmpty.success).toBe(true);
    expect(smallResidual.success).toBe(true);
    // The 1 atm EAN32 residual leaves the result slightly richer than the air top-off.
    expect(empty.finalO2).toBeCloseTo(21.05546, 5);
    expect(empty.finalO2).toBeCloseTo(nearEmpty.finalO2, 6);
    expect(empty.topOffMoles).toBeCloseTo(nearEmpty.topOffMoles, 4);
    expect(Math.abs(smallResidual.finalO2 - empty.finalO2)).toBeLessThan(1e-4);
    expect(Math.abs(smallResidual.topOffMoles - empty.topOffMoles)).toBeLessThan(0.01);
    const reconstructed = reconstructTopOffFinalState(
      trimixTopOffInput({ startPressure: 0, startO2: 32, startHe: 0, resultTemperatureF: 70 }),
      air,
      empty
    );
    expect(empty.finalO2).toBeCloseTo(reconstructed.fractions.o2 * 100, 10);
    expect(empty.resultPressurePsi).toBeCloseTo(reconstructed.resultPressurePsi, 8);
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

describe("real-gas fill volumes", () => {
  const standardInput = (overrides: Partial<StandardBlendInput> = {}): StandardBlendInput =>
    standardTrimixInput(overrides);

  const additionMoles = (result: RealGasBlendResult, kind: "helium" | "oxygen" | "topoff"): number =>
    result.additions?.find((addition) => addition.kind === kind)?.moles ?? 0;

  const additionCuFt = (
    result: RealGasBlendResult,
    kind: "helium" | "oxygen" | "topoff",
    tankSizeCuFt = 80,
    tankRatedPressurePsi = 3000
  ): number => realGasMolesToFreeGasCuFt(
    additionMoles(result, kind),
    result.waterVolumeLiters ?? 0,
    tankSizeCuFt,
    tankRatedPressurePsi
  );

  const topOffCuFt = (result: RealGasTopOffResult): number =>
    realGasMolesToFreeGasCuFt(result.topOffMoles, result.waterVolumeLiters ?? 0, 80, 3000);

  test("reports free gas at 70 F and 1 atm", () => {
    expect(FREE_GAS_LITERS_PER_MOLE).toBeCloseTo(24.1463, 4);
  });

  test("each addition equals tank size * (P2/Z2 - P1/Z1) / rated at one temperature", () => {
    const result = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardInput({ startPressure: 500, startO2: 21, startHe: 0, targetO2: 21, targetHe: 35 }),
      air
    );

    expect(result.success).toBe(true);
    expect(result.steps.map((step) => step.kind)).toEqual(["helium", "oxygen", "topoff"]);
    let previousAbsolutePsi = result.startHotPressurePsi + ATM_PRESSURE_PSI;
    let previousZ = result.startZ ?? 0;
    for (const step of result.steps) {
      const stopAbsolutePsi = step.stopPressurePsi + ATM_PRESSURE_PSI;
      const expectedCuFt = 80 * (stopAbsolutePsi / step.z - previousAbsolutePsi / previousZ) / 3000;
      expect(additionCuFt(result, step.kind)).toBeCloseTo(expectedCuFt, 6);
      previousAbsolutePsi = stopAbsolutePsi;
      previousZ = step.z;
    }
  });

  test.each([
    { targetO2: 21, targetHe: 35, helium: 25.431, oxygen: 6.760, topoff: 40.077 },
    { targetO2: 18, targetHe: 45, helium: 32.386 },
    { targetO2: 10, targetHe: 70, helium: 50.034 },
    { targetO2: 32, targetHe: 0, helium: 0, oxygen: 10.962, topoff: 67.375 }
  ])("pins empty-start AL80 volumes for $targetO2/$targetHe", ({ targetO2, targetHe, helium, oxygen, topoff }) => {
    const result = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardInput({ targetO2, targetHe }), air);

    expect(result.success).toBe(true);
    expect(additionCuFt(result, "helium")).toBeCloseTo(helium, 3);
    if (oxygen !== undefined) {
      expect(additionCuFt(result, "oxygen")).toBeCloseTo(oxygen, 3);
    }
    if (topoff !== undefined) {
      expect(additionCuFt(result, "topoff")).toBeCloseTo(topoff, 3);
    }
  });

  test("prices an empty cylinder from the 1 atm of start gas the solver starts from", () => {
    const empty = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardInput({ targetO2: 21, targetHe: 35 }), air);
    const barelyPressurized = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardInput({ startPressure: 1e-6, targetO2: 21, targetHe: 35 }),
      air
    );

    expect(empty.steps[0]?.stopPressurePsi).toBeCloseTo(987.0, 1);
    for (const kind of ["helium", "oxygen", "topoff"] as const) {
      expect(additionCuFt(empty, kind)).toBeCloseTo(additionCuFt(barelyPressurized, kind), 6);
    }
    const fullAirFill = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardInput({ targetO2: 21, targetHe: 0 }),
      air
    );
    expect(additionCuFt(fullAirFill, "topoff")).toBeCloseTo(77.37, 2);
  });

  test("prices pure oxygen the same over an oxygen or an air residual", () => {
    const oxygenResidual = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardInput({ startO2: 100, startHe: 0, targetO2: 100, targetHe: 0 }),
      air
    );
    const airResidual = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardInput({ targetO2: 100, targetHe: 0 }), air);

    expect(oxygenResidual.success).toBe(true);
    expect(additionCuFt(oxygenResidual, "oxygen")).toBeCloseTo(84.930, 3);
    expect(additionCuFt(oxygenResidual, "topoff")).toBe(0);
    expect(airResidual.success).toBe(true);
    expect(airResidual.residualAdjustedMix).toBeDefined();
    expect(additionCuFt(airResidual, "oxygen")).toBeCloseTo(additionCuFt(oxygenResidual, "oxygen"), 1);
    expect(additionCuFt(airResidual, "topoff")).toBe(0);
  });

  test("prices an empty Top-Off cylinder from the 1 atm of start gas the solver starts from", () => {
    const input = trimixTopOffInput({ startO2: 21, startHe: 0, finalPressure: 300, resultTemperatureF: 70 });
    const empty = calculateRealGasTopOff({ pressureUnit: "psi" }, { ...input, startPressure: 0 }, air);
    const barelyPressurized = calculateRealGasTopOff({ pressureUnit: "psi" }, { ...input, startPressure: 1e-6 }, air);
    const emptyCuFt = topOffCuFt(empty);

    expect(emptyCuFt).toBeCloseTo(topOffCuFt(barelyPressurized), 4);
    expect(emptyCuFt).toBeCloseTo(8.05, 2);
  });

  test("uses the cylinder Z for a pure helium top-up", () => {
    const result = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardInput({ startPressure: 500, startO2: 0, startHe: 100, targetO2: 0, targetHe: 100 }),
      air
    );

    expect(result.success).toBe(true);
    expect(result.startZ).toBeCloseTo(1.0173, 4);
    expect(result.steps[result.steps.length - 1]?.z).toBeCloseTo(1.0979, 4);
    expect(additionCuFt(result, "helium")).toBeCloseTo(59.7338, 3);
    expect(additionCuFt(result, "topoff")).toBe(0);
  });

  test("keeps planned moles independent of stage temperatures", () => {
    const base = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardInput(), air);
    const hotStages = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardInput({
        stageTemperaturesF: { helium: 90, oxygen: 95, topoff: 100 },
        stageTemperatureTouched: { helium: true, oxygen: true, topoff: true }
      }),
      air
    );

    expect(hotStages.success).toBe(true);
    expect(hotStages.steps[hotStages.steps.length - 1]?.stopPressurePsi)
      .toBeGreaterThan(base.steps[base.steps.length - 1]?.stopPressurePsi ?? 0);
    expect(hotStages.additions).toEqual(base.additions);
  });

  test("changes planned moles with initial and settled temperatures", () => {
    const base = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardInput(), air);
    const hotSettled = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardInput({ settledTemperatureF: 90 }), air);
    const partialStart = standardInput({ startPressure: 500, startO2: 18, startHe: 45 });
    const coolStart = calculateRealGasStandardBlend({ pressureUnit: "psi" }, partialStart, air);
    const hotStart = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      { ...partialStart, startTemperatureF: 90 },
      air
    );

    expect(additionMoles(hotSettled, "helium")).toBeLessThan(additionMoles(base, "helium"));
    expect(additionMoles(hotStart, "helium")).toBeGreaterThan(additionMoles(coolStart, "helium"));
  });

  test("keeps planned moles when a stage temperature is outside the GERG envelope", () => {
    const base = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardInput(), air);
    const coldStage = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardInput({
        stageTemperaturesF: { helium: 70, oxygen: -40, topoff: 70 },
        stageTemperatureTouched: { oxygen: true }
      }),
      air
    );

    expect(coldStage.success).toBe(false);
    expect(coldStage.additions).toEqual(base.additions);
    expect(coldStage.waterVolumeLiters).toBeCloseTo(base.waterVolumeLiters ?? 0, 9);
  });

  test("omits planned moles when the fill needs bleed-down first", () => {
    const result = calculateRealGasStandardBlend(
      { pressureUnit: "psi" },
      standardInput({ startPressure: 2000, startO2: 18, startHe: 45, targetO2: 32, targetHe: 0 }),
      air
    );

    expect(result.success).toBe(false);
    expect(result.additions).toBeUndefined();
  });

  test("rescales solved moles to the live tank context", () => {
    const result = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardInput(), air);
    const larger = calculateRealGasStandardBlend({ pressureUnit: "psi" }, standardInput({ tankSizeCuFt: 120 }), air);

    expect(result.waterVolumeLiters).toBeCloseTo(tankWaterVolumeLiters(80, 3000), 9);
    expect(additionCuFt(result, "helium", 120, 3000)).toBeCloseTo(additionCuFt(result, "helium") * 1.5, 9);
    expect(additionCuFt(larger, "helium", 120, 3000)).toBeCloseTo(additionCuFt(result, "helium", 120, 3000), 9);
    expect(realGasMolesToFreeGasCuFt(10, 0, 80, 3000)).toBe(0);
    expect(realGasMolesToFreeGasCuFt(-1, 11, 80, 3000)).toBe(0);
  });

  test("reports Top-Off start and goal Z with the solved top-off volume", () => {
    const input = trimixTopOffInput({ startPressure: 500, startO2: 32, startHe: 0, resultTemperatureF: 70 });
    const result = calculateRealGasTopOff({ pressureUnit: "psi" }, input, air);

    expect(result.success).toBe(true);
    expect(result.startZ).toBeCloseTo(0.9889, 4);
    expect(result.goalZ).toBeCloseTo(1.0316, 4);
    expect(result.z).toBeCloseTo(result.goalZ ?? 0, 6);
    expect(topOffCuFt(result)).toBeCloseTo(64.05, 2);

    const expectedCuFt = 80 * (
      (result.goalPressurePsi + ATM_PRESSURE_PSI) / (result.goalZ ?? 1) -
      (result.startPressurePsi + ATM_PRESSURE_PSI) / (result.startZ ?? 1)
    ) / 3000;
    expect(topOffCuFt(result)).toBeCloseTo(expectedCuFt, 2);
  });

  test("keeps Top-Off volume fixed when only Result Temp changes", () => {
    const input = trimixTopOffInput({ startPressure: 500, startO2: 32, startHe: 0, resultTemperatureF: 70 });
    const base = calculateRealGasTopOff({ pressureUnit: "psi" }, input, air);
    const hotResult = calculateRealGasTopOff({ pressureUnit: "psi" }, { ...input, resultTemperatureF: 95 }, air);
    const hotStart = calculateRealGasTopOff({ pressureUnit: "psi" }, { ...input, startTemperatureF: 90, resultTemperatureF: 90 }, air);

    expect(hotResult.resultPressurePsi).toBeGreaterThan(base.resultPressurePsi);
    expect(hotResult.goalZ).toBeCloseTo(base.goalZ ?? 0, 9);
    expect(topOffCuFt(hotResult)).toBeCloseTo(topOffCuFt(base), 9);
    expect(topOffCuFt(hotStart)).toBeCloseTo(61.09, 2);
  });

  test("reports an empty Top-Off start at the 1 atm Z", () => {
    const result = calculateRealGasTopOff(
      { pressureUnit: "psi" },
      trimixTopOffInput({ startPressure: 0, startO2: 21, startHe: 0, resultTemperatureF: 70 }),
      air
    );

    expect(result.success).toBe(true);
    expect(result.startZ).toBeCloseTo(0.9997, 4);
  });
});
