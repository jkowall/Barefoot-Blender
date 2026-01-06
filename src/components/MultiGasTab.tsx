import { useMemo, type ChangeEvent, type FocusEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState, type MultiGasInput, type GasSourceInput } from "../state/session";
import { solveNGasBlend, type GasSelection, type BlendAlternative } from "../utils/calculations";
import { formatPressure } from "../utils/format";
import { AccordionItem } from "./Accordion";

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));
const clampPressure = (value: number): number => Math.max(0, value);

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

  const sanitizeCustomMix = (o2: number, he: number): { o2: number; he: number } => {
    const nextO2 = clampPercent(o2);
    const maxHe = 100 - nextO2;
    const nextHe = Math.min(maxHe, Math.max(0, he));
    return { o2: nextO2, he: nextHe };
  };

  // Check if helium is available from any source
  const hasHeliumAvailable = useMemo(() => {
    const resolveGas = (source: GasSourceInput): GasSelection | null => {
      if (source.id === "custom") {
        const o2Val = clampPercent(source.customO2 ?? 32);
        const heVal = Math.min(100 - o2Val, Math.max(0, source.customHe ?? 0));
        return { id: "custom", name: `Custom`, o2: o2Val, he: heVal };
      }
      return gasOptions.find((option) => option.id === source.id) ?? null;
    };

    if ((multiGas.startHe ?? 0) > 0) return true;

    for (const source of multiGas.gasSources) {
      if (!source.enabled) continue;
      const gas = resolveGas(source);
      if (gas && gas.he > 0) return true;
    }

    return false;
  }, [multiGas.startHe, multiGas.gasSources, gasOptions]);

  const updateField = (patch: Partial<MultiGasInput>): void => {
    setMultiGas({ ...multiGas, ...patch });
  };

  const selectOnFocus = (event: FocusEvent<HTMLInputElement>): void => {
    event.target.select();
  };

  const updateGasSource = (index: number, patch: Partial<GasSourceInput>): void => {
    const newSources = [...multiGas.gasSources];
    newSources[index] = { ...newSources[index], ...patch };
    updateField({ gasSources: newSources });
  };

  const addGasSource = (): void => {
    if (multiGas.gasSources.length >= MAX_GAS_SOURCES) return;
    const newSource: GasSourceInput = { id: "air", enabled: true };
    updateField({ gasSources: [...multiGas.gasSources, newSource] });
  };

  const removeGasSource = (index: number): void => {
    if (multiGas.gasSources.length <= 1) return;
    const newSources = multiGas.gasSources.filter((_, i) => i !== index);
    updateField({ gasSources: newSources });
  };

  // Cost settings from app settings
  const costSettings = useMemo(() => ({
    pricePerCuFtO2: settings.pricePerCuFtO2,
    pricePerCuFtHe: settings.pricePerCuFtHe,
    tankSizeCuFt: settings.defaultTankSizeCuFt,
    tankRatedPressure: settings.tankRatedPressure
  }), [settings]);

  // Compute blend result
  const blendResult = useMemo(() => {
    const resolveGas = (source: GasSourceInput): GasSelection | null => {
      if (source.id === "custom") {
        const o2Val = clampPercent(source.customO2 ?? 32);
        const heVal = Math.min(100 - o2Val, Math.max(0, source.customHe ?? 0));
        return { id: "custom", name: `Custom (${o2Val.toFixed(1)} O2 / ${heVal.toFixed(1)} He)`, o2: o2Val, he: heVal };
      }
      return gasOptions.find((option) => option.id === source.id) ?? null;
    };

    const enabledGases = multiGas.gasSources
      .filter(s => s.enabled)
      .map(s => resolveGas(s))
      .filter((g): g is GasSelection => g !== null);

    if (enabledGases.length === 0) {
      return null;
    }

    return solveNGasBlend(
      { pressureUnit: settings.pressureUnit },
      multiGas.targetPressure,
      multiGas.targetO2,
      hasHeliumAvailable ? (multiGas.targetHe ?? 0) : 0,
      multiGas.startPressure ?? 0,
      multiGas.startO2 ?? 21,
      multiGas.startHe ?? 0,
      enabledGases,
      costSettings,
      multiGas.selectedAlternativeIndex
    );
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

  // Build options list with custom option
  const getOptionsForSource = (source: GasSourceInput): GasSelection[] => {
    const custom: GasSelection = {
      id: "custom",
      name: `Custom (${(source.customO2 ?? 32).toFixed(1)} O2 / ${(source.customHe ?? 0).toFixed(1)} He)`,
      o2: source.customO2 ?? 32,
      he: source.customHe ?? 0
    };
    return [...gasOptions, custom, ...trimixPresets.filter(t => !gasOptions.some(g => g.id === t.id))];
  };

  return (
    <>
      <AccordionItem title="Start Tank" defaultOpen={true}>
        <div className="grid two">
          <div className="field">
            <label>Start O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={multiGas.startO2 ?? 21}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField({ startO2: clampPercent(Number(event.target.value)) })
              }
            />
          </div>
          <div className="field">
            <label>Start He %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={multiGas.startHe ?? 0}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField({ startHe: clampPercent(Number(event.target.value)) })
              }
            />
          </div>
          <div className="field">
            <label>Start Pressure ({settings.pressureUnit.toUpperCase()})</label>
            <input
              type="number"
              min={0}
              step={settings.pressureUnit === "psi" ? 10 : 1}
              value={multiGas.startPressure ?? 0}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField({ startPressure: clampPressure(Number(event.target.value)) })
              }
            />
          </div>
        </div>
      </AccordionItem>

      <AccordionItem title="Source Gases" defaultOpen={true}>
        {multiGas.gasSources.map((source, index) => (
          <div key={index} className="gas-source-row">
            <div className="grid two">
              <div className="field">
                <label>
                  Gas {index + 1}
                  {multiGas.gasSources.length > 1 && (
                    <button
                      type="button"
                      className="remove-gas-btn"
                      onClick={() => removeGasSource(index)}
                      title="Remove gas source"
                    >
                      ✕
                    </button>
                  )}
                </label>
                <select
                  value={source.id}
                  onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                    updateGasSource(index, { id: event.target.value })
                  }
                >
                  {getOptionsForSource(source).map((option: GasSelection) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Enabled</label>
                <input
                  type="checkbox"
                  checked={source.enabled}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    updateGasSource(index, { enabled: event.target.checked })
                  }
                />
              </div>
            </div>
            {source.id === "custom" && (
              <div className="field">
                <label>Custom Mix</label>
                <div className="dual-input">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={source.customO2 ?? 32}
                    onFocus={selectOnFocus}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const { o2, he } = sanitizeCustomMix(Number(event.target.value), source.customHe ?? 0);
                      updateGasSource(index, { customO2: o2, customHe: he });
                    }}
                  />
                  <span className="dual-separator">O2%</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={source.customHe ?? 0}
                    onFocus={selectOnFocus}
                    onChange={(event: ChangeEvent<HTMLInputElement>) => {
                      const { o2, he } = sanitizeCustomMix(source.customO2 ?? 32, Number(event.target.value));
                      updateGasSource(index, { customO2: o2, customHe: he });
                    }}
                  />
                  <span className="dual-separator">He%</span>
                </div>
                <div className="table-note">N2 auto-balances remaining fraction.</div>
              </div>
            )}
            {index < multiGas.gasSources.length - 1 && <hr className="gas-source-divider" />}
          </div>
        ))}
        {multiGas.gasSources.length < MAX_GAS_SOURCES && (
          <button type="button" className="add-gas-btn" onClick={addGasSource}>
            + Add Gas Source
          </button>
        )}
      </AccordionItem>

      <AccordionItem title="Target Blend" defaultOpen={true}>
        <div className="grid two">
          <div className="field">
            <label>Target O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={multiGas.targetO2}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField({ targetO2: clampPercent(Number(event.target.value)) })
              }
            />
          </div>
          <div className="field">
            <label>Target He %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={hasHeliumAvailable ? (multiGas.targetHe ?? 0) : 0}
              disabled={!hasHeliumAvailable}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField({ targetHe: clampPercent(Number(event.target.value)) })
              }
            />
            {!hasHeliumAvailable && (
              <div className="table-note">No helium source available. Add a trimix gas or helium to the start tank.</div>
            )}
          </div>
          <div className="field">
            <label>Target Pressure ({settings.pressureUnit.toUpperCase()})</label>
            <input
              type="number"
              min={0}
              step={settings.pressureUnit === "psi" ? 10 : 1}
              value={multiGas.targetPressure}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField({ targetPressure: clampPressure(Number(event.target.value)) })
              }
            />
          </div>
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
                      const displayAmount = Math.abs(step.amount);
                      return (
                        <li key={index} className={isBleed ? "bleed-step" : ""}>
                          {index + 1}. {action} {step.gas}: {formatPressure(displayAmount, settings.pressureUnit)}
                          <span className="result-step-total">
                            {"->"} Tank @ {formatPressure(runningTotal, settings.pressureUnit)}
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
    </>
  );
};

export default MultiGasTab;
