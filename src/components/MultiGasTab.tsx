import { useMemo, useState } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState, type MultiGasInput, type GasSourceInput } from "../state/session";
import {
  solveNGasBlend,
  type GasSelection,
  type BlendAlternative,
  type CostSettings,
  type OptimizerGasSource,
  clampPercent,
  cuFtToLiters,
  pressureToCuFt
} from "../utils/calculations";
import { formatNumber, formatPressure, formatSignedPressure } from "../utils/format";
import { fromDisplayPressure, toDisplayPressure } from "../utils/units";
import { logger } from "../utils/logger";
import { AccordionItem } from "./Accordion";
import ErrorBoundary from "./ErrorBoundary";
import { NumberInput } from "./NumberInput";
import { GasSourceRow } from "./GasSourceRow";
import TankContextFields from "./TankContextFields";
import TrainingMathPanel from "./TrainingMathPanel";


const MAX_GAS_SOURCES = 4;
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

const costLineKey = (line: { gas: string; amount: number; cost: number }): string =>
  `${line.gas}-${line.amount.toFixed(6)}-${line.cost.toFixed(2)}`;

const MultiGasTab = ({ settings, topOffOptions, trainingModeEnabled }: Props): JSX.Element => {
  const multiGas = useSessionStore((state: SessionState) => state.multiGas);
  const setMultiGas = useSessionStore((state: SessionState) => state.setMultiGas);
  const gasSources = multiGas.gasSources ?? EMPTY_GAS_SOURCES;
  const [gasSourceRowKeys, setGasSourceRowKeys] = useState<string[]>(() =>
    gasSources.map(() => createGasSourceRowKey())
  );
  const tankSizeCuFt = multiGas.tankSizeCuFt ?? settings.defaultTankSizeCuFt ?? 80;
  const tankRatedPressurePsi = multiGas.tankRatedPressurePsi ?? settings.tankRatedPressure ?? 3000;
  const startPressurePsi = fromDisplayPressure(multiGas.startPressure ?? 0, settings.pressureUnit);
  const targetHeRequested = (multiGas.targetHe ?? 0) > 0.000001;

  // Build available gas options from presets and custom banks
  const gasOptions = useMemo(() => {
    return [
      ...topOffOptions,
      ...trimixPresets
    ];
  }, [topOffOptions]);

  // Check if helium is available from any source
  const hasHeliumAvailable = useMemo(() => {
    const resolveGas = (source: GasSourceInput, index: number): OptimizerGasSource | null => {
      if (source.id === "custom") {
        const o2Val = clampPercent(source.customO2 ?? 32);
        const heVal = Math.min(100 - o2Val, Math.max(0, source.customHe ?? 0));
        return {
          id: `custom-${index}`,
          name: "Custom",
          o2: o2Val,
          he: heVal,
          maxPressurePsi: source.maxPressure === undefined
            ? undefined
            : fromDisplayPressure(Math.max(0, source.maxPressure), settings.pressureUnit)
        };
      }
      const option = gasOptions.find((entry) => entry.id === source.id);
      if (!option) {
        return null;
      }
      return {
        ...option,
        id: `${option.id}-${index}`,
        maxPressurePsi: source.maxPressure === undefined
          ? undefined
          : fromDisplayPressure(Math.max(0, source.maxPressure), settings.pressureUnit)
      };
    };

    if ((multiGas.startHe ?? 0) > 0) return true;

    for (const [index, source] of gasSources.entries()) {
      if (!source.enabled) continue;
      const gas = resolveGas(source, index);
      if (gas && gas.he > 0) return true;
    }

    return false;
  }, [multiGas.startHe, gasSources, gasOptions, settings.pressureUnit]);

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

  // Compute blend result
  const blendResult = useMemo(() => {
    const resolveGas = (source: GasSourceInput, index: number): OptimizerGasSource | null => {
      if (source.id === "custom") {
        const o2Val = clampPercent(source.customO2 ?? 32);
        const heVal = Math.min(100 - o2Val, Math.max(0, source.customHe ?? 0));
        return {
          id: `custom-${index}`,
          name: `Custom (${o2Val.toFixed(1)} O2 / ${heVal.toFixed(1)} He)`,
          o2: o2Val,
          he: heVal,
          maxPressurePsi: source.maxPressure === undefined
            ? undefined
            : fromDisplayPressure(Math.max(0, source.maxPressure), settings.pressureUnit)
        };
      }
      const option = gasOptions.find((entry) => entry.id === source.id);
      if (!option) {
        return null;
      }
      return {
        ...option,
        id: `${option.id}-${index}`,
        maxPressurePsi: source.maxPressure === undefined
          ? undefined
          : fromDisplayPressure(Math.max(0, source.maxPressure), settings.pressureUnit)
      };
    };

    const enabledGases = gasSources
      .filter(s => s.enabled)
      .map((source, index) => resolveGas(source, index))
      .filter((g): g is OptimizerGasSource => g !== null);

    if (enabledGases.length === 0) {
      return null;
    }

    try {
      return solveNGasBlend(
        { pressureUnit: settings.pressureUnit },
        multiGas.targetPressure ?? 0,
        multiGas.targetO2 ?? 32,
        hasHeliumAvailable ? (multiGas.targetHe ?? 0) : 0,
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
  }, [multiGas, settings.pressureUnit, costSettings, hasHeliumAvailable, gasOptions, gasSources]);

  const selectedIndex = useMemo(() => {
    if (!blendResult?.success || blendResult.alternatives.length === 0) return 0;
    return Math.min(multiGas.selectedAlternativeIndex ?? 0, blendResult.alternatives.length - 1);
  }, [blendResult, multiGas.selectedAlternativeIndex]);

  const selectedAlternative: BlendAlternative | null = useMemo(() => {
    if (!blendResult?.success || blendResult.alternatives.length === 0) return null;
    return blendResult.alternatives[selectedIndex] ?? null;
  }, [blendResult, selectedIndex]);

  const selectAlternative = (index: number): void => {
    updateField({ selectedAlternativeIndex: index });
  };

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(2)}`;
  };

  const formatGasVolume = (pressurePsi: number): string => {
    const volumeCuFt = pressureToCuFt(pressurePsi, tankSizeCuFt, tankRatedPressurePsi);
    const volumeLiters = cuFtToLiters(volumeCuFt);
    return `${formatNumber(volumeCuFt, 2)} cu ft, ${formatNumber(volumeLiters, 2)} L`;
  };

  const trainingMath = useMemo(() => {
    if (!trainingModeEnabled || !selectedAlternative) {
      return null;
    }

    const targetPressurePsi = fromDisplayPressure(multiGas.targetPressure ?? 0, settings.pressureUnit);
    const bleedStep = selectedAlternative.fillOrder.find((step) => step.amount < 0);
    const effectiveStartPressurePsi = Math.max(0, startPressurePsi + (bleedStep?.amount ?? 0));
    const startO2Fraction = (multiGas.startO2 ?? 21) / 100;
    const startHeFraction = (multiGas.startHe ?? 0) / 100;
    const startN2Fraction = Math.max(0, 1 - startO2Fraction - startHeFraction);

    const sourceRows = selectedAlternative.steps.map((step) => {
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
    const targetO2Percent = selectedAlternative.finalO2;
    const targetHePercent = selectedAlternative.finalHe;
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
    selectedAlternative,
    settings.pressureUnit,
    startPressurePsi,
    trainingModeEnabled
  ]);

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
        </div>
      </AccordionItem>

      {blendResult && (
        <AccordionItem title="Blend Options" defaultOpen={true}>
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
                        checked={index === selectedIndex}
                        onChange={() => selectAlternative(index)}
                      />
                      <span className="alternative-title">Option {index + 1}</span>
                      <span className="alternative-cost">{formatCost(alt.estimatedCost)}</span>
                    </div>
                    <div className="alternative-gases">
                      {alt.costBreakdown.map((item) => (
                        <span key={costLineKey(item)} className="alternative-gas">
                          {item.gas}: {formatPressure(item.amount, settings.pressureUnit)}, {formatGasVolume(item.amount)}
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
                            {!isBleed ? `, ${formatGasVolume(step.amount)}` : ""})
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
                          <span>
                            {formatPressure(line.amount, settings.pressureUnit)}, {formatGasVolume(line.amount)} = {formatCost(line.cost)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <div className="table-note">Tank basis: {formatNumber(tankSizeCuFt, 2)} cu ft @ {formatNumber(tankRatedPressurePsi, 0)} PSI.</div>
                  </div>
                  {trainingMath && (
                    <TrainingMathPanel
                      title="Multi-Gas Hand Check"
                      note="This shows the classroom pressure-percent check for the selected option. The app may search more combinations, but the selected fill can still be checked by hand."
                    >
                      {settings.gasModel === "gerg2008" && (
                        <div className="training-math-note">
                          GERG-2008 is selected for Standard Blend. Multi-Gas uses the ideal pressure-point balance shown below.
                        </div>
                      )}
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
                              <li>Final O2% = total O2 points / target pressure = {formatNumber(trainingMath.totalO2PointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(selectedAlternative.finalO2, 1)}%</li>
                              <li>Final He% = total He points / target pressure = {formatNumber(trainingMath.totalHePointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(selectedAlternative.finalHe, 1)}%</li>
                              <li>Final N2% = total N2 points / target pressure = {formatNumber(trainingMath.totalN2PointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(Math.max(0, 100 - selectedAlternative.finalO2 - selectedAlternative.finalHe), 1)}%</li>
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
                              <li>Final O2% = total O2 points / target pressure = {formatNumber(trainingMath.totalO2PointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(selectedAlternative.finalO2, 1)}%</li>
                              <li>Final He% = total He points / target pressure = {formatNumber(trainingMath.totalHePointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(selectedAlternative.finalHe, 1)}%</li>
                              <li>Final N2% = total N2 points / target pressure = {formatNumber(trainingMath.totalN2PointsDisplay, 0)} / {formatNumber(trainingMath.targetPressureDisplay, 1)} = {formatNumber(Math.max(0, 100 - selectedAlternative.finalO2 - selectedAlternative.finalHe), 1)}%</li>
                            </ul>
                          </>
                        )}
                      </div>
                    </TrainingMathPanel>
                  )}
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
        </AccordionItem>
      )}
    </ErrorBoundary>
  );
};

export default MultiGasTab;
