import { useEffect, useMemo, useState, type ChangeEvent, type FocusEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState, type TopOffInput, type StandardBlendInput } from "../state/session";
import {
  calculateFillCostEstimate,
  calculateTopOffBlend,
  projectTopOffChart,
  type GasSelection,
  type TopOffResult,
  type TopOffProjectionRow,
  clampPercent,
  clampPressure
} from "../utils/calculations";
import { formatNumber, formatPercentage, formatPressure, formatSignedPressure } from "../utils/format";
import { fromDisplayPressure, toDisplayPressure } from "../utils/units";
import { AccordionItem } from "./Accordion";
import { NumberInput } from "./NumberInput";
import TankContextFields from "./TankContextFields";
import TrainingMathPanel from "./TrainingMathPanel";



type Props = {
  settings: SettingsSnapshot;
  topOffOptions: GasSelection[];
  trainingModeEnabled: boolean;
};

const TopOffTab = ({ settings, topOffOptions, trainingModeEnabled }: Props): JSX.Element => {
  const topOff = useSessionStore((state: SessionState) => state.topOff);
  const setTopOff = useSessionStore((state: SessionState) => state.setTopOff);
  const [result, setResult] = useState<TopOffResult | null>(null);
  const [chart, setChart] = useState<TopOffProjectionRow[] | null>(null);
  const [bleedPsi, setBleedPsi] = useState(0);
  const tankSizeCuFt = topOff.tankSizeCuFt ?? settings.defaultTankSizeCuFt ?? 80;
  const tankRatedPressurePsi = topOff.tankRatedPressurePsi ?? settings.tankRatedPressure ?? 3000;

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

  const effectiveBleedPsi = result?.success
    ? clampPressure(Math.min(bleedPsi, startPressurePsi))
    : 0;

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
      {
        ...topOff,
        startPressure: topOff.startPressure ?? 0,
        finalPressure: topOff.finalPressure ?? 3000,
        startO2: topOff.startO2 ?? 32,
        startHe: topOff.startHe ?? 0
      },
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
      setBleedPsi(0);
    }
  };

  const adjustedStartPsi = useMemo(
    () => clampPressure(startPressurePsi - effectiveBleedPsi),
    [effectiveBleedPsi, startPressurePsi]
  );

  const bleedSliderMaxDisplay = useMemo(
    () => toDisplayPressure(clampPressure(startPressurePsi), settings.pressureUnit),
    [settings.pressureUnit, startPressurePsi]
  );

  const bleedSliderValueDisplay = useMemo(
    () => toDisplayPressure(effectiveBleedPsi, settings.pressureUnit),
    [effectiveBleedPsi, settings.pressureUnit]
  );

  const bleedSliderStepDisplay = settings.pressureUnit === "psi" ? 10 : 0.1;

  const showBleedPreview = Boolean(result?.success && startPressurePsi > 0);

  const fillCost = useMemo(() => {
    if (!result?.success || !selectedTopGas) {
      return null;
    }

    return calculateFillCostEstimate(
      [
        {
          label: `${selectedTopGas.name} Top-Off`,
          gas: selectedTopGas,
          pressurePsi: result.addedPressure
        }
      ],
      {
        pricePerCuFtO2: settings.pricePerCuFtO2 ?? 1.0,
        pricePerCuFtHe: settings.pricePerCuFtHe ?? 3.5,
        pricePerCuFtTopOff: settings.pricePerCuFtTopOff ?? 0.1,
        tankSizeCuFt,
        tankRatedPressure: tankRatedPressurePsi
      }
    );
  }, [
    result,
    selectedTopGas,
    settings.pricePerCuFtHe,
    settings.pricePerCuFtO2,
    settings.pricePerCuFtTopOff,
    tankRatedPressurePsi,
    tankSizeCuFt
  ]);

  const bleedPreview = useMemo(() => {
    if (!showBleedPreview || !selectedTopGas) {
      return null;
    }

    const simulatedInput: TopOffInput = {
      ...topOff,
      startPressure: toDisplayPressure(adjustedStartPsi, settings.pressureUnit),
      finalPressure: topOff.finalPressure ?? 3000,
      startO2: topOff.startO2 ?? 32,
      startHe: topOff.startHe ?? 0
    };

    return calculateTopOffBlend(
      { pressureUnit: settings.pressureUnit },
      simulatedInput,
      selectedTopGas
    );
  }, [adjustedStartPsi, selectedTopGas, settings.pressureUnit, showBleedPreview, topOff]);

  const trainingMath = useMemo(() => {
    if (!trainingModeEnabled || !result?.success || !selectedTopGas) {
      return null;
    }

    const startO2Fraction = (topOff.startO2 ?? 32) / 100;
    const startHeFraction = (topOff.startHe ?? 0) / 100;
    const startN2Fraction = Math.max(0, 1 - startO2Fraction - startHeFraction);
    const topO2Fraction = selectedTopGas.o2 / 100;
    const topHeFraction = selectedTopGas.he / 100;
    const topN2Fraction = Math.max(0, 1 - topO2Fraction - topHeFraction);

    return {
      startO2Fraction,
      startHeFraction,
      startN2Fraction,
      topO2Fraction,
      topHeFraction,
      topN2Fraction,
      startPressurePsi,
      addedPressurePsi: result.addedPressure,
      finalPressurePsi: result.finalPressure,
      totalO2Psi: startPressurePsi * startO2Fraction + result.addedPressure * topO2Fraction,
      totalHePsi: startPressurePsi * startHeFraction + result.addedPressure * topHeFraction,
      totalN2Psi: startPressurePsi * startN2Fraction + result.addedPressure * topN2Fraction
    };
  }, [result, selectedTopGas, startPressurePsi, topOff.startHe, topOff.startO2, trainingModeEnabled]);

  return (
    <>
      <AccordionItem title="Start Tank" defaultOpen={true}>
        <div className="grid two">
          <NumberInput
            label="Current O2 %"
            min={0}
            max={100}
            step={0.1}
            value={topOff.startO2}
            onChange={(val) => updateField("startO2", val)}
            onBlur={() => updateField("startO2", clampPercent(topOff.startO2 ?? 0))}
          />
          <NumberInput
            label="Current He %"
            min={0}
            max={100}
            step={0.1}
            value={topOff.startHe}
            onChange={(val) => updateField("startHe", val)}
            onBlur={() => updateField("startHe", clampPercent(topOff.startHe ?? 0))}
          />
          <NumberInput
            label={`Current Pressure (${settings.pressureUnit.toUpperCase()})`}
            min={0}
            step={settings.pressureUnit === "psi" ? 10 : 1}
            value={topOff.startPressure}
            onChange={(val) => updateField("startPressure", val)}
            onBlur={() => updateField("startPressure", clampPressure(topOff.startPressure ?? 0))}
          />
        </div>
      </AccordionItem>

      <AccordionItem title="Tank Context" defaultOpen={false}>
        <TankContextFields
          tankSizeCuFt={topOff.tankSizeCuFt}
          tankRatedPressurePsi={topOff.tankRatedPressurePsi}
          defaultTankSizeCuFt={settings.defaultTankSizeCuFt}
          defaultTankRatedPressurePsi={settings.tankRatedPressure}
          onChange={(patch) => setTopOff({ ...topOff, ...patch })}
        />
      </AccordionItem>

      <AccordionItem title="Top-Off Goal" defaultOpen={true}>
        <NumberInput
          label={`Final Pressure (${settings.pressureUnit.toUpperCase()})`}
          min={0}
          step={settings.pressureUnit === "psi" ? 10 : 1}
          value={topOff.finalPressure}
          onChange={(val) => updateField("finalPressure", val)}
          onBlur={() => updateField("finalPressure", clampPressure(topOff.finalPressure ?? 0))}
        />
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
              Add {selectedTopGas?.name ?? "chosen gas"}: {formatPressure(result.finalPressure, settings.pressureUnit)}
              <span className="result-step-total"> ({formatSignedPressure(result.addedPressure, settings.pressureUnit)})</span>
            </div>
          )}
          {fillCost && fillCost.lines.length > 0 && (
            <div className="cost-breakdown">
              <div className="section-title">Fill Cost</div>
              <div className="grid two">
                {fillCost.lines.map((line) => (
                  <div key={line.label} className="cost-line">
                    <span>{line.label}:</span>
                    <span>
                      {formatPressure(line.pressurePsi, settings.pressureUnit)}, {formatNumber(line.volumeCuFt, 2)} cu ft, {formatNumber(line.volumeLiters, 2)} L × {"$"}{line.unitPrice.toFixed(2)} = {"$"}{line.cost.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="table-note">Tank basis: {formatNumber(tankSizeCuFt, 2)} cu ft @ {formatNumber(tankRatedPressurePsi, 0)} PSI.</div>
              <div className="cost-total">
                <strong>Total: {"$"}{fillCost.totalCost.toFixed(2)}</strong>
              </div>
            </div>
          )}
          {result.warnings.map((warning) => (
            <div key={warning} className="warning">
              {warning}
            </div>
          ))}
          {trainingMath && (
            <TrainingMathPanel
              title="Top-Off Math"
              note="Training Mode shows the weighted-average gas math only. Analyze the actual cylinder after the fill."
            >
              <p>
                Top-off adds {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} of {selectedTopGas?.name ?? "selected gas"} to {formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)}, ending at {formatPressure(trainingMath.finalPressurePsi, settings.pressureUnit)}.
              </p>
              <ul>
                <li>Added pressure = final pressure - start pressure = {formatPressure(trainingMath.finalPressurePsi, settings.pressureUnit)} - {formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)} = {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)}</li>
                <li>Final O2 = (start pressure x start O2 + added pressure x top-off O2) / final pressure = ({formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.startO2Fraction, 3)} + {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.topO2Fraction, 3)}) / {formatPressure(trainingMath.finalPressurePsi, settings.pressureUnit)} = {formatPercentage(result.finalO2)}</li>
                <li>Final He = ({formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.startHeFraction, 3)} + {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.topHeFraction, 3)}) / {formatPressure(trainingMath.finalPressurePsi, settings.pressureUnit)} = {formatPercentage(result.finalHe)}</li>
                <li>Final N2 = ({formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.startN2Fraction, 3)} + {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.topN2Fraction, 3)}) / {formatPressure(trainingMath.finalPressurePsi, settings.pressureUnit)} = {formatPercentage(result.finalN2)}</li>
              </ul>
            </TrainingMathPanel>
          )}
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
                setBleedPsi(clampPressure(Math.min(nextPsi, startPressurePsi)));
              }}
            />
          </div>
          <div className="sensitivity-summary">
            <span>Bleed {formatPressure(effectiveBleedPsi, settings.pressureUnit)}</span>
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
                      const topO2 = selectedTopGas?.o2 ?? 0;
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
                        setBleedPsi(clampPressure(Math.min(neededBleed, startPressurePsi)));
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
                      const topHe = selectedTopGas?.he ?? 0;
                      const startHe = topOff.startHe / 100;

                      const pTotal = fromDisplayPressure(topOff.finalPressure, settings.pressureUnit);

                      const numerator = pTotal * (targetHe - (topHe / 100));
                      const denominator = startHe - (topHe / 100);

                      if (Math.abs(denominator) > 1e-6) {
                        const neededStartPsi = numerator / denominator;
                        const neededBleed = startPressurePsi - neededStartPsi;
                        setBleedPsi(clampPressure(Math.min(neededBleed, startPressurePsi)));
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
                Bleed tank to {formatPressure(adjustedStartPsi, settings.pressureUnit)}, then add {selectedTopGas?.name ?? "chosen gas"}: {formatPressure(bleedPreview.finalPressure, settings.pressureUnit)}
                <span className="result-step-total"> ({formatSignedPressure(bleedPreview.addedPressure, settings.pressureUnit)})</span>
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
                <tr key={`${row.startPressure}-${row.helium ?? "drain"}-${row.oxygen ?? "drain"}-${row.topGas ?? "drain"}-${row.feasible ? "feasible" : "blocked"}`}>
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
