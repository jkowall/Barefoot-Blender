import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState, type TopOffInput } from "../state/session";
import {
  calculateTopOffBlend,
  type GasSelection,
  type TopOffResult
} from "../utils/calculations";
import { formatPercentage, formatPressure } from "../utils/format";

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));
const clampPressure = (value: number): number => Math.max(0, value);

type Props = {
  settings: SettingsSnapshot;
  topOffOptions: GasSelection[];
};

const TopOffTab = ({ settings, topOffOptions }: Props): JSX.Element => {
  const topOff = useSessionStore((state: SessionState) => state.topOff);
  const setTopOff = useSessionStore((state: SessionState) => state.setTopOff);
  const [result, setResult] = useState<TopOffResult | null>(null);

  const selectedTopGas = useMemo(() => {
    const match = topOffOptions.find((option) => option.id === topOff.topGasId);
    return match ?? topOffOptions[0];
  }, [topOff.topGasId, topOffOptions]);

  useEffect(() => {
    if (selectedTopGas && selectedTopGas.id !== topOff.topGasId) {
      setTopOff({ ...topOff, topGasId: selectedTopGas.id });
    }
  }, [selectedTopGas, topOff, setTopOff]);

  function updateField<K extends keyof TopOffInput>(key: K, value: TopOffInput[K]): void {
    setTopOff({ ...topOff, [key]: value });
  }

  const onCalculate = (): void => {
    if (!selectedTopGas) {
      setResult(null);
      return;
    }

    const outcome = calculateTopOffBlend(
      { pressureUnit: settings.pressureUnit },
      topOff,
      selectedTopGas
    );
    setResult(outcome);
  };

  return (
    <>
      <section className="card">
        <h2>Start Tank</h2>
        <div className="grid two">
          <div className="field">
            <label>Current O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={topOff.startO2}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField("startO2", Number(event.target.value))
              }
              onBlur={() => updateField("startO2", clampPercent(topOff.startO2))}
            />
          </div>
          <div className="field">
            <label>Current He %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={topOff.startHe}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField("startHe", Number(event.target.value))
              }
              onBlur={() => updateField("startHe", clampPercent(topOff.startHe))}
            />
          </div>
          <div className="field">
            <label>Current Pressure ({settings.pressureUnit.toUpperCase()})</label>
            <input
              type="number"
              min={0}
              step={settings.pressureUnit === "psi" ? 10 : 1}
              value={topOff.startPressure}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField("startPressure", Number(event.target.value))
              }
              onBlur={() => updateField("startPressure", clampPressure(topOff.startPressure))}
            />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>Top-Off Goal</h2>
        <div className="field">
          <label>Final Pressure ({settings.pressureUnit.toUpperCase()})</label>
          <input
            type="number"
            min={0}
            step={settings.pressureUnit === "psi" ? 10 : 1}
            value={topOff.finalPressure}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateField("finalPressure", Number(event.target.value))
            }
            onBlur={() => updateField("finalPressure", clampPressure(topOff.finalPressure))}
          />
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
          <h2>Top-Off Outcome</h2>
          {!result.success && result.errors.length > 0 && (
            <div className="error">{result.errors[0]}</div>
          )}
          {result.success && (
            <div className="grid three">
              <div className="stat">
                <div className="stat-label">Final O2</div>
                <div className="stat-value">{formatPercentage(result.finalO2)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Final He</div>
                <div className="stat-value">{formatPercentage(result.finalHe)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Final N2</div>
                <div className="stat-value">{formatPercentage(result.finalN2)}</div>
              </div>
            </div>
          )}
          {result.success && (
            <div className="result-note">
              Add {formatPressure(result.addedPressure, settings.pressureUnit)} of {selectedTopGas?.name ?? "chosen gas"} to reach
              {" "}
              {formatPressure(result.finalPressure, settings.pressureUnit)}.
            </div>
          )}
          {result.warnings.map((warning) => (
            <div key={warning} className="warning">
              {warning}
            </div>
          ))}
        </section>
      )}
    </>
  );
};

export default TopOffTab;
