import { useMemo, useState, type ChangeEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState, type MultiGasInput } from "../state/session";
import { calculateMultiGasBlend, type GasSelection } from "../utils/calculations";
import { formatPressure } from "../utils/format";

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

type Props = {
  settings: SettingsSnapshot;
  topOffOptions: GasSelection[];
};

const MultiGasTab = ({ settings, topOffOptions }: Props): JSX.Element => {
  const multiGas = useSessionStore((state: SessionState) => state.multiGas);
  const setMultiGas = useSessionStore((state: SessionState) => state.setMultiGas);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; amount: number }[] | null>(null);

  const options = useMemo(() => [{ id: "custom", name: "Custom", o2: 0, he: 0 }, ...topOffOptions], [topOffOptions]);

  const resolveGasSelection = (id: string, customO2?: number): GasSelection | null => {
    if (id === "custom") {
      const o2 = customO2 ?? 32;
      return { id: "custom", name: `Custom (${o2.toFixed(1)}% O2)`, o2, he: 0 };
    }
    return topOffOptions.find((option) => option.id === id) ?? null;
  };

  const updateField = (patch: Partial<MultiGasInput>): void => {
    setMultiGas({ ...multiGas, ...patch });
  };

  const onCalculate = (): void => {
    const gas1 = resolveGasSelection(multiGas.gas1Id, multiGas.gas1CustomO2);
    const gas2 = resolveGasSelection(multiGas.gas2Id, multiGas.gas2CustomO2);

    if (!gas1 || !gas2) {
      setError("Please select both source gases.");
      setResult(null);
      return;
    }

    const outcome = calculateMultiGasBlend(
      { pressureUnit: settings.pressureUnit },
      multiGas,
      gas1,
      gas2
    );

    if (!outcome.success) {
      setError(outcome.error ?? "Blend cannot be computed.");
      setResult(null);
      return;
    }

    setError(null);
    setResult([
      { label: `Add ${gas1.name}`, amount: outcome.steps[0].amount },
      { label: `Add ${gas2.name}`, amount: outcome.steps[1].amount }
    ]);
  };

  return (
    <>
      <section className="card">
        <h2>Source Gases</h2>
        <div className="grid two">
          <div className="field">
            <label>Gas 1</label>
            <select
              value={multiGas.gas1Id}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField({ gas1Id: event.target.value })}
            >
              {options.map((option: GasSelection) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          {multiGas.gas1Id === "custom" && (
            <div className="field">
              <label>Gas 1 O2 %</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={multiGas.gas1CustomO2 ?? 32}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateField({ gas1CustomO2: clampPercent(Number(event.target.value)) })
                }
              />
            </div>
          )}
          <div className="field">
            <label>Gas 2</label>
            <select
              value={multiGas.gas2Id}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField({ gas2Id: event.target.value })}
            >
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          {multiGas.gas2Id === "custom" && (
            <div className="field">
              <label>Gas 2 O2 %</label>
              <input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={multiGas.gas2CustomO2 ?? 36}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  updateField({ gas2CustomO2: clampPercent(Number(event.target.value)) })
                }
              />
            </div>
          )}
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
              value={multiGas.targetO2}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField({ targetO2: clampPercent(Number(event.target.value)) })
              }
            />
          </div>
          <div className="field">
            <label>Target Pressure ({settings.pressureUnit.toUpperCase()})</label>
            <input
              type="number"
              min={0}
              step={settings.pressureUnit === "psi" ? 10 : 1}
              value={multiGas.targetPressure}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField({ targetPressure: Math.max(0, Number(event.target.value)) })
              }
            />
          </div>
        </div>
        <button className="calculate-button" type="button" onClick={onCalculate}>
          Calculate
        </button>
      </section>

      <section className="card">
        <h2>Fill Plan</h2>
        {error && <div className="error">{error}</div>}
        {!error && result && (
          <ol className="result-list">
            {result.map((step, index) => (
              <li key={step.label}>
                {index + 1}. {step.label}: {formatPressure(step.amount, settings.pressureUnit)}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
};

export default MultiGasTab;
