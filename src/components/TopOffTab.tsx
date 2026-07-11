import { useCallback, useEffect, useMemo, useState, type FocusEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type TopOffInput } from "../state/session";
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
import { formatGasCostDetail, formatNumber, formatPercentage, formatPressure, formatSignedPressure } from "../utils/format";
import { calculateRealGasTopOff, type RealGasTopOffResult } from "../utils/realGasBlend";
import {
  DEFAULT_START_TEMPERATURE_F,
  fromDisplayTemperature,
  temperatureUnitLabel,
  toDisplayTemperature
} from "../utils/temperature";
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

type TopOffDisplayResult =
  | (TopOffResult & {
      model: "ideal";
      goalPressurePsi: number;
      resultPressurePsi: number;
    })
  | (RealGasTopOffResult & {
      model: "gerg2008";
    });

const RESULT_MIX_DECIMALS = 2;

const roundResultMixPercent = (value: number): number =>
  Number.isFinite(value) ? clampPercent(Number(value.toFixed(RESULT_MIX_DECIMALS))) : 0;

const copiedResultMix = (finalO2: number, finalHe: number): { o2: number; he: number } => {
  const o2 = roundResultMixPercent(finalO2);
  const he = Math.min(roundResultMixPercent(finalHe), roundResultMixPercent(100 - o2));
  return { o2, he };
};

const formatResultMixValue = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(RESULT_MIX_DECIMALS) : "0.00";

const formatResultMixPercentage = (value: number): string =>
  `${formatResultMixValue(value)}%`;

export const resolveTopOffSelectedGas = (
  topGasId: string,
  topOffOptions: GasSelection[]
): GasSelection | undefined => topOffOptions.find((option) => option.id === topGasId) ?? topOffOptions[0];

export const syncTopOffInputSelectedGas = (
  input: TopOffInput,
  selectedTopGas: GasSelection | undefined
): TopOffInput => {
  if (!selectedTopGas || selectedTopGas.id === input.topGasId) {
    return input;
  }
  return { ...input, topGasId: selectedTopGas.id };
};

export const resolveTopOffResultTemperatureF = (
  input: Pick<TopOffInput, "resultTemperatureF" | "resultTemperatureTouched">,
  startTemperatureF: number | undefined
): number | undefined => {
  if (input.resultTemperatureTouched) {
    return input.resultTemperatureF;
  }
  return startTemperatureF;
};

export const resolveTopOffStartTemperatureF = (
  input: Pick<TopOffInput, "startTemperatureF" | "startTemperatureTouched">
): number | undefined => {
  if (input.startTemperatureTouched) {
    return input.startTemperatureF;
  }
  return input.startTemperatureF ?? DEFAULT_START_TEMPERATURE_F;
};

export const updateTopOffStartTemperatureState = (
  startTemperatureF: number | undefined
): Pick<TopOffInput, "startTemperatureF" | "startTemperatureTouched"> => ({
  startTemperatureF,
  startTemperatureTouched: true
});

export const defaultTopOffStartTemperatureState = (): Pick<TopOffInput, "startTemperatureF" | "startTemperatureTouched"> => ({
  startTemperatureF: DEFAULT_START_TEMPERATURE_F,
  startTemperatureTouched: false
});

export const updateTopOffResultTemperatureState = (
  resultTemperatureF: number | undefined
): Pick<TopOffInput, "resultTemperatureF" | "resultTemperatureTouched"> => ({
  resultTemperatureF,
  resultTemperatureTouched: true
});

export const defaultTopOffResultTemperatureState = (): Pick<TopOffInput, "resultTemperatureF" | "resultTemperatureTouched"> => ({
  resultTemperatureF: undefined,
  resultTemperatureTouched: false
});

export const copyTopOffResultToStartInput = (
  input: TopOffInput,
  result: TopOffDisplayResult,
  pressureUnit: SettingsSnapshot["pressureUnit"]
): TopOffInput => {
  if (!result.success) {
    return input;
  }

  const mix = copiedResultMix(result.finalO2, result.finalHe);
  const next: TopOffInput = {
    ...input,
    startO2: mix.o2,
    startHe: mix.he,
    startPressure: toDisplayPressure(result.goalPressurePsi, pressureUnit)
  };

  if (result.model === "gerg2008") {
    next.startTemperatureF = result.startTemperatureF;
    next.startTemperatureTouched = true;
  }

  return next;
};

const TopOffTab = ({ settings, topOffOptions, trainingModeEnabled }: Props): JSX.Element => {
  const topOff = useSessionStore((state) => state.topOff);
  const setTopOff = useSessionStore((state) => state.setTopOff);
  const [result, setResult] = useState<TopOffDisplayResult | null>(null);
  const [chart, setChart] = useState<TopOffProjectionRow[] | null>(null);
  const [bleedPsi, setBleedPsi] = useState(0);
  const [copyConfirmation, setCopyConfirmation] = useState<string | null>(null);
  const tankSizeCuFt = topOff.tankSizeCuFt ?? settings.defaultTankSizeCuFt ?? 80;
  const tankRatedPressurePsi = topOff.tankRatedPressurePsi ?? settings.tankRatedPressure ?? 3000;
  const startTemperatureF = resolveTopOffStartTemperatureF(topOff);
  const resultTemperatureF = resolveTopOffResultTemperatureF(topOff, startTemperatureF);
  const temperatureLabel = temperatureUnitLabel(settings.temperatureUnit);

  const selectedTopGas = useMemo(() => {
    return resolveTopOffSelectedGas(topOff.topGasId, topOffOptions);
  }, [topOff.topGasId, topOffOptions]);

  const startPressurePsi = useMemo(
    () => fromDisplayPressure(topOff.startPressure, settings.pressureUnit),
    [topOff.startPressure, settings.pressureUnit]
  );

  const selectOnFocus = (event: FocusEvent<HTMLInputElement>): void => {
    const target = event.target;
    requestAnimationFrame(() => {
      target.select();
    });
  };

  const calculateForInput = useCallback((input: TopOffInput, topGas: GasSelection | undefined): void => {
    if (!topGas) {
      setResult(null);
      setChart(null);
      setBleedPsi(0);
      return;
    }

    const baseInput: TopOffInput = {
      ...input,
      startPressure: input.startPressure ?? 0,
      finalPressure: input.finalPressure ?? 3000,
      startO2: input.startO2 ?? 32,
      startHe: input.startHe ?? 0
    };
    const resolvedStartTemperatureF = resolveTopOffStartTemperatureF(baseInput);
    const resolvedResultTemperatureF = resolveTopOffResultTemperatureF(baseInput, resolvedStartTemperatureF);
    const resolvedTankSizeCuFt = baseInput.tankSizeCuFt ?? settings.defaultTankSizeCuFt ?? 80;
    const resolvedTankRatedPressurePsi = baseInput.tankRatedPressurePsi ?? settings.tankRatedPressure ?? 3000;
    const goalPressurePsi = fromDisplayPressure(baseInput.finalPressure ?? 3000, settings.pressureUnit);
    const outcome: TopOffDisplayResult = settings.gasModel === "gerg2008"
      ? resolvedStartTemperatureF === undefined
        ? {
            success: false,
            finalO2: 0,
            finalHe: 0,
            finalN2: 0,
            startPressurePsi: fromDisplayPressure(baseInput.startPressure ?? 0, settings.pressureUnit),
            goalPressurePsi,
            resultPressurePsi: goalPressurePsi,
            addedPressure: 0,
            startTemperatureF: DEFAULT_START_TEMPERATURE_F,
            resultTemperatureF: resolvedResultTemperatureF ?? DEFAULT_START_TEMPERATURE_F,
            topOffMoles: 0,
            z: 1,
            warnings: [],
            errors: ["Start temperature is required for GERG-2008 top-off correction."],
            model: "gerg2008"
          }
        : resolvedResultTemperatureF === undefined
        ? {
            success: false,
            finalO2: 0,
            finalHe: 0,
            finalN2: 0,
            startPressurePsi: fromDisplayPressure(baseInput.startPressure ?? 0, settings.pressureUnit),
            goalPressurePsi,
            resultPressurePsi: goalPressurePsi,
            addedPressure: 0,
            startTemperatureF: resolvedStartTemperatureF,
            resultTemperatureF: resolvedStartTemperatureF,
            topOffMoles: 0,
            z: 1,
            warnings: [],
            errors: ["Result temperature is required for GERG-2008 top-off correction."],
            model: "gerg2008"
          }
        : {
            ...calculateRealGasTopOff(
              { pressureUnit: settings.pressureUnit },
              {
                ...baseInput,
                tankSizeCuFt: resolvedTankSizeCuFt,
                tankRatedPressurePsi: resolvedTankRatedPressurePsi,
                startTemperatureF: resolvedStartTemperatureF,
                resultTemperatureF: resolvedResultTemperatureF
              },
              topGas
            ),
            model: "gerg2008"
          }
      : {
          ...calculateTopOffBlend(
            { pressureUnit: settings.pressureUnit },
            baseInput,
            topGas
          ),
          model: "ideal",
          goalPressurePsi,
          resultPressurePsi: goalPressurePsi
        };
    setResult(outcome);

    if (outcome.success) {
      const baseline = {
        startO2: baseInput.startO2,
        startHe: baseInput.startHe,
        startPressure: baseInput.startPressure,
        targetO2: outcome.finalO2,
        targetHe: outcome.finalHe,
        targetPressure: baseInput.finalPressure,
        topGasId: baseInput.topGasId
      };
      setChart(projectTopOffChart({ pressureUnit: settings.pressureUnit }, baseline, topGas));
    } else {
      setChart(null);
      setBleedPsi(0);
    }
  }, [settings]);

  const gasForInput = useCallback((input: TopOffInput): GasSelection | undefined => {
    return topOffOptions.find((option) => option.id === input.topGasId) ?? topOffOptions[0];
  }, [topOffOptions]);

  const setTopOffInput = useCallback((next: TopOffInput, recalculate = Boolean(result)): void => {
    setTopOff(next);
    if (recalculate) {
      calculateForInput(next, gasForInput(next));
    }
  }, [calculateForInput, gasForInput, result, setTopOff]);

  useEffect(() => {
    const nextInput = syncTopOffInputSelectedGas(topOff, selectedTopGas);
    if (nextInput !== topOff) {
      queueMicrotask(() => {
        setTopOffInput(nextInput);
      });
    }
  }, [selectedTopGas, setTopOffInput, topOff]);

  const effectiveBleedPsi = result?.success
    ? clampPressure(Math.min(bleedPsi, startPressurePsi))
    : 0;

  function updateField<K extends keyof TopOffInput>(key: K, value: TopOffInput[K]): void {
    setCopyConfirmation(null);
    setTopOffInput({ ...topOff, [key]: value });
  }

  const updateTemperatureField = (value: number | undefined): void => {
    setCopyConfirmation(null);
    setTopOffInput({
      ...topOff,
      ...updateTopOffStartTemperatureState(value === undefined ? undefined : fromDisplayTemperature(value, settings.temperatureUnit))
    });
  };

  const restoreDefaultStartTemperature = (): void => {
    if (topOff.startTemperatureF !== undefined) {
      return;
    }

    setTopOffInput({
      ...topOff,
      ...defaultTopOffStartTemperatureState()
    });
  };

  const updateResultTemperatureField = (value: number | undefined): void => {
    setCopyConfirmation(null);
    setTopOffInput({
      ...topOff,
      ...updateTopOffResultTemperatureState(value === undefined ? undefined : fromDisplayTemperature(value, settings.temperatureUnit))
    });
  };

  const restoreDefaultResultTemperature = (): void => {
    if (topOff.resultTemperatureF !== undefined) {
      return;
    }

    setTopOffInput({
      ...topOff,
      ...defaultTopOffResultTemperatureState()
    });
  };

  const onCalculate = (): void => {
    calculateForInput(topOff, selectedTopGas);
  };

  const copyResultToStartTank = (): void => {
    if (!result?.success) {
      return;
    }

    setBleedPsi(0);
    const nextInput = copyTopOffResultToStartInput(topOff, result, settings.pressureUnit);
    const copiedTemperatureF = result.model === "gerg2008" ? result.startTemperatureF : undefined;
    const copiedTemperature = copiedTemperatureF === undefined
      ? ""
      : ` at ${formatNumber(toDisplayTemperature(copiedTemperatureF, settings.temperatureUnit), 0)} ${temperatureLabel}`;
    setCopyConfirmation(
      `Copied to Start Tank: ${formatResultMixPercentage(nextInput.startO2 ?? 0)} O2 / ${formatResultMixPercentage(nextInput.startHe ?? 0)} He @ ${formatPressure(result.goalPressurePsi, settings.pressureUnit, 1)}${copiedTemperature}.`
    );
    setTopOffInput(nextInput);
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
    if (!trainingModeEnabled || !result?.success || result.model !== "ideal" || !selectedTopGas) {
      return null;
    }

    const startO2Fraction = (topOff.startO2 ?? 32) / 100;
    const startHeFraction = (topOff.startHe ?? 0) / 100;
    const startN2Fraction = Math.max(0, 1 - startO2Fraction - startHeFraction);
    const topO2Fraction = selectedTopGas.o2 / 100;
    const topHeFraction = selectedTopGas.he / 100;
    const topN2Fraction = Math.max(0, 1 - topO2Fraction - topHeFraction);
    const startPressureDisplay = toDisplayPressure(startPressurePsi, settings.pressureUnit);
    const addedPressureDisplay = toDisplayPressure(result.addedPressure, settings.pressureUnit);
    const finalPressureDisplay = toDisplayPressure(result.finalPressure, settings.pressureUnit);
    const startO2PartialPressurePsi = startPressurePsi * startO2Fraction;
    const topO2PartialPressurePsi = result.addedPressure * topO2Fraction;

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
      startO2PartialPressurePsi,
      topO2PartialPressurePsi,
      totalO2Psi: startPressurePsi * startO2Fraction + result.addedPressure * topO2Fraction,
      totalHePsi: startPressurePsi * startHeFraction + result.addedPressure * topHeFraction,
      totalN2Psi: startPressurePsi * startN2Fraction + result.addedPressure * topN2Fraction,
      totalO2PointsDisplay: startPressureDisplay * (topOff.startO2 ?? 32) + addedPressureDisplay * selectedTopGas.o2,
      totalHePointsDisplay: startPressureDisplay * (topOff.startHe ?? 0) + addedPressureDisplay * selectedTopGas.he,
      totalN2PointsDisplay: startPressureDisplay * startN2Fraction * 100 + addedPressureDisplay * topN2Fraction * 100,
      finalPressureDisplay
    };
  }, [result, selectedTopGas, settings.pressureUnit, startPressurePsi, topOff.startHe, topOff.startO2, trainingModeEnabled]);

  const bleedFormulaMath = useMemo(() => {
    if (!trainingModeEnabled || !bleedPreview?.success || !selectedTopGas) {
      return null;
    }

    const startO2Percent = topOff.startO2 ?? 32;
    const targetO2Percent = bleedPreview.finalO2;
    const topO2Percent = selectedTopGas.o2;
    const denominator = startO2Percent - topO2Percent;
    if (Math.abs(denominator) <= 0.000001) {
      return null;
    }

    const solvedStartPsi = bleedPreview.finalPressure * (targetO2Percent - topO2Percent) / denominator;
    return {
      startO2Percent,
      targetO2Percent,
      topO2Percent,
      solvedStartPsi
    };
  }, [bleedPreview, selectedTopGas, topOff.startO2, trainingModeEnabled]);

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
          {settings.gasModel === "gerg2008" && (
            <NumberInput
              label={`Start Temp (${temperatureLabel})`}
              step={1}
              value={startTemperatureF === undefined ? undefined : toDisplayTemperature(startTemperatureF, settings.temperatureUnit)}
              onChange={updateTemperatureField}
              onBlur={restoreDefaultStartTemperature}
              selectOnClick={true}
            />
          )}
        </div>
      </AccordionItem>

      <AccordionItem title="Top-Off" defaultOpen={true}>
        <div className="field">
          <label>Select Gas</label>
          <select
            value={selectedTopGas?.id ?? ""}
            onChange={(event) =>
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
        <NumberInput
          label={`Goal Pressure (${settings.pressureUnit.toUpperCase()})`}
          min={0}
          step={settings.pressureUnit === "psi" ? 10 : 1}
          value={topOff.finalPressure}
          onChange={(val) => updateField("finalPressure", val)}
          onBlur={() => updateField("finalPressure", clampPressure(topOff.finalPressure ?? 0))}
        />
        <button className="calculate-button" type="button" onClick={onCalculate}>
          Calculate
        </button>
      </AccordionItem>

      {result && (
        <AccordionItem title="Result" defaultOpen={true}>
          {!result.success && result.errors.length > 0 && (
            <div className="error">{result.errors[0]}</div>
          )}
          {result.success && (
            <div className="grid two">
              <div className="stat">
                <div className="stat-label">Final O2</div>
                <div className="stat-value">{formatResultMixPercentage(result.finalO2)}</div>
              </div>
              <div className="stat">
                <div className="stat-label">Final He</div>
                <div className="stat-value">{formatResultMixPercentage(result.finalHe)}</div>
              </div>
            </div>
          )}
          {settings.gasModel === "gerg2008" && (
            <NumberInput
              label={`Result Temp (${temperatureLabel})`}
              step={1}
              value={resultTemperatureF === undefined ? undefined : toDisplayTemperature(resultTemperatureF, settings.temperatureUnit)}
              onChange={updateResultTemperatureField}
              onBlur={restoreDefaultResultTemperature}
              selectOnClick={true}
            />
          )}
          {result.success && (
            <div className="result-note">
              {result.model === "gerg2008"
                ? (
                    <>
                      Stop at {formatPressure(result.resultPressurePsi, settings.pressureUnit, 1)}
                      {" "}at {formatNumber(toDisplayTemperature(result.resultTemperatureF, settings.temperatureUnit), 0)} {temperatureLabel}
                      {" "}for goal {formatPressure(result.goalPressurePsi, settings.pressureUnit, 1)}
                      {" "}at {formatNumber(toDisplayTemperature(result.startTemperatureF, settings.temperatureUnit), 0)} {temperatureLabel}.
                    </>
                  )
                : <>Add {selectedTopGas?.name ?? "chosen gas"}: {formatPressure(result.resultPressurePsi, settings.pressureUnit)}</>}
              {result.model === "ideal" && (
                <span className="result-step-total"> ({formatSignedPressure(result.addedPressure, settings.pressureUnit)})</span>
              )}
            </div>
          )}
          {result.success && (
            <div className="table-note">Final N2: {formatResultMixPercentage(result.finalN2)}.</div>
          )}
          {result.success && (
            <div className="result-actions">
              <button className="settings-button" type="button" onClick={copyResultToStartTank}>
                Copy Result to Start Tank
              </button>
            </div>
          )}
          {copyConfirmation && (
            <div className="result-action-note" aria-live="polite">{copyConfirmation}</div>
          )}
          {result.warnings.map((warning) => (
            <div key={warning} className="warning">
              {warning}
            </div>
          ))}
          {result.model === "gerg2008" && trainingModeEnabled && (
            <div className="table-note">GERG-2008 Topoff solves gas moles at Start Temp. Result Temp changes the displayed stop pressure, not the calculated mix.</div>
          )}
          {trainingMath && (
            <TrainingMathPanel
              title="Top-Off Hand Math"
              note="This uses pressure-percent points, the common hand check for topping a cylinder. Analyze the actual cylinder after the fill."
            >
              <p>
                Top-off adds {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} of {selectedTopGas?.name ?? "selected gas"} to {formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)}, ending at {formatPressure(trainingMath.finalPressurePsi, settings.pressureUnit)}.
              </p>
              <div className="formula-sheet" aria-label="Top-off visual formula worksheet">
                <div className="formula-step">
                  <span className="formula-step-label">Step 1</span>
                  <div className="formula-equation">
                    <span>Added P</span>
                    <span>=</span>
                    <span>Final P - Start P</span>
                    <span>=</span>
                    <strong>{formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)}</strong>
                  </div>
                </div>
                <div className="formula-step">
                  <span className="formula-step-label">Step 2</span>
                  <div className="formula-mini-grid">
                    <div className="formula-mini">
                      <span>PPH O2</span>
                      <strong>{formatPressure(trainingMath.startO2PartialPressurePsi, settings.pressureUnit, 1)}</strong>
                    </div>
                    <div className="formula-mini">
                      <span>PPTMx O2</span>
                      <strong>{formatPressure(trainingMath.topO2PartialPressurePsi, settings.pressureUnit, 1)}</strong>
                    </div>
                    <div className="formula-mini">
                      <span>O2 Points</span>
                      <strong>{formatNumber(trainingMath.totalO2PointsDisplay, 0)}</strong>
                    </div>
                    <div className="formula-mini">
                      <span>He Points</span>
                      <strong>{formatNumber(trainingMath.totalHePointsDisplay, 0)}</strong>
                    </div>
                    <div className="formula-mini">
                      <span>N2 Points</span>
                      <strong>{formatNumber(trainingMath.totalN2PointsDisplay, 0)}</strong>
                    </div>
                  </div>
                </div>
                <div className="formula-step">
                  <span className="formula-step-label">Step 3</span>
                  <div className="formula-equation">
                    <span>Final O2%</span>
                    <span>=</span>
                    <span className="formula-fraction">
                      <span>{formatNumber(trainingMath.totalO2PointsDisplay, 0)}</span>
                      <span>{formatNumber(trainingMath.finalPressureDisplay, 1)}</span>
                    </span>
                    <span>=</span>
                    <strong>{formatResultMixPercentage(result.finalO2)}</strong>
                  </div>
                </div>
              </div>
              <ul>
                <li>Added pressure = final pressure - start pressure = {formatPressure(trainingMath.finalPressurePsi, settings.pressureUnit)} - {formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)} = {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)}</li>
                <li>Formula reference: FO2 = (PPH + PPTMx) / PW, where PPH is partial pressure already in the cylinder, PPTMx is partial pressure from the top-off mix, and PW is wanted pressure.</li>
                <li>PPH = current pressure x current O2 fraction = {formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.startO2Fraction, 3)} = {formatPressure(trainingMath.startO2PartialPressurePsi, settings.pressureUnit, 1)}</li>
                <li>PPTMx = added pressure x top-off O2 fraction = {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.topO2Fraction, 3)} = {formatPressure(trainingMath.topO2PartialPressurePsi, settings.pressureUnit, 1)}</li>
                <li>Final O2% = (PPH + PPTMx) / PW = ({formatPressure(trainingMath.startO2PartialPressurePsi, settings.pressureUnit, 1)} + {formatPressure(trainingMath.topO2PartialPressurePsi, settings.pressureUnit, 1)}) / {formatPressure(trainingMath.finalPressurePsi, settings.pressureUnit)} = {formatResultMixPercentage(result.finalO2)}</li>
                <li>O2 points = start pressure x start O2% + added pressure x top-off O2% = {formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)} x {formatNumber((topOff.startO2 ?? 32), 1)} + {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} x {formatNumber(selectedTopGas.o2, 1)} = {formatNumber(trainingMath.totalO2PointsDisplay, 0)}</li>
                <li>Final O2% = O2 points / final pressure = {formatNumber(trainingMath.totalO2PointsDisplay, 0)} / {formatNumber(trainingMath.finalPressureDisplay, 1)} = {formatResultMixPercentage(result.finalO2)}</li>
                <li>He points = {formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)} x {formatNumber((topOff.startHe ?? 0), 1)} + {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} x {formatNumber(selectedTopGas.he, 1)} = {formatNumber(trainingMath.totalHePointsDisplay, 0)}; final He = {formatResultMixPercentage(result.finalHe)}</li>
                <li>N2 points = {formatPressure(trainingMath.startPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.startN2Fraction * 100, 1)} + {formatPressure(trainingMath.addedPressurePsi, settings.pressureUnit)} x {formatNumber(trainingMath.topN2Fraction * 100, 1)} = {formatNumber(trainingMath.totalN2PointsDisplay, 0)}; final N2 = {formatResultMixPercentage(result.finalN2)}</li>
              </ul>
            </TrainingMathPanel>
          )}
        </AccordionItem>
      )}

      {result && (
        <AccordionItem title="Fill Cost" defaultOpen={true}>
          <TankContextFields
            tankSizeCuFt={topOff.tankSizeCuFt}
            tankRatedPressurePsi={topOff.tankRatedPressurePsi}
            defaultTankSizeCuFt={settings.defaultTankSizeCuFt}
            defaultTankRatedPressurePsi={settings.tankRatedPressure}
            onChange={(patch) => setTopOffInput({ ...topOff, ...patch })}
          />
          {fillCost && fillCost.lines.length > 0 ? (
            <div className="cost-breakdown">
              <div className="grid two">
                {fillCost.lines.map((line) => (
                  <div key={line.label} className="cost-line">
                    <span>{line.label}:</span>
                    <span>{formatGasCostDetail(line.volumeCuFt, line.volumeLiters, line.unitPrice, line.cost)}</span>
                  </div>
                ))}
              </div>
              <div className="table-note">Tank basis: {formatNumber(tankSizeCuFt, 2)} cu ft @ {formatNumber(tankRatedPressurePsi, 0)} PSI.</div>
              <div className="cost-total">
                <strong>Total: {"$"}{fillCost.totalCost.toFixed(2)}</strong>
              </div>
            </div>
          ) : (
            <div className="table-note">Calculate a successful top-off with added gas to see the estimated fill cost.</div>
          )}
        </AccordionItem>
      )}

      {showBleedPreview && bleedPreview && (
        <AccordionItem title={settings.gasModel === "gerg2008" ? "Bleed-Down What-If (Ideal)" : "Bleed-Down What-If"} defaultOpen={false}>
          <div className="field">
            <label>Bleed Amount ({settings.pressureUnit.toUpperCase()})</label>
            <input
              type="range"
              min={0}
              max={bleedSliderMaxDisplay}
              step={bleedSliderStepDisplay}
              value={bleedSliderValueDisplay}
              onChange={(event) => {
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
                    step={0.01}
                    value={formatResultMixValue(bleedPreview.finalO2)}
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
                    step={0.01}
                    value={formatResultMixValue(bleedPreview.finalHe)}
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
                  <div className="stat-value">{formatResultMixPercentage(bleedPreview.finalN2)}</div>
                </div>
              </div>
              <div className="result-note">
                Bleed tank to {formatPressure(adjustedStartPsi, settings.pressureUnit)}, then add {selectedTopGas?.name ?? "chosen gas"}: {formatPressure(bleedPreview.finalPressure, settings.pressureUnit)}
                <span className="result-step-total"> ({formatSignedPressure(bleedPreview.addedPressure, settings.pressureUnit)})</span>
              </div>
              {bleedFormulaMath && (
                <TrainingMathPanel
                  title="Bleed Pressure Formula"
                  note="This shows the reference bleed formula for solving the pressure to keep before topping off."
                >
                  <ul>
                    <li>PH = PW x (FW - FTMx) / (FH - FTMx)</li>
                    <li>PW = {formatPressure(bleedPreview.finalPressure, settings.pressureUnit)}, FW = {formatNumber(bleedFormulaMath.targetO2Percent, RESULT_MIX_DECIMALS)}%, FH = {formatNumber(bleedFormulaMath.startO2Percent, 1)}%, FTMx = {formatNumber(bleedFormulaMath.topO2Percent, 1)}%</li>
                    <li>PH = {formatPressure(bleedPreview.finalPressure, settings.pressureUnit)} x ({formatNumber(bleedFormulaMath.targetO2Percent, RESULT_MIX_DECIMALS)} - {formatNumber(bleedFormulaMath.topO2Percent, 1)}) / ({formatNumber(bleedFormulaMath.startO2Percent, 1)} - {formatNumber(bleedFormulaMath.topO2Percent, 1)}) = {formatPressure(bleedFormulaMath.solvedStartPsi, settings.pressureUnit)}</li>
                    <li>Bleed amount = current pressure - PH = {formatPressure(startPressurePsi, settings.pressureUnit)} - {formatPressure(adjustedStartPsi, settings.pressureUnit)} = {formatPressure(effectiveBleedPsi, settings.pressureUnit)}</li>
                  </ul>
                </TrainingMathPanel>
              )}
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
        <AccordionItem title={settings.gasModel === "gerg2008" ? "Top-Off Sensitivity (Ideal)" : "Top-Off Sensitivity"} defaultOpen={false}>
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
