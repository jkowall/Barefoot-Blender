import type { GasModel, PressureUnit } from "../state/settings";
import type { GasSourceInput } from "../state/session";
import { clampPercent, type BlendAlternative, type GasSelection, type OptimizerGasSource } from "./calculations";
import type { RealGasMultiGasAlternative, RealGasMultiGasResult, RealGasMultiGasSource } from "./realGasMultiGas";
import { fromDisplayPressure } from "./units";

export type MultiGasSourceResolution = {
  // Sources for the ideal optimizer, with the same ids and names it has always used.
  idealSources: OptimizerGasSource[];
  // The same sources with their GERG-2008 stage temperatures.
  realGasSources: RealGasMultiGasSource[];
  // Source id to its row in the session list, for writing stage temperatures back.
  rowIndexById: Map<string, number>;
};

/**
 * Resolve the enabled source rows into solver gases. Ids are the option id plus the source's
 * position among enabled rows, so the same gas can be listed twice.
 */
export const resolveMultiGasSources = (
  gasSources: GasSourceInput[],
  gasOptions: GasSelection[],
  pressureUnit: PressureUnit
): MultiGasSourceResolution => {
  const idealSources: OptimizerGasSource[] = [];
  const realGasSources: RealGasMultiGasSource[] = [];
  const rowIndexById = new Map<string, number>();
  let enabledIndex = 0;

  gasSources.forEach((source, rowIndex) => {
    if (!source.enabled) {
      return;
    }
    const index = enabledIndex;
    enabledIndex += 1;
    // A limit that is not a finite number (a corrupted saved value) leaves the bank unusable rather
    // than unlimited.
    const maxPressurePsi = source.maxPressure === undefined
      ? undefined
      : Number.isFinite(source.maxPressure)
        ? fromDisplayPressure(Math.max(0, source.maxPressure), pressureUnit)
        : 0;

    let resolved: OptimizerGasSource | null = null;
    if (source.id === "custom") {
      const o2Val = clampPercent(source.customO2 ?? 32);
      const heVal = Math.min(100 - o2Val, Math.max(0, source.customHe ?? 0));
      resolved = {
        id: `custom-${index}`,
        name: `Custom (${o2Val.toFixed(1)} O2 / ${heVal.toFixed(1)} He)`,
        o2: o2Val,
        he: heVal,
        maxPressurePsi
      };
    } else {
      const option = gasOptions.find((entry) => entry.id === source.id);
      if (option) {
        resolved = { ...option, id: `${option.id}-${index}`, maxPressurePsi };
      }
    }
    if (!resolved) {
      return;
    }
    idealSources.push(resolved);
    realGasSources.push({ ...resolved, stageTemperatureF: source.stageTemperatureF });
    rowIndexById.set(resolved.id, rowIndex);
  });

  return { idealSources, realGasSources, rowIndexById };
};

/** Swap a source row with its neighbor, keeping the parallel React row keys in step. */
export const moveGasSource = <T, K>(
  sources: T[],
  rowKeys: K[],
  index: number,
  direction: -1 | 1
): { sources: T[]; rowKeys: K[] } => {
  const target = index + direction;
  if (index < 0 || index >= sources.length || target < 0 || target >= sources.length) {
    return { sources, rowKeys };
  }
  const swap = <V,>(values: V[]): V[] => {
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  };
  return { sources: swap(sources), rowKeys: rowKeys.length === sources.length ? swap(rowKeys) : rowKeys };
};

// "idealFallback" shows the ideal plan when GERG-2008 cannot evaluate the inputs (failure "gerg":
// envelope or temperature limits, or no tank volume). A GERG "no blend" result is shown as is, so a
// bank limit is never hidden.
export type MultiGasPlanModel = "ideal" | "gerg2008" | "idealFallback";

export const selectMultiGasPlanModel = (
  gasModel: GasModel,
  realGasResult: RealGasMultiGasResult | null
): MultiGasPlanModel => {
  if (gasModel !== "gerg2008") {
    return "ideal";
  }
  if (!realGasResult) {
    return "idealFallback";
  }
  if (realGasResult.success) {
    return "gerg2008";
  }
  return realGasResult.failure === "gerg" ? "idealFallback" : "gerg2008";
};

/** The ideal option that adds the same set of sources, for the Training Mode hand check. */
export const findMatchingIdealAlternative = (
  idealAlternatives: BlendAlternative[],
  realGasAlternative: RealGasMultiGasAlternative
): BlendAlternative | null => {
  const key = realGasAlternative.sourceIds.join("|");
  return idealAlternatives.find(
    (alternative) => alternative.steps.map((step) => step.gas.id).sort().join("|") === key
  ) ?? null;
};
