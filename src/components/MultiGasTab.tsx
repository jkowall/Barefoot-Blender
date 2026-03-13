import { useMemo } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState, type MultiGasInput, type GasSourceInput } from "../state/session";
import {
  solveNGasBlend,
  type GasSelection,
  type BlendAlternative,
  type CostSettings,
  type OptimizerGasSource,
  clampPercent
} from "../utils/calculations";
import { formatPressure, formatSignedPressure } from "../utils/format";
import { fromDisplayPressure } from "../utils/units";
import { AccordionItem } from "./Accordion";
import ErrorBoundary from "./ErrorBoundary";
import { NumberInput } from "./NumberInput";
import { GasSourceRow } from "./GasSourceRow";


const MAX_GAS_SOURCES = 4;

const trimixPresets: GasSelection[] = [
  { id: "trimix-2135", name: "Trimix 21/35", o2: 21, he: 35 },
  { id: "trimix-1845", name: "Trimix 18/45", o2: 18, he: 45 },
  { id: "trimix-1555", name: "Trimix 15/55", o2: 15, he: 55 }
];

type Props = {
  settings: SettingsSnapshot;
  topOffOptions: GasSelection[];
};

const MultiGasTab = ({ settings, topOffOptions }: Props): JSX.Element => {
  const multiGas = useSessionStore((state: SessionState) => state.multiGas);
  const setMultiGas = useSessionStore((state: SessionState) => state.setMultiGas);

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

    for (const [index, source] of (multiGas.gasSources ?? []).entries()) {
      if (!source.enabled) continue;
      const gas = resolveGas(source, index);
      if (gas && gas.he > 0) return true;
    }

    return false;
  }, [multiGas.startHe, multiGas.gasSources, gasOptions, settings.pressureUnit]);

  const updateField = (patch: Partial<MultiGasInput>): void => {
    setMultiGas({ ...multiGas, ...patch });
  };

  const updateGasSource = (index: number, patch: Partial<GasSourceInput>): void => {
    const newSources = [...(multiGas.gasSources ?? [])];
    if (!newSources[index]) return;
    newSources[index] = { ...newSources[index], ...patch };
    updateField({ gasSources: newSources });
  };

  const addGasSource = (): void => {
    const sources = multiGas.gasSources ?? [];
    if (sources.length >= MAX_GAS_SOURCES) return;
    const newSource: GasSourceInput = { id: "air", enabled: true };
    updateField({ gasSources: [...sources, newSource] });
  };

  const removeGasSource = (index: number): void => {
    const sources = multiGas.gasSources ?? [];
    if (sources.length <= 1) return;
    const newSources = sources.filter((_, i) => i !== index);
    updateField({ gasSources: newSources });
  };

  // Cost settings from app settings
  const costSettings = useMemo<CostSettings>(() => ({
    pricePerCuFtO2: settings.pricePerCuFtO2 ?? 1.0,
    pricePerCuFtHe: settings.pricePerCuFtHe ?? 3.5,
    pricePerCuFtAir: settings.pricePerCuFtAir ?? 0.1,
    tankSizeCuFt: settings.defaultTankSizeCuFt ?? 80,
    tankRatedPressure: settings.tankRatedPressure ?? 3000
  }), [
    settings.defaultTankSizeCuFt,
    settings.pricePerCuFtAir,
    settings.pricePerCuFtHe,
    settings.pricePerCuFtO2,
    settings.tankRatedPressure
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

    const sources = multiGas.gasSources ?? [];
    const enabledGases = sources
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
        costSettings,
        multiGas.selectedAlternativeIndex
      );
    } catch (err) {
      console.error("MultiGas calculation error:", err);
      return {
        success: false,
        alternatives: [],
        selectedIndex: 0,
        error: `Calculation error: ${err instanceof Error ? err.message : String(err)}`,
        warnings: []
      };
    }
  }, [multiGas, settings.pressureUnit, costSettings, hasHeliumAvailable, gasOptions]);

  const selectedAlternative: BlendAlternative | null = useMemo(() => {
    if (!blendResult?.success || blendResult.alternatives.length === 0) return null;
    return blendResult.alternatives[blendResult.selectedIndex] ?? null;
  }, [blendResult]);

  const selectAlternative = (index: number): void => {
    updateField({ selectedAlternativeIndex: index });
  };

  const formatCost = (cost: number): string => {
    return `$${cost.toFixed(2)}`;
  };

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

      <AccordionItem title="Source Gases" defaultOpen={true}>
        {(multiGas.gasSources ?? []).map((source, index) => (
          <GasSourceRow
            key={index}
            index={index}
            source={source}
            baseOptions={gasOptions}
            onUpdate={updateGasSource}
            onRemove={removeGasSource}
            canRemove={(multiGas.gasSources ?? []).length > 1}
            showDivider={index < (multiGas.gasSources ?? []).length - 1}
            pressureUnit={settings.pressureUnit}
          />
        ))}
        <div className="table-note">Set bank pressure limits per source to constrain optimization to currently available gas.</div>
        {(multiGas.gasSources ?? []).length < MAX_GAS_SOURCES && (
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
                    key={index}
                    className={`alternative-option ${index === blendResult.selectedIndex ? 'selected' : ''}`}
                    onClick={() => selectAlternative(index)}
                  >
                    <div className="alternative-header">
                      <input
                        type="radio"
                        name="blend-alternative"
                        checked={index === blendResult.selectedIndex}
                        onChange={() => selectAlternative(index)}
                      />
                      <span className="alternative-title">Option {index + 1}</span>
                      <span className="alternative-cost">{formatCost(alt.estimatedCost)}</span>
                    </div>
                    <div className="alternative-gases">
                      {alt.costBreakdown.map((item, i) => (
                        <span key={i} className="alternative-gas">
                          {item.gas}: {formatPressure(item.amount, settings.pressureUnit)}
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
                      let runningTotal = multiGas.startPressure ?? 0;
                      for (let i = 0; i <= index; i++) {
                        runningTotal += selectedAlternative.fillOrder[i].amount;
                      }
                      runningTotal = Math.max(0, runningTotal);
                      const isBleed = step.amount < 0;
                      const action = isBleed ? "Drain" : "Add";
                      return (
                        <li key={index} className={isBleed ? "bleed-step" : ""}>
                          {index + 1}. {action} {step.gas}: {formatPressure(runningTotal, settings.pressureUnit)}
                          <span className="result-step-total">
                            ({formatSignedPressure(step.amount, settings.pressureUnit)})
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
                </div>
              )}
            </>
          )}

          {blendResult.warnings.length > 0 && (
            <div className="warnings">
              {blendResult.warnings.map((warning, i) => (
                <div key={i} className="warning">{warning}</div>
              ))}
            </div>
          )}
        </AccordionItem>
      )}
    </ErrorBoundary>
  );
};

export default MultiGasTab;
