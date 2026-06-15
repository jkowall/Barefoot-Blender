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
import { fromDisplayPressure } from "../utils/units";
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
      return {
        name: step.gas.name,
        amountPsi: step.amount,
        o2Psi: step.amount * o2Fraction,
        hePsi: step.amount * heFraction,
        n2Psi: step.amount * n2Fraction,
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

    return {
      bleedStep,
      effectiveStartPressurePsi,
      targetPressurePsi,
      startO2Fraction,
      startHeFraction,
      startN2Fraction,
      startO2Psi,
      startHePsi,
      startN2Psi,
      sourceRows,
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
            {!hasHeliumAvailable && (
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
                      title="Multi-Gas Math"
                      note="The optimizer searches feasible source combinations and ranks them by estimated cost. This panel explains the selected option."
                    >
                      {trainingMath.bleedStep !== undefined && (
                        <p>
                          This option starts with a bleed-down from {formatPressure(startPressurePsi, settings.pressureUnit)} to {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} before adding source gases.
                        </p>
                      )}
                      <div className="training-math-grid">
                        <div>
                          <h4>Source contributions</h4>
                          <ul>
                            <li>Start O2 partial pressure: {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.startO2Fraction, 3)} = {formatPressure(trainingMath.startO2Psi, settings.pressureUnit)}</li>
                            <li>Start He partial pressure: {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.startHeFraction, 3)} = {formatPressure(trainingMath.startHePsi, settings.pressureUnit)}</li>
                            <li>Start N2 partial pressure: {formatPressure(trainingMath.effectiveStartPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.startN2Fraction, 3)} = {formatPressure(trainingMath.startN2Psi, settings.pressureUnit)}</li>
                            {trainingMath.sourceRows.map((row) => (
                              <li key={`${row.name}-${row.amountPsi.toFixed(6)}`}>
                                {row.name}: {formatPressure(row.amountPsi, settings.pressureUnit)} at {formatNumber(row.o2Fraction, 3)} O2 / {formatNumber(row.heFraction, 3)} He / {formatNumber(row.n2Fraction, 3)} N2
                              </li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <h4>Final mix check</h4>
                          <ul>
                            <li>Final O2 = total O2 partial pressure / target pressure = {formatPressure(trainingMath.totalO2Psi, settings.pressureUnit)} / {formatPressure(trainingMath.targetPressurePsi, settings.pressureUnit)} = {formatNumber(selectedAlternative.finalO2, 1)}%</li>
                            <li>Final He = total He partial pressure / target pressure = {formatPressure(trainingMath.totalHePsi, settings.pressureUnit)} / {formatPressure(trainingMath.targetPressurePsi, settings.pressureUnit)} = {formatNumber(selectedAlternative.finalHe, 1)}%</li>
                            <li>Final N2 = total N2 partial pressure / target pressure = {formatPressure(trainingMath.totalN2Psi, settings.pressureUnit)} / {formatPressure(trainingMath.targetPressurePsi, settings.pressureUnit)} = {formatNumber(Math.max(0, 100 - selectedAlternative.finalO2 - selectedAlternative.finalHe), 1)}%</li>
                          </ul>
                        </div>
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
