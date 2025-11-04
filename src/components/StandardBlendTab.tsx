import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState, type StandardBlendInput } from "../state/session";
import {
  calculateStandardBlend,
  projectTopOffChart,
  type BlendResult,
  type GasSelection,
  type TopOffProjectionRow
} from "../utils/calculations";
import { formatPercentage, formatPressure } from "../utils/format";

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const clampPressure = (value: number): number => Math.max(0, value);

type Props = {
  settings: SettingsSnapshot;
  topOffOptions: GasSelection[];
};

const StandardBlendTab = ({ settings, topOffOptions }: Props): JSX.Element => {
  const standardBlend = useSessionStore((state: SessionState) => state.standardBlend);
  const setStandardBlend = useSessionStore((state: SessionState) => state.setStandardBlend);
  const [result, setResult] = useState<BlendResult | null>(null);
  const [topOffChart, setTopOffChart] = useState<TopOffProjectionRow[] | null>(null);

  const selectedTopGas = useMemo(() => {
    const match = topOffOptions.find((option) => option.id === standardBlend.topGasId);
    return match ?? topOffOptions[0];
  }, [standardBlend.topGasId, topOffOptions]);

  useEffect(() => {
    if (selectedTopGas && selectedTopGas.id !== standardBlend.topGasId) {
      setStandardBlend({ ...standardBlend, topGasId: selectedTopGas.id });
    }
  }, [selectedTopGas, standardBlend, setStandardBlend]);

  const updateField = (key: keyof StandardBlendInput, value: number): void => {
    setStandardBlend({ ...standardBlend, [key]: value });
  };

  const onCalculate = (): void => {
    if (!selectedTopGas) {
      setResult(null);
      setTopOffChart(null);
      return;
    }

    const blendResult = calculateStandardBlend(
      { pressureUnit: settings.pressureUnit },
      standardBlend,
      selectedTopGas
    );
    setResult(blendResult);

    const shouldProject =
      blendResult.success &&
      blendResult.steps.every((step) => step.kind !== "bleed") &&
      standardBlend.startPressure > 0;

    if (shouldProject) {
      setTopOffChart(projectTopOffChart({ pressureUnit: settings.pressureUnit }, standardBlend, selectedTopGas));
    } else {
      setTopOffChart(null);
    }
  };

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

      {topOffChart && topOffChart.length > 0 && (
        <section className="card">
          <h2>Top-Off Chart</h2>
          <table>
            <thead>
              <tr>
                <th>Start Pressure</th>
                <th>Add He</th>
                <th>Add O2</th>
                <th>Top-Off Gas</th>
              </tr>
            </thead>
            <tbody>
              {topOffChart.map((row, index) => {
                return (
                  <tr key={index}>
                    <td>{formatPressure(row.startPressure, settings.pressureUnit)} {index === 0 && <span className="tag">Actual</span>}</td>
                    <td>{row.feasible && row.helium !== null ? formatPressure(row.helium, settings.pressureUnit) : "Drain"}</td>
                    <td>{row.feasible && row.oxygen !== null ? formatPressure(row.oxygen, settings.pressureUnit) : "Drain"}</td>
                    <td>{row.feasible && row.topGas !== null ? formatPressure(row.topGas, settings.pressureUnit) : "Drain"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="table-note">Projection assumes identical gas banks and topping strategy.</div>
        </section>
      )}
    </>
  );
};

export default StandardBlendTab;
