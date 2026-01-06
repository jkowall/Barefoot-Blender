import { useEffect, useMemo, useState, type ChangeEvent, type FocusEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState, type TopOffInput, type StandardBlendInput } from "../state/session";
import {
  calculateTopOffBlend,
  projectTopOffChart,
  type GasSelection,
  type TopOffResult,
  type TopOffProjectionRow
} from "../utils/calculations";
import { formatNumber, formatPercentage, formatPressure } from "../utils/format";
import { fromDisplayPressure, toDisplayPressure } from "../utils/units";
import { AccordionItem } from "./Accordion";

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
  const [chart, setChart] = useState<TopOffProjectionRow[] | null>(null);
  const [bleedPsi, setBleedPsi] = useState(0);

  const selectedTopGas = useMemo(() => {
    const match = topOffOptions.find((option) => option.id === topOff.topGasId);
    return match ?? topOffOptions[0];
  }, [topOff.topGasId, topOffOptions]);

  const startPressurePsi = useMemo(
    () => fromDisplayPressure(topOff.startPressure, settings.pressureUnit),
    [topOff.startPressure, settings.pressureUnit]
  );

  useEffect(() => {
    if (selectedTopGas && selectedTopGas.id !== topOff.topGasId) {
      setTopOff({ ...topOff, topGasId: selectedTopGas.id });
    }
  }, [selectedTopGas, topOff, setTopOff]);

  useEffect(() => {
    if (!result?.success) {
      setBleedPsi(0);
    }
  }, [result?.success]);

  useEffect(() => {
    setBleedPsi((previous) => {
      if (startPressurePsi <= 0) {
        return 0;
      }
      return Math.min(previous, startPressurePsi);
    });
  }, [startPressurePsi]);

  function updateField<K extends keyof TopOffInput>(key: K, value: TopOffInput[K]): void {
    setTopOff({ ...topOff, [key]: value });
  }

  const selectOnFocus = (event: FocusEvent<HTMLInputElement>): void => {
    const target = event.target;
    requestAnimationFrame(() => {
      target.select();
    });
  };

  const onCalculate = (): void => {
    if (!selectedTopGas) {
      setResult(null);
      setChart(null);
      setBleedPsi(0);
      return;
    }

    const outcome = calculateTopOffBlend(
      { pressureUnit: settings.pressureUnit },
      topOff,
      selectedTopGas
    );
    setResult(outcome);

    if (outcome.success) {
      const baseline: StandardBlendInput = {
        startO2: topOff.startO2,
        startHe: topOff.startHe,
        startPressure: topOff.startPressure,
        targetO2: outcome.finalO2,
        targetHe: outcome.finalHe,
        targetPressure: topOff.finalPressure,
        topGasId: topOff.topGasId
      };
      setChart(projectTopOffChart({ pressureUnit: settings.pressureUnit }, baseline, selectedTopGas));
    } else {
      setChart(null);
    }
  };

  const adjustedStartPsi = useMemo(
    () => Math.max(0, startPressurePsi - bleedPsi),
    [bleedPsi, startPressurePsi]
  );

  const bleedSliderMaxDisplay = useMemo(
    () => toDisplayPressure(Math.max(0, startPressurePsi), settings.pressureUnit),
    [settings.pressureUnit, startPressurePsi]
  );

  const bleedSliderValueDisplay = useMemo(
    () => toDisplayPressure(Math.min(bleedPsi, startPressurePsi), settings.pressureUnit),
    [bleedPsi, settings.pressureUnit, startPressurePsi]
  );

  const bleedSliderStepDisplay = settings.pressureUnit === "psi" ? 10 : 0.1;

  const showBleedPreview = Boolean(result?.success && startPressurePsi > 0);

  const bleedPreview = useMemo(() => {
    if (!showBleedPreview || !selectedTopGas) {
      return null;
    }

    const simulatedInput: TopOffInput = {
      ...topOff,
      startPressure: toDisplayPressure(adjustedStartPsi, settings.pressureUnit)
    };

    return calculateTopOffBlend(
      { pressureUnit: settings.pressureUnit },
      simulatedInput,
      selectedTopGas
    );
  }, [adjustedStartPsi, selectedTopGas, settings.pressureUnit, showBleedPreview, topOff]);

  return (
    <>
      <AccordionItem title="Start Tank" defaultOpen={true}>
        <div className="grid two">
          <div className="field">
            <label>Current O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={topOff.startO2 ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const val = event.target.value;
                updateField("startO2", val === "" ? undefined : Number(val));
              }}
              onBlur={() => updateField("startO2", clampPercent(topOff.startO2 ?? 0))}
            />
          </div>
          <div className="field">
            <label>Current He %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={topOff.startHe ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const val = event.target.value;
                updateField("startHe", val === "" ? undefined : Number(val));
              }}
              onBlur={() => updateField("startHe", clampPercent(topOff.startHe ?? 0))}
            />
          </div>
          <div className="field">
            <label>Current Pressure ({settings.pressureUnit.toUpperCase()})</label>
            <input
              type="number"
              min={0}
              step={settings.pressureUnit === "psi" ? 10 : 1}
              value={topOff.startPressure ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const val = event.target.value;
                updateField("startPressure", val === "" ? undefined : Number(val));
              }}
              onBlur={() => updateField("startPressure", clampPressure(topOff.startPressure ?? 0))}
            />
          </div>
        </div>
      </AccordionItem>

      <AccordionItem title="Top-Off Goal" defaultOpen={true}>
        <div className="field">
          <label>Final Pressure ({settings.pressureUnit.toUpperCase()})</label>
          <input
            type="number"
            min={0}
            step={settings.pressureUnit === "psi" ? 10 : 1}
            value={topOff.finalPressure ?? ""}
            onFocus={selectOnFocus}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const val = event.target.value;
              updateField("finalPressure", val === "" ? undefined : Number(val));
            }}
            onBlur={() => updateField("finalPressure", clampPressure(topOff.finalPressure ?? 0))}
          />
        </div>
      </AccordionItem>

      <AccordionItem title="Top-Off Gas" defaultOpen={true}>
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
      </AccordionItem>

      {result && (
        <AccordionItem title="Top-Off Outcome" defaultOpen={true}>
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
        </AccordionItem>
      )}

      {showBleedPreview && bleedPreview && (
        <AccordionItem title="Bleed-Down What-If" defaultOpen={false}>
          <div className="field">
            <label>Bleed Amount ({settings.pressureUnit.toUpperCase()})</label>
            <input
              type="range"
              min={0}
              max={bleedSliderMaxDisplay}
              step={bleedSliderStepDisplay}
              value={bleedSliderValueDisplay}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                const displayValue = Number(event.target.value);
                const nextPsi = fromDisplayPressure(displayValue, settings.pressureUnit);
                setBleedPsi(Math.max(0, Math.min(nextPsi, startPressurePsi)));
              }}
            />
          </div>
          <div className="sensitivity-summary">
            <span>Bleed {formatPressure(bleedPsi, settings.pressureUnit)}</span>
            <span>Adjusted Start {formatPressure(adjustedStartPsi, settings.pressureUnit)}</span>
          </div>
          {bleedPreview.success ? (
            <>
              <div className="grid three">
                <div className="stat">
                  <div className="stat-label">Final O2 %</div>
                  <input
                    type="number"
                    className="stat-value-input"
                    min={0}
                    max={100}
                    step={0.1}
                    value={formatNumber(bleedPreview.finalO2, 1)}
                    onFocus={selectOnFocus}
                    onChange={(e) => {
                      // Reverse solve: P_final_O2 = (P_start_adj * Start_O2 + P_added * Top_O2) / P_total
                      // We know P_total (finalPressure), Top_O2, Start_O2.
                      // Variable is bleed amount, which determines P_start_adj.
                      // P_start_adj = P_start - bleed.
                      // P_added = P_total - P_start_adj.

                      const targetO2 = Number(e.target.value) / 100;
                      const topO2 = topOffOptions.find(o => o.id === topOff.topGasId)?.o2 ?? 0;
                      const startO2 = topOff.startO2 / 100;

                      const pTotal = fromDisplayPressure(topOff.finalPressure, settings.pressureUnit);

                      // P_total * Target_O2 = P_start_adj * Start_O2 + (P_total - P_start_adj) * Top_O2
                      // P_total * Target_O2 = P_start_adj * Start_O2 + P_total * Top_O2 - P_start_adj * Top_O2
                      // P_total * (Target_O2 - Top_O2) = P_start_adj * (Start_O2 - Top_O2)
                      // P_start_adj = P_total * (Target_O2 - Top_O2) / (Start_O2 - Top_O2)

                      const numerator = pTotal * (targetO2 - (topO2 / 100));
                      const denominator = startO2 - (topO2 / 100);

                      if (Math.abs(denominator) > 1e-6) {
                        const neededStartPsi = numerator / denominator;
                        const neededBleed = startPressurePsi - neededStartPsi;
                        setBleedPsi(Math.max(0, Math.min(neededBleed, startPressurePsi)));
                      }
                    }}
                  />
                </div>
                <div className="stat">
                  <div className="stat-label">Final He %</div>
                  <input
                    type="number"
                    className="stat-value-input"
                    min={0}
                    max={100}
                    step={0.1}
                    value={formatNumber(bleedPreview.finalHe, 1)}
                    onFocus={selectOnFocus}
                    onChange={(e) => {
                      const targetHe = Number(e.target.value) / 100;
                      const topHe = topOffOptions.find(o => o.id === topOff.topGasId)?.he ?? 0;
                      const startHe = topOff.startHe / 100;

                      const pTotal = fromDisplayPressure(topOff.finalPressure, settings.pressureUnit);

                      const numerator = pTotal * (targetHe - (topHe / 100));
                      const denominator = startHe - (topHe / 100);

                      if (Math.abs(denominator) > 1e-6) {
                        const neededStartPsi = numerator / denominator;
                        const neededBleed = startPressurePsi - neededStartPsi;
                        setBleedPsi(Math.max(0, Math.min(neededBleed, startPressurePsi)));
                      }
                    }}
                  />
                </div>
                <div className="stat">
                  <div className="stat-label">Final N2 %</div>
                  <div className="stat-value">{formatPercentage(bleedPreview.finalN2)}</div>
                </div>
              </div>
              <div className="result-note">
                After bleeding to {formatPressure(adjustedStartPsi, settings.pressureUnit)}, add {formatPressure(bleedPreview.addedPressure, settings.pressureUnit)} of {selectedTopGas?.name ?? "chosen gas"}.
              </div>
              {bleedPreview.warnings.map((warning) => (
                <div key={warning} className="warning">
                  {warning}
                </div>
              ))}
            </>
          ) : (
            <div className="warning">{bleedPreview.errors[0] ?? "Unable to compute bleed preview."}</div>
          )}
          <div className="table-note">Slider previews a bleed-down before topping-off; it does not modify the start inputs.</div>
        </AccordionItem>
      )}

      {chart && chart.length > 0 && (
        <AccordionItem title="Top-Off Sensitivity" defaultOpen={false}>
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
              {chart.map((row, index) => (
                <tr key={`${row.startPressure}-${index}`}>
                  <td>
                    {formatPressure(row.startPressure, settings.pressureUnit)}
                    {index === 0 && (
                      <>
                        {" "}
                        <span className="tag">Actual</span>
                      </>
                    )}
                  </td>
                  <td>
                    {row.feasible && row.helium !== null
                      ? formatPressure(row.helium, settings.pressureUnit)
                      : "Drain"}
                  </td>
                  <td>
                    {row.feasible && row.oxygen !== null
                      ? formatPressure(row.oxygen, settings.pressureUnit)
                      : "Drain"}
                  </td>
                  <td>
                    {row.feasible && row.topGas !== null
                      ? formatPressure(row.topGas, settings.pressureUnit)
                      : "Drain"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="table-note">Projection varies starting pressure in fixed increments using the selected top-off gas.</div>
        </AccordionItem>
      )}
    </>
  );
};

export default TopOffTab;
