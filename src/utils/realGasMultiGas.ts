import type { PressureUnit } from "../state/settings";
import {
  MULTI_GAS_BANK_LIMIT_ERROR,
  MULTI_GAS_HE_TOLERANCE,
  MULTI_GAS_NO_BLEND_ERROR,
  MULTI_GAS_O2_TOLERANCE,
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
export const TARGET_BELOW_RESIDUAL_ERROR =
  "The target needs less gas than an empty cylinder holds at Start Temp (1 atm of the start mix). Raise the target pressure or check the temperatures.";

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
// Every plan must settle at the target pressure within this tolerance at Settled Temp.
const SETTLED_PRESSURE_TOLERANCE_PSI = 0.05;
// A source's real-gas rise stays well within twice its ideal-equivalent amount across the supported
// envelope (Z and stage temperature each move it by tens of percent), so options above twice a bank
// limit are rejected before the GERG-2008 pass.
const CAP_PREFILTER_FACTOR = 2;
// The closest-blend search can return thousands of near-duplicate options; at most this many are
// evaluated with GERG-2008 per search so the tab stays responsive.
const MAX_REALIZED_CANDIDATES = 400;
// Slack for the quick bank-limit check made before the scale refinement, which moves amounts by
// well under this fraction.
const QUICK_CAP_SLACK = 0.02;

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
  warnings: string[];
};

type RealizeOptions = {
  enforceCaps: boolean;
  // Reject options whose reached mix is further than this from the target (percentage points).
  mixTolerance?: { o2: number; he: number };
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

const LINEAR_SINGULAR_TOLERANCE = 1e-9;
// Allowed mismatch in the equation a 1-source solve does not use, as a fraction of the target amount.
const LINEAR_CONSISTENCY_TOLERANCE = 1e-5;

// Determinant of a 3x3 matrix given by rows.
const determinant3 = (m: number[][]): number =>
  m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
  m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
  m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

// Solve m * x = rhs by Cramer's rule; null when m is singular.
const solve3 = (m: number[][], rhs: number[]): number[] | null => {
  const det = determinant3(m);
  if (Math.abs(det) <= LINEAR_SINGULAR_TOLERANCE) {
    return null;
  }
  return [0, 1, 2].map((column) =>
    determinant3(m.map((row, i) => row.map((value, j) => (j === column ? rhs[i] : value)))) / det
  );
};

export type BleedSubsetSolution =
  // The start mix plus these sources makes the target only when `retained` of the start is kept.
  | { kind: "point"; sources: GasSelection[]; retained: number; additions: number[] }
  // Any kept amount r in [minRetained, maxRetained] works, adding offsets[i] - slopes[i] * r of each source.
  | {
      kind: "line";
      sources: GasSelection[];
      offsets: number[];
      slopes: number[];
      minRetained: number;
      maxRetained: number;
    };

/**
 * Exact fills after a bleed, per subset of one to three sources, from the linear mole balance
 * (amounts in the same units as targetAmount; mixes in percent). One source, and two sources with
 * helium involved, work at a single kept start amount, which a pressure scan can step over. Two
 * all-nitrox sources, and three sources with helium, work over a range of kept amounts in which each
 * source's amount changes linearly; bank limits then cut that range at points a search can bisect for.
 * Three all-nitrox sources leave two free amounts and are not covered here.
 */
export const bleedSubsetSolutions = (
  targetAmount: number,
  target: { o2: number; he: number },
  start: { o2: number; he: number },
  sources: GasSelection[]
): BleedSubsetSolution[] => {
  const t = { o2: target.o2 / 100, he: target.he / 100 };
  const s = { o2: start.o2 / 100, he: start.he / 100 };
  const solutions: BleedSubsetSolution[] = [];
  const nonnegative = (value: number): boolean => value >= -MOLE_TOLERANCE;
  const heliumActive = (subset: GasSelection[]): boolean =>
    s.he > LINEAR_SINGULAR_TOLERANCE ||
    t.he > LINEAR_SINGULAR_TOLERANCE ||
    subset.some((gas) => gas.he / 100 > LINEAR_SINGULAR_TOLERANCE);
  const addPoint = (subset: GasSelection[], retained: number, additions: number[]): void => {
    if (nonnegative(retained) && additions.every(nonnegative)) {
      solutions.push({ kind: "point", sources: subset, retained: Math.max(0, retained), additions });
    }
  };
  const addLine = (subset: GasSelection[], offsets: number[], slopes: number[]): void => {
    // additions_i(r) = offsets_i - slopes_i * r must stay nonnegative.
    let minRetained = 0;
    let maxRetained = targetAmount;
    for (let i = 0; i < offsets.length; i += 1) {
      if (slopes[i] > LINEAR_SINGULAR_TOLERANCE) {
        maxRetained = Math.min(maxRetained, offsets[i] / slopes[i]);
      } else if (slopes[i] < -LINEAR_SINGULAR_TOLERANCE) {
        minRetained = Math.max(minRetained, offsets[i] / slopes[i]);
      } else if (!nonnegative(offsets[i])) {
        return;
      }
    }
    if (minRetained <= maxRetained + MOLE_TOLERANCE) {
      solutions.push({ kind: "line", sources: subset, offsets, slopes, minRetained, maxRetained });
    }
  };

  for (const source of sources) {
    const g = { o2: source.o2 / 100, he: source.he / 100 };
    // retained + added = target; solve with the O2 balance, or the He balance when O2 cannot separate
    // the start mix from the source, then check the other balance.
    const useO2 = Math.abs(s.o2 - g.o2) > LINEAR_SINGULAR_TOLERANCE;
    const denominator = useO2 ? s.o2 - g.o2 : s.he - g.he;
    if (Math.abs(denominator) <= LINEAR_SINGULAR_TOLERANCE) {
      continue;
    }
    const retained = targetAmount * (useO2 ? t.o2 - g.o2 : t.he - g.he) / denominator;
    const added = targetAmount - retained;
    const otherResidual = useO2
      ? retained * s.he + added * g.he - targetAmount * t.he
      : retained * s.o2 + added * g.o2 - targetAmount * t.o2;
    if (Math.abs(otherResidual) <= LINEAR_CONSISTENCY_TOLERANCE * targetAmount) {
      addPoint([source], retained, [added]);
    }
  }

  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      const subset = [sources[i], sources[j]];
      const a = { o2: sources[i].o2 / 100, he: sources[i].he / 100 };
      const b = { o2: sources[j].o2 / 100, he: sources[j].he / 100 };
      if (heliumActive(subset)) {
        // [1 1 1; s.o2 a.o2 b.o2; s.he a.he b.he] [retained; x1; x2] = target * [1; t.o2; t.he]
        const solved = solve3(
          [[1, 1, 1], [s.o2, a.o2, b.o2], [s.he, a.he, b.he]],
          [targetAmount, targetAmount * t.o2, targetAmount * t.he]
        );
        if (solved) {
          addPoint(subset, solved[0], [solved[1], solved[2]]);
        }
        continue;
      }
      // All nitrox: x1 + x2 = target - r and a.o2 x1 + b.o2 x2 = target t.o2 - r s.o2.
      const denominator = b.o2 - a.o2;
      if (Math.abs(denominator) <= LINEAR_SINGULAR_TOLERANCE) {
        continue;
      }
      addLine(
        subset,
        [targetAmount * (b.o2 - t.o2) / denominator, targetAmount * (t.o2 - a.o2) / denominator],
        [(b.o2 - s.o2) / denominator, (s.o2 - a.o2) / denominator]
      );
    }
  }

  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      for (let k = j + 1; k < sources.length; k += 1) {
        const subset = [sources[i], sources[j], sources[k]];
        if (!heliumActive(subset)) {
          continue;
        }
        const matrix = [
          [1, 1, 1],
          subset.map((gas) => gas.o2 / 100),
          subset.map((gas) => gas.he / 100)
        ];
        const offsets = solve3(matrix, [targetAmount, targetAmount * t.o2, targetAmount * t.he]);
        const slopes = solve3(matrix, [1, s.o2, s.he]);
        if (offsets && slopes) {
          addLine(subset, offsets, slopes);
        }
      }
    }
  }

  return solutions;
};

/**
 * Start amounts to keep at which the start mix plus one or two sources makes the target exactly
 * (the single-point solutions of bleedSubsetSolutions).
 */
export const isolatedBleedStartAmounts = (
  targetAmount: number,
  target: { o2: number; he: number },
  start: { o2: number; he: number },
  sources: GasSelection[]
): number[] =>
  bleedSubsetSolutions(targetAmount, target, start, sources).flatMap((solution) =>
    solution.kind === "point" ? [solution.retained] : []
  );

// True when the added gases alone (ignoring the cylinder's start contents) make the target mix.
const additionsMakeTarget = (
  steps: { gas: GasSelection; amount: number }[],
  target: { targetO2: number; targetHe: number }
): boolean => {
  const total = steps.reduce((sum, step) => sum + step.amount, 0);
  if (total <= 0) {
    return false;
  }
  const o2 = steps.reduce((sum, step) => sum + step.amount * step.gas.o2, 0) / total;
  const he = steps.reduce((sum, step) => sum + step.amount * step.gas.he, 0) / total;
  return (
    Math.abs(o2 - target.targetO2) <= EXACT_MIX_TOLERANCE_PERCENT &&
    Math.abs(he - target.targetHe) <= EXACT_MIX_TOLERANCE_PERCENT
  );
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
      z: density.z,
      warnings: density.warnings
    };
  };

  const fullStart = startStateAt(startPressurePsi);
  if (!("components" in fullStart)) {
    warnings.push(...fullStart.warnings);
    return failure("gerg", waterVolumeLiters, warnings, fullStart.errors);
  }
  const fullStartMoles = totalMoles(fullStart.components);
  // Start Temp can be outside the normal fill range even when every stage temperature is not.
  warnings.push(...fullStart.warnings);

  // The 1 atm left in a cylinder at 0 gauge cannot be bled off, so a target holding fewer moles than
  // that residual cannot be reached by any plan.
  const residualStart = startStateAt(0);
  if ("components" in residualStart && targetMoles < totalMoles(residualStart.components) - MOLE_TOLERANCE) {
    return failure("input", waterVolumeLiters, warnings, [TARGET_BELOW_RESIDUAL_ERROR]);
  }

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
    | { rejected: "cap" | "mix" | "pressure" }
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

    const simulateAt = (scale: number) => {
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
      return { ordered, simulation };
    };
    const exceedsCap = (stages: { key: string; pressureChangePsi: number }[], slack: number): boolean =>
      stages.some((stage) => {
        const cap = sourceById.get(stage.key)?.maxPressurePsi;
        return cap !== undefined && stage.pressureChangePsi > cap * (1 + slack) + CAP_TOLERANCE_PSI;
      });

    // The scale refinement costs several GERG density solves, so reject clear bank-limit misses first.
    const hasCappedSource = additions.some((addition) => addition.source?.maxPressurePsi !== undefined);
    if (options.enforceCaps && hasCappedSource) {
      const quick = simulateAt(initialScale);
      if (quick.simulation.success && exceedsCap(quick.simulation.steps, QUICK_CAP_SLACK)) {
        return { rejected: "cap" };
      }
    }

    const scale = refineAdditionScaleToSettledTarget(
      start.components,
      additions,
      targetPressurePsi,
      settledTemperatureK,
      waterVolumeLiters,
      initialScale
    );
    const { ordered, simulation } = simulateAt(scale);
    if (!simulation.success) {
      return { rejected: "gerg", errors: simulation.errors };
    }
    if (options.enforceCaps && exceedsCap(simulation.steps, 0)) {
      return { rejected: "cap" };
    }

    const finalFractions = fractionsFromMoles(simulation.finalComponents);
    const mixTolerance = options.mixTolerance;
    if (
      mixTolerance !== undefined &&
      (Math.abs(finalFractions.o2 * 100 - input.targetO2) > mixTolerance.o2 ||
        Math.abs(finalFractions.he * 100 - input.targetHe) > mixTolerance.he)
    ) {
      return { rejected: "mix" };
    }
    const settled = stateFromComponents(settledTemperatureK, simulation.finalComponents, waterVolumeLiters);
    if (!settled.success) {
      return { rejected: "gerg", errors: settled.errors };
    }
    if (Math.abs(settled.pressurePsi - targetPressurePsi) > SETTLED_PRESSURE_TOLERANCE_PSI) {
      return { rejected: "pressure" };
    }
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
        settledPressurePsi: settled.pressurePsi,
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
    let evaluated = 0;
    for (const candidate of candidates) {
      if (outcome.alternatives.length >= limit || evaluated >= MAX_REALIZED_CANDIDATES) {
        break;
      }
      // Compare the amounts after the same scaling the realization applies: residual-adjusted options
      // are planned for an empty cylinder and shrink by the moles already in it.
      const addedAmount = candidate.steps.reduce((sum, step) => sum + Math.max(0, step.amount), 0);
      const amountScale = addedAmount > 0
        ? Math.max(0, (targetMoles - totalMoles(start.components)) * psiPerMole / addedAmount)
        : 1;
      if (
        options.enforceCaps &&
        candidate.steps.some((step) => {
          const cap = sourceById.get(step.gas.id)?.maxPressurePsi;
          return cap !== undefined && step.amount * amountScale > cap * CAP_PREFILTER_FACTOR + CAP_TOLERANCE_PSI;
        })
      ) {
        outcome.capRejected += 1;
        continue;
      }
      evaluated += 1;
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
  const exactOptions: RealizeOptions = {
    enforceCaps: true,
    mixTolerance: { o2: EXACT_MIX_TOLERANCE_PERCENT, he: EXACT_MIX_TOLERANCE_PERCENT }
  };
  const residualOptions: RealizeOptions = { enforceCaps: true };
  // The settled-pressure refinement can move a closest blend slightly, so recheck its limits.
  const closestOptions: RealizeOptions = {
    enforceCaps: true,
    mixTolerance: { o2: MULTI_GAS_O2_TOLERANCE + PERCENT_TOLERANCE, he: MULTI_GAS_HE_TOLERANCE + PERCENT_TOLERANCE }
  };

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
        mixTolerance: { o2: BLEED_SEARCH_MIX_TOLERANCE_PERCENT, he: BLEED_SEARCH_MIX_TOLERANCE_PERCENT }
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

    // Solve each subset of sources directly from the linear mole balance, so a fill that works only at
    // a single drain-to pressure, or only in a window between two bank limits, is not stepped over.
    const residualMoles = "components" in residualStart ? totalMoles(residualStart.components) : 0;
    const residualAmount = residualMoles * psiPerMole;
    const startAmount = fullStartMoles * psiPerMole;
    const drainToPressure = (retainedAmount: number): number | null => {
      const drained = stateFromComponents(
        startTemperatureK,
        componentMolesFromTotal(retainedAmount / psiPerMole, startFractions),
        waterVolumeLiters
      );
      return drained.success ? drained.pressurePsi : null;
    };
    const tryDrainTo = (retainedAmount: number): void => {
      const pressurePsi = drainToPressure(retainedAmount);
      if (pressurePsi === null || pressurePsi <= (bleedTo?.pressurePsi ?? -1)) {
        return;
      }
      const verified = feasibleAt(pressurePsi, true);
      if (verified) {
        bleedTo = verified;
      }
    };
    const inBleedRange = (retainedAmount: number): boolean =>
      retainedAmount >= residualAmount - MOLE_TOLERANCE && retainedAmount < startAmount - MOLE_TOLERANCE;

    const subsetSolutions = bleedSubsetSolutions(
      targetMoles * psiPerMole,
      { o2: input.targetO2, he: input.targetHe },
      { o2: input.startO2, he: input.startHe },
      uncappedSources
    );
    for (const solution of subsetSolutions) {
      if (solution.kind === "point" && inBleedRange(solution.retained)) {
        tryDrainTo(solution.retained);
      }
    }

    // On a range of kept amounts, each source's amount, and so its real-gas rise, moves one way. A
    // limited source whose amount grows with the kept amount caps the range from above; one whose
    // amount shrinks caps it from below. Bisect for the highest kept amount under every upper cap,
    // then check the lower caps there.
    const lines = subsetSolutions
      .flatMap((solution) => (solution.kind === "line" ? [solution] : []))
      .sort((a, b) => b.maxRetained - a.maxRetained);
    const bestRetained = (): number => (bleedTo ? totalMoles(bleedTo.components) * psiPerMole : -1);
    for (const line of lines) {
      const low = Math.max(line.minRetained, residualAmount);
      const high = Math.min(line.maxRetained, startAmount - BLEED_PRESSURE_TOLERANCE_PSI);
      if (low > high || high <= bestRetained()) {
        continue;
      }
      const limits = line.sources.flatMap((gas, index) => {
        const cap = sourceById.get(gas.id)?.maxPressurePsi;
        return cap === undefined ? [] : [{ id: gas.id, cap, slope: line.slopes[index] }];
      });
      const capViolations = (retainedAmount: number): { upper: boolean; lower: boolean; fixed: boolean } | null => {
        const pressurePsi = drainToPressure(retainedAmount);
        const state = pressurePsi === null ? null : startStateAt(pressurePsi);
        if (!state || !("components" in state)) {
          return null;
        }
        const candidate: BlendAlternative = {
          steps: line.sources.map((gas, index) => ({
            gas,
            amount: Math.max(0, line.offsets[index] - line.slopes[index] * retainedAmount)
          })),
          finalO2: input.targetO2,
          finalHe: input.targetHe,
          deviationO2: 0,
          deviationHe: 0,
          estimatedCost: 0,
          costBreakdown: [],
          fillOrder: []
        };
        const realized = realizeOne(candidate, state, {
          enforceCaps: false,
          mixTolerance: { o2: BLEED_SEARCH_MIX_TOLERANCE_PERCENT, he: BLEED_SEARCH_MIX_TOLERANCE_PERCENT }
        });
        if (!("alternative" in realized)) {
          return null;
        }
        const violations = { upper: false, lower: false, fixed: false };
        for (const limit of limits) {
          const rise = realized.alternative.steps.find((step) => step.sourceId === limit.id)?.pressureChangePsi ?? 0;
          if (rise <= limit.cap + CAP_TOLERANCE_PSI) {
            continue;
          }
          if (limit.slope < -LINEAR_SINGULAR_TOLERANCE) {
            violations.upper = true;
          } else if (limit.slope > LINEAR_SINGULAR_TOLERANCE) {
            violations.lower = true;
          } else {
            violations.fixed = true;
          }
        }
        return violations;
      };

      let retained = high;
      let atRetained = capViolations(high);
      if (!atRetained || atRetained.fixed) {
        continue;
      }
      if (atRetained.upper) {
        const atLow = capViolations(low);
        if (!atLow || atLow.upper || atLow.fixed) {
          continue;
        }
        let feasibleRetained = low;
        let violationsThere = atLow;
        let infeasibleRetained = high;
        while (infeasibleRetained - feasibleRetained > BLEED_PRESSURE_TOLERANCE_PSI) {
          const mid = (feasibleRetained + infeasibleRetained) / 2;
          const atMid = capViolations(mid);
          if (atMid && !atMid.upper && !atMid.fixed) {
            feasibleRetained = mid;
            violationsThere = atMid;
          } else {
            infeasibleRetained = mid;
          }
        }
        retained = feasibleRetained;
        atRetained = violationsThere;
      }
      if (!atRetained.lower && retained > bestRetained()) {
        tryDrainTo(retained);
      }
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
  // gases as if the cylinder were empty, scaled so the settled pressure still matches the target. Only
  // options whose gases alone make the target qualify: the ideal optimizer also accepts a single source
  // within 0.5 points, and purging would not make such a source reach the target either.
  if ("components" in residualStart) {
    const vacuumCandidates = enumerate(0).filter((candidate) => additionsMakeTarget(candidate.steps, input));
    const residualOutcome = realize(vacuumCandidates, residualStart, maxAlternatives, residualOptions);
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

  // 4. Closest blend within +/-1% O2 and +/-5% He, from the current start, or else after draining to
  // 0 gauge when the start contents keep every nearby mix out of reach.
  const closestFrom = (start: StartState): RealizeOutcome =>
    realize(
      findSimilarNGasAlternatives(
        targetMoles * psiPerMole,
        input.targetO2,
        input.targetHe,
        totalMoles(start.components) * psiPerMole,
        input.startO2,
        input.startHe,
        uncappedSources,
        costContext,
        Number.POSITIVE_INFINITY
      ),
      start,
      maxAlternatives,
      closestOptions
    );
  const closestOutcome = closestFrom(fullStart);
  const closest = track(closestOutcome);
  if (closest.length > 0) {
    return success(
      "closest",
      closest.map((alternative) => markReachedMix(alternative, false)),
      [MULTI_GAS_SIMILAR_BLEND_WARNING, ...closestOutcome.warnings]
    );
  }
  if (startPressurePsi > MOLE_TOLERANCE && "components" in residualStart) {
    const drainedOutcome = closestFrom(residualStart);
    const drained = track(drainedOutcome);
    if (drained.length > 0) {
      return success(
        "closest",
        withBleed(drained.map((alternative) => markReachedMix(alternative, false)), residualStart),
        [BLEED_REQUIRED_WARNING, MULTI_GAS_SIMILAR_BLEND_WARNING, ...drainedOutcome.warnings],
        0
      );
    }
  }

  if (gergErrors.length > 0 && capRejected === 0) {
    return failure("gerg", waterVolumeLiters, warnings, [...new Set(gergErrors)]);
  }
  if (capRejected > 0) {
    warnings.push(BANK_LIMITS_EXCLUDE_ALL_WARNING);
  }
  return failure("noBlend", waterVolumeLiters, warnings, [hasCaps ? MULTI_GAS_BANK_LIMIT_ERROR : MULTI_GAS_NO_BLEND_ERROR]);
};
