import type { PressureUnit } from "../state/settings";
import type { StandardBlendInput } from "../state/session";
import type { GasSelection } from "./calculations";
import {
  ATM_PRESSURE_PSI,
  absoluteKpaToGaugePsi,
  gasFractionsFromPercents,
  gaugePsiToAbsoluteKpa,
  gergDensityFromPressure,
  gergPressureFromDensity,
  normalizeGergFractions,
  type GergGasFractions
} from "./gerg2008";
import {
  DEFAULT_SETTLED_TEMPERATURE_F,
  DEFAULT_START_TEMPERATURE_F,
  fahrenheitToKelvin
} from "./temperature";
import { fromDisplayPressure } from "./units";

export type RealGasBlendStep = {
  kind: "helium" | "oxygen" | "topoff";
  gasName: string;
  molesAdded: number;
  stopPressurePsi: number;
  pressureChangePsi: number;
  temperatureF: number;
  z: number;
};

export type RealGasBlendResult = {
  success: boolean;
  steps: RealGasBlendStep[];
  startHotPressurePsi: number;
  finalHotPressurePsi: number;
  targetSettledPressurePsi: number;
  warnings: string[];
  errors: string[];
};

type RealGasBlendSettings = {
  pressureUnit: PressureUnit;
};

type ComponentMoles = {
  o2: number;
  he: number;
  n2: number;
};

type StepPlan = {
  kind: RealGasBlendStep["kind"];
  gasName: string;
  moles: number;
  fractions: GergGasFractions;
};

const CUFT_TO_LITERS = 28.316846592;
const MOLE_TOLERANCE = 1e-8;

const pureOxygenFractions: GergGasFractions = { o2: 1, he: 0, n2: 0 };
const pureHeliumFractions: GergGasFractions = { o2: 0, he: 1, n2: 0 };

const componentMolesFromTotal = (totalMoles: number, fractions: GergGasFractions): ComponentMoles => ({
  o2: totalMoles * fractions.o2,
  he: totalMoles * fractions.he,
  n2: totalMoles * fractions.n2
});

const addGasMoles = (components: ComponentMoles, moles: number, fractions: GergGasFractions): ComponentMoles => ({
  o2: components.o2 + moles * fractions.o2,
  he: components.he + moles * fractions.he,
  n2: components.n2 + moles * fractions.n2
});

const totalMoles = (components: ComponentMoles): number => components.o2 + components.he + components.n2;

const fractionsFromMoles = (components: ComponentMoles): GergGasFractions => {
  const total = totalMoles(components);
  if (total <= MOLE_TOLERANCE) {
    return { o2: 0.21, he: 0, n2: 0.79 };
  }
  return normalizeGergFractions({
    o2: components.o2 / total,
    he: components.he / total,
    n2: components.n2 / total
  });
};

const tankWaterVolumeLiters = (tankSizeCuFt: number, tankRatedPressurePsi: number): number => {
  if (tankSizeCuFt <= 0 || tankRatedPressurePsi <= 0) {
    return 0;
  }
  const freeGasLiters = tankSizeCuFt * CUFT_TO_LITERS;
  return freeGasLiters * ATM_PRESSURE_PSI / (tankRatedPressurePsi + ATM_PRESSURE_PSI);
};

const stateFromComponents = (
  temperatureK: number,
  components: ComponentMoles,
  waterVolumeLiters: number
): { success: boolean; pressurePsi: number; z: number; warnings: string[]; errors: string[] } => {
  const total = totalMoles(components);
  if (total <= MOLE_TOLERANCE) {
    return { success: true, pressurePsi: 0, z: 1, warnings: [], errors: [] };
  }

  const state = gergPressureFromDensity(temperatureK, total / waterVolumeLiters, fractionsFromMoles(components));
  return {
    success: state.success,
    pressurePsi: absoluteKpaToGaugePsi(state.pressureKpa),
    z: state.z,
    warnings: state.warnings,
    errors: state.errors
  };
};

const stepTemperatureF = (
  inputs: StandardBlendInput,
  kind: RealGasBlendStep["kind"],
  startTemperatureF: number
): number => {
  if (inputs.stageTemperatureTouched === undefined) {
    return inputs.stageTemperaturesF?.[kind] ?? inputs.fillTemperatureF ?? startTemperatureF;
  }
  return inputs.stageTemperaturesF?.[kind] ?? startTemperatureF;
};

export const calculateRealGasStandardBlend = (
  settings: RealGasBlendSettings,
  inputs: StandardBlendInput,
  topGas: GasSelection
): RealGasBlendResult => {
  const startPressurePsi = fromDisplayPressure(inputs.startPressure ?? 0, settings.pressureUnit);
  const targetPressurePsi = fromDisplayPressure(inputs.targetPressure ?? 0, settings.pressureUnit);
  const tankSizeCuFt = inputs.tankSizeCuFt ?? 80;
  const tankRatedPressurePsi = inputs.tankRatedPressurePsi ?? 3000;
  const waterVolumeLiters = tankWaterVolumeLiters(tankSizeCuFt, tankRatedPressurePsi);
  const warnings: string[] = [];
  const errors: string[] = [];

  if (waterVolumeLiters <= 0) {
    return {
      success: false,
      steps: [],
      startHotPressurePsi: startPressurePsi,
      finalHotPressurePsi: targetPressurePsi,
      targetSettledPressurePsi: targetPressurePsi,
      warnings,
      errors: ["Tank size and rated pressure are required for GERG-2008 correction."]
    };
  }

  const startFractions = gasFractionsFromPercents(inputs.startO2 ?? 21, inputs.startHe ?? 0);
  const targetFractions = gasFractionsFromPercents(inputs.targetO2 ?? 32, inputs.targetHe ?? 0);
  const topFractions = gasFractionsFromPercents(topGas.o2, topGas.he);
  const invalidMix = [startFractions, targetFractions, topFractions].some((mix) => mix.o2 < -MOLE_TOLERANCE || mix.he < -MOLE_TOLERANCE || mix.n2 < -MOLE_TOLERANCE);
  if (invalidMix) {
    return {
      success: false,
      steps: [],
      startHotPressurePsi: startPressurePsi,
      finalHotPressurePsi: targetPressurePsi,
      targetSettledPressurePsi: targetPressurePsi,
      warnings,
      errors: ["Gas fractions must be between 0% and 100%, and O2% + He% must not exceed 100%."]
    };
  }

  const startTemperatureK = fahrenheitToKelvin(inputs.startTemperatureF ?? DEFAULT_START_TEMPERATURE_F);
  const startTemperatureF = inputs.startTemperatureF ?? DEFAULT_START_TEMPERATURE_F;
  const settledTemperatureK = fahrenheitToKelvin(inputs.settledTemperatureF ?? DEFAULT_SETTLED_TEMPERATURE_F);

  let startComponents: ComponentMoles = { o2: 0, he: 0, n2: 0 };
  if (startPressurePsi > MOLE_TOLERANCE) {
    const startDensity = gergDensityFromPressure(startTemperatureK, gaugePsiToAbsoluteKpa(startPressurePsi), startFractions);
    warnings.push(...startDensity.warnings);
    if (!startDensity.success) {
      return {
        success: false,
        steps: [],
        startHotPressurePsi: startPressurePsi,
        finalHotPressurePsi: targetPressurePsi,
        targetSettledPressurePsi: targetPressurePsi,
        warnings,
        errors: startDensity.errors
      };
    }
    startComponents = componentMolesFromTotal(startDensity.densityMolPerLiter * waterVolumeLiters, startFractions);
  }

  const targetDensity = gergDensityFromPressure(settledTemperatureK, gaugePsiToAbsoluteKpa(targetPressurePsi), targetFractions);
  warnings.push(...targetDensity.warnings);
  if (!targetDensity.success) {
    return {
      success: false,
      steps: [],
      startHotPressurePsi: startPressurePsi,
      finalHotPressurePsi: targetPressurePsi,
      targetSettledPressurePsi: targetPressurePsi,
      warnings,
      errors: targetDensity.errors
    };
  }

  const targetComponents = componentMolesFromTotal(targetDensity.densityMolPerLiter * waterVolumeLiters, targetFractions);
  const delta = {
    o2: targetComponents.o2 - startComponents.o2,
    he: targetComponents.he - startComponents.he,
    n2: targetComponents.n2 - startComponents.n2
  };

  if (delta.o2 < -MOLE_TOLERANCE || delta.he < -MOLE_TOLERANCE || delta.n2 < -MOLE_TOLERANCE) {
    return {
      success: false,
      steps: [],
      startHotPressurePsi: startPressurePsi,
      finalHotPressurePsi: targetPressurePsi,
      targetSettledPressurePsi: targetPressurePsi,
      warnings,
      errors: ["GERG-2008 correction currently supports direct fills only. Complete the bleed-down step, then recalculate from the post-bleed state."]
    };
  }

  let topoffMoles: number;
  let heliumMoles: number;
  let oxygenMoles: number;

  if (topFractions.n2 > MOLE_TOLERANCE) {
    topoffMoles = delta.n2 / topFractions.n2;
    heliumMoles = delta.he - topFractions.he * topoffMoles;
    oxygenMoles = delta.o2 - topFractions.o2 * topoffMoles;
  } else {
    if (delta.n2 > MOLE_TOLERANCE) {
      return {
        success: false,
        steps: [],
        startHotPressurePsi: startPressurePsi,
        finalHotPressurePsi: targetPressurePsi,
        targetSettledPressurePsi: targetPressurePsi,
        warnings,
        errors: ["Selected top-off gas has no nitrogen and cannot reach the target N2 fraction."]
      };
    }
    topoffMoles = 0;
    heliumMoles = delta.he;
    oxygenMoles = delta.o2;
  }

  if (topoffMoles < -MOLE_TOLERANCE || heliumMoles < -MOLE_TOLERANCE || oxygenMoles < -MOLE_TOLERANCE) {
    return {
      success: false,
      steps: [],
      startHotPressurePsi: startPressurePsi,
      finalHotPressurePsi: targetPressurePsi,
      targetSettledPressurePsi: targetPressurePsi,
      warnings,
      errors: ["GERG-2008 correction requires removing gas or changing the top-off gas."]
    };
  }

  const plannedSteps: StepPlan[] = [];
  if (heliumMoles > MOLE_TOLERANCE) {
    plannedSteps.push({ kind: "helium", gasName: "Helium", moles: heliumMoles, fractions: pureHeliumFractions });
  }
  if (oxygenMoles > MOLE_TOLERANCE) {
    plannedSteps.push({ kind: "oxygen", gasName: "Oxygen", moles: oxygenMoles, fractions: pureOxygenFractions });
  }
  if (topoffMoles > MOLE_TOLERANCE) {
    plannedSteps.push({ kind: "topoff", gasName: topGas.name, moles: topoffMoles, fractions: topFractions });
  }

  let runningComponents = startComponents;
  let startHotPressurePsi = startPressurePsi;
  let previousPressurePsi = startPressurePsi;
  const steps: RealGasBlendStep[] = [];
  for (const step of plannedSteps) {
    const temperatureF = stepTemperatureF(inputs, step.kind, startTemperatureF);
    const temperatureK = fahrenheitToKelvin(temperatureF);
    const beforeState = stateFromComponents(temperatureK, runningComponents, waterVolumeLiters);
    warnings.push(...beforeState.warnings);
    if (!beforeState.success) {
      return {
        success: false,
        steps,
        startHotPressurePsi,
        finalHotPressurePsi: previousPressurePsi,
        targetSettledPressurePsi: targetPressurePsi,
        warnings,
        errors: beforeState.errors
      };
    }
    if (steps.length === 0) {
      startHotPressurePsi = beforeState.pressurePsi;
    }

    const nextComponents = addGasMoles(runningComponents, step.moles, step.fractions);
    const state = stateFromComponents(temperatureK, nextComponents, waterVolumeLiters);
    warnings.push(...state.warnings);
    if (!state.success) {
      return {
        success: false,
        steps,
        startHotPressurePsi,
        finalHotPressurePsi: previousPressurePsi,
        targetSettledPressurePsi: targetPressurePsi,
        warnings,
        errors: state.errors
      };
    }

    runningComponents = nextComponents;
    steps.push({
      kind: step.kind,
      gasName: step.gasName,
      molesAdded: step.moles,
      stopPressurePsi: state.pressurePsi,
      pressureChangePsi: state.pressurePsi - beforeState.pressurePsi,
      temperatureF,
      z: state.z
    });
    previousPressurePsi = state.pressurePsi;
  }

  return {
    success: true,
    steps,
    startHotPressurePsi,
    finalHotPressurePsi: previousPressurePsi,
    targetSettledPressurePsi: targetPressurePsi,
    warnings: [...new Set(warnings)],
    errors
  };
};
