import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import {
  useSessionStore,
  type SessionState,
  type StandardBlendInput,
  type StandardBlendHistoryEntry
} from "../state/session";
import {
  calculateStandardBlend,
  type BlendResult,
  type GasSelection,
  summarizeBlendVolumes,
  solveRequiredStartPressure,
  solveMaxTargetWithoutHelium,
  calculateFillCostEstimate,
  clampPercent
} from "../utils/calculations";
import { formatPercentage, formatPressure, formatSignedPressure } from "../utils/format";
import { fromDisplayPressure, toDisplayPressure } from "../utils/units";
import { AccordionItem } from "./Accordion";
import { NumberInput } from "./NumberInput";
import { SelectInput } from "./SelectInput";


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
  const standardBlendHistory = useSessionStore((state: SessionState) => state.standardBlendHistory);
  const setStandardBlend = useSessionStore((state: SessionState) => state.setStandardBlend);
  const addStandardBlendHistory = useSessionStore((state: SessionState) => state.addStandardBlendHistory);
  const removeStandardBlendHistory = useSessionStore((state: SessionState) => state.removeStandardBlendHistory);
  const clearStandardBlendHistory = useSessionStore((state: SessionState) => state.clearStandardBlendHistory);
  const [result, setResult] = useState<BlendResult | null>(null);
  const [sensitivityDeltaPsi, setSensitivityDeltaPsi] = useState(0);
  const [planOpen, setPlanOpen] = useState(false);

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
        pricePerCuFtAir: settings.pricePerCuFtAir ?? 0.1,
        tankSizeCuFt: settings.defaultTankSizeCuFt ?? 80,
        tankRatedPressure: settings.tankRatedPressure ?? 3000
      }
    );
  }, [
    baseVolumes,
    selectedTopGas,
    settings.defaultTankSizeCuFt,
    settings.pricePerCuFtAir,
    settings.pricePerCuFtHe,
    settings.pricePerCuFtO2,
    settings.tankRatedPressure
  ]);

  const updateField = <K extends keyof StandardBlendInput>(key: K, value: StandardBlendInput[K]): void => {
    setStandardBlend({ ...standardBlend, [key]: value });
  };

  const onCalculate = (): void => {
    if (!selectedTopGas) {
      setResult(null);
      setSensitivityDeltaPsi(0);
      return;
    }

    const resolvedInput: StandardBlendInput = {
      ...standardBlend,
      startPressure: standardBlend.startPressure ?? 0,
      targetPressure: standardBlend.targetPressure ?? 3000,
      targetO2: standardBlend.targetO2 ?? 32,
      startO2: standardBlend.startO2 ?? 21,
      startHe: standardBlend.startHe ?? 0,
      targetHe: standardBlend.targetHe ?? 0
    };

    const blendResult = calculateStandardBlend(
      { pressureUnit: settings.pressureUnit },
      resolvedInput,
      selectedTopGas
    );

    if (blendResult.success && blendResult.steps.length > 0) {
      const volumes = summarizeBlendVolumes(blendResult);
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
          pricePerCuFtAir: settings.pricePerCuFtAir ?? 0.1,
          tankSizeCuFt: settings.defaultTankSizeCuFt ?? 80,
          tankRatedPressure: settings.tankRatedPressure ?? 3000
        }
      );

      const historyEntry: StandardBlendHistoryEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        createdAt: new Date().toISOString(),
        startPressurePsi: fromDisplayPressure(resolvedInput.startPressure, settings.pressureUnit),
        targetPressurePsi: fromDisplayPressure(resolvedInput.targetPressure, settings.pressureUnit),
        startO2: resolvedInput.startO2 ?? 21,
        startHe: resolvedInput.startHe ?? 0,
        targetO2: resolvedInput.targetO2 ?? 32,
        targetHe: resolvedInput.targetHe ?? 0,
        topGasId: selectedTopGas.id,
        topGasName: selectedTopGas.name,
        estimatedCost: estimate.totalCost,
        steps: blendResult.steps.map((step) => ({
          kind: step.kind,
          amountPsi: step.amount,
          gasName: step.kind === "topoff" ? selectedTopGas.name : step.gasName
        }))
      };
      addStandardBlendHistory(historyEntry);
    }

    setResult(blendResult);
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
      topGasId: entry.topGasId
    });
    setResult(null);
    setSensitivityDeltaPsi(0);
    setPlanOpen(false);
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
        startPressure: toDisplayPressure(adjustedStartPsi, settings.pressureUnit),
        targetPressure: standardBlend.targetPressure ?? 3000,
        targetO2: standardBlend.targetO2 ?? 32,
        startO2: standardBlend.startO2 ?? 21,
        startHe: standardBlend.startHe ?? 0,
        targetHe: standardBlend.targetHe ?? 0
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
  }, [result, selectedTopGas, settings.pressureUnit, standardBlend]);

  const noHeliumTarget = useMemo(() => {
    if (!result || !result.success || !selectedTopGas) {
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
          {result.success && result.steps.length > 0 && (() => {
            let runningPsi = fromDisplayPressure(standardBlend.startPressure, settings.pressureUnit);
            return (
              <ol className="result-list">
                {result.steps.map((step, index) => {
                  if (step.kind === "bleed") {
                    const bleedTargetPsi = result.bleedPressure ?? Math.max(0, runningPsi - step.amount);
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
                    <li key={`${step.kind}-${index}`}>
                      {index + 1}. {descriptor} {gasLabel}: {formatPressure(runningPsi, settings.pressureUnit)}
                      <span className="result-step-total"> ({formatSignedPressure(step.amount, settings.pressureUnit)})</span>
                    </li>
                  );
                })}
              </ol>
            );
          })()}
          {result.warnings.map((warning) => (
            <div key={warning} className="warning">
              {warning}
            </div>
          ))}
          {fillCost && fillCost.lines.length > 0 && (
            <div className="cost-breakdown">
              <div className="section-title">Fill Cost</div>
              <div className="grid two">
                {fillCost.lines.map((line) => (
                  <div key={line.label} className="cost-line">
                    <span>{line.label}:</span>
                    <span>{line.volumeCuFt.toFixed(2)} cu ft × ${line.unitPrice.toFixed(2)} = ${line.cost.toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="cost-total">
                <strong>Total: ${fillCost.totalCost.toFixed(2)}</strong>
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
                    <div className="table-note">Estimated Cost: ${entry.estimatedCost.toFixed(2)}</div>
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
