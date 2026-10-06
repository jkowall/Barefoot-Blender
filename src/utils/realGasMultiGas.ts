import type { PressureUnit } from "../state/settings";
import {
  MULTI_GAS_BANK_LIMIT_ERROR,
  MULTI_GAS_NO_BLEND_ERROR,
  MULTI_GAS_SIMILAR_BLEND_WARNING,
  estimateGasPressureCost,
  findSimilarNGasAlternatives,
  generateBlendAlternatives,
  orderBlendStepsForFill,
  type BlendAlternative,
  type CostSettings,
  type GasSelection,
  type MultiGasFillOrderMode,
  type OptimizerGasSource
} from "./calculations";
import {
  GERG_MIN_TEMPERATURE_K,
  gasFractionsFromPercents,
  gaugePsiToAbsoluteKpa,
  gergDensityFromPressure
} from "./gerg2008";
import {
  MOLE_TOLERANCE,
  appendMixSafetyWarnings,
  componentMolesFromTotal,
  fractionsFromMoles,
  idealEquivalentPsiPerMole,
  invalidGergMix,
  percentFromFraction,
  realGasMolesToFreeGasCuFt,
  refineAdditionScaleToSettledTarget,
  residualAdjustedMixWarning,
  simulateRealGasStages,
  stateFromComponents,
  tankWaterVolumeLiters,
  totalMoles,
  type ComponentMoles
} from "./realGasBlend";
import { fahrenheitToKelvin } from "./temperature";
import { fromDisplayPressure } from "./units";

export type RealGasMultiGasSource = OptimizerGasSource & {
  // Cylinder temperature while this source is added. Undefined inherits the previous stage's
  // temperature, then Start Temp.
  stageTemperatureF?: number;
};

export type RealGasMultiGasInput = {
  // Display units, like solveNGasBlend.
  startPressure: number;
  targetPressure: number;
  startO2: number;
  startHe: number;
  targetO2: number;
  targetHe: number;
  tankSizeCuFt: number;
  tankRatedPressurePsi: number;
  startTemperatureF: number;
  settledTemperatureF: number;
  // Enabled sources in list order (the fill order in manual mode).
  sources: RealGasMultiGasSource[];
  fillOrderMode: MultiGasFillOrderMode;
};

export type RealGasMultiGasStep = {
  kind: "bleed" | "add";
  sourceId?: string;
  gasName: string;
  gas?: GasSelection;
  // Negative for a bleed.
  molesAdded: number;
  stopPressurePsi: number;
  pressureChangePsi: number;
  temperatureF: number;
  z: number;
  // Free gas at 1 atm and 70 F; 0 for a bleed.
  volumeCuFt: number;
};

export type RealGasMultiGasAlternative = {
  steps: RealGasMultiGasStep[];
  finalO2: number;
  finalHe: number;
  finalN2: number;
  deviationO2: number;
  deviationHe: number;
  // Cylinder contents before the first addition (after any bleed), at the first stage temperature.
  startHotPressurePsi: number;
  startZ?: number;
  finalHotPressurePsi: number;
  settledPressurePsi: number;
  estimatedCost: number;
  // amount is the real gauge pressure rise of that addition.
  costBreakdown: { gas: string; amount: number; volumeCuFt: number; cost: number }[];
  // Ids of the sources this option adds, sorted, for matching the ideal option with the same gases.
  sourceIds: string[];
  // Set when the 1 atm left in an empty cylinder makes the exact target unreachable.
  residualAdjustedMix?: { o2: number; he: number; n2: number };
  // Warnings that belong to this option, such as reached-mix safety flags.
  warnings: string[];
};

export type RealGasMultiGasMatch = "exact" | "bleed" | "residualAdjusted" | "closest";
export type RealGasMultiGasFailure = "input" | "gerg" | "noBlend";

export type RealGasMultiGasResult = {
  success: boolean;
  match?: RealGasMultiGasMatch;
  failure?: RealGasMultiGasFailure;
  alternatives: RealGasMultiGasAlternative[];
  bleedToPsi?: number;
  waterVolumeLiters: number;
  warnings: string[];
  errors: string[];
};

export const BANK_LIMITS_EXCLUDE_ALL_WARNING =
  "Bank limits exclude every listed option; a fill that takes partial amounts from more sources may still exist.";
export const BLEED_REQUIRED_WARNING = "Bleed-down required to achieve target mix.";
export const START_MATCHES_TARGET_ERROR = "Start tank already matches the target mix and pressure.";

const CAP_TOLERANCE_PSI = 0.01;
const BLEED_SCAN_POINTS = 32;
const CAPPED_BLEED_SCAN_POINTS = 64;
const BLEED_PRESSURE_TOLERANCE_PSI = 0.01;
const PERCENT_TOLERANCE = 1e-6;
// Exact and bleed plans must reach the target within this many percentage points. The ideal
// optimizer accepts a single source within 0.5 points, which hides a real-gas or residual shift.
const EXACT_MIX_TOLERANCE_PERCENT = 0.01;
// The bleed search maximizes the drain-to pressure, so it would settle at the edge of any mix
// tolerance; a tighter one keeps the smallest bleed on the exact target.
const BLEED_SEARCH_MIX_TOLERANCE_PERCENT = 0.001;
// Additions smaller than this (ideal-equivalent PSI) cannot be metered and are dropped.
const MIN_ADDITION_PSI = 0.05;

/**
 * Stage temperatures in fill order: each stage uses its own value, otherwise the previous stage's,
 * otherwise Start Temp. Editing one stage therefore carries forward to later unedited stages.
 */
export const resolveMultiGasStageTemperaturesF = (
  ordered: { stageTemperatureF?: number }[],
  startTemperatureF: number
): number[] => {
  const resolved: number[] = [];
  let previous = startTemperatureF;
  for (const stage of ordered) {
    const temperatureF = stage.stageTemperatureF ?? previous;
    resolved.push(temperatureF);
    previous = temperatureF;
  }
  return resolved;
};

type StartState = {
  pressurePsi: number;
  components: ComponentMoles;
  z: number;
};

type RealizeOptions = {
  enforceCaps: boolean;
  // Reject options whose reached mix is further than this from the target (percentage points).
  mixTolerancePercent?: number;
};

type RealizeOutcome = {
  alternatives: RealGasMultiGasAlternative[];
  capRejected: number;
  gergErrors: string[];
  warnings: string[];
};

const failure = (
  kind: RealGasMultiGasFailure,
  waterVolumeLiters: number,
  warnings: string[],
  errors: string[]
): RealGasMultiGasResult => ({
  success: false,
  failure: kind,
  alternatives: [],
  waterVolumeLiters,
  warnings: [...new Set(warnings)],
  errors
});

const isValidTemperatureF = (temperatureF: number): boolean => {
  const kelvin = fahrenheitToKelvin(temperatureF);
  return Number.isFinite(kelvin) && kelvin >= GERG_MIN_TEMPERATURE_K;
};

/**
 * Plan a Multi-Gas fill with GERG-2008 real-gas behavior.
 *
 * Mixing is linear in moles, so once the start and target states are converted to moles the source
 * amounts solve the same linear system the ideal optimizer uses, with moles written as
 * ideal-equivalent PSI. Amounts do not depend on fill order; order and stage temperatures only
 * change the gauge stop pressures, which come from a forward GERG pass over the ordered additions.
 */
export const calculateRealGasMultiGasBlend = (
  settings: { pressureUnit: PressureUnit },
  input: RealGasMultiGasInput,
  costSettings: CostSettings,
  maxAlternatives = 5
): RealGasMultiGasResult => {
  const startPressurePsi = fromDisplayPressure(input.startPressure, settings.pressureUnit);
  const targetPressurePsi = fromDisplayPressure(input.targetPressure, settings.pressureUnit);
  const tankSizeCuFt = input.tankSizeCuFt;
  const tankRatedPressurePsi = input.tankRatedPressurePsi;
  const waterVolumeLiters = tankWaterVolumeLiters(tankSizeCuFt, tankRatedPressurePsi);
  const warnings: string[] = [];

  if (!Number.isFinite(targetPressurePsi)) {
    return failure("input", waterVolumeLiters, warnings, ["Target pressure must be a finite value."]);
  }
  if (targetPressurePsi <= 0) {
    return failure("input", waterVolumeLiters, warnings, ["Target pressure must be greater than zero."]);
  }
  if (!Number.isFinite(startPressurePsi)) {
    return failure("input", waterVolumeLiters, warnings, ["Start pressure must be a finite value."]);
  }
  if (startPressurePsi < 0) {
    return failure("input", waterVolumeLiters, warnings, ["Start pressure cannot be negative."]);
  }
  if (input.targetO2 + input.targetHe > 100 + PERCENT_TOLERANCE) {
    return failure("input", waterVolumeLiters, warnings, ["O2 + He must be 100% or less."]);
  }
  if (input.sources.length === 0) {
    return failure("input", waterVolumeLiters, warnings, ["No gas sources available."]);
  }
  if (waterVolumeLiters <= 0) {
    return failure("input", waterVolumeLiters, warnings, ["Tank size and rated pressure are required for GERG-2008 correction."]);
  }

  const startFractions = gasFractionsFromPercents(input.startO2, input.startHe);
  const targetFractions = gasFractionsFromPercents(input.targetO2, input.targetHe);
  const sourceFractions = input.sources.map((source) => gasFractionsFromPercents(source.o2, source.he));
  if (invalidGergMix(startFractions, targetFractions, ...sourceFractions)) {
    return failure("input", waterVolumeLiters, warnings, [
      "Gas fractions must be between 0% and 100%, and O2% + He% must not exceed 100%."
    ]);
  }

  const temperaturesF = [
    input.startTemperatureF,
    input.settledTemperatureF,
    ...input.sources.flatMap((source) => (source.stageTemperatureF === undefined ? [] : [source.stageTemperatureF]))
  ];
  if (temperaturesF.some((temperatureF) => !isValidTemperatureF(temperatureF))) {
    return failure("input", waterVolumeLiters, warnings, [
      "GERG-2008 correction is limited to temperatures at or above 250 K."
    ]);
  }

  const startTemperatureK = fahrenheitToKelvin(input.startTemperatureF);
  const settledTemperatureK = fahrenheitToKelvin(input.settledTemperatureF);
  const psiPerMole = idealEquivalentPsiPerMole(waterVolumeLiters);

  const targetDensity = gergDensityFromPressure(
    settledTemperatureK,
    gaugePsiToAbsoluteKpa(targetPressurePsi),
    targetFractions
  );
  warnings.push(...targetDensity.warnings);
  if (!targetDensity.success) {
    return failure("gerg", waterVolumeLiters, warnings, targetDensity.errors);
  }
  const targetMoles = targetDensity.densityMolPerLiter * waterVolumeLiters;

  // A cylinder at 0 gauge still holds 1 atm absolute of the start mix, so 0 gauge is not a vacuum.
  const startStateAt = (pressurePsi: number): StartState | { errors: string[]; warnings: string[] } => {
    const density = gergDensityFromPressure(startTemperatureK, gaugePsiToAbsoluteKpa(pressurePsi), startFractions);
    if (!density.success) {
      return { errors: density.errors, warnings: density.warnings };
    }
    return {
      pressurePsi,
      components: componentMolesFromTotal(density.densityMolPerLiter * waterVolumeLiters, startFractions),
      z: density.z
    };
  };

  const fullStart = startStateAt(startPressurePsi);
  if (!("components" in fullStart)) {
    warnings.push(...fullStart.warnings);
    return failure("gerg", waterVolumeLiters, warnings, fullStart.errors);
  }
  const fullStartMoles = totalMoles(fullStart.components);

  const sameMix =
    Math.abs(input.startO2 - input.targetO2) <= PERCENT_TOLERANCE &&
    Math.abs(input.startHe - input.targetHe) <= PERCENT_TOLERANCE;
  if (sameMix && Math.abs(targetMoles - fullStartMoles) * psiPerMole <= 1e-6) {
    return failure("input", waterVolumeLiters, warnings, [START_MATCHES_TARGET_ERROR]);
  }

  const costContext: CostSettings = {
    ...costSettings,
    tankSizeCuFt,
    tankRatedPressure: tankRatedPressurePsi
  };
  // Caps are checked in real pressure terms after each forward pass, so the linear solve runs uncapped.
  const uncappedSources: OptimizerGasSource[] = input.sources.map((source) => ({
    id: source.id,
    name: source.name,
    o2: source.o2,
    he: source.he
  }));
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const sourceOrderIds = input.sources.map((source) => source.id);
  const hasCaps = input.sources.some((source) => source.maxPressurePsi !== undefined);

  const enumerate = (startMoles: number): BlendAlternative[] =>
    generateBlendAlternatives(
      targetMoles * psiPerMole,
      input.targetO2,
      input.targetHe,
      startMoles * psiPerMole,
      input.startO2,
      input.startHe,
      uncappedSources,
      costContext,
      Number.POSITIVE_INFINITY
    );

  const realizeOne = (
    candidate: BlendAlternative,
    start: StartState,
    options: RealizeOptions
  ):
    | { alternative: RealGasMultiGasAlternative; warnings: string[] }
    | { rejected: "cap" | "mix" }
    | { rejected: "gerg"; errors: string[] } => {
    const additions = candidate.steps
      .filter((step) => step.amount >= MIN_ADDITION_PSI)
      .map((step) => ({
        gas: step.gas,
        source: sourceById.get(step.gas.id),
        moles: step.amount / psiPerMole,
        fractions: gasFractionsFromPercents(step.gas.o2, step.gas.he)
      }));
    const addedMoles = additions.reduce((sum, addition) => sum + addition.moles, 0);
    const startMoles = totalMoles(start.components);
    const initialScale = addedMoles > MOLE_TOLERANCE ? Math.max(0, (targetMoles - startMoles) / addedMoles) : 1;
    const scale = refineAdditionScaleToSettledTarget(
      start.components,
      additions,
      targetPressurePsi,
      settledTemperatureK,
      waterVolumeLiters,
      initialScale
    );

    const ordered = orderBlendStepsForFill(
      additions.map((addition) => ({ ...addition, amount: addition.moles * scale })),
      input.fillOrderMode,
      sourceOrderIds
    );
    const stageTemperatures = resolveMultiGasStageTemperaturesF(
      ordered.map((addition) => ({ stageTemperatureF: addition.source?.stageTemperatureF })),
      input.startTemperatureF
    );
    const simulation = simulateRealGasStages(
      start.components,
      ordered.map((addition, index) => ({
        key: addition.gas.id,
        gasName: addition.gas.name,
        moles: addition.amount,
        fractions: addition.fractions,
        temperatureF: stageTemperatures[index]
      })),
      waterVolumeLiters,
      start.pressurePsi
    );
    if (!simulation.success) {
      return { rejected: "gerg", errors: simulation.errors };
    }

    if (options.enforceCaps) {
      for (const stage of simulation.steps) {
        const cap = sourceById.get(stage.key)?.maxPressurePsi;
        if (cap !== undefined && stage.pressureChangePsi > cap + CAP_TOLERANCE_PSI) {
          return { rejected: "cap" };
        }
      }
    }

    const finalFractions = fractionsFromMoles(simulation.finalComponents);
    const mixTolerance = options.mixTolerancePercent;
    if (
      mixTolerance !== undefined &&
      (Math.abs(finalFractions.o2 * 100 - input.targetO2) > mixTolerance ||
        Math.abs(finalFractions.he * 100 - input.targetHe) > mixTolerance)
    ) {
      return { rejected: "mix" };
    }
    const settled = stateFromComponents(settledTemperatureK, simulation.finalComponents, waterVolumeLiters);
    const steps: RealGasMultiGasStep[] = simulation.steps.map((stage, index) => ({
      kind: "add",
      sourceId: stage.key,
      gasName: stage.gasName,
      gas: ordered[index].gas,
      molesAdded: stage.molesAdded,
      stopPressurePsi: stage.stopPressurePsi,
      pressureChangePsi: stage.pressureChangePsi,
      temperatureF: stage.temperatureF,
      z: stage.z,
      volumeCuFt: realGasMolesToFreeGasCuFt(stage.molesAdded, waterVolumeLiters, tankSizeCuFt, tankRatedPressurePsi)
    }));
    const costBreakdown = steps.map((step) => ({
      gas: step.gasName,
      amount: step.pressureChangePsi,
      volumeCuFt: step.volumeCuFt,
      cost: step.gas ? estimateGasPressureCost(step.gas, step.molesAdded * psiPerMole, costContext) : 0
    }));
    const finalO2 = percentFromFraction(finalFractions.o2);
    const finalHe = percentFromFraction(finalFractions.he);

    return {
      alternative: {
        steps,
        finalO2,
        finalHe,
        finalN2: percentFromFraction(finalFractions.n2),
        deviationO2: finalO2 - input.targetO2,
        deviationHe: finalHe - input.targetHe,
        startHotPressurePsi: simulation.startHotPressurePsi,
        startZ: simulation.startZ,
        finalHotPressurePsi: simulation.finalHotPressurePsi,
        settledPressurePsi: settled.success ? settled.pressurePsi : targetPressurePsi,
        estimatedCost: costBreakdown.reduce((sum, line) => sum + line.cost, 0),
        costBreakdown,
        sourceIds: steps.map((step) => step.sourceId ?? "").sort(),
        warnings: []
      },
      warnings: [...simulation.warnings, ...settled.warnings]
    };
  };

  const realize = (
    candidates: BlendAlternative[],
    start: StartState,
    limit: number,
    options: RealizeOptions
  ): RealizeOutcome => {
    const outcome: RealizeOutcome = { alternatives: [], capRejected: 0, gergErrors: [], warnings: [] };
    // Dropping unmeterable additions can make two candidates identical.
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (outcome.alternatives.length >= limit) {
        break;
      }
      const result = realizeOne(candidate, start, options);
      if ("alternative" in result) {
        const key = result.alternative.steps.map((step) => `${step.sourceId}:${step.molesAdded.toFixed(4)}`).join("|");
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        outcome.alternatives.push(result.alternative);
        outcome.warnings.push(...result.warnings);
      } else if (result.rejected === "cap") {
        outcome.capRejected += 1;
      } else if (result.rejected === "gerg") {
        outcome.gergErrors.push(...result.errors);
      }
    }
    return outcome;
  };
  const exactOptions: RealizeOptions = { enforceCaps: true, mixTolerancePercent: EXACT_MIX_TOLERANCE_PERCENT };
  const approximateOptions: RealizeOptions = { enforceCaps: true };

  let capRejected = 0;
  const gergErrors: string[] = [];
  const track = (outcome: RealizeOutcome): RealGasMultiGasAlternative[] => {
    capRejected += outcome.capRejected;
    gergErrors.push(...outcome.gergErrors);
    return outcome.alternatives;
  };

  const success = (
    match: RealGasMultiGasMatch,
    alternatives: RealGasMultiGasAlternative[],
    extraWarnings: string[],
    bleedToPsi?: number
  ): RealGasMultiGasResult => ({
    success: true,
    match,
    alternatives,
    bleedToPsi,
    waterVolumeLiters,
    warnings: [...new Set([...warnings, ...extraWarnings])],
    errors: []
  });

  const targetSafetyWarnings: string[] = [];
  appendMixSafetyWarnings(targetSafetyWarnings, input.targetO2);

  // 1. Exact fill from the current start.
  const exactOutcome = realize(enumerate(fullStartMoles), fullStart, maxAlternatives, exactOptions);
  const exact = track(exactOutcome);
  if (exact.length > 0) {
    return success("exact", exact, [...targetSafetyWarnings, ...exactOutcome.warnings]);
  }

  const bleedStep = (start: StartState): RealGasMultiGasStep => ({
    kind: "bleed",
    gasName: "Bleed Tank",
    molesAdded: totalMoles(start.components) - fullStartMoles,
    stopPressurePsi: start.pressurePsi,
    pressureChangePsi: start.pressurePsi - startPressurePsi,
    temperatureF: input.startTemperatureF,
    z: start.z,
    volumeCuFt: 0
  });
  const withBleed = (alternatives: RealGasMultiGasAlternative[], start: StartState): RealGasMultiGasAlternative[] =>
    alternatives.map((alternative) => ({ ...alternative, steps: [bleedStep(start), ...alternative.steps] }));

  // 2. Bleed down to the highest drain-to pressure that still allows an exact fill (the smallest
  // bleed). Each search scans from the top down for a feasible point, then bisects up toward the
  // infeasible point above it. Without bank limits the feasible range ends at the composition limit.
  // Bank limits can shrink it to a narrow window that excludes 0, which a plain bisection over
  // [0, start] misses, so the capped search scans the uncapped range more finely.
  if (startPressurePsi > MOLE_TOLERANCE) {
    const feasibleAt = (pressurePsi: number, enforceCaps: boolean): StartState | null => {
      const state = startStateAt(pressurePsi);
      if (!("components" in state)) {
        return null;
      }
      const outcome = realize(enumerate(totalMoles(state.components)), state, 1, {
        enforceCaps,
        mixTolerancePercent: BLEED_SEARCH_MIX_TOLERANCE_PERCENT
      });
      return outcome.alternatives.length > 0 ? state : null;
    };
    const highestFeasibleBelow = (topPsi: number, enforceCaps: boolean, points: number): StartState | null => {
      let infeasiblePsi = topPsi;
      let found: StartState | null = null;
      for (let point = 1; point <= points && !found; point += 1) {
        const pressurePsi = point === points ? 0 : topPsi * (1 - point / points);
        found = feasibleAt(pressurePsi, enforceCaps);
        if (!found) {
          infeasiblePsi = pressurePsi;
        }
      }
      if (!found) {
        return null;
      }
      while (infeasiblePsi - found.pressurePsi > BLEED_PRESSURE_TOLERANCE_PSI) {
        const midPsi = (found.pressurePsi + infeasiblePsi) / 2;
        const mid = feasibleAt(midPsi, enforceCaps);
        if (mid) {
          found = mid;
        } else {
          infeasiblePsi = midPsi;
        }
      }
      return found;
    };

    const uncappedTop = (hasCaps ? feasibleAt(startPressurePsi, false) : null) ??
      highestFeasibleBelow(startPressurePsi, false, BLEED_SCAN_POINTS);
    let bleedTo: StartState | null = null;
    if (uncappedTop && !hasCaps) {
      bleedTo = uncappedTop;
    } else if (uncappedTop) {
      const topIsFeasible = uncappedTop.pressurePsi < startPressurePsi && feasibleAt(uncappedTop.pressurePsi, true);
      bleedTo = topIsFeasible
        ? uncappedTop
        : highestFeasibleBelow(uncappedTop.pressurePsi, true, CAPPED_BLEED_SCAN_POINTS);
    }

    if (bleedTo) {
      const bleedOutcome = realize(enumerate(totalMoles(bleedTo.components)), bleedTo, maxAlternatives, exactOptions);
      const bled = track(bleedOutcome);
      if (bled.length > 0) {
        return success(
          "bleed",
          withBleed(bled, bleedTo),
          [BLEED_REQUIRED_WARNING, ...targetSafetyWarnings, ...bleedOutcome.warnings],
          bleedTo.pressurePsi
        );
      }
    }
  }

  const markReachedMix = (alternative: RealGasMultiGasAlternative, residualAdjusted: boolean): RealGasMultiGasAlternative => {
    const alternativeWarnings: string[] = [];
    appendMixSafetyWarnings(alternativeWarnings, alternative.finalO2);
    const residualAdjustedMix = residualAdjusted
      ? { o2: alternative.finalO2, he: alternative.finalHe, n2: alternative.finalN2 }
      : undefined;
    if (residualAdjustedMix) {
      alternativeWarnings.push(residualAdjustedMixWarning(residualAdjustedMix));
    }
    return { ...alternative, residualAdjustedMix, warnings: alternativeWarnings };
  };

  // 3. Residual-adjusted plan. The 1 atm left in a cylinder at 0 gauge cannot be bled off, so plan the
  // gases as if the cylinder were empty, scaled so the settled pressure still matches the target.
  const residualStart = startStateAt(0);
  if ("components" in residualStart) {
    const residualOutcome = realize(enumerate(0), residualStart, maxAlternatives, approximateOptions);
    const residual = track(residualOutcome);
    if (residual.length > 0) {
      const startWasAboveZero = startPressurePsi > MOLE_TOLERANCE;
      const adjusted = residual.map((alternative) => markReachedMix(alternative, true));
      return success(
        "residualAdjusted",
        startWasAboveZero ? withBleed(adjusted, residualStart) : adjusted,
        [...(startWasAboveZero ? [BLEED_REQUIRED_WARNING] : []), ...residualOutcome.warnings],
        startWasAboveZero ? 0 : undefined
      );
    }
  }

  // 4. Closest blend within +/-1% O2 and +/-5% He, from the current start.
  const closestCandidates = findSimilarNGasAlternatives(
    targetMoles * psiPerMole,
    input.targetO2,
    input.targetHe,
    fullStartMoles * psiPerMole,
    input.startO2,
    input.startHe,
    uncappedSources,
    costContext,
    Number.POSITIVE_INFINITY
  );
  const closestOutcome = realize(closestCandidates, fullStart, maxAlternatives, approximateOptions);
  const closest = track(closestOutcome);
  if (closest.length > 0) {
    return success(
      "closest",
      closest.map((alternative) => markReachedMix(alternative, false)),
      [MULTI_GAS_SIMILAR_BLEND_WARNING, ...closestOutcome.warnings]
    );
  }

  if (gergErrors.length > 0 && capRejected === 0) {
    return failure("gerg", waterVolumeLiters, warnings, [...new Set(gergErrors)]);
  }
  if (capRejected > 0) {
    warnings.push(BANK_LIMITS_EXCLUDE_ALL_WARNING);
  }
  return failure("noBlend", waterVolumeLiters, warnings, [hasCaps ? MULTI_GAS_BANK_LIMIT_ERROR : MULTI_GAS_NO_BLEND_ERROR]);
};
