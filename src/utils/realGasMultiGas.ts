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
  GERG_MIN_TEMPERATURE_ERROR,
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
export const BANK_LIMITS_BLOCK_EXACT_WARNING =
  "Bank limits rule out the exact plans; more available pressure in a limited bank may allow the exact mix.";
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
// A source's real-gas rise is never below half its ideal-equivalent amount across the supported
// envelope, so an option whose ideal-equivalent amount is above twice a bank limit cannot meet it and
// is rejected before the GERG-2008 pass. (The rise can exceed twice the amount, for example helium
// added last at a stage above 350 F, so this factor must not be lowered.)
const CAP_PREFILTER_FACTOR = 2;
// The closest-blend search can return thousands of near-duplicate options; at most this many are
// evaluated with GERG-2008 per search so the tab stays responsive.
const MAX_REALIZED_CANDIDATES = 400;
// Slack for the quick bank-limit check made before the scale refinement. That check projects each
// rise to the refined scale, and the projection is accurate to well under this fraction.
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
// Smallest change in a source's real-gas rise across a bleed range that counts as a direction.
const RISE_DIRECTION_TOLERANCE_PSI = 1e-6;
// Allowed mismatch in a balance the solve cannot satisfy exactly, as a fraction of its right-hand side.
const LINEAR_CONSISTENCY_TOLERANCE = 1e-5;

// Solve columns * x = rhs for the 3-row total/O2/He balance when the columns are independent and rhs
// lies in their span within `tolerance`; null otherwise. Gaussian elimination with partial pivoting.
const solveInSpan = (columns: number[][], rhs: number[], tolerance: number): number[] | null => {
  const unknowns = columns.length;
  if (unknowns > 3) {
    return null;
  }
  const rows = [0, 1, 2].map((i) => [...columns.map((column) => column[i]), rhs[i]]);
  for (let col = 0; col < unknowns; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(rows[row][col]) > Math.abs(rows[pivot][col])) {
        pivot = row;
      }
    }
    if (Math.abs(rows[pivot][col]) <= LINEAR_SINGULAR_TOLERANCE) {
      return null;
    }
    [rows[col], rows[pivot]] = [rows[pivot], rows[col]];
    for (let row = col + 1; row < 3; row += 1) {
      const factor = rows[row][col] / rows[col][col];
      for (let j = col; j <= unknowns; j += 1) {
        rows[row][j] -= factor * rows[col][j];
      }
    }
  }
  for (let row = unknowns; row < 3; row += 1) {
    if (Math.abs(rows[row][unknowns]) > tolerance) {
      return null;
    }
  }
  const x = new Array<number>(unknowns).fill(0);
  for (let row = unknowns - 1; row >= 0; row -= 1) {
    let sum = rows[row][unknowns];
    for (let j = row + 1; j < unknowns; j += 1) {
      sum -= rows[row][j] * x[j];
    }
    x[row] = sum / rows[row][row];
  }
  return x;
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
 * Exact fills after a bleed, per subset of one to three sources, from the linear total, O2, and He
 * balances (amounts in the same units as targetAmount; mixes in percent).
 * - When the start mix is not something the subset's sources can make, at most one kept start amount
 *   works (a point). A pressure scan can step over it.
 * - When the sources can make the start mix, any kept amount r in a range works, and each source's
 *   amount changes linearly with r (a line). Bank limits cut that range at points a search can bisect
 *   for. This covers any dependent balance: all nitrox, a shared helium or nitrogen fraction, or three
 *   independent sources.
 * Sources that are not independent of each other (identical rows, or three sources that only span two
 * balances) leave more than one free amount and are not covered here.
 */
export const bleedSubsetSolutions = (
  targetAmount: number,
  target: { o2: number; he: number },
  start: { o2: number; he: number },
  sources: GasSelection[]
): BleedSubsetSolution[] => {
  const startColumn = [1, start.o2 / 100, start.he / 100];
  const targetColumn = [targetAmount, targetAmount * target.o2 / 100, targetAmount * target.he / 100];
  const targetTolerance = LINEAR_CONSISTENCY_TOLERANCE * targetAmount;
  const solutions: BleedSubsetSolution[] = [];
  const nonnegative = (value: number): boolean => value >= -MOLE_TOLERANCE;
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

  const subsets: GasSelection[][] = [];
  for (let i = 0; i < sources.length; i += 1) {
    subsets.push([sources[i]]);
  }
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      subsets.push([sources[i], sources[j]]);
    }
  }
  for (let i = 0; i < sources.length; i += 1) {
    for (let j = i + 1; j < sources.length; j += 1) {
      for (let k = j + 1; k < sources.length; k += 1) {
        subsets.push([sources[i], sources[j], sources[k]]);
      }
    }
  }

  for (const subset of subsets) {
    const columns = subset.map((gas) => [1, gas.o2 / 100, gas.he / 100]);
    // Kept start gas that the sources could also make: the target needs offsets - slopes * r.
    const slopes = solveInSpan(columns, startColumn, LINEAR_CONSISTENCY_TOLERANCE);
    if (slopes) {
      // A lone source with the start's own mix only tops up; nothing to solve for.
      if (subset.length > 1) {
        const offsets = solveInSpan(columns, targetColumn, targetTolerance);
        if (offsets) {
          addLine(subset, offsets, slopes);
        }
      }
      continue;
    }
    // [start, sources] [retained; additions] = target, when those columns are independent.
    const solved = solveInSpan([startColumn, ...columns], targetColumn, targetTolerance);
    if (solved && solved.every(nonnegative)) {
      solutions.push({ kind: "point", sources: subset, retained: Math.max(0, solved[0]), additions: solved.slice(1) });
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
    // GERG-2008 cannot evaluate without a volume, but the ideal plan can still be shown.
    return failure("gerg", waterVolumeLiters, warnings, ["Tank size and rated pressure are required for GERG-2008 correction."]);
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
    return failure("gerg", waterVolumeLiters, warnings, [GERG_MIN_TEMPERATURE_ERROR]);
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
  // Within the smallest meterable addition, there is nothing to add or bleed.
  if (sameMix && Math.abs(targetMoles - fullStartMoles) * psiPerMole <= MIN_ADDITION_PSI) {
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
    // An option whose every addition is too small to meter would be a plan with nothing to do.
    if (additions.length === 0) {
      return { rejected: "mix" };
    }
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
    const exceedsCap = (
      stages: { key: string; pressureChangePsi: number }[],
      slack: number,
      riseScale = 1
    ): boolean =>
      stages.some((stage) => {
        const cap = sourceById.get(stage.key)?.maxPressurePsi;
        return cap !== undefined && stage.pressureChangePsi * riseScale > cap * (1 + slack) + CAP_TOLERANCE_PSI;
      });

    // The scale refinement costs several GERG density solves, so reject clear bank-limit misses first.
    // The refinement rescales every addition until the settled pressure meets the target, and a mix
    // whose Z differs from the target's can need a sizable rescale of a small rise. So project each
    // rise to the refined scale from the quick pass's settled pressure before comparing.
    const hasCappedSource = additions.some((addition) => addition.source?.maxPressurePsi !== undefined);
    if (options.enforceCaps && hasCappedSource) {
      const quick = simulateAt(initialScale);
      if (quick.simulation.success) {
        const startSettled = stateFromComponents(settledTemperatureK, start.components, waterVolumeLiters);
        const quickSettled = stateFromComponents(settledTemperatureK, quick.simulation.finalComponents, waterVolumeLiters);
        const quickAdded = quickSettled.pressurePsi - startSettled.pressurePsi;
        if (startSettled.success && quickSettled.success && quickAdded > MIN_ADDITION_PSI) {
          const riseScale = Math.max(0, targetPressurePsi - startSettled.pressurePsi) / quickAdded;
          if (exceedsCap(quick.simulation.steps, QUICK_CAP_SLACK, riseScale)) {
            return { rejected: "cap" };
          }
        }
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
      // Only a candidate no bank limit has ruled out counts as an envelope failure, even in an
      // uncapped probe: a failed probe is infeasible either way, and this keeps the reason right.
      if (exceedsCap(simulation.steps, 0)) {
        return { rejected: "cap" };
      }
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
      const capMiss = candidate.steps.some((step) => {
        const cap = sourceById.get(step.gas.id)?.maxPressurePsi;
        return cap !== undefined && step.amount * amountScale > cap * CAP_PREFILTER_FACTOR + CAP_TOLERANCE_PSI;
      });
      if (options.enforceCaps && capMiss) {
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
        // An uncapped probe's envelope failure says nothing about a fill its bank limits rule out.
        if (capMiss) {
          outcome.capRejected += 1;
        } else {
          outcome.gergErrors.push(...result.errors);
        }
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
  // Exact plans can miss the target by up to 0.01 points, so also flag the mix each plan reaches.
  const exactSafetyWarnings = (alternatives: RealGasMultiGasAlternative[]): string[] => {
    const flags = [...targetSafetyWarnings];
    for (const alternative of alternatives) {
      appendMixSafetyWarnings(flags, alternative.finalO2);
    }
    return flags;
  };

  // 1. Exact fill from the current start.
  const exactOutcome = realize(enumerate(fullStartMoles), fullStart, maxAlternatives, exactOptions);
  const exact = track(exactOutcome);
  if (exact.length > 0) {
    return success("exact", exact, [...exactSafetyWarnings(exact), ...exactOutcome.warnings]);
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
  // bleed). Excess start gas that already has the target mix only needs a drain, to the pressure at
  // which the kept moles at Start Temp equal the target's.
  if (sameMix && targetMoles < fullStartMoles - MOLE_TOLERANCE) {
    const drainedPressure = stateFromComponents(
      startTemperatureK,
      componentMolesFromTotal(targetMoles, startFractions),
      waterVolumeLiters
    );
    const drained = drainedPressure.success ? startStateAt(drainedPressure.pressurePsi) : null;
    if (drained && "components" in drained) {
      const settled = stateFromComponents(settledTemperatureK, drained.components, waterVolumeLiters);
      if (settled.success && Math.abs(settled.pressurePsi - targetPressurePsi) <= SETTLED_PRESSURE_TOLERANCE_PSI) {
        const drainOnly: RealGasMultiGasAlternative = {
          steps: [],
          finalO2: input.startO2,
          finalHe: input.startHe,
          finalN2: Math.max(0, 100 - input.startO2 - input.startHe),
          deviationO2: input.startO2 - input.targetO2,
          deviationHe: input.startHe - input.targetHe,
          startHotPressurePsi: drained.pressurePsi,
          startZ: drained.z,
          finalHotPressurePsi: drained.pressurePsi,
          settledPressurePsi: settled.pressurePsi,
          estimatedCost: 0,
          costBreakdown: [],
          sourceIds: [],
          warnings: []
        };
        return success(
          "bleed",
          withBleed([drainOnly], drained),
          [BLEED_REQUIRED_WARNING, ...exactSafetyWarnings([drainOnly]), ...settled.warnings],
          drained.pressurePsi
        );
      }
    }
  }

  // Otherwise each search scans from the top down for a feasible point, then bisects up toward the
  // infeasible point above it, and the subset solves below catch answers narrower than the scan step.
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
      // Keep the reasons a bleed failed, so an envelope failure falls back to ideal instead of "no blend".
      return track(outcome).length > 0 ? state : null;
    };
    const highestFeasibleBelow = (topPsi: number, enforceCaps: boolean, points: number): StartState | null => {
      // A top already at empty leaves only 0 to try; scanning would repeat that probe.
      if (topPsi <= BLEED_PRESSURE_TOLERANCE_PSI) {
        return feasibleAt(0, enforceCaps);
      }
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

    // On a range of kept amounts each limited source's real-gas rise moves one way, though not always
    // the way its moles do: a fixed helium amount rises more over a denser residual. So measure each
    // rise at both ends of the range. A rise that grows with the kept amount caps the range from above;
    // one that shrinks or holds is best at the top. Bisect for the highest kept amount under every
    // upper cap, then check the other limits there.
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
      const limits = line.sources.flatMap((gas) => {
        const cap = sourceById.get(gas.id)?.maxPressurePsi;
        return cap === undefined ? [] : [{ id: gas.id, cap }];
      });
      const risesAt = (retainedAmount: number): Map<string, number> | null => {
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
        return new Map(realized.alternative.steps.map((step) => [step.sourceId ?? "", step.pressureChangePsi]));
      };
      const exceeds = (rises: Map<string, number>, limit: { id: string; cap: number }): boolean =>
        (rises.get(limit.id) ?? 0) > limit.cap + CAP_TOLERANCE_PSI;

      const atHigh = risesAt(high);
      if (!atHigh) {
        continue;
      }
      if (!limits.some((limit) => exceeds(atHigh, limit))) {
        if (high > bestRetained()) {
          tryDrainTo(high);
        }
        continue;
      }
      const atLow = high > low ? risesAt(low) : null;
      if (!atLow) {
        continue;
      }
      const upperLimits = limits.filter(
        (limit) => (atHigh.get(limit.id) ?? 0) > (atLow.get(limit.id) ?? 0) + RISE_DIRECTION_TOLERANCE_PSI
      );
      const otherLimits = limits.filter((limit) => !upperLimits.includes(limit));
      const meetsUpperLimits = (rises: Map<string, number>): boolean =>
        upperLimits.every((limit) => !exceeds(rises, limit));
      if (!meetsUpperLimits(atLow)) {
        continue;
      }
      let feasibleRetained = low;
      let feasibleRises = atLow;
      if (meetsUpperLimits(atHigh)) {
        feasibleRetained = high;
        feasibleRises = atHigh;
      } else {
        let infeasibleRetained = high;
        while (infeasibleRetained - feasibleRetained > BLEED_PRESSURE_TOLERANCE_PSI) {
          const mid = (feasibleRetained + infeasibleRetained) / 2;
          const atMid = risesAt(mid);
          if (atMid && meetsUpperLimits(atMid)) {
            feasibleRetained = mid;
            feasibleRises = atMid;
          } else {
            infeasibleRetained = mid;
          }
        }
      }
      if (!otherLimits.some((limit) => exceeds(feasibleRises, limit)) && feasibleRetained > bestRetained()) {
        tryDrainTo(feasibleRetained);
      }
    }

    if (bleedTo) {
      const bleedOutcome = realize(enumerate(totalMoles(bleedTo.components)), bleedTo, maxAlternatives, exactOptions);
      const bled = track(bleedOutcome);
      if (bled.length > 0) {
        return success(
          "bleed",
          withBleed(bled, bleedTo),
          [BLEED_REQUIRED_WARNING, ...exactSafetyWarnings(bled), ...bleedOutcome.warnings],
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
  // Bank limits that rejected exact, bleed, or residual options are worth naming next to a closest blend.
  const closestLimitWarnings = capRejected > 0 ? [BANK_LIMITS_BLOCK_EXACT_WARNING] : [];
  const closestOutcome = closestFrom(fullStart);
  const closest = track(closestOutcome);
  if (closest.length > 0) {
    return success(
      "closest",
      closest.map((alternative) => markReachedMix(alternative, false)),
      [MULTI_GAS_SIMILAR_BLEND_WARNING, ...closestLimitWarnings, ...closestOutcome.warnings]
    );
  }
  if (startPressurePsi > MOLE_TOLERANCE && "components" in residualStart) {
    const drainedOutcome = closestFrom(residualStart);
    const drained = track(drainedOutcome);
    if (drained.length > 0) {
      return success(
        "closest",
        withBleed(drained.map((alternative) => markReachedMix(alternative, false)), residualStart),
        [BLEED_REQUIRED_WARNING, MULTI_GAS_SIMILAR_BLEND_WARNING, ...closestLimitWarnings, ...drainedOutcome.warnings],
        0
      );
    }
  }

  // Envelope failures come only from candidates no bank limit ruled out, so GERG-2008 cannot say
  // the fill is impossible, even when other candidates hit their limits.
  // Like ideal mode, flag a hypoxic or high-O2 target even when no plan is shown.
  warnings.push(...targetSafetyWarnings);
  if (gergErrors.length > 0) {
    return failure("gerg", waterVolumeLiters, warnings, [...new Set(gergErrors)]);
  }
  if (capRejected > 0) {
    warnings.push(BANK_LIMITS_EXCLUDE_ALL_WARNING);
  }
  return failure("noBlend", waterVolumeLiters, warnings, [hasCaps ? MULTI_GAS_BANK_LIMIT_ERROR : MULTI_GAS_NO_BLEND_ERROR]);
};
