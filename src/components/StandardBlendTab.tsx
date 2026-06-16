import { useEffect, useMemo, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import {
  useSessionStore,
  type SessionState,
  type StandardBlendInput,
  type StandardBlendHistoryEntry,
  type StandardBlendStageKind,
  type StandardBlendStageTemperatureTouched,
  type StandardBlendStageTemperaturesF
} from "../state/session";
import {
  calculateStandardBlend,
  type BlendResult,
  type GasSelection,
  summarizeBlendVolumes,
  solveRequiredStartPressure,
  solveMaxTargetWithoutHelium,
  calculateFillCostEstimate,
  clampPercent,
  clampPressure
} from "../utils/calculations";
import { formatNumber, formatPercentage, formatPressure, formatSignedPressure } from "../utils/format";
import { calculateRealGasStandardBlend, type RealGasBlendResult } from "../utils/realGasBlend";
import {
  DEFAULT_SETTLED_TEMPERATURE_F,
  DEFAULT_START_TEMPERATURE_F,
  fromDisplayTemperature,
  temperatureUnitLabel,
  toDisplayTemperature
} from "../utils/temperature";
import { fromDisplayPressure, toDisplayPressure } from "../utils/units";
import { AccordionItem } from "./Accordion";
import { NumberInput } from "./NumberInput";
import { SelectInput } from "./SelectInput";
import TankContextFields from "./TankContextFields";
import TrainingMathPanel from "./TrainingMathPanel";



const SENSITIVITY_RANGE_PSI = 300;
const SENSITIVITY_STEP_PSI = 10;
const SENSITIVITY_METRIC_STEP_PSI = 50;
const IDEAL_SAME_PRESSURE_ERROR = "Target pressure matches start pressure.";
const REAL_GAS_ONLY_WARNING = "Ideal partial-pressure plan has no pressure change; showing GERG-2008 corrected stop plan.";
const stageTemperatureOrder: StandardBlendStageKind[] = ["helium", "oxygen", "topoff"];

const realGasResultToBlendResult = (realGasResult: RealGasBlendResult): BlendResult => ({
  success: true,
  steps: realGasResult.steps.map((step) => ({
    kind: step.kind,
    amount: Math.max(0, step.pressureChangePsi),
    gasName: step.gasName
  })),
  warnings: [REAL_GAS_ONLY_WARNING],
  errors: []
});

type Props = {
  settings: SettingsSnapshot;
  topOffOptions: GasSelection[];
  trainingModeEnabled: boolean;
};

const toFraction = (percent: number | undefined, fallback: number): number => (percent ?? fallback) / 100;

const resolveStageTemperatures = (
  stageTemperaturesF: StandardBlendStageTemperaturesF | undefined,
  startTemperatureF: number
): StandardBlendStageTemperaturesF => ({
  helium: stageTemperaturesF?.helium ?? startTemperatureF,
  oxygen: stageTemperaturesF?.oxygen ?? startTemperatureF,
  topoff: stageTemperaturesF?.topoff ?? startTemperatureF
});

const stepLabel = (kind: StandardBlendStageKind): string => {
  if (kind === "topoff") {
    return "Top-off";
  }
  return kind === "oxygen" ? "Oxygen" : "Helium";
};

const touchedFromStageTemperatures = (
  stageTemperaturesF: StandardBlendStageTemperaturesF | undefined
): StandardBlendStageTemperatureTouched => ({
  helium: stageTemperaturesF?.helium !== undefined,
  oxygen: stageTemperaturesF?.oxygen !== undefined,
  topoff: stageTemperaturesF?.topoff !== undefined
});

const StandardBlendTab = ({ settings, topOffOptions, trainingModeEnabled }: Props): JSX.Element => {
  const standardBlend = useSessionStore((state: SessionState) => state.standardBlend);
  const standardBlendHistory = useSessionStore((state: SessionState) => state.standardBlendHistory);
  const setStandardBlend = useSessionStore((state: SessionState) => state.setStandardBlend);
  const addStandardBlendHistory = useSessionStore((state: SessionState) => state.addStandardBlendHistory);
  const removeStandardBlendHistory = useSessionStore((state: SessionState) => state.removeStandardBlendHistory);
  const clearStandardBlendHistory = useSessionStore((state: SessionState) => state.clearStandardBlendHistory);
  const [result, setResult] = useState<BlendResult | null>(null);
  const [realGasResult, setRealGasResult] = useState<RealGasBlendResult | null>(null);
  const [resultSource, setResultSource] = useState<"ideal" | "realGas">("ideal");
  const [sensitivityDeltaPsi, setSensitivityDeltaPsi] = useState(0);
  const [planOpen, setPlanOpen] = useState(false);
  const tankSizeCuFt = standardBlend.tankSizeCuFt ?? settings.defaultTankSizeCuFt ?? 80;
  const tankRatedPressurePsi = standardBlend.tankRatedPressurePsi ?? settings.tankRatedPressure ?? 3000;
  const startTemperatureF = standardBlend.startTemperatureF ?? DEFAULT_START_TEMPERATURE_F;
  const settledTemperatureF = standardBlend.settledTemperatureF ?? DEFAULT_SETTLED_TEMPERATURE_F;
  const stageTemperaturesF = standardBlend.stageTemperaturesF ?? {};
  const stageTemperatureTouched = standardBlend.stageTemperatureTouched ?? {};
  const temperatureLabel = temperatureUnitLabel(settings.temperatureUnit);

  const selectedTopGas = useMemo(() => {
    const match = topOffOptions.find((option) => option.id === standardBlend.topGasId);
    return match ?? topOffOptions[0];
  }, [standardBlend.topGasId, topOffOptions]);

  useEffect(() => {
    if (selectedTopGas && selectedTopGas.id !== standardBlend.topGasId) {
      setStandardBlend({ ...standardBlend, topGasId: selectedTopGas.id });
    }
  }, [selectedTopGas, standardBlend, setStandardBlend]);

  const startPressurePsi = useMemo(
    () => fromDisplayPressure(standardBlend.startPressure, settings.pressureUnit),
    [standardBlend.startPressure, settings.pressureUnit]
  );

  const negativeSensitivityLimitPsi = useMemo(
    () => Math.min(SENSITIVITY_RANGE_PSI, startPressurePsi),
    [startPressurePsi]
  );

  const clampedSensitivityDeltaPsi = Math.max(
    -negativeSensitivityLimitPsi,
    Math.min(SENSITIVITY_RANGE_PSI, sensitivityDeltaPsi)
  );

  const baseVolumes = useMemo(() => {
    if (!result || !result.success) {
      return null;
    }
    return summarizeBlendVolumes(result);
  }, [result]);

  const fillCost = useMemo(() => {
    if (!baseVolumes || !selectedTopGas) {
      return null;
    }

    return calculateFillCostEstimate(
      [
        {
          label: "Oxygen",
          gas: { id: "oxygen", name: "Oxygen", o2: 100, he: 0 },
          pressurePsi: baseVolumes.oxygen
        },
        {
          label: "Helium",
          gas: { id: "helium", name: "Helium", o2: 0, he: 100 },
          pressurePsi: baseVolumes.helium
        },
        {
          label: `${selectedTopGas.name} Top-Off`,
          gas: selectedTopGas,
          pressurePsi: baseVolumes.topoff
        }
      ],
      {
        pricePerCuFtO2: settings.pricePerCuFtO2 ?? 1.0,
        pricePerCuFtHe: settings.pricePerCuFtHe ?? 3.5,
        pricePerCuFtTopOff: settings.pricePerCuFtTopOff ?? 0.1,
        tankSizeCuFt,
        tankRatedPressure: tankRatedPressurePsi
      }
    );
  }, [
    baseVolumes,
    selectedTopGas,
    settings.pricePerCuFtTopOff,
    settings.pricePerCuFtHe,
    settings.pricePerCuFtO2,
    tankRatedPressurePsi,
    tankSizeCuFt
  ]);

  const blendPlanItems = useMemo(() => {
    if (!result?.success || result.steps.length === 0) {
      return null;
    }

    let runningPsi = resultSource === "realGas" && realGasResult
      ? realGasResult.startHotPressurePsi
      : fromDisplayPressure(standardBlend.startPressure, settings.pressureUnit);

    return result.steps.map((step, index) => {
      if (step.kind === "bleed") {
        const bleedTargetPsi = result.bleedPressure ?? clampPressure(runningPsi - step.amount);
        runningPsi = bleedTargetPsi;
        return (
          <li key={step.kind}>
            {index + 1}. BLEED tank down to {formatPressure(bleedTargetPsi, settings.pressureUnit)}
            <span className="result-step-total">{"->"} Tank @ {formatPressure(runningPsi, settings.pressureUnit)}</span>
          </li>
        );
      }

      const descriptor = step.kind === "topoff" ? "Top-off with" : "Add";
      const gasLabel = step.kind === "topoff" ? selectedTopGas?.name ?? step.gasName : step.gasName;
      runningPsi += step.amount;
      return (
        <li key={`${step.kind}-${step.gasName}-${step.amount.toFixed(6)}-${runningPsi.toFixed(6)}`}>
          {index + 1}. {descriptor} {gasLabel}: {formatPressure(runningPsi, settings.pressureUnit)}
          <span className="result-step-total"> ({formatSignedPressure(step.amount, settings.pressureUnit)})</span>
        </li>
      );
    });
  }, [realGasResult, result, resultSource, selectedTopGas?.name, settings.pressureUnit, standardBlend.startPressure]);

  const updateField = <K extends keyof StandardBlendInput>(key: K, value: StandardBlendInput[K]): void => {
    setStandardBlend({ ...standardBlend, [key]: value });
  };

  const buildResolvedInput = (input: StandardBlendInput): StandardBlendInput => {
    const resolvedStartTemperatureF = input.startTemperatureF ?? DEFAULT_START_TEMPERATURE_F;
    return {
      ...input,
      startPressure: input.startPressure ?? 0,
      targetPressure: input.targetPressure ?? 3000,
      targetO2: input.targetO2 ?? 32,
      startO2: input.startO2 ?? 21,
      startHe: input.startHe ?? 0,
      targetHe: input.targetHe ?? 0,
      tankSizeCuFt,
      tankRatedPressurePsi,
      startTemperatureF: resolvedStartTemperatureF,
      settledTemperatureF: input.settledTemperatureF ?? DEFAULT_SETTLED_TEMPERATURE_F,
      stageTemperaturesF: resolveStageTemperatures(input.stageTemperaturesF, resolvedStartTemperatureF)
    };
  };

  const setStandardBlendAndRefreshRealGas = (nextStandardBlend: StandardBlendInput): void => {
    setStandardBlend(nextStandardBlend);
    if (!result || !selectedTopGas || settings.gasModel !== "gerg2008") {
      return;
    }

    const correctedResult = calculateRealGasStandardBlend(
      { pressureUnit: settings.pressureUnit },
      buildResolvedInput(nextStandardBlend),
      selectedTopGas
    );
    setRealGasResult(correctedResult);
    if (resultSource === "realGas" && correctedResult.success) {
      setResult(realGasResultToBlendResult(correctedResult));
    }
  };

  const updateTemperatureField = (
    key: "startTemperatureF" | "settledTemperatureF",
    value: number | undefined
  ): void => {
    const nextValue = value === undefined ? undefined : fromDisplayTemperature(value, settings.temperatureUnit);
    setStandardBlendAndRefreshRealGas({ ...standardBlend, [key]: nextValue });
  };

  const updateStageTemperatureField = (
    kind: StandardBlendStageKind,
    value: number | undefined
  ): void => {
    const nextValue = value === undefined ? undefined : fromDisplayTemperature(value, settings.temperatureUnit);
    const nextStageTemperatures: StandardBlendStageTemperaturesF = { ...stageTemperaturesF };
    const nextTouched: StandardBlendStageTemperatureTouched = { ...stageTemperatureTouched };
    const currentIndex = stageTemperatureOrder.indexOf(kind);

    if (nextValue === undefined) {
      delete nextStageTemperatures[kind];
      delete nextTouched[kind];
    } else {
      nextStageTemperatures[kind] = nextValue;
      nextTouched[kind] = true;
    }

    for (const laterKind of stageTemperatureOrder.slice(currentIndex + 1)) {
      if (stageTemperatureTouched[laterKind]) {
        continue;
      }
      if (nextValue === undefined) {
        delete nextStageTemperatures[laterKind];
      } else {
        nextStageTemperatures[laterKind] = nextValue;
      }
    }

    setStandardBlendAndRefreshRealGas({
      ...standardBlend,
      stageTemperaturesF: nextStageTemperatures,
      stageTemperatureTouched: nextTouched
    });
  };

  const stageTemperatureDisplay = (kind: StandardBlendStageKind): number =>
    toDisplayTemperature(stageTemperaturesF[kind] ?? startTemperatureF, settings.temperatureUnit);

  const selectTempOnEnter = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.select();
    }
  };

  const onCalculate = (): void => {
    if (!selectedTopGas) {
      setResult(null);
      setRealGasResult(null);
      setResultSource("ideal");
      setSensitivityDeltaPsi(0);
      return;
    }

    const resolvedInput = buildResolvedInput(standardBlend);

    const blendResult = calculateStandardBlend(
      { pressureUnit: settings.pressureUnit },
      resolvedInput,
      selectedTopGas
    );
    const correctedResult = settings.gasModel === "gerg2008"
      ? calculateRealGasStandardBlend({ pressureUnit: settings.pressureUnit }, resolvedInput, selectedTopGas)
      : null;
    const useRealGasAsPrimary =
      correctedResult?.success === true &&
      correctedResult.steps.length > 0 &&
      !blendResult.success &&
      blendResult.errors.includes(IDEAL_SAME_PRESSURE_ERROR);
    const effectiveResult = useRealGasAsPrimary && correctedResult
      ? realGasResultToBlendResult(correctedResult)
      : blendResult;

    if (effectiveResult.success && effectiveResult.steps.length > 0) {
      const volumes = summarizeBlendVolumes(effectiveResult);
      const estimate = calculateFillCostEstimate(
        [
          {
            label: "Oxygen",
            gas: { id: "oxygen", name: "Oxygen", o2: 100, he: 0 },
            pressurePsi: volumes.oxygen
          },
          {
            label: "Helium",
            gas: { id: "helium", name: "Helium", o2: 0, he: 100 },
            pressurePsi: volumes.helium
          },
          {
            label: `${selectedTopGas.name} Top-Off`,
            gas: selectedTopGas,
            pressurePsi: volumes.topoff
          }
        ],
        {
          pricePerCuFtO2: settings.pricePerCuFtO2 ?? 1.0,
          pricePerCuFtHe: settings.pricePerCuFtHe ?? 3.5,
          pricePerCuFtTopOff: settings.pricePerCuFtTopOff ?? 0.1,
          tankSizeCuFt,
          tankRatedPressure: tankRatedPressurePsi
        }
      );

      const historyEntry: StandardBlendHistoryEntry = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        startPressurePsi: fromDisplayPressure(resolvedInput.startPressure, settings.pressureUnit),
        targetPressurePsi: fromDisplayPressure(resolvedInput.targetPressure, settings.pressureUnit),
        startO2: resolvedInput.startO2 ?? 21,
        startHe: resolvedInput.startHe ?? 0,
        targetO2: resolvedInput.targetO2 ?? 32,
        targetHe: resolvedInput.targetHe ?? 0,
        topGasId: selectedTopGas.id,
        topGasName: selectedTopGas.name,
        tankSizeCuFt,
        tankRatedPressurePsi,
        startTemperatureF,
        fillTemperatureF: resolvedInput.stageTemperaturesF?.topoff ?? startTemperatureF,
        settledTemperatureF,
        stageTemperaturesF: resolvedInput.stageTemperaturesF,
        estimatedCost: estimate.totalCost,
        steps: effectiveResult.steps.map((step) => ({
          kind: step.kind,
          amountPsi: step.amount,
          gasName: step.kind === "topoff" ? selectedTopGas.name : step.gasName
        }))
      };
      addStandardBlendHistory(historyEntry);
    }

    setResult(effectiveResult);
    setRealGasResult(correctedResult);
    setResultSource(useRealGasAsPrimary ? "realGas" : "ideal");
    setSensitivityDeltaPsi(0);
    setPlanOpen(true);
  };

  const applyHistory = (entry: StandardBlendHistoryEntry): void => {
    setStandardBlend({
      startO2: entry.startO2,
      startHe: entry.startHe,
      startPressure: toDisplayPressure(entry.startPressurePsi, settings.pressureUnit),
      targetO2: entry.targetO2,
      targetHe: entry.targetHe,
      targetPressure: toDisplayPressure(entry.targetPressurePsi, settings.pressureUnit),
      tankSizeCuFt: entry.tankSizeCuFt,
      tankRatedPressurePsi: entry.tankRatedPressurePsi,
      startTemperatureF: entry.startTemperatureF ?? standardBlend.startTemperatureF,
      fillTemperatureF: entry.fillTemperatureF ?? standardBlend.fillTemperatureF,
      settledTemperatureF: entry.settledTemperatureF ?? standardBlend.settledTemperatureF,
      stageTemperaturesF: entry.stageTemperaturesF,
      stageTemperatureTouched: touchedFromStageTemperatures(entry.stageTemperaturesF),
      topGasId: entry.topGasId
    });
    setResult(null);
    setRealGasResult(null);
    setResultSource("ideal");
    setSensitivityDeltaPsi(0);
    setPlanOpen(false);
  };

  const sensitivityAnalysis = useMemo(() => {
    if (!selectedTopGas || !result || !result.success || resultSource !== "ideal" || !baseVolumes) {
      return null;
    }

    const computeBlend = (deltaPsi: number): BlendResult | null => {
      if (Math.abs(deltaPsi) <= 1e-6) {
        return result;
      }

      const adjustedStartPsi = clampPressure(startPressurePsi + deltaPsi);
      const candidate: StandardBlendInput = {
        ...standardBlend,
        startPressure: toDisplayPressure(adjustedStartPsi, settings.pressureUnit),
        targetPressure: standardBlend.targetPressure ?? 3000,
        targetO2: standardBlend.targetO2 ?? 32,
        startO2: standardBlend.startO2 ?? 21,
        startHe: standardBlend.startHe ?? 0,
        targetHe: standardBlend.targetHe ?? 0
      };
      return calculateStandardBlend({ pressureUnit: settings.pressureUnit }, candidate, selectedTopGas);
    };

    const currentBlend = computeBlend(clampedSensitivityDeltaPsi);
    const adjustedStartPsi = clampPressure(startPressurePsi + clampedSensitivityDeltaPsi);
    const adjustedStartDisplay = toDisplayPressure(adjustedStartPsi, settings.pressureUnit);

    if (!currentBlend || !currentBlend.success) {
      return {
        available: false as const,
        deltaPsi: clampedSensitivityDeltaPsi,
        adjustedStartPsi,
        adjustedStartDisplay,
        error: currentBlend?.errors[0] ?? "Unable to evaluate sensitivity."
      };
    }

    if (currentBlend.steps.some((step) => step.kind === "bleed")) {
      return {
        available: false as const,
        deltaPsi: clampedSensitivityDeltaPsi,
        adjustedStartPsi,
        adjustedStartDisplay,
        error: "Blend requires bleed at this starting pressure."
      };
    }

    const currentVolumes = summarizeBlendVolumes(currentBlend);

    const differenceFromBase = {
      helium: currentVolumes.helium - baseVolumes.helium,
      oxygen: currentVolumes.oxygen - baseVolumes.oxygen,
      topoff: currentVolumes.topoff - baseVolumes.topoff
    };

    const computePerStep = (direction: 1 | -1) => {
      const targetDeltaPsi = clampedSensitivityDeltaPsi + direction * SENSITIVITY_METRIC_STEP_PSI;
      if (
        targetDeltaPsi < -negativeSensitivityLimitPsi ||
        targetDeltaPsi > SENSITIVITY_RANGE_PSI
      ) {
        return null;
      }

      const blend = computeBlend(targetDeltaPsi);
      if (!blend || !blend.success || blend.steps.some((step) => step.kind === "bleed")) {
        return null;
      }
      const volumes = summarizeBlendVolumes(blend);
      return {
        deltaPsi: targetDeltaPsi,
        difference: {
          helium: volumes.helium - currentVolumes.helium,
          oxygen: volumes.oxygen - currentVolumes.oxygen,
          topoff: volumes.topoff - currentVolumes.topoff
        }
      };
    };

    return {
      available: true as const,
      deltaPsi: clampedSensitivityDeltaPsi,
      adjustedStartPsi,
      adjustedStartDisplay,
      differenceFromBase,
      currentVolumes,
      perPlus: computePerStep(1),
      perMinus: computePerStep(-1),
      warnings: currentBlend.warnings
    };
  }, [
    baseVolumes,
    clampedSensitivityDeltaPsi,
    negativeSensitivityLimitPsi,
    result,
    resultSource,
    selectedTopGas,
    settings.pressureUnit,
    standardBlend,
    startPressurePsi
  ]);

  const requiredStart = useMemo(() => {
    if (!result || !result.success || resultSource !== "ideal" || !selectedTopGas) {
      return null;
    }
    return solveRequiredStartPressure(
      { pressureUnit: settings.pressureUnit },
      {
        ...standardBlend,
        startPressure: standardBlend.startPressure ?? 0,
        targetPressure: standardBlend.targetPressure ?? 3000,
        targetO2: standardBlend.targetO2 ?? 32,
        startO2: standardBlend.startO2 ?? 21,
        startHe: standardBlend.startHe ?? 0,
        targetHe: standardBlend.targetHe ?? 0
      },
      selectedTopGas
    );
  }, [result, resultSource, selectedTopGas, settings.pressureUnit, standardBlend]);

  const noHeliumTarget = useMemo(() => {
    if (!result || !result.success || resultSource !== "ideal" || !selectedTopGas) {
      return null;
    }
    return solveMaxTargetWithoutHelium(
      { pressureUnit: settings.pressureUnit },
      {
        ...standardBlend,
        startPressure: standardBlend.startPressure ?? 0,
        targetPressure: standardBlend.targetPressure ?? 3000,
        targetO2: standardBlend.targetO2 ?? 32,
        startO2: standardBlend.startO2 ?? 21,
        startHe: standardBlend.startHe ?? 0,
        targetHe: standardBlend.targetHe ?? 0
      },
      selectedTopGas
    );
  }, [result, resultSource, selectedTopGas, settings.pressureUnit, standardBlend]);

  const sliderMinDisplay = toDisplayPressure(-negativeSensitivityLimitPsi, settings.pressureUnit);
  const sliderMaxDisplay = toDisplayPressure(SENSITIVITY_RANGE_PSI, settings.pressureUnit);
  const sliderValueDisplay = toDisplayPressure(clampedSensitivityDeltaPsi, settings.pressureUnit);
  const sliderStepDisplay = Math.max(
    Math.abs(toDisplayPressure(SENSITIVITY_STEP_PSI, settings.pressureUnit)),
    settings.pressureUnit === "psi" ? 5 : 0.25
  );
  const showBaseBlendPlan = settings.gasModel !== "gerg2008" || realGasResult?.success !== true;

  const trainingMath = useMemo(() => {
    if (!trainingModeEnabled || !result?.success || !selectedTopGas || !baseVolumes) {
      return null;
    }

    const effectiveStartPressurePsi = result.bleedPressure ?? startPressurePsi;
    const targetPressurePsi = fromDisplayPressure(standardBlend.targetPressure ?? 3000, settings.pressureUnit);
    const startO2Fraction = toFraction(standardBlend.startO2, 21);
    const startHeFraction = toFraction(standardBlend.startHe, 0);
    const startN2Fraction = Math.max(0, 1 - startO2Fraction - startHeFraction);
    const targetO2Fraction = toFraction(standardBlend.targetO2, 32);
    const targetHeFraction = toFraction(standardBlend.targetHe, 0);
    const targetN2Fraction = Math.max(0, 1 - targetO2Fraction - targetHeFraction);
    const topO2Fraction = selectedTopGas.o2 / 100;
    const topHeFraction = selectedTopGas.he / 100;
    const topN2Fraction = Math.max(0, 1 - topO2Fraction - topHeFraction);

    const startO2Psi = effectiveStartPressurePsi * startO2Fraction;
    const startHePsi = effectiveStartPressurePsi * startHeFraction;
    const startN2Psi = effectiveStartPressurePsi * startN2Fraction;
    const targetO2Psi = targetPressurePsi * targetO2Fraction;
    const targetHePsi = targetPressurePsi * targetHeFraction;
    const targetN2Psi = targetPressurePsi * targetN2Fraction;
    const deltaO2Psi = targetO2Psi - startO2Psi;
    const deltaHePsi = targetHePsi - startHePsi;
    const deltaN2Psi = targetN2Psi - startN2Psi;
    const commonHandMethod =
      resultSource === "ideal" &&
      topHeFraction <= 0.000001 &&
      1 - topO2Fraction > 0.000001;
    const handHeliumAddPsi = commonHandMethod ? clampPressure(deltaHePsi) : 0;
    const pressureLeftAfterHeliumPsi = commonHandMethod
      ? clampPressure(targetPressurePsi - effectiveStartPressurePsi - handHeliumAddPsi)
      : 0;
    const rawHandOxygenAddPsi = commonHandMethod
      ? (
          targetO2Psi * 100 -
          startO2Psi * 100 -
          selectedTopGas.o2 * pressureLeftAfterHeliumPsi
        ) / (100 - selectedTopGas.o2)
      : 0;
    const handOxygenAddPsi = clampPressure(rawHandOxygenAddPsi);
    const handTopoffPsi = commonHandMethod
      ? clampPressure(targetPressurePsi - effectiveStartPressurePsi - handHeliumAddPsi - handOxygenAddPsi)
      : 0;
    const effectiveStartPressureDisplay = toDisplayPressure(effectiveStartPressurePsi, settings.pressureUnit);
    const targetPressureDisplay = toDisplayPressure(targetPressurePsi, settings.pressureUnit);
    const pressureLeftAfterHeliumDisplay = toDisplayPressure(pressureLeftAfterHeliumPsi, settings.pressureUnit);
    const startO2PointsDisplay = effectiveStartPressureDisplay * (standardBlend.startO2 ?? 21);
    const startHePointsDisplay = effectiveStartPressureDisplay * (standardBlend.startHe ?? 0);
    const targetO2PointsDisplay = targetPressureDisplay * (standardBlend.targetO2 ?? 32);
    const targetHePointsDisplay = targetPressureDisplay * (standardBlend.targetHe ?? 0);

    return {
      realGasPrimary: resultSource === "realGas",
      commonHandMethod,
      effectiveStartPressurePsi,
      targetPressurePsi,
      startO2Fraction,
      startHeFraction,
      startN2Fraction,
      targetO2Fraction,
      targetHeFraction,
      targetN2Fraction,
      topO2Fraction,
      topHeFraction,
      topN2Fraction,
      startO2Psi,
      startHePsi,
      startN2Psi,
      targetO2Psi,
      targetHePsi,
      targetN2Psi,
      deltaO2Psi,
      deltaHePsi,
      deltaN2Psi,
      handHeliumAddPsi,
      pressureLeftAfterHeliumPsi,
      pressureLeftAfterHeliumDisplay,
      handOxygenAddPsi,
      handTopoffPsi,
      startO2PointsDisplay,
      startHePointsDisplay,
      targetO2PointsDisplay,
      targetHePointsDisplay
    };
  }, [
    baseVolumes,
    result,
    resultSource,
    selectedTopGas,
    settings.pressureUnit,
    standardBlend.startHe,
    standardBlend.startO2,
    standardBlend.targetHe,
    standardBlend.targetO2,
    standardBlend.targetPressure,
    startPressurePsi,
    trainingModeEnabled
  ]);

  return (
    <>
      <AccordionItem title="Start Tank" defaultOpen={true}>
        <div className="grid two">
          <NumberInput
            label="Start O2 %"
            min={0}
            max={100}
            step={0.1}
            value={standardBlend.startO2}
            onChange={(val) => updateField("startO2", val)}
            onBlur={() => updateField("startO2", clampPercent(standardBlend.startO2 ?? 0))}
          />
          <NumberInput
            label="Start He %"
            min={0}
            max={100}
            step={0.1}
            value={standardBlend.startHe}
            onChange={(val) => updateField("startHe", val)}
            onBlur={() => updateField("startHe", clampPercent(standardBlend.startHe ?? 0))}
          />
          <NumberInput
            label={`Start Pressure (${settings.pressureUnit.toUpperCase()})`}
            min={0}
            step={settings.pressureUnit === "psi" ? 10 : 1}
            value={standardBlend.startPressure}
            onChange={(val) => updateField("startPressure", val)}
            onBlur={() => updateField("startPressure", clampPressure(standardBlend.startPressure ?? 0))}
          />
        </div>
      </AccordionItem>

      <AccordionItem title="Tank Context" defaultOpen={false}>
        <TankContextFields
          tankSizeCuFt={standardBlend.tankSizeCuFt}
          tankRatedPressurePsi={standardBlend.tankRatedPressurePsi}
          defaultTankSizeCuFt={settings.defaultTankSizeCuFt}
          defaultTankRatedPressurePsi={settings.tankRatedPressure}
          onChange={(patch) => setStandardBlend({ ...standardBlend, ...patch })}
        />
      </AccordionItem>

      <AccordionItem title="Target Blend" defaultOpen={true}>
        <div className="grid two">
          <NumberInput
            label="Target O2 %"
            min={0}
            max={100}
            step={0.1}
            value={standardBlend.targetO2}
            onChange={(val) => updateField("targetO2", val)}
            onBlur={() => updateField("targetO2", clampPercent(standardBlend.targetO2 ?? 0))}
          />
          <NumberInput
            label="Target He %"
            min={0}
            max={100}
            step={0.1}
            value={standardBlend.targetHe}
            onChange={(val) => updateField("targetHe", val)}
            onBlur={() => updateField("targetHe", clampPercent(standardBlend.targetHe ?? 0))}
          />
          <NumberInput
            label={`Target Pressure (${settings.pressureUnit.toUpperCase()})`}
            min={0}
            step={settings.pressureUnit === "psi" ? 10 : 1}
            value={standardBlend.targetPressure}
            onChange={(val) => updateField("targetPressure", val)}
            onBlur={() => updateField("targetPressure", clampPressure(standardBlend.targetPressure ?? 0))}
          />
        </div>
      </AccordionItem>

      <AccordionItem title="Top-Off Gas" defaultOpen={true}>
        <SelectInput
          label="Select Gas"
          value={selectedTopGas?.id ?? ""}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            updateField("topGasId", event.target.value)
          }
        >
          {topOffOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name} ({formatPercentage(option.o2)} O2 / {formatPercentage(option.he)} He)
            </option>
          ))}
        </SelectInput>
        <div className="table-note">What gas is being used other than oxygen and helium?</div>
        <button className="calculate-button" type="button" onClick={onCalculate}>
          Calculate
        </button>
      </AccordionItem>

      {result && (
        <AccordionItem title="Blend Plan" isOpen={planOpen} onToggle={() => setPlanOpen(!planOpen)}>
          {!result.success && result.errors.length > 0 && (
            <div className="error">{result.errors[0]}</div>
          )}
          {result.success && result.steps.length === 0 && (
            <div className="error">No gas additions required.</div>
          )}
          {showBaseBlendPlan && blendPlanItems && <ol className="result-list">{blendPlanItems}</ol>}
          {result.warnings.map((warning) => (
            <div key={warning} className="warning">
              {warning}
            </div>
          ))}
          {trainingMath && (
            <TrainingMathPanel
              title="Standard Blend Hand Math"
              note="This mirrors the worksheet method taught for partial-pressure fills. Always analyze the finished gas with calibrated oxygen and helium analyzers."
            >
              {result.bleedPressure !== undefined && (
                <p>
                  The original start pressure was {formatPressure(startPressurePsi, settings.pressureUnit)}. The worksheet starts after the bleed-down, at {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)}.
                </p>
              )}
              {trainingMath.realGasPrimary ? (
                <div className="training-math-note">
                  This result is a GERG-2008 correction case. The hand-fill partial-pressure worksheet has no normal pressure add to show; GERG-2008 estimates corrected stop pressures from absolute pressure, temperature, cylinder volume, component moles, and mixture compressibility.
                </div>
              ) : trainingMath.commonHandMethod ? (
                <>
                  <div className="formula-sheet" aria-label="Standard blend visual formula worksheet">
                    <div className="formula-step">
                      <span className="formula-step-label">Step 1</span>
                      <div className="formula-equation">
                        <span>He Fill P</span>
                        <span>=</span>
                        <span className="formula-fraction">
                          <span>{formatNumber(trainingMath.targetHePointsDisplay, 0)} - {formatNumber(trainingMath.startHePointsDisplay, 0)}</span>
                          <span>100</span>
                        </span>
                        <span>=</span>
                        <strong>{formatPressure(trainingMath.handHeliumAddPsi, settings.pressureUnit)}</strong>
                      </div>
                    </div>
                    <div className="formula-step">
                      <span className="formula-step-label">Step 2</span>
                      <div className="formula-equation">
                        <span>O2 Fill P</span>
                        <span>=</span>
                        <span className="formula-fraction">
                          <span>{formatNumber(trainingMath.targetO2PointsDisplay, 0)} - {formatNumber(trainingMath.startO2PointsDisplay, 0)} - ({formatNumber(selectedTopGas.o2, 1)} x {formatNumber(trainingMath.pressureLeftAfterHeliumDisplay, 1)})</span>
                          <span>{formatNumber(100 - selectedTopGas.o2, 1)}</span>
                        </span>
                        <span>=</span>
                        <strong>{formatPressure(trainingMath.handOxygenAddPsi, settings.pressureUnit)}</strong>
                      </div>
                    </div>
                    <div className="formula-step">
                      <span className="formula-step-label">Step 3</span>
                      <div className="formula-equation">
                        <span>Top-off</span>
                        <span>=</span>
                        <span>Final P - Start P - He P - O2 P</span>
                        <span>=</span>
                        <strong>{formatPressure(trainingMath.handTopoffPsi, settings.pressureUnit)}</strong>
                      </div>
                    </div>
                  </div>
                  <div className="training-math-grid training-math-grid-support">
                    <div>
                      <h4>Slate setup</h4>
                      <ul>
                        <li>Use pressure-percent points: mix percent x pressure.</li>
                        <li>Start O2 points = {formatNumber((standardBlend.startO2 ?? 21), 1)} x {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} = {formatNumber(trainingMath.startO2PointsDisplay, 0)}</li>
                        <li>Target O2 points = {formatNumber((standardBlend.targetO2 ?? 32), 1)} x {formatPressure(trainingMath.targetPressurePsi, settings.pressureUnit)} = {formatNumber(trainingMath.targetO2PointsDisplay, 0)}</li>
                        <li>Start He points = {formatNumber((standardBlend.startHe ?? 0), 1)} x {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} = {formatNumber(trainingMath.startHePointsDisplay, 0)}</li>
                        <li>Target He points = {formatNumber((standardBlend.targetHe ?? 0), 1)} x {formatPressure(trainingMath.targetPressurePsi, settings.pressureUnit)} = {formatNumber(trainingMath.targetHePointsDisplay, 0)}</li>
                      </ul>
                    </div>
                    <div>
                      <h4>Formula reference</h4>
                      <ul>
                        <li>Reference shortcut: PO2 = ((FO2 want - FO2 top) / N2 top) x P(fill).</li>
                        <li>FO2 want = target O2 = {formatNumber((standardBlend.targetO2 ?? 32), 1)}%; FO2 top = top-off O2 = {formatNumber(selectedTopGas.o2, 1)}%.</li>
                        <li>N2 top = 100 - top-off O2 = 100 - {formatNumber(selectedTopGas.o2, 1)} = {formatNumber(trainingMath.topN2Fraction * 100, 1)}%.</li>
                        <li>Top-off O2 credit = FO2 top x pressure left = {formatNumber(selectedTopGas.o2, 1)} x {formatNumber(trainingMath.pressureLeftAfterHeliumDisplay, 1)} = {formatNumber(selectedTopGas.o2 * trainingMath.pressureLeftAfterHeliumDisplay, 0)} pressure-percent points.</li>
                      </ul>
                    </div>
                    <div>
                      <h4>Fill worksheet</h4>
                      <ul>
                        <li>Helium first = (target He points - start He points) / 100 = ({formatNumber(trainingMath.targetHePointsDisplay, 0)} - {formatNumber(trainingMath.startHePointsDisplay, 0)}) / 100 = {formatPressure(trainingMath.handHeliumAddPsi, settings.pressureUnit)}</li>
                        <li>Pressure left after He = final - start - He = {formatPressure(trainingMath.targetPressurePsi, settings.pressureUnit)} - {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} - {formatPressure(trainingMath.handHeliumAddPsi, settings.pressureUnit)} = {formatPressure(trainingMath.pressureLeftAfterHeliumPsi, settings.pressureUnit)}</li>
                        <li>Oxygen add = (target O2 points - start O2 points - top gas O2% x pressure left) / (100 - top gas O2%)</li>
                        <li>Oxygen add = ({formatNumber(trainingMath.targetO2PointsDisplay, 0)} - {formatNumber(trainingMath.startO2PointsDisplay, 0)} - {formatNumber(selectedTopGas.o2, 1)} x {formatNumber(trainingMath.pressureLeftAfterHeliumDisplay, 1)}) / ({formatNumber(100 - selectedTopGas.o2, 1)}) = {formatPressure(trainingMath.handOxygenAddPsi, settings.pressureUnit)}</li>
                        <li>Top-off = final - start - He - O2 = {formatPressure(trainingMath.targetPressurePsi, settings.pressureUnit)} - {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} - {formatPressure(trainingMath.handHeliumAddPsi, settings.pressureUnit)} - {formatPressure(trainingMath.handOxygenAddPsi, settings.pressureUnit)} = {formatPressure(trainingMath.handTopoffPsi, settings.pressureUnit)}</li>
                      </ul>
                    </div>
                  </div>
                </>
              ) : (
                <div className="training-math-grid training-math-grid-support">
                  <div>
                    <h4>Gas-balance worksheet</h4>
                    <ul>
                      <li>This top-off gas is not the common helium, oxygen, then air/nitrox-bank hand-fill case, so balance the gas that only comes from the top-off.</li>
                      {trainingMath.topN2Fraction > 0.000001 ? (
                        <li>Top-off = N2 needed / top-off N2 = {formatPressure(trainingMath.deltaN2Psi, settings.pressureUnit)} / {formatNumber(trainingMath.topN2Fraction, 3)} = {formatPressure(baseVolumes.topoff, settings.pressureUnit)}</li>
                      ) : (
                        <li>Selected top-off gas has no N2, so O2 and He additions carry the fill directly.</li>
                      )}
                      <li>Helium add = He needed - top-off He = {formatPressure(trainingMath.deltaHePsi, settings.pressureUnit)} - ({formatPressure(baseVolumes.topoff, settings.pressureUnit)} x {formatNumber(trainingMath.topHeFraction, 3)}) = {formatPressure(baseVolumes.helium, settings.pressureUnit)}</li>
                      <li>Oxygen add = O2 needed - top-off O2 = {formatPressure(trainingMath.deltaO2Psi, settings.pressureUnit)} - ({formatPressure(baseVolumes.topoff, settings.pressureUnit)} x {formatNumber(trainingMath.topO2Fraction, 3)}) = {formatPressure(baseVolumes.oxygen, settings.pressureUnit)}</li>
                    </ul>
                  </div>
                  <div>
                    <h4>Pressure check</h4>
                    <ul>
                      <li>Start + He + O2 + top-off = {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} + {formatPressure(baseVolumes.helium, settings.pressureUnit)} + {formatPressure(baseVolumes.oxygen, settings.pressureUnit)} + {formatPressure(baseVolumes.topoff, settings.pressureUnit)} = {formatPressure(trainingMath.targetPressurePsi, settings.pressureUnit)}</li>
                    </ul>
                  </div>
                </div>
              )}
              {settings.gasModel === "gerg2008" && (
                <div className="training-math-note">
                  GERG-2008 mode keeps this ideal partial-pressure plan as the working fill order, then estimates corrected stop pressures from absolute pressure, measured stage temperatures, cylinder volume, component moles, and mixture compressibility. The detailed GERG solver stays high level here by design.
                </div>
              )}
            </TrainingMathPanel>
          )}
          {settings.gasModel === "gerg2008" && realGasResult && (
            <div className="cost-breakdown">
              <div className="section-title">GERG-2008 Corrected Stops</div>
              <div className="real-gas-temperature-grid">
                <NumberInput
                  label={`Initial Temp (${temperatureLabel})`}
                  step={1}
                  value={toDisplayTemperature(startTemperatureF, settings.temperatureUnit)}
                  onChange={(val) => updateTemperatureField("startTemperatureF", val)}
                  onKeyDown={selectTempOnEnter}
                />
                <NumberInput
                  label={`Settled Temp (${temperatureLabel})`}
                  step={1}
                  value={toDisplayTemperature(settledTemperatureF, settings.temperatureUnit)}
                  onChange={(val) => updateTemperatureField("settledTemperatureF", val)}
                  onKeyDown={selectTempOnEnter}
                />
              </div>
              <div className="table-note">
                Stage temps default to the initial temperature. Enter a measured cylinder temperature on a stop row to update that stop and any following unedited stops.
              </div>
              {!realGasResult.success && realGasResult.errors.map((error) => (
                <div key={error} className="warning">
                  {error}
                </div>
              ))}
              {realGasResult.success && realGasResult.steps.length === 0 && (
                <div className="table-note">No corrected gas additions required.</div>
              )}
              {realGasResult.success && realGasResult.steps.length > 0 && (
                <>
                  <ol className="result-list">
                    {realGasResult.steps.map((step, index) => {
                      const descriptor = step.kind === "topoff" ? "Top-off with" : "Add";
                      return (
                        <li className="real-gas-step" key={`${step.kind}-${step.gasName}`}>
                          <div className="real-gas-step-main">
                            <span>
                              {index + 1}. {descriptor} {step.gasName}: <strong>{formatPressure(step.stopPressurePsi, settings.pressureUnit, 1)}</strong>
                            </span>
                            <NumberInput
                              className="stage-temperature-field"
                              label={`${stepLabel(step.kind)} Temp (${temperatureLabel})`}
                              step={1}
                              value={stageTemperatureDisplay(step.kind)}
                              onChange={(val) => updateStageTemperatureField(step.kind, val)}
                              onKeyDown={selectTempOnEnter}
                            />
                          </div>
                          <div className="real-gas-step-detail">
                            {formatSignedPressure(step.pressureChangePsi, settings.pressureUnit, 1)}, Z {formatNumber(step.z, 4)}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                  <div className="table-note">
                    Initial reference: {formatPressure(realGasResult.startHotPressurePsi, settings.pressureUnit, 1)}. Final stage stop: {formatPressure(realGasResult.finalHotPressurePsi, settings.pressureUnit, 1)} for settled target {formatPressure(realGasResult.targetSettledPressurePsi, settings.pressureUnit, 1)}.
                  </div>
                </>
              )}
              {realGasResult.warnings.map((warning) => (
                <div key={warning} className="warning">
                  {warning}
                </div>
              ))}
            </div>
          )}
          {fillCost && fillCost.lines.length > 0 && (
            <div className="cost-breakdown">
              <div className="section-title">Fill Cost</div>
              <div className="grid two">
                {fillCost.lines.map((line) => (
                  <div key={line.label} className="cost-line">
                    <span>{line.label}:</span>
                    <span>
                      {formatPressure(line.pressurePsi, settings.pressureUnit)}, {formatNumber(line.volumeCuFt, 2)} cu ft, {formatNumber(line.volumeLiters, 2)} L × {"$"}{line.unitPrice.toFixed(2)} = {"$"}{line.cost.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="table-note">Tank basis: {formatNumber(tankSizeCuFt, 2)} cu ft @ {formatNumber(tankRatedPressurePsi, 0)} PSI.</div>
              <div className="cost-total">
                <strong>Total: {"$"}{fillCost.totalCost.toFixed(2)}</strong>
              </div>
            </div>
          )}
        </AccordionItem>
      )}

      <AccordionItem title={`Blend History (${standardBlendHistory.length})`} defaultOpen={false}>
        {standardBlendHistory.length === 0 && (
          <div className="table-note">No saved blends yet.</div>
        )}
        {standardBlendHistory.length > 0 && (
          <>
            <div className="history-list">
              {standardBlendHistory.map((entry) => (
                <div key={entry.id} className="history-item">
                  <div className="history-title">
                    {formatPercentage(entry.targetO2)} O2 / {formatPercentage(entry.targetHe)} He @{" "}
                    {formatPressure(entry.targetPressurePsi, settings.pressureUnit)}
                  </div>
                  <div className="table-note">
                    {new Date(entry.createdAt).toLocaleString()} • Top-Off {entry.topGasName}
                  </div>
                  <div className="table-note">
                    Start {formatPercentage(entry.startO2)} O2 / {formatPercentage(entry.startHe)} He @{" "}
                    {formatPressure(entry.startPressurePsi, settings.pressureUnit)}
                  </div>
                  {entry.estimatedCost !== undefined && (
                    <div className="table-note">Estimated Cost: {"$"}{entry.estimatedCost.toFixed(2)}</div>
                  )}
                  <div className="table-note">
                    Steps: {entry.steps
                      .map((step) => {
                        const signedAmount = step.kind === "bleed" ? -step.amountPsi : step.amountPsi;
                        return `${step.kind} ${formatSignedPressure(signedAmount, settings.pressureUnit)}`;
                      })
                      .join(", ")}
                  </div>
                  <div className="reverse-actions">
                    <button className="settings-button" type="button" onClick={() => applyHistory(entry)}>
                      Recreate
                    </button>
                    <button className="settings-close" type="button" onClick={() => removeStandardBlendHistory(entry.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="history-actions">
              <button className="settings-close" type="button" onClick={clearStandardBlendHistory}>
                Clear History
              </button>
            </div>
          </>
        )}
      </AccordionItem>

      {result?.success && sensitivityAnalysis && (
        <AccordionItem title="Fill Sensitivity" defaultOpen={false}>
          <div className="field">
            <label>Adjust Start Pressure ({settings.pressureUnit.toUpperCase()})</label>
            <input
              type="range"
              min={sliderMinDisplay}
              max={sliderMaxDisplay}
              step={sliderStepDisplay}
              value={sliderValueDisplay}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const nextDisplay = Number(event.target.value);
                const nextPsi = fromDisplayPressure(nextDisplay, settings.pressureUnit);
                const clampedPsi = Math.max(-negativeSensitivityLimitPsi, Math.min(SENSITIVITY_RANGE_PSI, nextPsi));
                setSensitivityDeltaPsi(clampedPsi);
              }}
            />
          </div>
          <div className="sensitivity-summary">
            <span>Baseline {formatPressure(startPressurePsi, settings.pressureUnit)}</span>
            <span>
              Adjusted {formatPressure(sensitivityAnalysis.adjustedStartPsi, settings.pressureUnit)}
              {` (${formatSignedPressure(sensitivityAnalysis.deltaPsi, settings.pressureUnit)})`}
            </span>
          </div>

          {sensitivityAnalysis.available ? (
            <>
              <div className="grid three">
                <div className="stat">
                  <div className="stat-label">Helium Δ</div>
                  <div className="stat-value">{formatSignedPressure(sensitivityAnalysis.differenceFromBase.helium, settings.pressureUnit)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Oxygen Δ</div>
                  <div className="stat-value">{formatSignedPressure(sensitivityAnalysis.differenceFromBase.oxygen, settings.pressureUnit)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Top-Off Δ</div>
                  <div className="stat-value">{formatSignedPressure(sensitivityAnalysis.differenceFromBase.topoff, settings.pressureUnit)}</div>
                </div>
              </div>

              <div className="sensitivity-per50">
                <div className="per50-block">
                  <div className="per50-title">+{formatPressure(SENSITIVITY_METRIC_STEP_PSI, "psi")}{settings.pressureUnit === "psi" ? "" : ` (~${formatPressure(SENSITIVITY_METRIC_STEP_PSI, settings.pressureUnit)})`}</div>
                  {sensitivityAnalysis.perPlus ? (
                    <ul>
                      <li>ΔHe {formatSignedPressure(sensitivityAnalysis.perPlus.difference.helium, settings.pressureUnit)}</li>
                      <li>ΔO2 {formatSignedPressure(sensitivityAnalysis.perPlus.difference.oxygen, settings.pressureUnit)}</li>
                      <li>ΔTop {formatSignedPressure(sensitivityAnalysis.perPlus.difference.topoff, settings.pressureUnit)}</li>
                    </ul>
                  ) : (
                    <div className="table-note">Out of range</div>
                  )}
                </div>
                <div className="per50-block">
                  <div className="per50-title">-{formatPressure(SENSITIVITY_METRIC_STEP_PSI, "psi")}{settings.pressureUnit === "psi" ? "" : ` (~${formatPressure(SENSITIVITY_METRIC_STEP_PSI, settings.pressureUnit)})`}</div>
                  {sensitivityAnalysis.perMinus ? (
                    <ul>
                      <li>ΔHe {formatSignedPressure(sensitivityAnalysis.perMinus.difference.helium, settings.pressureUnit)}</li>
                      <li>ΔO2 {formatSignedPressure(sensitivityAnalysis.perMinus.difference.oxygen, settings.pressureUnit)}</li>
                      <li>ΔTop {formatSignedPressure(sensitivityAnalysis.perMinus.difference.topoff, settings.pressureUnit)}</li>
                    </ul>
                  ) : (
                    <div className="table-note">Out of range</div>
                  )}
                </div>
              </div>

              {sensitivityAnalysis.warnings.map((warning) => (
                <div key={warning} className="warning">
                  {warning}
                </div>
              ))}
              <div className="table-note">Metrics show changes relative to the baseline plan.</div>
            </>
          ) : (
            <div className="warning">{sensitivityAnalysis.error}</div>
          )}
        </AccordionItem>
      )}

      {result?.success && (requiredStart || noHeliumTarget) && (
        <AccordionItem title="Reverse Solvers" defaultOpen={false}>
          <div className="grid two">
            <div className="reverse-block">
              <div className="section-title">Required Start Pressure (no helium)</div>
              {requiredStart?.success ? (
                <>
                  <div className="reverse-value">{formatPressure(requiredStart.startPressurePsi, settings.pressureUnit)}</div>
                  <div className="table-note">
                    Needs {formatSignedPressure(requiredStart.startPressurePsi - startPressurePsi, settings.pressureUnit)} relative to current start.
                  </div>
                </>
              ) : (
                <div className="warning">
                  {requiredStart?.errors[0] ?? "Target cannot be met without helium addition."}
                </div>
              )}
            </div>
            <div className="reverse-block">
              <div className="section-title">Max Target Without Helium</div>
              {noHeliumTarget?.success ? (
                <>
                  <div className="reverse-value">
                    {formatPercentage(standardBlend.targetO2)} O2 / {formatPercentage(noHeliumTarget.targetHe)} He
                  </div>
                  <div className="reverse-actions">
                    <button
                      className="settings-button"
                      type="button"
                      onClick={() => updateField("targetHe", Number(noHeliumTarget.targetHe.toFixed(1)))}
                    >
                      Apply He%
                    </button>
                  </div>
                  <div className="table-note">O2 held at current target; remaining volume is N2.</div>
                </>
              ) : (
                <div className="warning">
                  {noHeliumTarget?.errors[0] ?? "Unable to determine a helium-free target."}
                </div>
              )}
            </div>
          </div>
        </AccordionItem>
      )}
    </>
  );
};

export default StandardBlendTab;
