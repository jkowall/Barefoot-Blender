import type { DepthUnit, GasDefinition, PressureUnit } from "../state/settings";
import type { StandardBlendInput, MultiGasInput, TopOffInput } from "../state/session";
import { depthPerAtm, fromDisplayPressure } from "./units";

export type GasSelection = {
  id: string;
  name: string;
  o2: number;
  he: number;
};

export type BlendStep = {
  kind: "bleed" | "helium" | "oxygen" | "topoff";
  amount: number;
  gasName: string;
};

export type BlendResult = {
  success: boolean;
  steps: BlendStep[];
  warnings: string[];
  errors: string[];
  bleedPressure?: number;
};

export type TopOffProjectionRow = {
  startPressure: number;
  helium: number | null;
  oxygen: number | null;
  topGas: number | null;
  feasible: boolean;
};

export type TopOffResult = {
  success: boolean;
  finalO2: number;
  finalHe: number;
  finalN2: number;
  finalPressure: number;
  addedPressure: number;
  warnings: string[];
  errors: string[];
};

type BlendInputs = {
  startPressure: number;
  targetPressure: number;
  startO2: number;
  startHe: number;
  targetO2: number;
  targetHe: number;
  topGas: GasSelection;
};

type SolveOutcome = {
  success: boolean;
  requiresBleed: boolean;
  message?: string;
  helium?: number;
  oxygen?: number;
  topoff?: number;
};

const tolerance = 1e-6;

const isCloseToZero = (value: number, eps = tolerance): boolean => Math.abs(value) <= eps;

const fraction = (percent: number): number => percent / 100;

const sanitizeMix = (o2: number, he: number): { valid: boolean; message?: string } => {
  if (o2 < 0 || he < 0) {
    return { valid: false, message: "Gas fractions cannot be negative." };
  }
  if (o2 > 100 || he > 100) {
    return { valid: false, message: "Gas fractions cannot exceed 100%." };
  }
  if (o2 + he > 100 + 1e-9) {
    return { valid: false, message: "O2% + He% must be 100% or less." };
  }
  return { valid: true };
};

const solveBlend = (inputs: BlendInputs): SolveOutcome => {
  const {
    startPressure,
    targetPressure,
    startO2,
    startHe,
    targetO2,
    targetHe,
    topGas
  } = inputs;

  if (targetPressure <= 0) {
    return { success: false, requiresBleed: false, message: "Target pressure must be greater than zero." };
  }

  if (startPressure > targetPressure + tolerance) {
    return {
      success: false,
      requiresBleed: true,
      message: "Target pressure is below current pressure. Bleed-down required."
    };
  }

  const startCheck = sanitizeMix(startO2, startHe);
  if (!startCheck.valid) {
    return { success: false, requiresBleed: false, message: startCheck.message };
  }
  const targetCheck = sanitizeMix(targetO2, targetHe);
  if (!targetCheck.valid) {
    return { success: false, requiresBleed: false, message: targetCheck.message };
  }
  const topCheck = sanitizeMix(topGas.o2, topGas.he);
  if (!topCheck.valid) {
    return { success: false, requiresBleed: false, message: topCheck.message };
  }

  const targetN2 = 1 - fraction(targetO2) - fraction(targetHe);
  if (targetN2 < -tolerance) {
    return {
      success: false,
      requiresBleed: false,
      message: "Target mix is not physically possible."
    };
  }

  const startO2Fraction = fraction(startO2);
  const startHeFraction = fraction(startHe);
  const startN2Fraction = Math.max(0, 1 - startO2Fraction - startHeFraction);

  const targetO2Fraction = fraction(targetO2);
  const targetHeFraction = fraction(targetHe);

  const topO2Fraction = fraction(topGas.o2);
  const topHeFraction = fraction(topGas.he);
  const topN2Fraction = Math.max(0, 1 - topO2Fraction - topHeFraction);

  const dTotal = targetPressure - startPressure;
  const dO2 = targetPressure * targetO2Fraction - startPressure * startO2Fraction;
  const dHe = targetPressure * targetHeFraction - startPressure * startHeFraction;
  const dN2 = targetPressure * targetN2 - startPressure * startN2Fraction;

  if (dO2 < -tolerance || dHe < -tolerance || dN2 < -tolerance) {
    return {
      success: false,
      requiresBleed: true,
      message: "Start mix exceeds target specification. Bleed-down recommended."
    };
  }

  if (isCloseToZero(dTotal)) {
    return { success: false, requiresBleed: false, message: "Target pressure matches start pressure." };
  }

  let topoff = 0;
  let helium = 0;
  let oxygen = 0;

  if (topN2Fraction > tolerance) {
    topoff = (dTotal - dHe - dO2) / topN2Fraction;
    helium = dHe - topHeFraction * topoff;
    oxygen = dO2 - topO2Fraction * topoff;
  } else {
    const nitrogenDeltaOk = Math.abs(dTotal - (dHe + dO2)) <= 1e-4;
    if (!nitrogenDeltaOk) {
      return {
        success: false,
        requiresBleed: true,
        message: "Selected top-off gas cannot reach target without bleed-down."
      };
    }
    topoff = 0;
    helium = dHe;
    oxygen = dO2;
  }

  if (helium < -tolerance || oxygen < -tolerance || topoff < -tolerance) {
    return {
      success: false,
      requiresBleed: true,
      message: "Blend requires removing gas. Bleed-down suggested."
    };
  }

  helium = Math.max(0, helium);
  oxygen = Math.max(0, oxygen);
  topoff = Math.max(0, topoff);

  const finalPressure = startPressure + helium + oxygen + topoff;
  if (Math.abs(finalPressure - targetPressure) > 0.5) {
    return {
      success: false,
      requiresBleed: true,
      message: "Unable to match target pressure with current inputs."
    };
  }

  return {
    success: true,
    requiresBleed: false,
    helium,
    oxygen,
    topoff
  };
};

const findBleedSolution = (inputs: BlendInputs): SolveOutcome & { bleedPressure?: number } => {
  const { startPressure } = inputs;
  let low = 0;
  let high = startPressure;
  let best: SolveOutcome & { bleedPressure?: number } = {
    success: false,
    requiresBleed: true
  };

  for (let i = 0; i < 40; i += 1) {
    const mid = (low + high) / 2;
    const scaledInputs: BlendInputs = {
      ...inputs,
      startPressure: mid
    };
    // Maintain fractions by keeping composition identical during bleed-down search
    scaledInputs.startO2 = inputs.startO2;
    scaledInputs.startHe = inputs.startHe;

    const attempt = solveBlend(scaledInputs);
    if (attempt.success) {
      best = { ...attempt, bleedPressure: mid };
      high = mid;
    } else {
      low = mid;
    }
  }

  return best;
};

export const calculateStandardBlend = (
  settings: { pressureUnit: PressureUnit },
  inputs: StandardBlendInput,
  topGas: GasSelection
): BlendResult => {
  const startPressurePsi = fromDisplayPressure(inputs.startPressure, settings.pressureUnit);
  const targetPressurePsi = fromDisplayPressure(inputs.targetPressure, settings.pressureUnit);

  const blendInputs: BlendInputs = {
    startPressure: startPressurePsi,
    targetPressure: targetPressurePsi,
    startO2: inputs.startO2,
    startHe: inputs.startHe,
    targetO2: inputs.targetO2,
    targetHe: inputs.targetHe,
    topGas
  };

  const primary = solveBlend(blendInputs);

  const warnings: string[] = [];
  if (inputs.targetO2 < 18) {
    warnings.push("Hypoxic mix (<18% O2).");
  }
  if (inputs.targetO2 > 40) {
    warnings.push("High O2 - fire risk (>40% O2).");
  }

  if (primary.success) {
    const steps: BlendStep[] = [];
    if (primary.helium && primary.helium > tolerance) {
      steps.push({ kind: "helium", amount: primary.helium, gasName: "Helium" });
    }
    if (primary.oxygen && primary.oxygen > tolerance) {
      steps.push({ kind: "oxygen", amount: primary.oxygen, gasName: "Oxygen" });
    }
    if (primary.topoff && primary.topoff > tolerance) {
      steps.push({ kind: "topoff", amount: primary.topoff, gasName: topGas.name });
    }

    return {
      success: true,
      steps,
      warnings,
      errors: []
    };
  }

  if (!primary.requiresBleed) {
    return {
      success: false,
      steps: [],
      warnings,
      errors: primary.message ? [primary.message] : ["Calculation failed."]
    };
  }

  if (startPressurePsi <= tolerance) {
    return {
      success: false,
      steps: [],
      warnings,
      errors: [primary.message ?? "Blend is not possible with current inputs."]
    };
  }

  const bleed = findBleedSolution(blendInputs);
  if (!bleed.success || bleed.bleedPressure === undefined) {
    return {
      success: false,
      steps: [],
      warnings,
      errors: [primary.message ?? "Unable to compute bleed-down solution."]
    };
  }

  const bleedAmount = startPressurePsi - bleed.bleedPressure;
  const steps: BlendStep[] = [
    {
      kind: "bleed",
      amount: bleedAmount,
      gasName: "Bleed"
    }
  ];

  if (bleed.helium && bleed.helium > tolerance) {
    steps.push({ kind: "helium", amount: bleed.helium, gasName: "Helium" });
  }
  if (bleed.oxygen && bleed.oxygen > tolerance) {
    steps.push({ kind: "oxygen", amount: bleed.oxygen, gasName: "Oxygen" });
  }
  if (bleed.topoff && bleed.topoff > tolerance) {
    steps.push({ kind: "topoff", amount: bleed.topoff, gasName: topGas.name });
  }

  return {
    success: true,
    steps,
    warnings,
    errors: [],
    bleedPressure: bleed.bleedPressure
  };
};

export const projectTopOffChart = (
  settings: { pressureUnit: PressureUnit },
  baseInputs: StandardBlendInput,
  topGas: GasSelection
): TopOffProjectionRow[] => {
  const basePressurePsi = fromDisplayPressure(baseInputs.startPressure, settings.pressureUnit);
  const step = settings.pressureUnit === "psi" ? 100 : 10;
  const deltas = [0, step, step * 2, step * 3];

  return deltas.map((deltaDisplay) => {
    const adjustedDisplay = baseInputs.startPressure - deltaDisplay;
    const adjustedPsi = basePressurePsi - fromDisplayPressure(deltaDisplay, settings.pressureUnit);

    if (adjustedDisplay < 0 || adjustedPsi < 0) {
      return {
        startPressure: Math.max(0, adjustedPsi),
        helium: null,
        oxygen: null,
        topGas: null,
        feasible: false
      };
    }

    const attemptInputs: StandardBlendInput = {
      ...baseInputs,
      startPressure: adjustedDisplay
    };

    const result = calculateStandardBlend(settings, attemptInputs, topGas);
    if (!result.success || result.steps.some((step) => step.kind === "bleed")) {
      return {
        startPressure: adjustedPsi,
        helium: null,
        oxygen: null,
        topGas: null,
        feasible: false
      };
    }

    const helium = result.steps.find((step) => step.kind === "helium")?.amount ?? 0;
    const oxygen = result.steps.find((step) => step.kind === "oxygen")?.amount ?? 0;
    const topoff = result.steps.find((step) => step.kind === "topoff")?.amount ?? 0;

    return {
      startPressure: adjustedPsi,
      helium,
      oxygen,
      topGas: topoff,
      feasible: true
    };
  });
};

export const calculateTopOffBlend = (
  settings: { pressureUnit: PressureUnit },
  inputs: TopOffInput,
  topGas: GasSelection
): TopOffResult => {
  const startPressurePsi = fromDisplayPressure(inputs.startPressure, settings.pressureUnit);
  const finalPressurePsi = fromDisplayPressure(inputs.finalPressure, settings.pressureUnit);

  if (finalPressurePsi <= tolerance) {
    return {
      success: false,
      finalO2: 0,
      finalHe: 0,
      finalN2: 0,
      finalPressure: finalPressurePsi,
      addedPressure: 0,
      warnings: [],
      errors: ["Final pressure must be greater than zero."]
    };
  }

  if (startPressurePsi < 0) {
    return {
      success: false,
      finalO2: 0,
      finalHe: 0,
      finalN2: 0,
      finalPressure: finalPressurePsi,
      addedPressure: 0,
      warnings: [],
      errors: ["Start pressure cannot be negative."]
    };
  }

  const addedPressurePsi = finalPressurePsi - startPressurePsi;
  if (addedPressurePsi < -tolerance) {
    return {
      success: false,
      finalO2: 0,
      finalHe: 0,
      finalN2: 0,
      finalPressure: finalPressurePsi,
      addedPressure: 0,
      warnings: [],
      errors: ["Final pressure is below current pressure. Bleed-down required."]
    };
  }

  const startCheck = sanitizeMix(inputs.startO2, inputs.startHe);
  if (!startCheck.valid) {
    return {
      success: false,
      finalO2: 0,
      finalHe: 0,
      finalN2: 0,
      finalPressure: finalPressurePsi,
      addedPressure: 0,
      warnings: [],
      errors: [startCheck.message ?? "Invalid start mix."]
    };
  }

  const topCheck = sanitizeMix(topGas.o2, topGas.he);
  if (!topCheck.valid) {
    return {
      success: false,
      finalO2: 0,
      finalHe: 0,
      finalN2: 0,
      finalPressure: finalPressurePsi,
      addedPressure: 0,
      warnings: [],
      errors: [topCheck.message ?? "Invalid top-off mix."]
    };
  }

  if (startPressurePsi <= tolerance && addedPressurePsi <= tolerance) {
    return {
      success: false,
      finalO2: 0,
      finalHe: 0,
      finalN2: 0,
      finalPressure: finalPressurePsi,
      addedPressure: 0,
      warnings: [],
      errors: ["No gas in cylinder. Add pressure or adjust inputs."]
    };
  }

  const totalPressurePsi = Math.max(finalPressurePsi, tolerance);
  const addedGasPsi = Math.max(0, addedPressurePsi);

  const startO2Fraction = fraction(inputs.startO2);
  const startHeFraction = fraction(inputs.startHe);
  const startN2Fraction = Math.max(0, 1 - startO2Fraction - startHeFraction);

  const topO2Fraction = fraction(topGas.o2);
  const topHeFraction = fraction(topGas.he);
  const topN2Fraction = Math.max(0, 1 - topO2Fraction - topHeFraction);

  const totalO2 = startPressurePsi * startO2Fraction + addedGasPsi * topO2Fraction;
  const totalHe = startPressurePsi * startHeFraction + addedGasPsi * topHeFraction;
  const totalN2 = startPressurePsi * startN2Fraction + addedGasPsi * topN2Fraction;

  const finalO2Fraction = Math.max(0, Math.min(1, totalO2 / totalPressurePsi));
  const finalHeFraction = Math.max(0, Math.min(1, totalHe / totalPressurePsi));
  const finalN2Fraction = Math.max(0, Math.min(1, totalN2 / totalPressurePsi));

  const finalO2Percent = finalO2Fraction * 100;
  const finalHePercent = finalHeFraction * 100;
  const finalN2Percent = Math.max(0, Math.min(100, finalN2Fraction * 100));

  const warnings: string[] = [];
  if (finalO2Percent < 18) {
    warnings.push("Hypoxic mix (<18% O2).");
  }
  if (finalO2Percent > 40) {
    warnings.push("High O2 - fire risk (>40% O2).");
  }

  return {
    success: true,
    finalO2: finalO2Percent,
    finalHe: finalHePercent,
    finalN2: finalN2Percent,
    finalPressure: finalPressurePsi,
    addedPressure: addedGasPsi,
    warnings,
    errors: []
  };
};

export const calculateMultiGasBlend = (
  settings: { pressureUnit: PressureUnit },
  inputs: MultiGasInput,
  gas1: GasSelection,
  gas2: GasSelection
): { success: boolean; steps: { gas: string; amount: number }[]; error?: string } => {
  const targetPressurePsi = fromDisplayPressure(inputs.targetPressure, settings.pressureUnit);
  const targetO2Fraction = fraction(inputs.targetO2);

  const gas1O2Fraction = fraction(gas1.o2);
  const gas2O2Fraction = fraction(gas2.o2);

  if (inputs.targetO2 < Math.min(gas1.o2, gas2.o2) - 1e-6 || inputs.targetO2 > Math.max(gas1.o2, gas2.o2) + 1e-6) {
    return {
      success: false,
      steps: [],
      error: "Target O2% must lie between Gas 1 and Gas 2 O2%."
    };
  }

  const denominator = gas1O2Fraction - gas2O2Fraction;
  if (Math.abs(denominator) < tolerance) {
    return {
      success: false,
      steps: [],
      error: "Source gases must have different O2 percentages."
    };
  }

  const gas1Pressure = targetPressurePsi * (targetO2Fraction - gas2O2Fraction) / denominator;
  const gas2Pressure = targetPressurePsi - gas1Pressure;

  if (gas1Pressure < -tolerance || gas2Pressure < -tolerance) {
    return {
      success: false,
      steps: [],
      error: "Blend requires negative source gas volume."
    };
  }

  return {
    success: true,
    steps: [
      { gas: gas1.name, amount: Math.max(0, gas1Pressure) },
      { gas: gas2.name, amount: Math.max(0, gas2Pressure) }
    ]
  };
};

export const calculateMOD = (
  o2Percent: number,
  targetPPO2: number,
  contingencyPPO2: number,
  unit: DepthUnit
): { mod: number; contingency: number } => {
  const fractionO2 = fraction(o2Percent);
  if (fractionO2 <= 0) {
    return { mod: 0, contingency: 0 };
  }
  const perAtm = depthPerAtm(unit);
  const mod = (targetPPO2 / fractionO2 - 1) * perAtm;
  const contingency = (contingencyPPO2 / fractionO2 - 1) * perAtm;
  return { mod, contingency };
};

export const calculateEAD = (o2Percent: number, depth: number, unit: DepthUnit): number => {
  const fractionO2 = fraction(o2Percent);
  const perAtm = depthPerAtm(unit);
  const ambient = depth / perAtm + 1;
  const nitrogenFraction = 1 - fractionO2;
  const ead = (ambient * nitrogenFraction / 0.79 - 1) * perAtm;
  return Math.max(0, ead);
};

export const calculateBestMix = (depth: number, targetPPO2: number, unit: DepthUnit): number => {
  const perAtm = depthPerAtm(unit);
  const ambient = depth / perAtm + 1;
  return Math.min(100, Math.max(0, targetPPO2 / ambient * 100));
};

export const calculateEND = (
  o2Percent: number,
  hePercent: number,
  depth: number,
  unit: DepthUnit,
  oxygenIsNarcotic: boolean
): number => {
  const fractionO2 = fraction(o2Percent);
  const fractionHe = fraction(hePercent);
  const fractionN2 = Math.max(0, 1 - fractionO2 - fractionHe);
  const narcoticFraction = oxygenIsNarcotic ? fractionO2 + fractionN2 : fractionN2;
  const perAtm = depthPerAtm(unit);
  const ambient = depth / perAtm + 1;
  const end = (ambient * narcoticFraction / 0.79 - 1) * perAtm;
  return Math.max(0, end);
};

const gasDensityAtSurface = (o2Percent: number, hePercent: number): number => {
  const fractionO2 = fraction(o2Percent);
  const fractionHe = fraction(hePercent);
  const fractionN2 = Math.max(0, 1 - fractionO2 - fractionHe);
  const densityO2 = 1.429; // g/L at 1 ATA
  const densityN2 = 1.2506;
  const densityHe = 0.1785;
  return fractionO2 * densityO2 + fractionN2 * densityN2 + fractionHe * densityHe;
};

export const calculateDensity = (o2Percent: number, hePercent: number, depth: number, unit: DepthUnit): number => {
  const baseDensity = gasDensityAtSurface(o2Percent, hePercent);
  const perAtm = depthPerAtm(unit);
  const ambient = depth / perAtm + 1;
  return baseDensity * ambient;
};

export const listTopOffOptions = (customGases: GasDefinition[]): GasSelection[] => {
  return [
    { id: "air", name: "Air", o2: 21, he: 0 },
    { id: "oxygen", name: "Oxygen", o2: 100, he: 0 },
    { id: "helium", name: "Helium", o2: 0, he: 100 },
    ...customGases.map((gas) => ({ id: gas.id, name: gas.name, o2: gas.o2, he: gas.he }))
  ];
};
