import { useMemo, useState, type KeyboardEvent } from "react";
import type { GasModel, SettingsSnapshot, TemperatureUnit } from "../state/settings";
import { useSessionStore, type MultiGasInput, type GasSourceInput } from "../state/session";
import {
  applyFillOrderToAlternative,
  solveNGasBlend,
  type GasSelection,
  type BlendAlternative,
  type CostSettings,
  type MultiGasFillOrderMode,
  type OptimizerGasSource,
  cuFtToLiters,
  pressureToCuFt
} from "../utils/calculations";
import {
  formatFillCostBasis,
  formatGasVolume,
  formatNumber,
  formatPressure,
  formatSignedPressure
} from "../utils/format";
import {
  calculateRealGasMultiGasBlend,
  type RealGasMultiGasAlternative,
  type RealGasMultiGasResult,
  type RealGasMultiGasStep
} from "../utils/realGasMultiGas";
import {
  DEFAULT_SETTLED_TEMPERATURE_F,
  DEFAULT_START_TEMPERATURE_F,
  fromDisplayTemperature,
  temperatureUnitLabel,
  toDisplayTemperature
} from "../utils/temperature";
import { useClearableNumber } from "./useClearableNumber";
import { fromDisplayPressure, toDisplayPressure } from "../utils/units";
import { logger } from "../utils/logger";
import { AccordionItem } from "./Accordion";
import ErrorBoundary from "./ErrorBoundary";
import { NumberInput } from "./NumberInput";
import { GasSourceRow } from "./GasSourceRow";
import { SelectInput } from "./SelectInput";
import TankContextFields from "./TankContextFields";
import TrainingMathPanel from "./TrainingMathPanel";
import {
  findMatchingIdealAlternative,
  moveGasSource,
  resolveMultiGasSources,
  selectMultiGasPlanModel
} from "../utils/multiGasPlan";


export const MAX_GAS_SOURCES = 6;
const EMPTY_GAS_SOURCES: GasSourceInput[] = [];

const trimixPresets: GasSelection[] = [
  { id: "trimix-2135", name: "Trimix 21/35", o2: 21, he: 35 },
  { id: "trimix-1845", name: "Trimix 18/45", o2: 18, he: 45 },
  { id: "trimix-1555", name: "Trimix 15/55", o2: 15, he: 55 }
];

type Props = {
  settings: SettingsSnapshot;
  topOffOptions: GasSelection[];
  trainingModeEnabled: boolean;
};

const createGasSourceRowKey = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `gas-source-${Date.now()}-${Math.random().toString(36).slice(2)}`;
};

const blendAlternativeKey = (alternative: BlendAlternative): string => {
  const stepKey = alternative.steps
    .map((step) => `${step.gas.id}:${step.amount.toFixed(6)}`)
    .join("|");
  return [
    alternative.finalO2.toFixed(3),
    alternative.finalHe.toFixed(3),
    alternative.estimatedCost.toFixed(2),
    stepKey
  ].join(":");
};

const realGasAlternativeKey = (alternative: RealGasMultiGasAlternative): string =>
  alternative.steps.map((step) => `${step.sourceId ?? step.kind}:${step.molesAdded.toFixed(6)}`).join("|");

const costLineKey = (line: { gas: string; amount: number; cost: number }): string =>
  `${line.gas}-${line.amount.toFixed(6)}-${line.cost.toFixed(2)}`;

/**
 * React key for a corrected stop row. Source ids are unique within a plan, and the key must not
 * change when a recalculation changes the amounts, or the row's Stage Temp input loses focus mid-edit.
 */
export const realGasStepKey = (step: Pick<RealGasMultiGasStep, "kind" | "sourceId" | "gasName">): string =>
  step.kind === "bleed" ? "bleed" : step.sourceId ?? step.gasName;

export const hasStageTemperatureOverrides = (gasSources: GasSourceInput[]): boolean =>
  gasSources.some((source) => source.stageTemperatureF !== undefined);

/** Clear every source's stage temperature so all stages inherit Start Temp again. */
export const clearStageTemperatures = (gasSources: GasSourceInput[]): GasSourceInput[] =>
  gasSources.map((source) => (source.stageTemperatureF === undefined ? source : { ...source, stageTemperatureF: undefined }));

const selectTempOnEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
  if (event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.select();
  }
};

/**
 * Stage temperatures are saved on their source rows but edited on corrected stop rows. When GERG-2008
 * shows no corrected plan (an out-of-range stage temperature, or a bank limit no option meets), the
 * saved values still need an editor so a bad one can be fixed or cleared. Inputs commit on every
 * keystroke, so once someone is editing there the editor stays until focus leaves it: otherwise the
 * first digit that makes the plan valid (7 of 70) would close it.
 */
export const showStageTemperatureRecovery = (
  gasModel: GasModel,
  gasSources: GasSourceInput[],
  hasCorrectedPlan: boolean,
  editing = false
): boolean =>
  gasModel === "gerg2008" &&
  (editing || (!hasCorrectedPlan && gasSources.some((source) => source.enabled && source.stageTemperatureF !== undefined)));

/**
 * Rows the recovery editor lists: enabled rows with a saved stage temperature (the solver ignores
 * disabled rows), plus rows being edited that were just cleared.
 */
export const stageTemperatureRecoveryRows = (
  gasSources: GasSourceInput[],
  rowKeys: string[],
  editKeys: string[] | null
): number[] =>
  gasSources.flatMap((source, rowIndex) =>
    (source.enabled && source.stageTemperatureF !== undefined) || (editKeys?.includes(rowKeys[rowIndex] ?? source.id) ?? false)
      ? [rowIndex]
      : []
  );

type StageTemperatureRecoveryProps = {
  gasSources: GasSourceInput[];
  rowKeys: string[];
  temperatureUnit: TemperatureUnit;
  onChange: (rowIndex: number, temperatureF: number | undefined) => void;
  onReset: () => void;
  editKeys?: string[] | null;
  onEditStart?: () => void;
  onEditEnd?: () => void;
};

export const StageTemperatureRecovery = ({
  gasSources,
  rowKeys,
  temperatureUnit,
  onChange,
  onReset,
  editKeys = null,
  onEditStart,
  onEditEnd
}: StageTemperatureRecoveryProps): JSX.Element => {
  const temperatureLabel = temperatureUnitLabel(temperatureUnit);
  return (
    <div
      className="cost-breakdown stage-temperature-recovery"
      onFocus={() => onEditStart?.()}
      onBlur={(event) => {
        if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
          onEditEnd?.();
        }
      }}
    >
      <div className="section-title">Stage Temperatures</div>
      <div className="table-note">
        These stage temperatures are saved on their source gases. If one is out of range, correct or clear it here.
      </div>
      <div className="real-gas-temperature-grid">
        {stageTemperatureRecoveryRows(gasSources, rowKeys, editKeys).map((rowIndex) => {
          const source = gasSources[rowIndex];
          return (
            <NumberInput
              key={rowKeys[rowIndex] ?? source.id}
              label={`Gas ${rowIndex + 1} Stage Temp (${temperatureLabel})`}
              step={1}
              value={source.stageTemperatureF === undefined ? undefined : toDisplayTemperature(source.stageTemperatureF, temperatureUnit)}
              onChange={(val) => onChange(rowIndex, val === undefined ? undefined : fromDisplayTemperature(val, temperatureUnit))}
              onKeyDown={selectTempOnEnter}
            />
          );
        })}
      </div>
      <button className="settings-button" type="button" onClick={onReset}>
        Reset stage temps
      </button>
    </div>
  );
};

const MultiGasTab = ({ settings, topOffOptions, trainingModeEnabled }: Props): JSX.Element => {
  const multiGas = useSessionStore((state) => state.multiGas);
  const setMultiGas = useSessionStore((state) => state.setMultiGas);
  const gasSources = multiGas.gasSources ?? EMPTY_GAS_SOURCES;
  const [gasSourceRowKeys, setGasSourceRowKeys] = useState<string[]>(() =>
    gasSources.map(() => createGasSourceRowKey())
  );
  const tankSizeCuFt = multiGas.tankSizeCuFt ?? settings.defaultTankSizeCuFt ?? 80;
  const tankRatedPressurePsi = multiGas.tankRatedPressurePsi ?? settings.tankRatedPressure ?? 3000;
  const startPressurePsi = fromDisplayPressure(multiGas.startPressure ?? 0, settings.pressureUnit);
  const targetHeRequested = (multiGas.targetHe ?? 0) > 0.000001;
  const useRealGas = settings.gasModel === "gerg2008";
  const fillOrderMode: MultiGasFillOrderMode = multiGas.fillOrderMode ?? "auto";
  const startTemperatureF = multiGas.startTemperatureF ?? DEFAULT_START_TEMPERATURE_F;
  const settledTemperatureF = multiGas.settledTemperatureF ?? DEFAULT_SETTLED_TEMPERATURE_F;
  const temperatureLabel = temperatureUnitLabel(settings.temperatureUnit);

  // Build available gas options from presets and custom banks
  const gasOptions = useMemo(() => {
    return [
      ...topOffOptions,
      ...trimixPresets
    ];
  }, [topOffOptions]);

  const sourceResolution = useMemo(
    () => resolveMultiGasSources(gasSources, gasOptions, settings.pressureUnit),
    [gasSources, gasOptions, settings.pressureUnit]
  );

  // Check if helium is available from any source
  const hasHeliumAvailable = (multiGas.startHe ?? 0) > 0 ||
    sourceResolution.idealSources.some((gas) => gas.he > 0);

  const updateField = (patch: Partial<MultiGasInput>): void => {
    setMultiGas({ ...multiGas, ...patch });
  };

  const updateGasSource = (index: number, patch: Partial<GasSourceInput>): void => {
    const newSources = [...gasSources];
    if (!newSources[index]) return;
    newSources[index] = { ...newSources[index], ...patch };
    updateField({ gasSources: newSources });
  };

  const addGasSource = (): void => {
    if (gasSources.length >= MAX_GAS_SOURCES) return;
    const newSource: GasSourceInput = { id: "air", enabled: true };
    setGasSourceRowKeys((current) => [...current, createGasSourceRowKey()]);
    updateField({ gasSources: [...gasSources, newSource] });
  };

  const removeGasSource = (index: number): void => {
    if (gasSources.length <= 1) return;
    setGasSourceRowKeys((current) => current.filter((_, sourceIndex) => sourceIndex !== index));
    const newSources = gasSources.filter((_, sourceIndex) => sourceIndex !== index);
    updateField({ gasSources: newSources });
  };

  const moveSource = (index: number, direction: -1 | 1): void => {
    const moved = moveGasSource(gasSources, gasSourceRowKeys, index, direction);
    if (moved.sources === gasSources) return;
    setGasSourceRowKeys(moved.rowKeys);
    updateField({ gasSources: moved.sources });
  };

  // Start/Settled Temp fields the user has emptied stay empty until a number is typed or focus
  // leaves, instead of refilling with the default mid-edit (which made a leading "-" impossible).
  const clearableTemperatures = useClearableNumber<"startTemperatureF" | "settledTemperatureF">();
  const updateTemperatureField = (
    key: "startTemperatureF" | "settledTemperatureF",
    value: number | undefined
  ): void => {
    clearableTemperatures.track(key, value);
    updateField({ [key]: value === undefined ? undefined : fromDisplayTemperature(value, settings.temperatureUnit) });
  };

  // Stop-row Stage Temp fields the user has emptied. An emptied field is a local draft: it stays
  // empty until a number is typed or focus leaves, instead of refilling with the inherited
  // temperature mid-edit (which also made a leading "-" impossible to type). The saved temperature
  // is kept meanwhile, so a plan that needs it stays on screen while its replacement is typed; it
  // is cleared only if the field is left empty.
  const [clearedStageTemperatureIds, setClearedStageTemperatureIds] = useState<string[]>([]);
  const updateStageTemperature = (sourceId: string | undefined, value: number | undefined): void => {
    const rowIndex = sourceId === undefined ? undefined : sourceResolution.rowIndexById.get(sourceId);
    if (sourceId === undefined || rowIndex === undefined) return;
    if (value === undefined) {
      setClearedStageTemperatureIds((ids) => [...ids.filter((id) => id !== sourceId), sourceId]);
      return;
    }
    setClearedStageTemperatureIds((ids) => ids.filter((id) => id !== sourceId));
    updateGasSource(rowIndex, { stageTemperatureF: fromDisplayTemperature(value, settings.temperatureUnit) });
  };
  const endStageTemperatureEdit = (sourceId: string | undefined): void => {
    if (sourceId === undefined || !clearedStageTemperatureIds.includes(sourceId)) return;
    setClearedStageTemperatureIds((ids) => ids.filter((id) => id !== sourceId));
    const rowIndex = sourceResolution.rowIndexById.get(sourceId);
    if (rowIndex !== undefined) {
      updateGasSource(rowIndex, { stageTemperatureF: undefined });
    }
  };

  // Row keys of the recovery editor's rows while someone is editing there; null otherwise.
  const [recoveryEditKeys, setRecoveryEditKeys] = useState<string[] | null>(null);
  const resetStageTemperatures = (): void => {
    setRecoveryEditKeys(null);
    updateField({ gasSources: clearStageTemperatures(gasSources) });
  };

  const stageTemperatureDisplay = (sourceId: string | undefined, resolvedTemperatureF: number): number | undefined => {
    if (sourceId !== undefined && clearedStageTemperatureIds.includes(sourceId)) {
      return undefined;
    }
    const rowIndex = sourceId === undefined ? undefined : sourceResolution.rowIndexById.get(sourceId);
    const ownTemperatureF = rowIndex === undefined ? undefined : gasSources[rowIndex]?.stageTemperatureF;
    return toDisplayTemperature(ownTemperatureF ?? resolvedTemperatureF, settings.temperatureUnit);
  };

  // Cost settings from app settings
  const costSettings = useMemo<CostSettings>(() => ({
    pricePerCuFtO2: settings.pricePerCuFtO2 ?? 1.0,
    pricePerCuFtHe: settings.pricePerCuFtHe ?? 3.5,
    pricePerCuFtTopOff: settings.pricePerCuFtTopOff ?? 0.1,
    tankSizeCuFt,
    tankRatedPressure: tankRatedPressurePsi
  }), [
    settings.pricePerCuFtTopOff,
    settings.pricePerCuFtHe,
    settings.pricePerCuFtO2,
    tankRatedPressurePsi,
    tankSizeCuFt
  ]);

  const targetHeForSolve = hasHeliumAvailable ? (multiGas.targetHe ?? 0) : 0;

  // Compute blend result. The ideal plan always runs: it is the plan in ideal mode, the fallback when
  // GERG-2008 cannot evaluate the inputs, and the Training Mode hand check.
  // Stage temperatures change the rows but not the ideal sources, so key the ideal solve on the
  // sources' content: typing a Stage Temp then does not rerun the ideal search.
  const idealSourcesKey = JSON.stringify(sourceResolution.idealSources);
  const idealSources = useMemo(() => JSON.parse(idealSourcesKey) as OptimizerGasSource[], [idealSourcesKey]);
  const blendResult = useMemo(() => {
    const enabledGases = idealSources;
    if (enabledGases.length === 0) {
      return null;
    }

    try {
      return solveNGasBlend(
        { pressureUnit: settings.pressureUnit },
        multiGas.targetPressure ?? 0,
        multiGas.targetO2 ?? 32,
        targetHeForSolve,
        multiGas.startPressure ?? 0,
        multiGas.startO2 ?? 21,
        multiGas.startHe ?? 0,
        enabledGases,
        costSettings
      );
    } catch (err) {
      logger.error("MultiGas calculation error:", err);
      return {
        success: false,
        alternatives: [],
        error: `Calculation error: ${err instanceof Error ? err.message : String(err)}`,
        warnings: []
      };
    }
  }, [
    idealSources,
    settings.pressureUnit,
    multiGas.targetPressure,
    multiGas.targetO2,
    targetHeForSolve,
    multiGas.startPressure,
    multiGas.startO2,
    multiGas.startHe,
    costSettings
  ]);

  const realGasResult = useMemo((): RealGasMultiGasResult | null => {
    if (!useRealGas || sourceResolution.realGasSources.length === 0) {
      return null;
    }
    try {
      return calculateRealGasMultiGasBlend(
        { pressureUnit: settings.pressureUnit },
        {
          startPressure: multiGas.startPressure ?? 0,
          targetPressure: multiGas.targetPressure ?? 0,
          startO2: multiGas.startO2 ?? 21,
          startHe: multiGas.startHe ?? 0,
          targetO2: multiGas.targetO2 ?? 32,
          targetHe: targetHeForSolve,
          tankSizeCuFt,
          tankRatedPressurePsi,
          startTemperatureF,
          settledTemperatureF,
          sources: sourceResolution.realGasSources,
          fillOrderMode
        },
        costSettings
      );
    } catch (err) {
      logger.error("MultiGas GERG-2008 calculation error:", err);
      return {
        success: false,
        failure: "gerg",
        alternatives: [],
        waterVolumeLiters: 0,
        warnings: [],
        errors: [`GERG-2008 calculation error: ${err instanceof Error ? err.message : String(err)}`]
      };
    }
  }, [
    useRealGas,
    sourceResolution,
    settings.pressureUnit,
    multiGas.startPressure,
    multiGas.targetPressure,
    multiGas.startO2,
    multiGas.startHe,
    multiGas.targetO2,
    targetHeForSolve,
    tankSizeCuFt,
    tankRatedPressurePsi,
    startTemperatureF,
    settledTemperatureF,
    fillOrderMode,
    costSettings
  ]);

  const planModel = selectMultiGasPlanModel(settings.gasModel, realGasResult);
  const showRealGasPlan = planModel === "gerg2008" && realGasResult !== null;

  const selectedIndex = useMemo(() => {
    const count = showRealGasPlan
      ? (realGasResult.success ? realGasResult.alternatives.length : 0)
      : (blendResult?.success ? blendResult.alternatives.length : 0);
    if (count === 0) return 0;
    return Math.min(multiGas.selectedAlternativeIndex ?? 0, count - 1);
  }, [blendResult, realGasResult, showRealGasPlan, multiGas.selectedAlternativeIndex]);

  const selectedAlternative: BlendAlternative | null = useMemo(() => {
    if (showRealGasPlan || !blendResult?.success || blendResult.alternatives.length === 0) return null;
    const alternative = blendResult.alternatives[selectedIndex] ?? null;
    return alternative
      ? applyFillOrderToAlternative(alternative, fillOrderMode, sourceResolution.idealSources.map((gas) => gas.id))
      : null;
  }, [blendResult, selectedIndex, showRealGasPlan, fillOrderMode, sourceResolution]);

  const selectedRealGasAlternative: RealGasMultiGasAlternative | null = useMemo(() => {
    if (!showRealGasPlan || !realGasResult.success) return null;
    return realGasResult.alternatives[selectedIndex] ?? null;
  }, [realGasResult, selectedIndex, showRealGasPlan]);

  // The hand check always uses ideal pressure points; in GERG-2008 mode it checks the ideal option
  // that adds the same gases as the selected corrected plan.
  const trainingAlternative: BlendAlternative | null = useMemo(() => {
    if (selectedRealGasAlternative) {
      return blendResult?.success
        ? findMatchingIdealAlternative(blendResult.alternatives, selectedRealGasAlternative)
        : null;
    }
    return selectedAlternative;
  }, [blendResult, selectedAlternative, selectedRealGasAlternative]);

  const selectAlternative = (index: number): void => {
    updateField({ selectedAlternativeIndex: index });
  };

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(2)}`;
  };

  const formatGasVolumeFromPressure = (pressurePsi: number): string => {
    const volumeCuFt = pressureToCuFt(pressurePsi, tankSizeCuFt, tankRatedPressurePsi);
    const volumeLiters = cuFtToLiters(volumeCuFt);
    return formatGasVolume(volumeCuFt, volumeLiters);
  };

  const formatRealGasVolume = (volumeCuFt: number): string => formatGasVolume(volumeCuFt, cuFtToLiters(volumeCuFt));

  const trainingMath = useMemo(() => {
    if (!trainingModeEnabled || !trainingAlternative) {
      return null;
    }

    const targetPressurePsi = fromDisplayPressure(multiGas.targetPressure ?? 0, settings.pressureUnit);
    const bleedStep = trainingAlternative.fillOrder.find((step) => step.amount < 0);
    const effectiveStartPressurePsi = Math.max(0, startPressurePsi + (bleedStep?.amount ?? 0));
    const startO2Fraction = (multiGas.startO2 ?? 21) / 100;
    const startHeFraction = (multiGas.startHe ?? 0) / 100;
    const startN2Fraction = Math.max(0, 1 - startO2Fraction - startHeFraction);

    const sourceRows = trainingAlternative.steps.map((step) => {
      const o2Fraction = step.gas.o2 / 100;
      const heFraction = step.gas.he / 100;
      const n2Fraction = Math.max(0, 1 - o2Fraction - heFraction);
      const n2Percent = Math.max(0, 100 - step.gas.o2 - step.gas.he);
      const amountDisplay = toDisplayPressure(step.amount, settings.pressureUnit);
      return {
        id: step.gas.id,
        name: step.gas.name,
        amountPsi: step.amount,
        amountDisplay,
        o2Percent: step.gas.o2,
        hePercent: step.gas.he,
        n2Percent,
        o2Psi: step.amount * o2Fraction,
        hePsi: step.amount * heFraction,
        n2Psi: step.amount * n2Fraction,
        o2PointsDisplay: amountDisplay * step.gas.o2,
        hePointsDisplay: amountDisplay * step.gas.he,
        n2PointsDisplay: amountDisplay * n2Percent,
        o2Fraction,
        heFraction,
        n2Fraction
      };
    });

    const startO2Psi = effectiveStartPressurePsi * startO2Fraction;
    const startHePsi = effectiveStartPressurePsi * startHeFraction;
    const startN2Psi = effectiveStartPressurePsi * startN2Fraction;
    const totalO2Psi = sourceRows.reduce((sum, row) => sum + row.o2Psi, startO2Psi);
    const totalHePsi = sourceRows.reduce((sum, row) => sum + row.hePsi, startHePsi);
    const totalN2Psi = sourceRows.reduce((sum, row) => sum + row.n2Psi, startN2Psi);
    const addedPressurePsi = targetPressurePsi - effectiveStartPressurePsi;
    const targetO2Percent = trainingAlternative.finalO2;
    const targetHePercent = trainingAlternative.finalHe;
    const startO2Percent = multiGas.startO2 ?? 21;
    const startHePercent = multiGas.startHe ?? 0;
    const startO2Points = effectiveStartPressurePsi * startO2Percent;
    const startHePoints = effectiveStartPressurePsi * startHePercent;
    const targetO2Points = targetPressurePsi * targetO2Percent;
    const targetHePoints = targetPressurePsi * targetHePercent;
    const startPressureDisplay = toDisplayPressure(effectiveStartPressurePsi, settings.pressureUnit);
    const targetPressureDisplay = toDisplayPressure(targetPressurePsi, settings.pressureUnit);
    const addedPressureDisplay = toDisplayPressure(addedPressurePsi, settings.pressureUnit);
    const startO2PointsDisplay = startPressureDisplay * startO2Percent;
    const startHePointsDisplay = startPressureDisplay * startHePercent;
    const startN2PointsDisplay = startPressureDisplay * startN2Fraction * 100;
    const targetO2PointsDisplay = targetPressureDisplay * targetO2Percent;
    const targetHePointsDisplay = targetPressureDisplay * targetHePercent;
    const totalO2PointsDisplay = toDisplayPressure(totalO2Psi, settings.pressureUnit) * 100;
    const totalHePointsDisplay = toDisplayPressure(totalHePsi, settings.pressureUnit) * 100;
    const totalN2PointsDisplay = toDisplayPressure(totalN2Psi, settings.pressureUnit) * 100;
    const neededAddedO2Percent = addedPressurePsi > 0
      ? (targetO2Points - startO2Points) / addedPressurePsi
      : 0;
    const neededAddedHePercent = addedPressurePsi > 0
      ? (targetHePoints - startHePoints) / addedPressurePsi
      : 0;
    const nitroxPearsonRows = sourceRows.length === 2 &&
      Math.abs(startHePsi) <= 0.000001 &&
      Math.abs(targetHePoints) <= 0.000001 &&
      sourceRows.every((row) => row.hePercent <= 0.000001);
    const pearsonRows = nitroxPearsonRows
      ? [...sourceRows].sort((a, b) => b.o2Percent - a.o2Percent)
      : [];
    const highSource = pearsonRows[0];
    const lowSource = pearsonRows[1];
    const highSourceParts = highSource && lowSource ? neededAddedO2Percent - lowSource.o2Percent : 0;
    const lowSourceParts = highSource && lowSource ? highSource.o2Percent - neededAddedO2Percent : 0;
    const totalPearsonParts = highSourceParts + lowSourceParts;
    const pearson = highSource && lowSource &&
      addedPressurePsi > 0 &&
      totalPearsonParts > 0.000001 &&
      highSourceParts >= -0.000001 &&
      lowSourceParts >= -0.000001
      ? {
          highSource,
          lowSource,
          highSourceParts,
          lowSourceParts,
          totalPearsonParts,
          highSourcePressurePsi: addedPressurePsi * highSourceParts / totalPearsonParts,
          lowSourcePressurePsi: addedPressurePsi * lowSourceParts / totalPearsonParts
        }
      : null;
    const startContribution = effectiveStartPressurePsi > 0.000001
      ? {
          id: "start",
          name: "Start tank",
          amountPsi: effectiveStartPressurePsi,
          amountDisplay: startPressureDisplay,
          o2Percent: startO2Percent,
          hePercent: startHePercent,
          n2Percent: startN2Fraction * 100,
          o2Psi: startO2Psi,
          hePsi: startHePsi,
          n2Psi: startN2Psi,
          o2PointsDisplay: startO2PointsDisplay,
          hePointsDisplay: startHePointsDisplay,
          n2PointsDisplay: startN2PointsDisplay,
          o2Fraction: startO2Fraction,
          heFraction: startHeFraction,
          n2Fraction: startN2Fraction
        }
      : null;
    const contributionRows = startContribution ? [startContribution, ...sourceRows] : sourceRows;
    const trimixBalance = pearson === null &&
      (Math.abs(targetHePercent) > 0.000001 ||
        Math.abs(startHePercent) > 0.000001 ||
        sourceRows.some((row) => row.hePercent > 0.000001));

    return {
      alternative: trainingAlternative,
      bleedStep,
      effectiveStartPressurePsi,
      targetPressurePsi,
      addedPressurePsi,
      startO2Fraction,
      startHeFraction,
      startN2Fraction,
      startO2Psi,
      startHePsi,
      startN2Psi,
      startO2Percent,
      startHePercent,
      targetO2Percent,
      targetHePercent,
      startO2Points,
      startHePoints,
      targetO2Points,
      targetHePoints,
      startO2PointsDisplay,
      startHePointsDisplay,
      startN2PointsDisplay,
      targetO2PointsDisplay,
      targetHePointsDisplay,
      totalO2PointsDisplay,
      totalHePointsDisplay,
      totalN2PointsDisplay,
      targetPressureDisplay,
      addedPressureDisplay,
      neededAddedO2Percent,
      neededAddedHePercent,
      pearson,
      trimixBalance,
      sourceRows,
      contributionRows,
      totalO2Psi,
      totalHePsi,
      totalN2Psi
    };
  }, [
    multiGas.startHe,
    multiGas.startO2,
    multiGas.targetPressure,
    trainingAlternative,
    settings.pressureUnit,
    startPressurePsi,
    trainingModeEnabled
  ]);

  const fillOrderNote = fillOrderMode === "manual"
    ? "Gases are added from the top of the list down. Amounts stay the same in any order; only the stop pressures change."
    : "Gases are added in the recommended order: helium, then oxygen, then richer mixes, then Air.";
  const bankLimitNote = useRealGas
    ? "Limits the real-gas pressure rise this source adds, at its stage temperature and fill position. Leave blank for no limit."
    : undefined;

  const trainingPanel = trainingModeEnabled && (trainingMath || selectedRealGasAlternative) ? (
    <TrainingMathPanel
      title="Multi-Gas Hand Check"
      note="This shows the classroom pressure-percent check for the selected option. The app may search more combinations, but the selected fill can still be checked by hand."
    >
      {useRealGas && (
        <div className="training-math-note">
          {selectedRealGasAlternative && !trainingMath
            ? "GERG-2008 is selected. No ideal option uses the same source gases as this corrected plan, so there is no hand check for it."
            : selectedRealGasAlternative
              ? "GERG-2008 is selected. The corrected stops above include compressibility and stage temperatures; this hand check uses the ideal pressure-point balance for the same source gases, so its pressures differ."
              : "GERG-2008 is selected. This hand check uses the ideal pressure-point balance."}
        </div>
      )}
      {trainingMath && (
        <>
                      {trainingMath.bleedStep !== undefined && (
                        <p>
                          This option starts with a bleed-down from {formatPressure(startPressurePsi, settings.pressureUnit)} to {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} before adding source gases.
                        </p>
                      )}
                      <div className="training-math-section">
                        <h4>Needed added gas</h4>
                        <ul>
                          <li>Added pressure = target - start = {formatPressure(trainingMath.targetPressurePsi, settings.pressureUnit)} - {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} = {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)}</li>
                          <li>Needed added O2% = (target O2 points - start O2 points) / added pressure = ({formatNumber(trainingMath.targetO2PointsDisplay, 0)} - {formatNumber(trainingMath.startO2PointsDisplay, 0)}) / {formatNumber(trainingMath.addedPressureDisplay, 1)} = {formatNumber(trainingMath.neededAddedO2Percent, 1)}%</li>
                          {Math.abs(trainingMath.targetHePercent) > 0.000001 || Math.abs(trainingMath.startHePercent) > 0.000001 ? (
                            <li>Needed added He% = (target He points - start He points) / added pressure = ({formatNumber(trainingMath.targetHePointsDisplay, 0)} - {formatNumber(trainingMath.startHePointsDisplay, 0)}) / {formatNumber(trainingMath.addedPressureDisplay, 1)} = {formatNumber(trainingMath.neededAddedHePercent, 1)}%</li>
                          ) : (
                            <li>No helium target is present, so this can be checked as a nitrox alligation problem when two source gases are selected.</li>
                          )}
                        </ul>
                      </div>
                      <div className="training-math-section">
                        {trainingMath.pearson ? (
                          <>
                            <h4>Pearson square</h4>
                            <div className="formula-sheet formula-sheet-compact" aria-label="Pearson square visual formula worksheet">
                              <div className="formula-step">
                                <span className="formula-step-label">Step 1</span>
                                <div className="formula-equation">
                                  <span>Needed O2%</span>
                                  <span>=</span>
                                  <span className="formula-fraction">
                                    <span>{formatNumber(trainingMath.targetO2PointsDisplay, 0)} - {formatNumber(trainingMath.startO2PointsDisplay, 0)}</span>
                                    <span>{formatNumber(trainingMath.addedPressureDisplay, 1)}</span>
                                  </span>
                                  <span>=</span>
                                  <strong>{formatNumber(trainingMath.neededAddedO2Percent, 1)}%</strong>
                                </div>
                              </div>
                              <div className="formula-step">
                                <span className="formula-step-label">Step 2</span>
                                <div className="formula-mini-grid">
                                  <div className="formula-mini">
                                    <span>{trainingMath.pearson.highSource.name} parts</span>
                                    <strong>{formatNumber(trainingMath.pearson.highSourceParts, 1)}</strong>
                                  </div>
                                  <div className="formula-mini">
                                    <span>{trainingMath.pearson.lowSource.name} parts</span>
                                    <strong>{formatNumber(trainingMath.pearson.lowSourceParts, 1)}</strong>
                                  </div>
                                </div>
                              </div>
                              <div className="formula-step">
                                <span className="formula-step-label">Step 3</span>
                                <div className="formula-equation">
                                  <span>Source add</span>
                                  <span>=</span>
                                  <span className="formula-fraction">
                                    <span>Added P x parts</span>
                                    <span>Total parts</span>
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="pearson-square" aria-label="Pearson square visual check">
                              <svg className="pearson-square-lines" aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none">
                                <line x1="16" y1="27" x2="84" y2="73" />
                                <line x1="16" y1="73" x2="84" y2="27" />
                              </svg>
                              <div className="pearson-square-node pearson-square-source pearson-square-source-high">
                                <span className="pearson-square-label">{trainingMath.pearson.highSource.name}</span>
                                <strong>{formatNumber(trainingMath.pearson.highSource.o2Percent, 1)}%</strong>
                              </div>
                              <div className="pearson-square-node pearson-square-source pearson-square-source-low">
                                <span className="pearson-square-label">{trainingMath.pearson.lowSource.name}</span>
                                <strong>{formatNumber(trainingMath.pearson.lowSource.o2Percent, 1)}%</strong>
                              </div>
                              <div className="pearson-square-target">
                                <span>Needed</span>
                                <strong>{formatNumber(trainingMath.neededAddedO2Percent, 1)}%</strong>
                              </div>
                              <div className="pearson-square-node pearson-square-parts pearson-square-parts-high">
                                <span className="pearson-square-label">Parts</span>
                                <strong>{formatNumber(trainingMath.pearson.highSourceParts, 1)}</strong>
                              </div>
                              <div className="pearson-square-node pearson-square-parts pearson-square-parts-low">
                                <span className="pearson-square-label">Parts</span>
                                <strong>{formatNumber(trainingMath.pearson.lowSourceParts, 1)}</strong>
                              </div>
                            </div>
                            <div className="pearson-square-adds">
                              <span>{trainingMath.pearson.highSource.name}: {formatPressure(trainingMath.pearson.highSourcePressurePsi, settings.pressureUnit)}</span>
                              <span>{trainingMath.pearson.lowSource.name}: {formatPressure(trainingMath.pearson.lowSourcePressurePsi, settings.pressureUnit)}</span>
                            </div>
                            <ul>
                              <li>Reference formula: P FMx = ((FW - FTMx) / (FMx - FTMx)) x fill pressure.</li>
                              <li>FW = needed O2% = {formatNumber(trainingMath.neededAddedO2Percent, 1)}%; FMx = {trainingMath.pearson.highSource.name} at {formatNumber(trainingMath.pearson.highSource.o2Percent, 1)}%; FTMx = {trainingMath.pearson.lowSource.name} at {formatNumber(trainingMath.pearson.lowSource.o2Percent, 1)}%.</li>
                              <li>P FMx = (({formatNumber(trainingMath.neededAddedO2Percent, 1)} - {formatNumber(trainingMath.pearson.lowSource.o2Percent, 1)}) / ({formatNumber(trainingMath.pearson.highSource.o2Percent, 1)} - {formatNumber(trainingMath.pearson.lowSource.o2Percent, 1)})) x {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} = {formatPressure(trainingMath.pearson.highSourcePressurePsi, settings.pressureUnit)}</li>
                              <li>Top-off mix pressure = fill pressure - P FMx = {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} - {formatPressure(trainingMath.pearson.highSourcePressurePsi, settings.pressureUnit)} = {formatPressure(trainingMath.pearson.lowSourcePressurePsi, settings.pressureUnit)}</li>
                              <li>High source: {trainingMath.pearson.highSource.name} at {formatNumber(trainingMath.pearson.highSource.o2Percent, 1)}% O2.</li>
                              <li>Low source: {trainingMath.pearson.lowSource.name} at {formatNumber(trainingMath.pearson.lowSource.o2Percent, 1)}% O2.</li>
                              <li>High-source parts = needed O2% - low O2% = {formatNumber(trainingMath.neededAddedO2Percent, 1)} - {formatNumber(trainingMath.pearson.lowSource.o2Percent, 1)} = {formatNumber(trainingMath.pearson.highSourceParts, 1)}</li>
                              <li>Low-source parts = high O2% - needed O2% = {formatNumber(trainingMath.pearson.highSource.o2Percent, 1)} - {formatNumber(trainingMath.neededAddedO2Percent, 1)} = {formatNumber(trainingMath.pearson.lowSourceParts, 1)}</li>
                              <li>{trainingMath.pearson.highSource.name} add = added pressure x high parts / total parts = {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.pearson.highSourceParts, 1)} / {formatNumber(trainingMath.pearson.totalPearsonParts, 1)} = {formatPressure(trainingMath.pearson.highSourcePressurePsi, settings.pressureUnit)}</li>
                              <li>{trainingMath.pearson.lowSource.name} add = added pressure x low parts / total parts = {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.pearson.lowSourceParts, 1)} / {formatNumber(trainingMath.pearson.totalPearsonParts, 1)} = {formatPressure(trainingMath.pearson.lowSourcePressurePsi, settings.pressureUnit)}</li>
                            </ul>
                          </>
                        ) : trainingMath.trimixBalance ? (
                          <>
                            <h4>Trimix balance check</h4>
                            <div className="training-math-note">
                              Helium blends balance O2 and He at the same time, so the hand check uses pressure points instead of a one-axis Pearson square.
                            </div>
                            <div className="formula-sheet formula-sheet-compact" aria-label="Trimix visual formula worksheet">
                              <div className="formula-step">
                                <span className="formula-step-label">Step 1</span>
                                <div className="formula-mini-grid">
                                  <div className="formula-mini">
                                    <span>Needed added O2</span>
                                    <strong>{formatNumber(trainingMath.neededAddedO2Percent, 1)}%</strong>
                                  </div>
                                  <div className="formula-mini">
                                    <span>Needed added He</span>
                                    <strong>{formatNumber(trainingMath.neededAddedHePercent, 1)}%</strong>
                                  </div>
                                </div>
                              </div>
                              <div className="formula-step">
                                <span className="formula-step-label">Step 2</span>
                                <div className="formula-equation">
                                  <span>Gas points</span>
                                  <span>=</span>
                                  <span>source pressure x gas percent</span>
                                </div>
                              </div>
                              <div className="formula-step">
                                <span className="formula-step-label">Step 3</span>
                                <div className="formula-equation">
                                  <span>Final gas %</span>
                                  <span>=</span>
                                  <span className="formula-fraction">
                                    <span>total pressure-points</span>
                                    <span>target pressure</span>
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="trimix-balance-grid" aria-label="Trimix O2 and helium pressure point check">
                              {trainingMath.contributionRows.map((row) => (
                                <div key={`${row.id}-${row.amountPsi.toFixed(6)}`} className="trimix-balance-card">
                                  <div className="trimix-balance-title">
                                    <span>{row.name}</span>
                                    <strong>{formatPressure(row.amountPsi, settings.pressureUnit)}</strong>
                                  </div>
                                  <div className="trimix-balance-points">
                                    <div>
                                      <span>O2</span>
                                      <strong>{formatNumber(row.o2PointsDisplay, 0)}</strong>
                                      <small>{formatNumber(row.amountDisplay, 1)} x {formatNumber(row.o2Percent, 1)}%</small>
                                    </div>
                                    <div>
                                      <span>He</span>
                                      <strong>{formatNumber(row.hePointsDisplay, 0)}</strong>
                                      <small>{formatNumber(row.amountDisplay, 1)} x {formatNumber(row.hePercent, 1)}%</small>
                                    </div>
                                    <div>
                                      <span>N2</span>
                                      <strong>{formatNumber(row.n2PointsDisplay, 0)}</strong>
                                      <small>{formatNumber(row.amountDisplay, 1)} x {formatNumber(row.n2Percent, 1)}%</small>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                            <ul>
                              <li>Needed added O2% = ({formatNumber(trainingMath.targetO2PointsDisplay, 0)} - {formatNumber(trainingMath.startO2PointsDisplay, 0)}) / {formatNumber(trainingMath.addedPressureDisplay, 1)} = {formatNumber(trainingMath.neededAddedO2Percent, 1)}%</li>
                              <li>Needed added He% = ({formatNumber(trainingMath.targetHePointsDisplay, 0)} - {formatNumber(trainingMath.startHePointsDisplay, 0)}) / {formatNumber(trainingMath.addedPressureDisplay, 1)} = {formatNumber(trainingMath.neededAddedHePercent, 1)}%</li>
                              <li>Final O2% = total O2 points / target pressure = {formatNumber(trainingMath.totalO2PointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(trainingMath.alternative.finalO2, 1)}%</li>
                              <li>Final He% = total He points / target pressure = {formatNumber(trainingMath.totalHePointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(trainingMath.alternative.finalHe, 1)}%</li>
                              <li>Final N2% = total N2 points / target pressure = {formatNumber(trainingMath.totalN2PointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(Math.max(0, 100 - trainingMath.alternative.finalO2 - trainingMath.alternative.finalHe), 1)}%</li>
                            </ul>
                          </>
                        ) : (
                          <>
                            <h4>Source point check</h4>
                            <ul>
                              {trainingMath.sourceRows.map((row) => (
                                <li key={`${row.id}-${row.amountPsi.toFixed(6)}`}>
                                  {row.name}: {formatPressure(row.amountPsi, settings.pressureUnit)} x {formatNumber(row.o2Percent, 1)}% O2 / {formatNumber(row.hePercent, 1)}% He / {formatNumber(row.n2Percent, 1)}% N2
                                </li>
                              ))}
                              <li>Final O2% = total O2 points / target pressure = {formatNumber(trainingMath.totalO2PointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(trainingMath.alternative.finalO2, 1)}%</li>
                              <li>Final He% = total He points / target pressure = {formatNumber(trainingMath.totalHePointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(trainingMath.alternative.finalHe, 1)}%</li>
                              <li>Final N2% = total N2 points / target pressure = {formatNumber(trainingMath.totalN2PointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(Math.max(0, 100 - trainingMath.alternative.finalO2 - trainingMath.alternative.finalHe), 1)}%</li>
                            </ul>
                          </>
                        )}
                      </div>
        </>
      )}
    </TrainingMathPanel>
  ) : null;

  const stageTemperatureRecovery = showStageTemperatureRecovery(
    settings.gasModel,
    gasSources,
    selectedRealGasAlternative !== null,
    recoveryEditKeys !== null
  ) ? (
    <StageTemperatureRecovery
      gasSources={gasSources}
      rowKeys={gasSourceRowKeys}
      temperatureUnit={settings.temperatureUnit}
      onChange={(rowIndex, temperatureF) => updateGasSource(rowIndex, { stageTemperatureF: temperatureF })}
      onReset={resetStageTemperatures}
      editKeys={recoveryEditKeys}
      onEditStart={() =>
        setRecoveryEditKeys((keys) =>
          keys ?? stageTemperatureRecoveryRows(gasSources, gasSourceRowKeys, null).map((rowIndex) => gasSourceRowKeys[rowIndex] ?? gasSources[rowIndex].id)
        )
      }
      onEditEnd={() => setRecoveryEditKeys(null)}
    />
  ) : null;

  return (
    <ErrorBoundary fallback={<div className="error">MultiGasTab crashed. Please check the console for details.</div>}>
      <AccordionItem title="Start Tank" defaultOpen={true}>
        <div className="grid two">
          <NumberInput
            label="Start O2 %"
            min={0}
            max={100}
            step={0.1}
            value={multiGas.startO2}
            onChange={(val) => updateField({ startO2: val })}
          />
          <NumberInput
            label="Start He %"
            min={0}
            max={100}
            step={0.1}
            value={multiGas.startHe}
            onChange={(val) => updateField({ startHe: val })}
          />
          <NumberInput
            label={`Start Pressure (${settings.pressureUnit.toUpperCase()})`}
            min={0}
            step={settings.pressureUnit === "psi" ? 10 : 1}
            value={multiGas.startPressure}
            onChange={(val) => updateField({ startPressure: val })}
          />
          {useRealGas && (
            <NumberInput
              label={`Start Temp (${temperatureLabel})`}
              step={1}
              value={clearableTemperatures.display("startTemperatureF", toDisplayTemperature(startTemperatureF, settings.temperatureUnit))}
              onBlur={() => clearableTemperatures.endEdit("startTemperatureF")}
              onChange={(val) => updateTemperatureField("startTemperatureF", val)}
              onKeyDown={selectTempOnEnter}
            />
          )}
        </div>
      </AccordionItem>

      <AccordionItem title="Tank Context" defaultOpen={false}>
        <TankContextFields
          tankSizeCuFt={multiGas.tankSizeCuFt}
          tankRatedPressurePsi={multiGas.tankRatedPressurePsi}
          defaultTankSizeCuFt={settings.defaultTankSizeCuFt}
          defaultTankRatedPressurePsi={settings.tankRatedPressure}
          onChange={(patch) => setMultiGas({ ...multiGas, ...patch })}
        />
      </AccordionItem>

      <AccordionItem title="Source Gases" defaultOpen={true}>
        <SelectInput
          label="Fill Order"
          value={fillOrderMode}
          onChange={(event) => updateField({ fillOrderMode: event.target.value === "manual" ? "manual" : "auto" })}
        >
          <option value="auto">Auto (recommended)</option>
          <option value="manual">My order (top to bottom)</option>
        </SelectInput>
        <div className="table-note">{fillOrderNote}</div>
        <hr className="gas-source-divider" />
        {gasSources.map((source, index) => (
          <GasSourceRow
            key={gasSourceRowKeys[index] ?? source.id}
            index={index}
            source={source}
            baseOptions={gasOptions}
            onUpdate={updateGasSource}
            onRemove={removeGasSource}
            canRemove={gasSources.length > 1}
            showDivider={index < gasSources.length - 1}
            pressureUnit={settings.pressureUnit}
            showMoveControls={fillOrderMode === "manual" && gasSources.length > 1}
            canMoveUp={index > 0}
            canMoveDown={index < gasSources.length - 1}
            onMove={moveSource}
            bankLimitNote={bankLimitNote}
          />
        ))}
        <div className="table-note">Set bank pressure limits per source to constrain optimization to currently available gas.</div>
        {gasSources.length < MAX_GAS_SOURCES && (
          <button type="button" className="add-gas-btn" onClick={addGasSource}>
            + Add Gas Source
          </button>
        )}
      </AccordionItem>

      <AccordionItem title="Target Blend" defaultOpen={true}>
        <div className="grid two">
          <NumberInput
            label="Target O2 %"
            min={0}
            max={100}
            step={0.1}
            value={multiGas.targetO2}
            onChange={(val) => updateField({ targetO2: val })}
          />
          <div>
            <NumberInput
              label="Target He %"
              min={0}
              max={100}
              step={0.1}
              value={hasHeliumAvailable ? multiGas.targetHe : 0}
              disabled={!hasHeliumAvailable}
              onChange={(val) => updateField({ targetHe: val })}
            />
            {!hasHeliumAvailable && targetHeRequested && (
              <div className="table-note">No helium source available. Add a trimix gas or helium to the start tank.</div>
            )}
          </div>
          <NumberInput
            label={`Target Pressure (${settings.pressureUnit.toUpperCase()})`}
            min={0}
            step={settings.pressureUnit === "psi" ? 10 : 1}
            value={multiGas.targetPressure}
            onChange={(val) => updateField({ targetPressure: val })}
          />
          {useRealGas && (
            <NumberInput
              label={`Settled Temp (${temperatureLabel})`}
              step={1}
              value={clearableTemperatures.display("settledTemperatureF", toDisplayTemperature(settledTemperatureF, settings.temperatureUnit))}
              onBlur={() => clearableTemperatures.endEdit("settledTemperatureF")}
              onChange={(val) => updateTemperatureField("settledTemperatureF", val)}
              onKeyDown={selectTempOnEnter}
            />
          )}
        </div>
        {useRealGas && (
          <div className="table-note">Target pressure is the settled pressure once the cylinder reaches Settled Temp.</div>
        )}
      </AccordionItem>

      {(showRealGasPlan || blendResult) && (
        // One section for both models, with the recovery editor in a fixed slot: switching from the
        // ideal fallback to the corrected plan mid-edit must not remount the input being typed in.
        <AccordionItem title="Blend Options" defaultOpen={true}>
          {showRealGasPlan ? (
            !realGasResult.success && realGasResult.errors.map((error) => (
              <div key={error} className="error">{error}</div>
            ))
          ) : (
            planModel === "idealFallback" && realGasResult && !realGasResult.success && (
              <div className="warnings">
                {realGasResult.errors.map((error) => (
                  <div key={error} className="warning">{error}</div>
                ))}
                <div className="table-note">Showing the ideal partial-pressure plan instead.</div>
              </div>
            )
          )}
          {stageTemperatureRecovery}

          {showRealGasPlan ? (
            <>
              {realGasResult.success && realGasResult.alternatives.length > 0 && (
                <>
                  <div className="alternatives-list">
                    {realGasResult.alternatives.map((alt, index) => (
                      <div
                        key={realGasAlternativeKey(alt)}
                        className={`alternative-option ${index === selectedIndex ? 'selected' : ''}`}
                        onClick={() => selectAlternative(index)}
                      >
                        <div className="alternative-header">
                          <input
                            type="radio"
                            name="blend-alternative"
                            aria-label={`Option ${index + 1}`}
                            checked={index === selectedIndex}
                            onChange={() => selectAlternative(index)}
                          />
                          <span className="alternative-title">Option {index + 1}</span>
                          <span className="alternative-cost">{formatCost(alt.estimatedCost)}</span>
                        </div>
                        <div className="alternative-gases">
                          {alt.costBreakdown.map((item) => (
                            <span key={costLineKey(item)} className="alternative-gas">
                              {item.gas}: {formatRealGasVolume(item.volumeCuFt)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedRealGasAlternative && (
                    <div className="fill-plan">
                      <h4>GERG-2008 Corrected Stops</h4>
                      <ol className="result-list">
                        {selectedRealGasAlternative.steps.map((step, index) => (
                          step.kind === "bleed" ? (
                            <li key={realGasStepKey(step)} className="real-gas-step bleed-step">
                              <div className="real-gas-step-main">
                                <span>
                                  {index + 1}. Drain to <strong>{formatPressure(step.stopPressurePsi, settings.pressureUnit, 1)}</strong>
                                </span>
                              </div>
                              <div className="real-gas-step-detail">
                                {formatSignedPressure(step.pressureChangePsi, settings.pressureUnit, 1)} at Start Temp, Z {formatNumber(step.z, 4)}
                              </div>
                            </li>
                          ) : (
                            <li key={realGasStepKey(step)} className="real-gas-step">
                              <div className="real-gas-step-main">
                                <span>
                                  {index + 1}. Add {step.gasName}: <strong>{formatPressure(step.stopPressurePsi, settings.pressureUnit, 1)}</strong>
                                </span>
                                <NumberInput
                                  className="stage-temperature-field"
                                  label={`Stage Temp (${temperatureLabel})`}
                                  step={1}
                                  value={stageTemperatureDisplay(step.sourceId, step.temperatureF)}
                                  onChange={(val) => updateStageTemperature(step.sourceId, val)}
                                  onBlur={() => endStageTemperatureEdit(step.sourceId)}
                                  onKeyDown={selectTempOnEnter}
                                />
                              </div>
                              <div className="real-gas-step-detail">
                                {formatSignedPressure(step.pressureChangePsi, settings.pressureUnit, 1)}, Z {formatNumber(step.z, 4)}, {formatRealGasVolume(step.volumeCuFt)}
                              </div>
                            </li>
                          )
                        ))}
                      </ol>
                      <div className="table-note">
                        Stage temps default to Start Temp. Enter a measured cylinder temperature on a stop row to update that stop and any following unedited stops.
                      </div>
                      {hasStageTemperatureOverrides(gasSources) && (
                        <button className="settings-button" type="button" onClick={resetStageTemperatures}>
                          Reset stage temps
                        </button>
                      )}
                      <div className="table-note">
                        Initial reference: {formatPressure(selectedRealGasAlternative.startHotPressurePsi, settings.pressureUnit, 1)}
                        {selectedRealGasAlternative.startZ !== undefined && <> (Z {formatNumber(selectedRealGasAlternative.startZ, 4)})</>}. Final stage stop: {formatPressure(selectedRealGasAlternative.finalHotPressurePsi, settings.pressureUnit, 1)} for settled target {formatPressure(selectedRealGasAlternative.settledPressurePsi, settings.pressureUnit, 1)} at {formatNumber(toDisplayTemperature(settledTemperatureF, settings.temperatureUnit), 1)} {temperatureLabel}.
                      </div>
                      <div className="table-note">
                        Resulting mix ≈ {selectedRealGasAlternative.finalO2.toFixed(2)}% O2 / {selectedRealGasAlternative.finalHe.toFixed(2)}% He
                      </div>
                      {selectedRealGasAlternative.warnings.length > 0 && (
                        <div className="warnings">
                          {selectedRealGasAlternative.warnings.map((warning) => (
                            <div key={warning} className="warning">{warning}</div>
                          ))}
                        </div>
                      )}
                      <div className="cost-summary">
                        Estimated cost: {formatCost(selectedRealGasAlternative.estimatedCost)}
                      </div>
                      <div className="cost-breakdown">
                        <div className="section-title">Cost Basis</div>
                        <div className="grid two">
                          {selectedRealGasAlternative.costBreakdown.map((line) => (
                            <div key={costLineKey(line)} className="cost-line">
                              <span>{line.gas}:</span>
                              <span>{formatRealGasVolume(line.volumeCuFt)} = {formatCost(line.cost)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="table-note">Tank basis: {formatNumber(tankSizeCuFt, 2)} cu ft @ {formatNumber(tankRatedPressurePsi, 0)} PSI.</div>
                        <div className="table-note">{formatFillCostBasis("gerg2008", settings.temperatureUnit)}</div>
                      </div>
                      {trainingPanel}
                    </div>
                  )}
                </>
              )}

              {realGasResult.warnings.length > 0 && (
                <div className="warnings">
                  {realGasResult.warnings.map((warning) => (
                    <div key={warning} className="warning">{warning}</div>
                  ))}
                </div>
              )}
            </>
          ) : blendResult && (
            <>
              {!blendResult.success && (
                <div className="error">{blendResult.error}</div>
              )}

              {blendResult.success && blendResult.alternatives.length > 0 && (
                <>
                  <div className="alternatives-list">
                    {blendResult.alternatives.map((alt, index) => (
                      <div
                        key={blendAlternativeKey(alt)}
                        className={`alternative-option ${index === selectedIndex ? 'selected' : ''}`}
                        onClick={() => selectAlternative(index)}
                      >
                        <div className="alternative-header">
                          <input
                            type="radio"
                            name="blend-alternative"
                            aria-label={`Option ${index + 1}`}
                            checked={index === selectedIndex}
                            onChange={() => selectAlternative(index)}
                          />
                          <span className="alternative-title">Option {index + 1}</span>
                          <span className="alternative-cost">{formatCost(alt.estimatedCost)}</span>
                        </div>
                        <div className="alternative-gases">
                          {alt.costBreakdown.map((item) => (
                            <span key={costLineKey(item)} className="alternative-gas">
                              {item.gas}: {formatGasVolumeFromPressure(item.amount)}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedAlternative && (
                    <div className="fill-plan">
                      <h4>Fill Order</h4>
                      <ol className="result-list">
                        {selectedAlternative.fillOrder.map((step, index) => {
                          let runningTotal = startPressurePsi;
                          for (let i = 0; i <= index; i++) {
                            runningTotal += selectedAlternative.fillOrder[i].amount;
                          }
                          runningTotal = Math.max(0, runningTotal);
                          const isBleed = step.amount < 0;
                          const action = isBleed ? "Drain" : "Add";
                          return (
                            <li key={`${step.gas}-${step.amount.toFixed(6)}-${runningTotal.toFixed(6)}`} className={isBleed ? "bleed-step" : ""}>
                              {index + 1}. {action} {step.gas}: {formatPressure(runningTotal, settings.pressureUnit)}
                              <span className="result-step-total">
                                ({formatSignedPressure(step.amount, settings.pressureUnit)}
                                {!isBleed ? `, ${formatGasVolumeFromPressure(step.amount)}` : ""})
                              </span>
                            </li>
                          );
                        })}
                      </ol>
                      <div className="table-note">
                        Resulting mix ≈ {selectedAlternative.finalO2.toFixed(1)}% O2 / {selectedAlternative.finalHe.toFixed(1)}% He
                      </div>
                      <div className="cost-summary">
                        Estimated cost: {formatCost(selectedAlternative.estimatedCost)}
                      </div>
                      <div className="cost-breakdown">
                        <div className="section-title">Cost Basis</div>
                        <div className="grid two">
                          {selectedAlternative.costBreakdown.map((line) => (
                            <div key={costLineKey(line)} className="cost-line">
                              <span>{line.gas}:</span>
                              <span>{formatGasVolumeFromPressure(line.amount)} = {formatCost(line.cost)}</span>
                            </div>
                          ))}
                        </div>
                        <div className="table-note">Tank basis: {formatNumber(tankSizeCuFt, 2)} cu ft @ {formatNumber(tankRatedPressurePsi, 0)} PSI.</div>
                        {planModel === "idealFallback" && (
                          <div className="table-note">{formatFillCostBasis("idealFallback", settings.temperatureUnit)}</div>
                        )}
                      </div>
                      {trainingPanel}
                    </div>
                  )}
                </>
              )}

              {blendResult.warnings.length > 0 && (
                <div className="warnings">
                  {blendResult.warnings.map((warning) => (
                    <div key={warning} className="warning">{warning}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </AccordionItem>
      )}
    </ErrorBoundary>
  );
};

export default MultiGasTab;
