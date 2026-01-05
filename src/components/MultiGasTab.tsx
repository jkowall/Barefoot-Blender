import { useMemo, useState, type ChangeEvent, type FocusEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState, type MultiGasInput } from "../state/session";
import { calculateMultiGasBlend, type GasSelection } from "../utils/calculations";
import { formatPressure } from "../utils/format";
import { AccordionItem } from "./Accordion";

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));
const clampPressure = (value: number): number => Math.max(0, value);

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
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<{ label: string; amount: number; total: number }[] | null>(null);
  const [outcomeMeta, setOutcomeMeta] = useState<{
    finalO2: number;
    finalHe: number;
    warning?: string;
    similar?: boolean;
    deviationO2?: number;
    deviationHe?: number;
  } | null>(null);
  const [planOpen, setPlanOpen] = useState(false);

  const sanitizeCustomMix = (o2: number, he: number): { o2: number; he: number } => {
    const nextO2 = clampPercent(o2);
    const maxHe = 100 - nextO2;
    const nextHe = Math.min(maxHe, Math.max(0, he));
    return { o2: nextO2, he: nextHe };
  };

  const options = useMemo(() => {
    const custom = sanitizeCustomMix(multiGas.gas1CustomO2 ?? 32, multiGas.gas1CustomHe ?? 0);
    return [
      ...trimixPresets,
      { id: "custom", name: `Custom (${custom.o2.toFixed(1)} O2 / ${custom.he.toFixed(1)} He)`, o2: custom.o2, he: custom.he },
      ...topOffOptions
    ];
  }, [multiGas.gas1CustomHe, multiGas.gas1CustomO2, topOffOptions]);

  const optionForGas2 = useMemo(() => {
    const custom = sanitizeCustomMix(multiGas.gas2CustomO2 ?? 36, multiGas.gas2CustomHe ?? 0);
    return [
      ...trimixPresets,
      { id: "custom", name: `Custom (${custom.o2.toFixed(1)} O2 / ${custom.he.toFixed(1)} He)`, o2: custom.o2, he: custom.he },
      ...topOffOptions
    ];
  }, [multiGas.gas2CustomHe, multiGas.gas2CustomO2, topOffOptions]);

  const resolveGasSelection = (id: string, customO2?: number, customHe?: number): GasSelection | null => {
    if (id === "custom") {
      const { o2, he } = sanitizeCustomMix(customO2 ?? 32, customHe ?? 0);
      return { id: "custom", name: `Custom (${o2.toFixed(1)} O2 / ${he.toFixed(1)} He)`, o2, he };
    }
    return topOffOptions.find((option) => option.id === id) ?? trimixPresets.find((preset) => preset.id === id) ?? null;
  };

  const updateField = (patch: Partial<MultiGasInput>): void => {
    setMultiGas({ ...multiGas, ...patch });
  };

  const selectOnFocus = (event: FocusEvent<HTMLInputElement>): void => {
    event.target.select();
  };

  const buildCumulativeSteps = (steps: { gas: string; amount: number }[], startPressure: number): { label: string; amount: number; total: number }[] => {
    const cumulative: { label: string; amount: number; total: number }[] = [];
    let runningPsi = startPressure;
    steps.forEach((step) => {
      runningPsi += step.amount;
      cumulative.push({ label: `Add ${step.gas}`, amount: step.amount, total: runningPsi });
    });
    return cumulative;
  };

  const formatSignedPercent = (value?: number): string => {
    if (value === undefined) {
      return "0.0%";
    }
    const rounded = value.toFixed(1);
    if (value > 0) {
      return `+${rounded}%`;
    }
    return `${rounded}%`;
  };


  const onCalculate = (): void => {
    setNotice(null);
    const gas1 = resolveGasSelection(multiGas.gas1Id, multiGas.gas1CustomO2, multiGas.gas1CustomHe);
    const gas2 = resolveGasSelection(multiGas.gas2Id, multiGas.gas2CustomO2, multiGas.gas2CustomHe);

    if (!gas1 || !gas2) {
      setError("Please select both source gases.");
      setNotice(null);
      setResult(null);
      setOutcomeMeta(null);
      return;
    }

    const outcome = calculateMultiGasBlend(
      { pressureUnit: settings.pressureUnit },
      multiGas,
      gas1,
      gas2
    );

    if (!outcome.success) {
      if (outcome.fallback) {
        setError(null);
        setNotice("Desired mix cannot be attained with these gases. A similar mix within ±1% O2 / ±5% He is shown below.");
        setResult(buildCumulativeSteps(outcome.fallback.steps, multiGas.startPressure ?? 0));
        setOutcomeMeta({
          finalO2: outcome.fallback.finalO2,
          finalHe: outcome.fallback.finalHe,
          warning: outcome.fallback.warning,
          similar: true,
          deviationO2: outcome.fallback.deviationO2,
          deviationHe: outcome.fallback.deviationHe
        });
        return;
      }
      setError(outcome.error ?? "Blend cannot be computed.");
      setNotice(null);
      setResult(null);
      setOutcomeMeta(null);
      return;
    }

    setError(null);
    setNotice(null);
    setResult(buildCumulativeSteps(outcome.steps, multiGas.startPressure ?? 0));
    setOutcomeMeta({
      finalO2: outcome.finalO2 ?? multiGas.targetO2,
      finalHe: outcome.finalHe ?? (multiGas.targetHe ?? 0),
      warning: outcome.warning,
      similar: false
    });
    setPlanOpen(true);
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
              <label>Gas 1 Mix</label>
              <div className="dual-input">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={multiGas.gas1CustomO2 ?? 32}
                  onFocus={selectOnFocus}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const { o2, he } = sanitizeCustomMix(Number(event.target.value), multiGas.gas1CustomHe ?? 0);
                    updateField({ gas1CustomO2: o2, gas1CustomHe: he });
                  }}
                />
                <span className="dual-separator">O2%</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={multiGas.gas1CustomHe ?? 0}
                  onFocus={selectOnFocus}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const { o2, he } = sanitizeCustomMix(multiGas.gas1CustomO2 ?? 32, Number(event.target.value));
                    updateField({ gas1CustomO2: o2, gas1CustomHe: he });
                  }}
                />
                <span className="dual-separator">He%</span>
              </div>
              <div className="table-note">N2 auto-balances remaining fraction.</div>
            </div>
          )}
          <div className="field">
            <label>Gas 2</label>
            <select
              value={multiGas.gas2Id}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => updateField({ gas2Id: event.target.value })}
            >
              {optionForGas2.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          {multiGas.gas2Id === "custom" && (
            <div className="field">
              <label>Gas 2 Mix</label>
              <div className="dual-input">
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={multiGas.gas2CustomO2 ?? 36}
                  onFocus={selectOnFocus}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const { o2, he } = sanitizeCustomMix(Number(event.target.value), multiGas.gas2CustomHe ?? 0);
                    updateField({ gas2CustomO2: o2, gas2CustomHe: he });
                  }}
                />
                <span className="dual-separator">O2%</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={multiGas.gas2CustomHe ?? 0}
                  onFocus={selectOnFocus}
                  onChange={(event: ChangeEvent<HTMLInputElement>) => {
                    const { o2, he } = sanitizeCustomMix(multiGas.gas2CustomO2 ?? 36, Number(event.target.value));
                    updateField({ gas2CustomO2: o2, gas2CustomHe: he });
                  }}
                />
                <span className="dual-separator">He%</span>
              </div>
              <div className="table-note">N2 auto-balances remaining fraction.</div>
            </div>
          )}
        </div>
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
              value={multiGas.targetHe ?? 0}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField({ targetHe: clampPercent(Number(event.target.value)) })
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
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                updateField({ targetPressure: clampPressure(Number(event.target.value)) })
              }
            />
          </div>
        </div>
        <button className="calculate-button" type="button" onClick={onCalculate}>
          Calculate
        </button>
      </AccordionItem>

      {(result || error || notice) && (
        <AccordionItem title="Fill Plan" isOpen={planOpen} onToggle={() => setPlanOpen(!planOpen)}>
          {error && <div className="error">{error}</div>}
          {!error && notice && <div className="warning">{notice}</div>}
          {!error && result && (
            <ol className="result-list">
              {result.map((step, index) => (
                <li key={step.label}>
                  {index + 1}. {step.label}: {formatPressure(step.amount, settings.pressureUnit)}
                  <span className="result-step-total">{"->"} Tank @ {formatPressure(step.total, settings.pressureUnit)}</span>
                </li>
              ))}
            </ol>
          )}
          {!error && outcomeMeta && (
            <div className="table-note">
              Resulting mix ≈ {outcomeMeta.finalO2.toFixed(1)}% O2 / {outcomeMeta.finalHe.toFixed(1)}% He.
              {outcomeMeta.similar && (
                <>
                  {" "}(ΔO2 {formatSignedPercent(outcomeMeta.deviationO2)}, ΔHe {formatSignedPercent(outcomeMeta.deviationHe)}).
                </>
              )}
            </div>
          )}
          {!error && outcomeMeta?.warning && <div className="warning">{outcomeMeta.warning}</div>}
        </AccordionItem>
      )}
    </>
  );
};

export default MultiGasTab;
