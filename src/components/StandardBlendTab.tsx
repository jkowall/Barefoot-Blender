import { useEffect, useMemo, useState, type ChangeEvent, type FocusEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState, type StandardBlendInput } from "../state/session";
import {
  calculateStandardBlend,
  type BlendResult,
  type GasSelection,
  summarizeBlendVolumes,
  solveRequiredStartPressure,
  solveMaxTargetWithoutHelium
} from "../utils/calculations";
import { formatPercentage, formatPressure } from "../utils/format";
import { fromDisplayPressure, toDisplayPressure } from "../utils/units";

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const clampPressure = (value: number): number => Math.max(0, value);

const SENSITIVITY_RANGE_PSI = 300;
const SENSITIVITY_STEP_PSI = 10;
const SENSITIVITY_METRIC_STEP_PSI = 50;

type Props = {
  settings: SettingsSnapshot;
  topOffOptions: GasSelection[];
};

const StandardBlendTab = ({ settings, topOffOptions }: Props): JSX.Element => {
  const standardBlend = useSessionStore((state: SessionState) => state.standardBlend);
  const setStandardBlend = useSessionStore((state: SessionState) => state.setStandardBlend);
  const [result, setResult] = useState<BlendResult | null>(null);
  const [sensitivityDeltaPsi, setSensitivityDeltaPsi] = useState(0);

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

  useEffect(() => {
    if (sensitivityDeltaPsi < -negativeSensitivityLimitPsi) {
      setSensitivityDeltaPsi(-negativeSensitivityLimitPsi);
    } else if (sensitivityDeltaPsi > SENSITIVITY_RANGE_PSI) {
      setSensitivityDeltaPsi(SENSITIVITY_RANGE_PSI);
    }
  }, [negativeSensitivityLimitPsi, sensitivityDeltaPsi]);

  const baseVolumes = useMemo(() => {
    if (!result || !result.success) {
      return null;
    }
    if (result.steps.some((step) => step.kind === "bleed")) {
      return null;
    }
    return summarizeBlendVolumes(result);
  }, [result]);

  const updateField = (key: keyof StandardBlendInput, value: number): void => {
    setStandardBlend({ ...standardBlend, [key]: value });
  };

  const selectOnFocus = (event: FocusEvent<HTMLInputElement>): void => {
    event.target.select();
  };

  const onCalculate = (): void => {
    if (!selectedTopGas) {
      setResult(null);
      setSensitivityDeltaPsi(0);
      return;
    }

    const blendResult = calculateStandardBlend(
      { pressureUnit: settings.pressureUnit },
      standardBlend,
      selectedTopGas
    );
    setResult(blendResult);
    setSensitivityDeltaPsi(0);
  };

  const formatSignedPressure = (valuePsi: number): string => {
    const magnitude = formatPressure(Math.abs(valuePsi), settings.pressureUnit);
    if (valuePsi > 0) {
      return `+${magnitude}`;
    }
    if (valuePsi < 0) {
      return `-${magnitude}`;
    }
    return magnitude;
  };

  const sensitivityAnalysis = useMemo(() => {
    if (!selectedTopGas || !result || !result.success || !baseVolumes) {
      return null;
    }

    const computeBlend = (deltaPsi: number): BlendResult | null => {
      if (Math.abs(deltaPsi) <= 1e-6) {
        return result;
      }

      const adjustedStartPsi = Math.max(0, startPressurePsi + deltaPsi);
      const candidate: StandardBlendInput = {
        ...standardBlend,
        startPressure: toDisplayPressure(adjustedStartPsi, settings.pressureUnit)
      };
      return calculateStandardBlend({ pressureUnit: settings.pressureUnit }, candidate, selectedTopGas);
    };

    const currentBlend = computeBlend(sensitivityDeltaPsi);
    const adjustedStartPsi = Math.max(0, startPressurePsi + sensitivityDeltaPsi);
    const adjustedStartDisplay = toDisplayPressure(adjustedStartPsi, settings.pressureUnit);

    if (!currentBlend || !currentBlend.success) {
      return {
        available: false as const,
        deltaPsi: sensitivityDeltaPsi,
        adjustedStartPsi,
        adjustedStartDisplay,
        error: currentBlend?.errors[0] ?? "Unable to evaluate sensitivity."
      };
    }

    if (currentBlend.steps.some((step) => step.kind === "bleed")) {
      return {
        available: false as const,
        deltaPsi: sensitivityDeltaPsi,
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
      const targetDeltaPsi = sensitivityDeltaPsi + direction * SENSITIVITY_METRIC_STEP_PSI;
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
      deltaPsi: sensitivityDeltaPsi,
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
    negativeSensitivityLimitPsi,
    result,
    selectedTopGas,
    sensitivityDeltaPsi,
    settings.pressureUnit,
    standardBlend,
    startPressurePsi
  ]);

  const requiredStart = useMemo(() => {
    if (!result || !result.success || !selectedTopGas) {
      return null;
    }
    return solveRequiredStartPressure(
      { pressureUnit: settings.pressureUnit },
      standardBlend,
      selectedTopGas
    );
  }, [result, selectedTopGas, settings.pressureUnit, standardBlend]);

  const noHeliumTarget = useMemo(() => {
    if (!result || !result.success || !selectedTopGas) {
      return null;
    }
    return solveMaxTargetWithoutHelium(
      { pressureUnit: settings.pressureUnit },
      standardBlend,
      selectedTopGas
    );
  }, [result, selectedTopGas, settings.pressureUnit, standardBlend]);

  const sliderMinDisplay = toDisplayPressure(-negativeSensitivityLimitPsi, settings.pressureUnit);
  const sliderMaxDisplay = toDisplayPressure(SENSITIVITY_RANGE_PSI, settings.pressureUnit);
  const sliderValueDisplay = toDisplayPressure(sensitivityDeltaPsi, settings.pressureUnit);
  const sliderStepDisplay = Math.max(
    Math.abs(toDisplayPressure(SENSITIVITY_STEP_PSI, settings.pressureUnit)),
    settings.pressureUnit === "psi" ? 5 : 0.25
  );

  return (
    <>
      <section className="card">
        <h2>Start Tank</h2>
        <div className="grid two">
          <div className="field">
            <label>Start O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={standardBlend.startO2}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField("startO2", Number(event.target.value))
              }
              onBlur={() => updateField("startO2", clampPercent(standardBlend.startO2))}
            />
          </div>
          <div className="field">
            <label>Start He %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={standardBlend.startHe}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField("startHe", Number(event.target.value))
              }
              onBlur={() => updateField("startHe", clampPercent(standardBlend.startHe))}
            />
          </div>
          <div className="field">
            <label>Start Pressure ({settings.pressureUnit.toUpperCase()})</label>
            <input
              type="number"
              min={0}
              step={settings.pressureUnit === "psi" ? 10 : 1}
              value={standardBlend.startPressure}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField("startPressure", Number(event.target.value))
              }
              onBlur={() => updateField("startPressure", clampPressure(standardBlend.startPressure))}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Target Blend</h2>
        <div className="grid two">
          <div className="field">
            <label>Target O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={standardBlend.targetO2}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField("targetO2", Number(event.target.value))
              }
              onBlur={() => updateField("targetO2", clampPercent(standardBlend.targetO2))}
            />
          </div>
          <div className="field">
            <label>Target He %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={standardBlend.targetHe}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField("targetHe", Number(event.target.value))
              }
              onBlur={() => updateField("targetHe", clampPercent(standardBlend.targetHe))}
            />
          </div>
          <div className="field">
            <label>Target Pressure ({settings.pressureUnit.toUpperCase()})</label>
            <input
              type="number"
              min={0}
              step={settings.pressureUnit === "psi" ? 10 : 1}
              value={standardBlend.targetPressure}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField("targetPressure", Number(event.target.value))
              }
              onBlur={() => updateField("targetPressure", clampPressure(standardBlend.targetPressure))}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Top-Off Gas</h2>
        <div className="field">
          <label>Select Gas</label>
          <select
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
          </select>
        </div>
        <button className="calculate-button" type="button" onClick={onCalculate}>
          Calculate
        </button>
      </section>

      {result && (
        <section className="card">
          <h2>Blend Plan</h2>
          {!result.success && result.errors.length > 0 && (
            <div className="error">{result.errors[0]}</div>
          )}
          {result.success && result.steps.length === 0 && (
            <div className="error">No gas additions required.</div>
          )}
          {result.success && result.steps.length > 0 && (
            <ol className="result-list">
              {result.steps.map((step, index) => {
                if (step.kind === "bleed") {
                  const bleedTarget = result.bleedPressure ?? 0;
                  return (
                    <li key={step.kind}>
                      {index + 1}. BLEED tank down to {formatPressure(bleedTarget, settings.pressureUnit)}
                    </li>
                  );
                }

                const descriptor = step.kind === "topoff" ? "Top-off with" : "Add";
                const gasLabel = step.kind === "topoff" ? selectedTopGas?.name ?? step.gasName : step.gasName;
                return (
                  <li key={`${step.kind}-${index}`}>
                    {index + 1}. {descriptor} {formatPressure(step.amount, settings.pressureUnit)} {gasLabel}
                  </li>
                );
              })}
            </ol>
          )}
          {result.warnings.map((warning) => (
            <div key={warning} className="warning">
              {warning}
            </div>
          ))}
        </section>
      )}

      {result?.success && sensitivityAnalysis && (
        <section className="card">
          <h2>Fill Sensitivity</h2>
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
              {` (${formatSignedPressure(sensitivityAnalysis.deltaPsi)})`}
            </span>
          </div>

          {sensitivityAnalysis.available ? (
            <>
              <div className="grid three">
                <div className="stat">
                  <div className="stat-label">Helium Δ</div>
                  <div className="stat-value">{formatSignedPressure(sensitivityAnalysis.differenceFromBase.helium)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Oxygen Δ</div>
                  <div className="stat-value">{formatSignedPressure(sensitivityAnalysis.differenceFromBase.oxygen)}</div>
                </div>
                <div className="stat">
                  <div className="stat-label">Top-Off Δ</div>
                  <div className="stat-value">{formatSignedPressure(sensitivityAnalysis.differenceFromBase.topoff)}</div>
                </div>
              </div>

              <div className="sensitivity-per50">
                <div className="per50-block">
                  <div className="per50-title">+{formatPressure(SENSITIVITY_METRIC_STEP_PSI, "psi")}{settings.pressureUnit === "psi" ? "" : ` (~${formatPressure(SENSITIVITY_METRIC_STEP_PSI, settings.pressureUnit)})`}</div>
                  {sensitivityAnalysis.perPlus ? (
                    <ul>
                      <li>ΔHe {formatSignedPressure(sensitivityAnalysis.perPlus.difference.helium)}</li>
                      <li>ΔO2 {formatSignedPressure(sensitivityAnalysis.perPlus.difference.oxygen)}</li>
                      <li>ΔTop {formatSignedPressure(sensitivityAnalysis.perPlus.difference.topoff)}</li>
                    </ul>
                  ) : (
                    <div className="table-note">Out of range</div>
                  )}
                </div>
                <div className="per50-block">
                  <div className="per50-title">-{formatPressure(SENSITIVITY_METRIC_STEP_PSI, "psi")}{settings.pressureUnit === "psi" ? "" : ` (~${formatPressure(SENSITIVITY_METRIC_STEP_PSI, settings.pressureUnit)})`}</div>
                  {sensitivityAnalysis.perMinus ? (
                    <ul>
                      <li>ΔHe {formatSignedPressure(sensitivityAnalysis.perMinus.difference.helium)}</li>
                      <li>ΔO2 {formatSignedPressure(sensitivityAnalysis.perMinus.difference.oxygen)}</li>
                      <li>ΔTop {formatSignedPressure(sensitivityAnalysis.perMinus.difference.topoff)}</li>
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
        </section>
      )}

      {result?.success && (requiredStart || noHeliumTarget) && (
        <section className="card">
          <h2>Reverse Solvers</h2>
          <div className="grid two">
            <div className="reverse-block">
              <div className="section-title">Required Start Pressure (no helium)</div>
              {requiredStart?.success ? (
                <>
                  <div className="reverse-value">{formatPressure(requiredStart.startPressurePsi, settings.pressureUnit)}</div>
                  <div className="table-note">
                    Needs {formatSignedPressure(requiredStart.startPressurePsi - startPressurePsi)} relative to current start.
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
        </section>
      )}
    </>
  );
};

export default StandardBlendTab;
