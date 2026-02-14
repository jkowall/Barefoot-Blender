import type { DepthUnit, GasDefinition, PressureUnit } from "../state/settings";
import type { StandardBlendInput, MultiGasInput, TopOffInput } from "../state/session";
import { depthPerAtm, fromDisplayPressure, toDisplayPressure } from "./units";

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

export type BlendVolumes = {
  helium: number;
  oxygen: number;
  topoff: number;
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

export const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

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

  for (let i = 0; i < 25; i += 1) {
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

export const summarizeBlendVolumes = (result: BlendResult): BlendVolumes => {
  const summary: BlendVolumes = {
    helium: 0,
    oxygen: 0,
    topoff: 0
  };

  if (!result.success) {
    return summary;
  }

  for (const step of result.steps) {
    if (step.kind === "helium") {
      summary.helium += step.amount;
    } else if (step.kind === "oxygen") {
      summary.oxygen += step.amount;
    } else if (step.kind === "topoff") {
      summary.topoff += step.amount;
    }
  }

  return summary;
};

export const calculateStandardBlend = (
  settings: { pressureUnit: PressureUnit },
  inputs: StandardBlendInput,
  topGas: GasSelection
): BlendResult => {
  const startPressurePsi = fromDisplayPressure(inputs.startPressure ?? 0, settings.pressureUnit);
  const targetPressurePsi = fromDisplayPressure(inputs.targetPressure ?? 0, settings.pressureUnit);

  const blendInputs: BlendInputs = {
    startPressure: startPressurePsi,
    targetPressure: targetPressurePsi,
    startO2: inputs.startO2 ?? 21,
    startHe: inputs.startHe ?? 0,
    targetO2: inputs.targetO2 ?? 32,
    targetHe: inputs.targetHe ?? 0,
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

export type StartPressureSolveResult = {
  success: boolean;
  startPressurePsi: number;
  blend: BlendResult | null;
  warnings: string[];
  errors: string[];
};

export const solveRequiredStartPressure = (
  settings: { pressureUnit: PressureUnit },
  inputs: StandardBlendInput,
  topGas: GasSelection
): StartPressureSolveResult => {
  const targetPressurePsi = fromDisplayPressure(inputs.targetPressure, settings.pressureUnit);
  if (targetPressurePsi <= tolerance) {
    return {
      success: false,
      startPressurePsi: 0,
      blend: null,
      warnings: [],
      errors: ["Target pressure must be greater than zero."]
    };
  }

  const evaluate = (startPsi: number): BlendResult => {
    const candidate: StandardBlendInput = {
      ...inputs,
      startPressure: toDisplayPressure(startPsi, settings.pressureUnit)
    };
    return calculateStandardBlend(settings, candidate, topGas);
  };

  const upper = evaluate(targetPressurePsi);
  const upperVolumes = summarizeBlendVolumes(upper);
  if (!upper.success || upper.steps.some((step) => step.kind === "bleed") || upperVolumes.helium > tolerance) {
    return {
      success: false,
      startPressurePsi: 0,
      blend: null,
      warnings: [],
      errors: ["Target cannot be met without adding helium at full cylinder pressure."]
    };
  }

  let low = 0;
  let high = targetPressurePsi;
  let best: { startPsi: number; result: BlendResult } | null = { startPsi: targetPressurePsi, result: upper };

  for (let i = 0; i < 25; i += 1) {
    const mid = (low + high) / 2;
    const attempt = evaluate(mid);
    if (!attempt.success || attempt.steps.some((step) => step.kind === "bleed")) {
      low = mid;
      continue;
    }

    const volumes = summarizeBlendVolumes(attempt);
    if (volumes.helium <= tolerance) {
      best = { startPsi: mid, result: attempt };
      high = mid;
    } else {
      low = mid;
    }
  }

  if (!best) {
    return {
      success: false,
      startPressurePsi: 0,
      blend: null,
      warnings: [],
      errors: ["Unable to determine required start pressure without helium addition."]
    };
  }

  return {
    success: true,
    startPressurePsi: best.startPsi,
    blend: best.result,
    warnings: best.result.warnings,
    errors: []
  };
};

export type NoHeliumTargetResult = {
  success: boolean;
  targetHe: number;
  blend: BlendResult | null;
  warnings: string[];
  errors: string[];
};

export const solveMaxTargetWithoutHelium = (
  settings: { pressureUnit: PressureUnit },
  inputs: StandardBlendInput,
  topGas: GasSelection
): NoHeliumTargetResult => {
  const maxHe = Math.max(0, Math.min(100 - inputs.targetO2, 100));
  if (maxHe <= tolerance) {
    return {
      success: true,
      targetHe: 0,
      blend: calculateStandardBlend(settings, { ...inputs, targetHe: 0 }, topGas),
      warnings: [],
      errors: []
    };
  }

  let low = 0;
  let high = maxHe;
  let best: { he: number; result: BlendResult } | null = null;

  for (let i = 0; i < 25; i += 1) {
    const mid = (low + high) / 2;
    const candidate: StandardBlendInput = {
      ...inputs,
      targetHe: mid
    };
    const attempt = calculateStandardBlend(settings, candidate, topGas);

    if (!attempt.success || attempt.steps.some((step) => step.kind === "bleed")) {
      high = mid;
      continue;
    }

    const volumes = summarizeBlendVolumes(attempt);
    if (volumes.helium <= tolerance) {
      best = { he: mid, result: attempt };
      low = mid;
    } else {
      high = mid;
    }
  }

  if (!best) {
    return {
      success: false,
      targetHe: 0,
      blend: null,
      warnings: [],
      errors: ["Unable to achieve a target mix without helium addition."]
    };
  }

  return {
    success: true,
    targetHe: best.he,
    blend: best.result,
    warnings: best.result.warnings,
    errors: []
  };
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

type TwoGasBlendResult =
  | {
    success: true;
    gas1Amount: number;
    gas2Amount: number;
    finalO2: number;
    finalHe: number;
    warning?: string;
  }
  | {
    success: false;
    error: string;
  };

const solveTwoGasBlend = (
  targetPressurePsi: number,
  targetO2: number,
  targetHe: number,
  gas1: GasSelection,
  gas2: GasSelection
): TwoGasBlendResult => {
  const targetO2Fraction = fraction(targetO2);
  const targetHeFraction = fraction(targetHe);
  if (targetO2Fraction + targetHeFraction > 1 + tolerance) {
    return {
      success: false,
      error: "O2 + He must be 100% or less."
    };
  }

  const gas1O2Fraction = fraction(gas1.o2);
  const gas1HeFraction = fraction(gas1.he);
  const gas2O2Fraction = fraction(gas2.o2);
  const gas2HeFraction = fraction(gas2.he);

  const demandO2 = targetPressurePsi * targetO2Fraction;
  const demandHe = targetPressurePsi * targetHeFraction;

  const determinant = gas1O2Fraction * gas2HeFraction - gas2O2Fraction * gas1HeFraction;

  let gas1Pressure: number | null = null;
  let gas2Pressure: number | null = null;
  let usedTrimixSolver = false;

  if (
    Math.abs(determinant) > tolerance &&
    (targetHeFraction > tolerance || gas1HeFraction > tolerance || gas2HeFraction > tolerance)
  ) {
    usedTrimixSolver = true;
    gas1Pressure = (demandO2 * gas2HeFraction - demandHe * gas2O2Fraction) / determinant;
    gas2Pressure = (gas1O2Fraction * demandHe - gas1HeFraction * demandO2) / determinant;
  }

  if (gas1Pressure === null || gas2Pressure === null) {
    if (
      targetO2 < Math.min(gas1.o2, gas2.o2) - 1e-6 ||
      targetO2 > Math.max(gas1.o2, gas2.o2) + 1e-6
    ) {
      return {
        success: false,
        error: "Target O2% must lie between Gas 1 and Gas 2 O2%."
      };
    }

    const denominator = gas1O2Fraction - gas2O2Fraction;
    if (Math.abs(denominator) < tolerance) {
      return {
        success: false,
        error: "Source gases must have different O2 percentages."
      };
    }

    gas1Pressure = targetPressurePsi * (targetO2Fraction - gas2O2Fraction) / denominator;
    gas2Pressure = targetPressurePsi - gas1Pressure;
  }

  if (gas1Pressure < -tolerance || gas2Pressure < -tolerance) {
    return {
      success: false,
      error: "Blend requires negative source gas volume."
    };
  }

  const sanitizedGas1 = Math.max(0, gas1Pressure);
  const sanitizedGas2 = Math.max(0, gas2Pressure);
  const totalPressure = sanitizedGas1 + sanitizedGas2;

  if (totalPressure <= tolerance) {
    return {
      success: false,
      error: "Unable to compute source gas contributions."
    };
  }

  if (Math.abs(totalPressure - targetPressurePsi) > Math.max(5, targetPressurePsi * 0.01)) {
    return {
      success: false,
      error: "Selected sources cannot meet the target composition at this pressure."
    };
  }

  const resultO2 = (sanitizedGas1 * gas1O2Fraction + sanitizedGas2 * gas2O2Fraction) / totalPressure * 100;
  const resultHe = (sanitizedGas1 * gas1HeFraction + sanitizedGas2 * gas2HeFraction) / totalPressure * 100;

  let warning: string | undefined;
  if (usedTrimixSolver) {
    const heError = Math.abs(resultHe - targetHe);
    if (heError > 0.5) {
      warning = "Helium target may require additional trimming with oxygen or helium.";
    }
  }

  return {
    success: true,
    gas1Amount: sanitizedGas1,
    gas2Amount: sanitizedGas2,
    finalO2: resultO2,
    finalHe: resultHe,
    warning
  };
};

const MULTI_GAS_O2_TOLERANCE = 1;
const MULTI_GAS_HE_TOLERANCE = 5;
const MULTI_GAS_O2_STEP = 0.1;
const MULTI_GAS_HE_STEP = 0.5;

const buildSearchValues = (
  target: number,
  toleranceValue: number,
  step: number,
  minValue: number,
  maxValue: number
): number[] => {
  const values: number[] = [];
  const append = (value: number) => {
    if (value < minValue - 1e-6 || value > maxValue + 1e-6) {
      return;
    }
    const rounded = Number(value.toFixed(4));
    if (!values.some((existing) => Math.abs(existing - rounded) < 1e-4)) {
      values.push(rounded);
    }
  };

  append(target);
  for (let delta = step; delta <= toleranceValue + 1e-6; delta += step) {
    append(target - delta);
    append(target + delta);
  }

  return values;
};

export type MultiGasFallbackSuggestion = {
  steps: { gas: string; amount: number }[];
  finalO2: number;
  finalHe: number;
  deviationO2: number;
  deviationHe: number;
  warning?: string;
};

const findSimilarMultiGasBlend = (
  targetPressurePsi: number,
  targetO2: number,
  targetHe: number,
  gas1: GasSelection,
  gas2: GasSelection,
  startPressurePsi: number = 0,
  startO2: number = 0,
  startHe: number = 0
): MultiGasFallbackSuggestion | null => {
  const o2Candidates = buildSearchValues(targetO2, MULTI_GAS_O2_TOLERANCE, MULTI_GAS_O2_STEP, 0, 100);

  for (const o2 of o2Candidates) {
    const heMax = Math.max(0, 100 - o2);
    const heCandidates = buildSearchValues(targetHe, MULTI_GAS_HE_TOLERANCE, MULTI_GAS_HE_STEP, 0, heMax);
    for (const he of heCandidates) {
      if (Math.abs(o2 - targetO2) < 1e-6 && Math.abs(he - targetHe) < 1e-6) {
        continue;
      }

      // Calculate required added mix for this candidate target
      const addedPressure = targetPressurePsi - startPressurePsi;
      if (addedPressure <= tolerance) continue;

      const neededO2Psi = targetPressurePsi * fraction(o2) - startPressurePsi * fraction(startO2);
      const neededHePsi = targetPressurePsi * fraction(he) - startPressurePsi * fraction(startHe);
      const neededO2 = (neededO2Psi / addedPressure) * 100;
      const neededHe = (neededHePsi / addedPressure) * 100;

      // Skip if needed mix is invalid (e.g. requires removing O2/He or > 100%)
      if (neededO2 < -1e-6 || neededHe < -1e-6 || neededO2 + neededHe > 100 + 1e-6) continue;

      const attempt = solveTwoGasBlend(addedPressure, neededO2, neededHe, gas1, gas2);
      if (attempt.success) {
        return {
          steps: [
            { gas: gas1.name, amount: attempt.gas1Amount },
            { gas: gas2.name, amount: attempt.gas2Amount }
          ],
          finalO2: o2,
          finalHe: he,
          deviationO2: o2 - targetO2,
          deviationHe: he - targetHe,
          warning: attempt.warning
        };
      }
    }
  }

  return null;
};

export const calculateMultiGasBlend = (
  settings: { pressureUnit: PressureUnit },
  inputs: MultiGasInput,
  gas1: GasSelection,
  gas2: GasSelection
): {
  success: boolean;
  steps: { gas: string; amount: number }[];
  finalO2?: number;
  finalHe?: number;
  error?: string;
  warning?: string;
  fallback?: MultiGasFallbackSuggestion;
} => {
  const targetPressurePsi = fromDisplayPressure(inputs.targetPressure ?? 0, settings.pressureUnit);
  const startPressurePsi = fromDisplayPressure(inputs.startPressure ?? 0, settings.pressureUnit);

  if (targetPressurePsi <= tolerance) {
    return {
      success: false,
      steps: [],
      error: "Target pressure must be greater than zero."
    };
  }

  if (targetPressurePsi < startPressurePsi - tolerance) {
    return {
      success: false,
      steps: [],
      error: "Target pressure is lower than start pressure. Bleed-down required first."
    };
  }

  const addedPressurePsi = targetPressurePsi - startPressurePsi;
  if (addedPressurePsi <= tolerance) {
    return {
      success: false, // Or true? If equal, we are done.
      // If exactly equal, no gas adds.
      steps: [],
      error: "Start pressure equals target pressure."
    };
  }

  const targetO2Fraction = fraction(inputs.targetO2 ?? 32);
  const targetHe = inputs.targetHe ?? 0;
  const targetHeFraction = fraction(targetHe);

  if (targetO2Fraction + targetHeFraction > 1 + tolerance) {
    return {
      success: false,
      steps: [],
      error: "O2 + He must be 100% or less."
    };
  }

  // Calculate required composition of the added gas
  const startO2Fraction = fraction(inputs.startO2 ?? 21);
  const startHeFraction = fraction(inputs.startHe ?? 0);

  const neededO2Psi = targetPressurePsi * targetO2Fraction - startPressurePsi * startO2Fraction;
  const neededHePsi = targetPressurePsi * targetHeFraction - startPressurePsi * startHeFraction;

  const neededO2Percent = (neededO2Psi / addedPressurePsi) * 100;
  const neededHePercent = (neededHePsi / addedPressurePsi) * 100;

  // Basic sanity check on needed mix
  if (neededO2Percent < -0.01 || neededHePercent < -0.01 || (neededO2Percent + neededHePercent) > 100.01) {
    return {
      success: false,
      steps: [],
      error: "Impossible to reach target from current start mix (requires removing gas or exceeding 100%)."
    };
  }

  const primary = solveTwoGasBlend(
    addedPressurePsi,
    Math.max(0, neededO2Percent),
    Math.max(0, neededHePercent),
    gas1,
    gas2
  );

  if (primary.success) {
    return {
      success: true,
      steps: [
        { gas: gas1.name, amount: primary.gas1Amount },
        { gas: gas2.name, amount: primary.gas2Amount }
      ],
      // We return the TARGET final mix relative to total pressure (which is what the user asked for).
      // solveTwoGasBlend returns the mix of the ADDED portion.
      // We should confirm if the caller expects the final total mix or the added mix.
      // Looking at usage: likely expects the resulting mix in the tank.
      // Since we hit the target exactly (primary.success), we return the requested target.
      finalO2: inputs.targetO2,
      finalHe: targetHe,
      warning: primary.warning
    };
  }

  const fallback = findSimilarMultiGasBlend(
    targetPressurePsi,
    inputs.targetO2,
    targetHe,
    gas1,
    gas2,
    startPressurePsi,
    inputs.startO2 ?? 0,
    inputs.startHe ?? 0
  );

  if (fallback) {
    return {
      success: false,
      steps: [],
      error: primary.error ?? "Blend cannot be computed.",
      fallback
    };
  }

  return {
    success: false,
    steps: [],
    error: primary.error ?? "Blend cannot be computed."
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

export const calculateBestMix = (
  depth: number,
  targetPPO2: number,
  maxEND: number,
  unit: DepthUnit
): { o2: number; he: number } => {
  const perAtm = depthPerAtm(unit);
  const ambient = depth / perAtm + 1;
  const o2 = Math.min(100, Math.max(0, (targetPPO2 / ambient) * 100));

  const safeN2Pressure = (maxEND / perAtm + 1) * 0.79;
  const maxN2Fraction = safeN2Pressure / ambient;
  const he = Math.max(0, 100 - o2 - maxN2Fraction * 100);

  return { o2, he };
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

export type GasCostResult = {
  oxygenCuFt: number;
  heliumCuFt: number;
  oxygenCost: number;
  heliumCost: number;
  totalCost: number;
};

/**
 * Calculate the cost of gas additions based on PSI values and tank specifications.
 * Formula: cuFt = (psi / tankRatedPressure) * tankSizeCuFt
 */
export const calculateGasCost = (
  oxygenPsi: number,
  heliumPsi: number,
  tankSizeCuFt: number,
  tankRatedPressure: number,
  pricePerCuFtO2: number,
  pricePerCuFtHe: number
): GasCostResult => {
  const psiToCuFt = (psi: number): number => {
    if (tankRatedPressure <= 0) return 0;
    return (psi / tankRatedPressure) * tankSizeCuFt;
  };

  const oxygenCuFt = psiToCuFt(oxygenPsi);
  const heliumCuFt = psiToCuFt(heliumPsi);
  const oxygenCost = oxygenCuFt * pricePerCuFtO2;
  const heliumCost = heliumCuFt * pricePerCuFtHe;
  const totalCost = oxygenCost + heliumCost;

  return {
    oxygenCuFt,
    heliumCuFt,
    oxygenCost,
    heliumCost,
    totalCost
  };
};

// ============================================================================
// N-GAS BLEND OPTIMIZER
// ============================================================================

export type BlendAlternative = {
  steps: { gas: GasSelection; amount: number }[];
  finalO2: number;
  finalHe: number;
  deviationO2: number;
  deviationHe: number;
  estimatedCost: number;
  costBreakdown: { gas: string; amount: number; cost: number }[];
  fillOrder: { gas: string; amount: number }[];
};

export type NGasBlendResult = {
  success: boolean;
  alternatives: BlendAlternative[];
  selectedIndex: number;
  error?: string;
  warnings: string[];
};

type CostSettings = {
  pricePerCuFtO2: number;
  pricePerCuFtHe: number;
  tankSizeCuFt: number;
  tankRatedPressure: number;
};

/**
 * Calculate cost priority rank for a gas (lower = cheaper).
 * Used as fallback when He price is not configured.
 */
const getGasCostRank = (gas: GasSelection): number => {
  if (gas.id === "air") return 1;
  if (gas.he === 0) return 2; // Nitrox (no He)
  if (gas.he < 20) return 3;  // Low He
  if (gas.he < 100) return 4; // High He
  return 5; // Pure He
};

/**
 * Estimate cost for using a gas at a given pressure.
 * If He price is 0/undefined, uses heuristic ranking.
 */
const estimateGasPressureCost = (
  gas: GasSelection,
  pressurePsi: number,
  costSettings: CostSettings
): number => {
  const { pricePerCuFtO2, pricePerCuFtHe, tankSizeCuFt, tankRatedPressure } = costSettings;

  if (tankRatedPressure <= 0 || pressurePsi <= 0) return 0;

  const cuFt = (pressurePsi / tankRatedPressure) * tankSizeCuFt;
  const o2Fraction = fraction(gas.o2);
  const heFraction = fraction(gas.he);

  // If He price is configured, calculate actual cost
  if (pricePerCuFtHe > 0) {
    const o2Cost = cuFt * o2Fraction * pricePerCuFtO2;
    const heCost = cuFt * heFraction * pricePerCuFtHe;
    return o2Cost + heCost;
  }

  // Fallback: use rank-based heuristic (rank * base cost)
  const rank = getGasCostRank(gas);
  return cuFt * rank * 0.1; // Arbitrary multiplier for comparison
};

/**
 * Sort gases by cost (cheapest first).
 */
export const rankGasesByCost = (
  gases: GasSelection[],
  costSettings: CostSettings
): GasSelection[] => {
  const referenceAmount = 100; // Use 100 PSI as reference for ranking
  return [...gases].sort((a, b) => {
    const costA = estimateGasPressureCost(a, referenceAmount, costSettings);
    const costB = estimateGasPressureCost(b, referenceAmount, costSettings);
    return costA - costB;
  });
};

/**
 * Solve a blend using exactly 2 gases.
 * Uses linear algebra to find amounts that satisfy both O2 and He targets.
 * Returns null if not solvable.
 */
const tryTwoGasSolution = (
  addedPressure: number,
  neededO2Percent: number,
  neededHePercent: number,
  gas1: GasSelection,
  gas2: GasSelection
): { gas1Amount: number; gas2Amount: number; finalO2: number; finalHe: number } | null => {
  const targetO2 = fraction(neededO2Percent);
  const targetHe = fraction(neededHePercent);

  if (targetO2 + targetHe > 1 + tolerance) return null;
  if (targetO2 < -tolerance || targetHe < -tolerance) return null;

  const o1 = fraction(gas1.o2);
  const h1 = fraction(gas1.he);
  const o2 = fraction(gas2.o2);
  const h2 = fraction(gas2.he);

  // We have constraints:
  // g1 + g2 = P (total pressure)
  // g1*o1 + g2*o2 = P*targetO2 (O2 target)
  // g1*h1 + g2*h2 = P*targetHe (He target)

  // This is overdetermined (3 equations, 2 unknowns).
  // We solve using O2 and He constraints (2 equations), then check if g1+g2 = P.

  // Matrix form: [o1 o2; h1 h2] * [g1; g2] = P * [targetO2; targetHe]
  const det = o1 * h2 - o2 * h1;

  // Handle degenerate cases
  if (Math.abs(det) < tolerance) {
    // Gases are parallel in O2/He space - can't span 2D
    // Try simple nitrox blending (He = 0 case)
    if (targetHe < tolerance && h1 < tolerance && h2 < tolerance) {
      // Both gases are nitrox, solve for O2 only
      const denom = o1 - o2;
      if (Math.abs(denom) < tolerance) return null;

      const g1 = addedPressure * (targetO2 - o2) / denom;
      const g2 = addedPressure - g1;

      if (g1 < -tolerance || g2 < -tolerance) return null;

      const sg1 = Math.max(0, g1);
      const sg2 = Math.max(0, g2);

      return {
        gas1Amount: sg1,
        gas2Amount: sg2,
        finalO2: (sg1 * o1 + sg2 * o2) / addedPressure * 100,
        finalHe: 0
      };
    }
    return null;
  }

  // Solve the 2x2 system for O2 and He constraints
  // The target amounts are: P*targetO2 for O2, P*targetHe for He
  const rhs_o2 = addedPressure * targetO2;
  const rhs_he = addedPressure * targetHe;

  // Cramer's rule
  const g1 = (rhs_o2 * h2 - rhs_he * o2) / det;
  const g2 = (o1 * rhs_he - h1 * rhs_o2) / det;

  // Check if amounts are valid (non-negative)
  if (g1 < -tolerance || g2 < -tolerance) return null;

  const sg1 = Math.max(0, g1);
  const sg2 = Math.max(0, g2);
  const totalPressure = sg1 + sg2;

  // Check if total matches added pressure (within tolerance)
  // This is the third constraint - if it doesn't match, these 2 gases can't hit the target
  if (Math.abs(totalPressure - addedPressure) > Math.max(1, addedPressure * 0.005)) {
    return null;
  }

  // Verify result
  const resultO2 = totalPressure > 0 ? (sg1 * o1 + sg2 * o2) / totalPressure * 100 : 0;
  const resultHe = totalPressure > 0 ? (sg1 * h1 + sg2 * h2) / totalPressure * 100 : 0;

  return {
    gas1Amount: sg1,
    gas2Amount: sg2,
    finalO2: resultO2,
    finalHe: resultHe
  };
};

/**
 * Try to solve using a single gas source.
 * Only matches if the gas composition is very close to needed.
 */
const trySingleGasSolution = (
  addedPressure: number,
  neededO2Percent: number,
  neededHePercent: number,
  gas: GasSelection
): { amount: number; finalO2: number; finalHe: number } | null => {
  // Single gas solution requires the gas composition to closely match the needed composition
  // Use tight tolerance (0.5%) to avoid false matches
  const o2Match = Math.abs(gas.o2 - neededO2Percent) < 0.5;
  const heMatch = Math.abs(gas.he - neededHePercent) < 0.5;

  if (o2Match && heMatch) {
    return {
      amount: addedPressure,
      finalO2: gas.o2,
      finalHe: gas.he
    };
  }

  return null;
};

/**
 * Get recommended fill order for a blend (He first, then O2, then diluent/Air).
 */
export const getRecommendedFillOrder = (
  steps: { gas: GasSelection; amount: number }[]
): { gas: string; amount: number }[] => {
  // Sort by: pure He first, then by He content descending, then by O2 content descending
  const sorted = [...steps]
    .filter(s => s.amount > tolerance)
    .sort((a, b) => {
      // Pure He comes first
      if (a.gas.he === 100 && b.gas.he !== 100) return -1;
      if (b.gas.he === 100 && a.gas.he !== 100) return 1;
      // Then pure O2
      if (a.gas.o2 === 100 && b.gas.o2 !== 100) return -1;
      if (b.gas.o2 === 100 && a.gas.o2 !== 100) return 1;
      // Then by He content (higher He first)
      if (a.gas.he !== b.gas.he) return b.gas.he - a.gas.he;
      // Then by O2 content (higher O2 first)  
      if (a.gas.o2 !== b.gas.o2) return b.gas.o2 - a.gas.o2;
      // Air/diluent last
      return 0;
    });

  return sorted.map(s => ({ gas: s.gas.name, amount: s.amount }));
};

/**
 * Solve a blend using exactly 3 gases.
 * Uses Cramer's rule to solve the 3x3 linear system.
 * 
 * System of equations:
 *   g1 + g2 + g3 = P (total pressure)
 *   g1*o1 + g2*o2 + g3*o3 = P*targetO2 (O2 constraint)
 *   g1*h1 + g2*h2 + g3*h3 = P*targetHe (He constraint)
 */
const tryThreeGasSolution = (
  addedPressure: number,
  neededO2Percent: number,
  neededHePercent: number,
  gas1: GasSelection,
  gas2: GasSelection,
  gas3: GasSelection
): { gas1Amount: number; gas2Amount: number; gas3Amount: number; finalO2: number; finalHe: number } | null => {
  const targetO2 = fraction(neededO2Percent);
  const targetHe = fraction(neededHePercent);

  if (targetO2 + targetHe > 1 + tolerance) return null;
  if (targetO2 < -tolerance || targetHe < -tolerance) return null;

  const o1 = fraction(gas1.o2), h1 = fraction(gas1.he);
  const o2 = fraction(gas2.o2), h2 = fraction(gas2.he);
  const o3 = fraction(gas3.o2), h3 = fraction(gas3.he);

  // Matrix form: A * [g1; g2; g3] = [P; P*targetO2; P*targetHe]
  // where A = [[1, 1, 1], [o1, o2, o3], [h1, h2, h3]]

  // Calculate determinant of A using rule of Sarrus
  const detA = 1 * (o2 * h3 - o3 * h2) - 1 * (o1 * h3 - o3 * h1) + 1 * (o1 * h2 - o2 * h1);

  if (Math.abs(detA) < tolerance) {
    // Matrix is singular - gases are linearly dependent
    return null;
  }

  // Right-hand side vector
  const rhs1 = addedPressure;
  const rhs2 = addedPressure * targetO2;
  const rhs3 = addedPressure * targetHe;

  // Cramer's rule for g1 (replace first column with rhs)
  const detA1 = rhs1 * (o2 * h3 - o3 * h2) - 1 * (rhs2 * h3 - o3 * rhs3) + 1 * (rhs2 * h2 - o2 * rhs3);
  const g1 = detA1 / detA;

  // Cramer's rule for g2 (replace second column with rhs)
  const detA2 = 1 * (rhs2 * h3 - o3 * rhs3) - rhs1 * (o1 * h3 - o3 * h1) + 1 * (o1 * rhs3 - rhs2 * h1);
  const g2 = detA2 / detA;

  // Cramer's rule for g3 (replace third column with rhs)
  const detA3 = 1 * (o2 * rhs3 - rhs2 * h2) - 1 * (o1 * rhs3 - rhs2 * h1) + rhs1 * (o1 * h2 - o2 * h1);
  const g3 = detA3 / detA;

  // Check if all amounts are non-negative
  if (g1 < -tolerance || g2 < -tolerance || g3 < -tolerance) {
    return null;
  }

  const sg1 = Math.max(0, g1);
  const sg2 = Math.max(0, g2);
  const sg3 = Math.max(0, g3);
  const totalPressure = sg1 + sg2 + sg3;

  // Verify total matches added pressure
  if (Math.abs(totalPressure - addedPressure) > Math.max(1, addedPressure * 0.01)) {
    return null;
  }

  // Compute resulting mix
  const resultO2 = totalPressure > 0 ? (sg1 * o1 + sg2 * o2 + sg3 * o3) / totalPressure * 100 : 0;
  const resultHe = totalPressure > 0 ? (sg1 * h1 + sg2 * h2 + sg3 * h3) / totalPressure * 100 : 0;

  return {
    gas1Amount: sg1,
    gas2Amount: sg2,
    gas3Amount: sg3,
    finalO2: resultO2,
    finalHe: resultHe
  };
};

/**
 * Generate all valid blend alternatives for the given gas sources.
 * Tries all 1-gas, 2-gas, and 3-gas combinations, ranked by cost.
 */
export const generateBlendAlternatives = (
  targetPressurePsi: number,
  targetO2: number,
  targetHe: number,
  startPressurePsi: number,
  startO2: number,
  startHe: number,
  availableGases: GasSelection[],
  costSettings: CostSettings,
  maxAlternatives: number = 5
): BlendAlternative[] => {
  const addedPressure = targetPressurePsi - startPressurePsi;
  if (addedPressure <= tolerance) return [];

  // Calculate needed composition for the added gas
  const neededO2Psi = targetPressurePsi * fraction(targetO2) - startPressurePsi * fraction(startO2);
  const neededHePsi = targetPressurePsi * fraction(targetHe) - startPressurePsi * fraction(startHe);
  const neededO2Percent = (neededO2Psi / addedPressure) * 100;
  const neededHePercent = (neededHePsi / addedPressure) * 100;

  // Validate needed mix is achievable
  if (neededO2Percent < -0.5 || neededHePercent < -0.5) return [];
  if (neededO2Percent + neededHePercent > 100.5) return [];

  const alternatives: BlendAlternative[] = [];
  const enabledGases = availableGases.filter(g => g);

  // Try single-gas solutions
  for (const gas of enabledGases) {
    const solution = trySingleGasSolution(addedPressure, neededO2Percent, neededHePercent, gas);
    if (solution) {
      // Compute actual final mix in the tank
      const totalPressure = startPressurePsi + solution.amount;
      const actualFinalO2 = (startPressurePsi * fraction(startO2) + solution.amount * fraction(gas.o2)) / totalPressure * 100;
      const actualFinalHe = (startPressurePsi * fraction(startHe) + solution.amount * fraction(gas.he)) / totalPressure * 100;

      const steps = [{ gas, amount: solution.amount }];
      const cost = estimateGasPressureCost(gas, solution.amount, costSettings);
      alternatives.push({
        steps,
        finalO2: actualFinalO2,
        finalHe: actualFinalHe,
        deviationO2: actualFinalO2 - targetO2,
        deviationHe: actualFinalHe - targetHe,
        estimatedCost: cost,
        costBreakdown: [{ gas: gas.name, amount: solution.amount, cost }],
        fillOrder: getRecommendedFillOrder(steps)
      });
    }
  }

  // Try two-gas solutions (all combinations)
  for (let i = 0; i < enabledGases.length; i++) {
    for (let j = i + 1; j < enabledGases.length; j++) {
      const gas1 = enabledGases[i];
      const gas2 = enabledGases[j];

      const solution = tryTwoGasSolution(addedPressure, neededO2Percent, neededHePercent, gas1, gas2);
      if (solution && solution.gas1Amount > -tolerance && solution.gas2Amount > -tolerance) {
        const steps: { gas: GasSelection; amount: number }[] = [];
        if (solution.gas1Amount > tolerance) steps.push({ gas: gas1, amount: solution.gas1Amount });
        if (solution.gas2Amount > tolerance) steps.push({ gas: gas2, amount: solution.gas2Amount });

        // Compute actual final mix in the tank
        const totalAdd = solution.gas1Amount + solution.gas2Amount;
        const totalPressure = startPressurePsi + totalAdd;
        const actualFinalO2 = (startPressurePsi * fraction(startO2) +
          solution.gas1Amount * fraction(gas1.o2) +
          solution.gas2Amount * fraction(gas2.o2)) / totalPressure * 100;
        const actualFinalHe = (startPressurePsi * fraction(startHe) +
          solution.gas1Amount * fraction(gas1.he) +
          solution.gas2Amount * fraction(gas2.he)) / totalPressure * 100;

        const cost1 = estimateGasPressureCost(gas1, solution.gas1Amount, costSettings);
        const cost2 = estimateGasPressureCost(gas2, solution.gas2Amount, costSettings);
        const totalCost = cost1 + cost2;

        const costBreakdown: { gas: string; amount: number; cost: number }[] = [];
        if (solution.gas1Amount > tolerance) costBreakdown.push({ gas: gas1.name, amount: solution.gas1Amount, cost: cost1 });
        if (solution.gas2Amount > tolerance) costBreakdown.push({ gas: gas2.name, amount: solution.gas2Amount, cost: cost2 });

        alternatives.push({
          steps,
          finalO2: actualFinalO2,
          finalHe: actualFinalHe,
          deviationO2: actualFinalO2 - targetO2,
          deviationHe: actualFinalHe - targetHe,
          estimatedCost: totalCost,
          costBreakdown,
          fillOrder: getRecommendedFillOrder(steps)
        });
      }
    }
  }

  // Try three-gas solutions (all triplet combinations)
  for (let i = 0; i < enabledGases.length; i++) {
    for (let j = i + 1; j < enabledGases.length; j++) {
      for (let k = j + 1; k < enabledGases.length; k++) {
        const gas1 = enabledGases[i];
        const gas2 = enabledGases[j];
        const gas3 = enabledGases[k];

        const solution = tryThreeGasSolution(addedPressure, neededO2Percent, neededHePercent, gas1, gas2, gas3);
        if (solution &&
          solution.gas1Amount > -tolerance &&
          solution.gas2Amount > -tolerance &&
          solution.gas3Amount > -tolerance) {

          const steps: { gas: GasSelection; amount: number }[] = [];
          if (solution.gas1Amount > tolerance) steps.push({ gas: gas1, amount: solution.gas1Amount });
          if (solution.gas2Amount > tolerance) steps.push({ gas: gas2, amount: solution.gas2Amount });
          if (solution.gas3Amount > tolerance) steps.push({ gas: gas3, amount: solution.gas3Amount });

          // Compute actual final mix in the tank
          const totalAdd = solution.gas1Amount + solution.gas2Amount + solution.gas3Amount;
          const totalPressure = startPressurePsi + totalAdd;
          const actualFinalO2 = (startPressurePsi * fraction(startO2) +
            solution.gas1Amount * fraction(gas1.o2) +
            solution.gas2Amount * fraction(gas2.o2) +
            solution.gas3Amount * fraction(gas3.o2)) / totalPressure * 100;
          const actualFinalHe = (startPressurePsi * fraction(startHe) +
            solution.gas1Amount * fraction(gas1.he) +
            solution.gas2Amount * fraction(gas2.he) +
            solution.gas3Amount * fraction(gas3.he)) / totalPressure * 100;

          const cost1 = estimateGasPressureCost(gas1, solution.gas1Amount, costSettings);
          const cost2 = estimateGasPressureCost(gas2, solution.gas2Amount, costSettings);
          const cost3 = estimateGasPressureCost(gas3, solution.gas3Amount, costSettings);
          const totalCost = cost1 + cost2 + cost3;

          const costBreakdown: { gas: string; amount: number; cost: number }[] = [];
          if (solution.gas1Amount > tolerance) costBreakdown.push({ gas: gas1.name, amount: solution.gas1Amount, cost: cost1 });
          if (solution.gas2Amount > tolerance) costBreakdown.push({ gas: gas2.name, amount: solution.gas2Amount, cost: cost2 });
          if (solution.gas3Amount > tolerance) costBreakdown.push({ gas: gas3.name, amount: solution.gas3Amount, cost: cost3 });

          alternatives.push({
            steps,
            finalO2: actualFinalO2,
            finalHe: actualFinalHe,
            deviationO2: actualFinalO2 - targetO2,
            deviationHe: actualFinalHe - targetHe,
            estimatedCost: totalCost,
            costBreakdown,
            fillOrder: getRecommendedFillOrder(steps)
          });
        }
      }
    }
  }

  // Deduplicate alternatives based on gas combo and amounts
  const seen = new Set<string>();
  const uniqueAlternatives: BlendAlternative[] = [];
  for (const alt of alternatives) {
    const key = alt.fillOrder.map(s => `${s.gas}:${Math.round(s.amount)}`).sort().join('|');
    if (!seen.has(key)) {
      seen.add(key);
      uniqueAlternatives.push(alt);
    }
  }

  // Sort by cost and return top alternatives
  uniqueAlternatives.sort((a, b) => a.estimatedCost - b.estimatedCost);
  return uniqueAlternatives.slice(0, maxAlternatives);
};

/**
 * Main N-gas blend solver.
 * Finds optimal blend using available gas sources, minimizing cost.
 * Supports bleed-down scenarios when target composition requires removing gas.
 */
export const solveNGasBlend = (
  settings: { pressureUnit: PressureUnit },
  targetPressure: number,
  targetO2: number,
  targetHe: number,
  startPressure: number,
  startO2: number,
  startHe: number,
  availableGases: GasSelection[],
  costSettings: CostSettings,
  selectedIndex: number = 0
): NGasBlendResult => {
  const targetPressurePsi = fromDisplayPressure(targetPressure ?? 0, settings.pressureUnit);
  const startPressurePsi = fromDisplayPressure(startPressure ?? 0, settings.pressureUnit);

  const warnings: string[] = [];

  // Basic validation
  if (targetPressurePsi <= tolerance) {
    return { success: false, alternatives: [], selectedIndex: 0, error: "Target pressure must be greater than zero.", warnings };
  }

  if (targetO2 + targetHe > 100 + tolerance) {
    return { success: false, alternatives: [], selectedIndex: 0, error: "O2 + He must be 100% or less.", warnings };
  }

  if (availableGases.length === 0) {
    return { success: false, alternatives: [], selectedIndex: 0, error: "No gas sources available.", warnings };
  }

  // Add warnings
  if (targetO2 < 18) warnings.push("Hypoxic mix (<18% O2).");
  if (targetO2 > 40) warnings.push("High O2 - fire risk (>40% O2).");

  // First try: generate alternatives from current start tank
  let alternatives = generateBlendAlternatives(
    targetPressurePsi,
    targetO2,
    targetHe,
    startPressurePsi,
    startO2,
    startHe,
    availableGases,
    costSettings
  );

  // If no solution and bleed-down might help (target He < start He, or composition requires it)
  if (alternatives.length === 0 && startPressurePsi > tolerance) {
    // Binary search for the maximum starting pressure (minimum bleed) that allows a solution
    let low = 0;
    let high = startPressurePsi;
    let bestStartPressure = 0;
    let bestAlternatives: BlendAlternative[] = [];

    // 20 iterations is enough for < 1 PSI precision at 10000 PSI
    for (let i = 0; i < 20; i++) {
      const mid = (low + high) / 2;
      const attemptAlts = generateBlendAlternatives(
        targetPressurePsi,
        targetO2,
        targetHe,
        mid,
        startO2,
        startHe,
        availableGases,
        costSettings
      );

      if (attemptAlts.length > 0) {
        bestStartPressure = mid;
        bestAlternatives = attemptAlts;
        low = mid; // Try to bleed less
      } else {
        high = mid; // Must bleed more
      }
    }

    if (bestAlternatives.length > 0) {
      warnings.push("Bleed-down required to achieve target mix.");

      // Add bleed step to each alternative
      for (const alt of bestAlternatives) {
        const bleedAmount = startPressurePsi - bestStartPressure;
        const bleedStep = { gas: "Bleed Tank", amount: -bleedAmount };
        alt.fillOrder = [bleedStep, ...alt.fillOrder];

        // Add bleed note to cost breakdown
        alt.costBreakdown = [
          { gas: `Bleed to ${Math.round(toDisplayPressure(bestStartPressure, settings.pressureUnit))} ${settings.pressureUnit}`, amount: bleedAmount, cost: 0 },
          ...alt.costBreakdown
        ];
      }
      alternatives = bestAlternatives;
    }
  }

  if (alternatives.length === 0) {
    return {
      success: false,
      alternatives: [],
      selectedIndex: 0,
      error: "No valid blend found with available gases. Try adding more gas sources or adjusting target.",
      warnings
    };
  }

  const validIndex = Math.min(selectedIndex, alternatives.length - 1);

  return {
    success: true,
    alternatives,
    selectedIndex: validIndex,
    warnings
  };
};
