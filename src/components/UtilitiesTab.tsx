import { useMemo, useState, useId, type FocusEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState } from "../state/session";
import {
  calculateBestMix,
  calculateDensity,
  calculateEAD,
  calculateEND,
  calculateMOD,
  calculatePsiPerCuFt,
  clampPercent,
  clampDepth,
  clampPressure,
  cuFtToLiters,
  cuFtToPressure,
  litersToCuFt,
  pressureToCuFt
} from "../utils/calculations";
import { formatNumber } from "../utils/format";
import { AccordionItem } from "./Accordion";
import { NumberInput } from "./NumberInput";

const UtilitiesTab = ({ settings }: { settings: SettingsSnapshot }): JSX.Element => {
  const utilities = useSessionStore((state: SessionState) => state.utilities);
  const setUtilities = useSessionStore((state: SessionState) => state.setUtilities);

  const modResult = useMemo(
    () =>
      calculateMOD(
        utilities.modGasO2 ?? 0,
        utilities.modMaxPPO2 ?? settings.defaultMaxPPO2 ?? 1.4,
        settings.defaultContingencyPPO2 ?? 1.6,
        settings.depthUnit
      ),
    [utilities.modGasO2, utilities.modMaxPPO2, settings.defaultMaxPPO2, settings.defaultContingencyPPO2, settings.depthUnit]
  );

  const eadResult = useMemo(
    () => calculateEAD(utilities.eadO2 ?? 0, utilities.eadDepth ?? 0, settings.depthUnit),
    [utilities.eadO2, utilities.eadDepth, settings.depthUnit]
  );

  const bestMixResult = useMemo(
    () =>
      calculateBestMix(
        utilities.bestMixDepth ?? 0,
        utilities.bestMixPPO2 ?? settings.defaultMaxPPO2 ?? 1.4,
        utilities.bestMixMaxEND ?? 30, // Default to 30m if not set
        settings.depthUnit
      ),
    [
      utilities.bestMixDepth,
      utilities.bestMixPPO2,
      utilities.bestMixMaxEND,
      settings.defaultMaxPPO2,
      settings.depthUnit
    ]
  );

  const endResult = useMemo(
    () =>
      calculateEND(
        utilities.endO2 ?? 0,
        utilities.endHe ?? 0,
        utilities.endDepth ?? 0,
        settings.depthUnit,
        settings.oxygenIsNarcotic
      ),
    [utilities.endO2, utilities.endHe, utilities.endDepth, settings.depthUnit, settings.oxygenIsNarcotic]
  );

  const densityResult = useMemo(
    () => calculateDensity(utilities.densityO2 ?? 0, utilities.densityHe ?? 0, utilities.densityDepth ?? 0, settings.depthUnit),
    [utilities.densityO2, utilities.densityHe, utilities.densityDepth, settings.depthUnit]
  );

  const tankSizeCuFt = utilities.tankSizeCuFt ?? settings.defaultTankSizeCuFt ?? 80;
  const tankRatedPressurePsi = utilities.tankRatedPressurePsi ?? settings.tankRatedPressure ?? 3000;
  const tankConvertPressurePsi = utilities.tankConvertPressurePsi ?? 500;
  const tankConvertCuFt = utilities.tankConvertCuFt ?? pressureToCuFt(tankConvertPressurePsi, tankSizeCuFt, tankRatedPressurePsi);
  const tankConvertLiters = utilities.tankConvertLiters ?? cuFtToLiters(tankConvertCuFt);
  const tankPsiPerCuFt = calculatePsiPerCuFt(tankSizeCuFt, tankRatedPressurePsi);
  const tankFreeGasLiters = cuFtToLiters(tankSizeCuFt);

  const update = (patch: Parameters<typeof setUtilities>[0]): void => {
    setUtilities(patch);
  };

  const updateTankPressureConversion = (pressurePsi: number | undefined): void => {
    const nextPressurePsi = pressurePsi === undefined ? undefined : clampPressure(pressurePsi);
    const nextCuFt = nextPressurePsi === undefined
      ? undefined
      : pressureToCuFt(nextPressurePsi, tankSizeCuFt, tankRatedPressurePsi);
    update({
      tankConvertPressurePsi: nextPressurePsi,
      tankConvertCuFt: nextCuFt,
      tankConvertLiters: nextCuFt === undefined ? undefined : cuFtToLiters(nextCuFt)
    });
  };

  const updateTankCuFtConversion = (cuFt: number | undefined): void => {
    const nextCuFt = cuFt === undefined ? undefined : Math.max(0, cuFt);
    update({
      tankConvertCuFt: nextCuFt,
      tankConvertLiters: nextCuFt === undefined ? undefined : cuFtToLiters(nextCuFt),
      tankConvertPressurePsi: nextCuFt === undefined
        ? undefined
        : cuFtToPressure(nextCuFt, tankSizeCuFt, tankRatedPressurePsi)
    });
  };

  const updateTankLitersConversion = (liters: number | undefined): void => {
    const nextLiters = liters === undefined ? undefined : Math.max(0, liters);
    const nextCuFt = nextLiters === undefined ? undefined : litersToCuFt(nextLiters);
    update({
      tankConvertLiters: nextLiters,
      tankConvertCuFt: nextCuFt,
      tankConvertPressurePsi: nextCuFt === undefined
        ? undefined
        : cuFtToPressure(nextCuFt, tankSizeCuFt, tankRatedPressurePsi)
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <AccordionItem title="Maximum Operating Depth" defaultOpen={true}>
        <div className="grid two">
          <NumberInput
            label="Gas O2 %"
            min={0}
            max={100}
            step={0.1}
            value={utilities.modGasO2}
            onChange={(val) => update({ modGasO2: val === undefined ? undefined : clampPercent(val) })}
          />
          <NumberInput
            label="Max PPO2"
            min={0}
            step={0.1}
            value={utilities.modMaxPPO2}
            onChange={(val) => update({ modMaxPPO2: val === undefined ? undefined : clampPressure(val) })}
          />
        </div>
        <div style={{ marginTop: "12px" }}>
          <div>Working MOD: {formatNumber(modResult.mod, 1)} {settings.depthUnit}</div>
          <div>Contingency MOD ({settings.defaultContingencyPPO2}): {formatNumber(modResult.contingency, 1)} {settings.depthUnit}</div>
        </div>
      </AccordionItem>

      <AccordionItem title="Best Mix">
        <div className="grid two">
          <NumberInput
            label={`Target Depth (${settings.depthUnit})`}
            min={0}
            step={1}
            value={utilities.bestMixDepth}
            onChange={(val) => update({ bestMixDepth: val === undefined ? undefined : clampDepth(val) })}
          />
          <NumberInput
            label="Target PPO2"
            min={0}
            step={0.1}
            value={utilities.bestMixPPO2}
            onChange={(val) => update({ bestMixPPO2: val === undefined ? undefined : clampPressure(val) })}
          />
          <NumberInput
            label={`Max END (${settings.depthUnit})`}
            min={0}
            step={1}
            value={utilities.bestMixMaxEND}
            onChange={(val) => update({ bestMixMaxEND: val === undefined ? undefined : clampDepth(val) })}
          />
        </div>
        <div style={{ marginTop: "12px" }}>
          <div>Best Mix: {formatNumber(bestMixResult.o2, 1)}% O2, {formatNumber(bestMixResult.he, 1)}% He</div>
        </div>
      </AccordionItem>

      <AccordionItem title="Equivalent Air Depth">
        <div className="grid two">
          <NumberInput
            label="Gas O2 %"
            min={0}
            max={100}
            step={0.1}
            value={utilities.eadO2}
            onChange={(val) => update({ eadO2: val === undefined ? undefined : clampPercent(val) })}
          />
          <NumberInput
            label={`Depth (${settings.depthUnit})`}
            min={0}
            step={1}
            value={utilities.eadDepth}
            onChange={(val) => update({ eadDepth: val === undefined ? undefined : clampDepth(val) })}
          />
        </div>
        <div style={{ marginTop: "12px" }}>
          <div>EAD: {formatNumber(eadResult, 1)} {settings.depthUnit}</div>
        </div>
      </AccordionItem>

      <AccordionItem title="Equivalent Narcotic Depth">
        <div className="grid two">
          <NumberInput
            label="Gas O2 %"
            min={0}
            max={100}
            step={0.1}
            value={utilities.endO2}
            onChange={(val) => update({ endO2: val === undefined ? undefined : clampPercent(val) })}
          />
          <NumberInput
            label="Gas He %"
            min={0}
            max={100}
            step={0.1}
            value={utilities.endHe}
            onChange={(val) => update({ endHe: val === undefined ? undefined : clampPercent(val) })}
          />
          <NumberInput
            label={`Depth (${settings.depthUnit})`}
            min={0}
            step={1}
            value={utilities.endDepth}
            onChange={(val) => update({ endDepth: val === undefined ? undefined : clampDepth(val) })}
          />
        </div>
        <div style={{ marginTop: "12px" }}>
          <div>END: {formatNumber(endResult, 1)} {settings.depthUnit}</div>
          <div className="table-note">Oxygen counted as narcotic: {settings.oxygenIsNarcotic ? "Yes" : "No"}</div>
        </div>
      </AccordionItem>

      <AccordionItem title="Gas Density">
        <div className="grid two">
          <NumberInput
            label="Gas O2 %"
            min={0}
            max={100}
            step={0.1}
            value={utilities.densityO2}
            onChange={(val) => update({ densityO2: val === undefined ? undefined : clampPercent(val) })}
          />
          <NumberInput
            label="Gas He %"
            min={0}
            max={100}
            step={0.1}
            value={utilities.densityHe}
            onChange={(val) => update({ densityHe: val === undefined ? undefined : clampPercent(val) })}
          />
          <NumberInput
            label={`Depth (${settings.depthUnit})`}
            min={0}
            step={1}
            value={utilities.densityDepth}
            onChange={(val) => update({ densityDepth: val === undefined ? undefined : clampDepth(val) })}
          />
        </div>
        <div style={{ marginTop: "12px" }}>
          <div>Density: {formatNumber(densityResult, 2)} g/L</div>
        </div>
      </AccordionItem>

      <AccordionItem title="Tank Conversion">
        <div className="grid two">
          <NumberInput
            label="Tank Volume (cu ft)"
            min={1}
            step={1}
            value={tankSizeCuFt}
            onChange={(val) => {
              const nextTankSize = val === undefined ? undefined : Math.max(1, val);
              const resolvedTankSize = nextTankSize ?? settings.defaultTankSizeCuFt ?? 80;
              update({
                tankSizeCuFt: nextTankSize,
                tankConvertPressurePsi: cuFtToPressure(tankConvertCuFt, resolvedTankSize, tankRatedPressurePsi)
              });
            }}
          />
          <NumberInput
            label="Tank Volume (free gas L)"
            min={0}
            step={1}
            value={tankFreeGasLiters}
            onChange={(val) => {
              const nextCuFt = val === undefined ? undefined : Math.max(1, litersToCuFt(val));
              const resolvedTankSize = nextCuFt ?? settings.defaultTankSizeCuFt ?? 80;
              update({
                tankSizeCuFt: nextCuFt,
                tankConvertPressurePsi: cuFtToPressure(tankConvertCuFt, resolvedTankSize, tankRatedPressurePsi)
              });
            }}
          />
          <NumberInput
            label="Rated Pressure (PSI)"
            min={1}
            step={100}
            value={tankRatedPressurePsi}
            onChange={(val) => {
              const nextRatedPressure = val === undefined ? undefined : Math.max(1, val);
              const resolvedRatedPressure = nextRatedPressure ?? settings.tankRatedPressure ?? 3000;
              update({
                tankRatedPressurePsi: nextRatedPressure,
                tankConvertPressurePsi: cuFtToPressure(tankConvertCuFt, tankSizeCuFt, resolvedRatedPressure)
              });
            }}
          />
          <div className="stat">
            <div className="stat-label">PSI per cu ft</div>
            <div className="stat-value">{formatNumber(tankPsiPerCuFt, 2)}</div>
          </div>
        </div>

        <div className="section-title" style={{ marginTop: "16px" }}>Fill Volume</div>
        <div className="grid three">
          <NumberInput
            label="Pressure (PSI)"
            min={0}
            step={10}
            value={tankConvertPressurePsi}
            onChange={updateTankPressureConversion}
          />
          <NumberInput
            label="Volume (cu ft)"
            min={0}
            step={0.1}
            value={tankConvertCuFt}
            onChange={updateTankCuFtConversion}
          />
          <NumberInput
            label="Volume (free gas L)"
            min={0}
            step={1}
            value={tankConvertLiters}
            onChange={updateTankLitersConversion}
          />
        </div>
        <div className="result-note">
          {formatNumber(tankSizeCuFt, 2)} cu ft = {formatNumber(tankFreeGasLiters, 2)} free gas L.{" "}
          {formatNumber(tankConvertPressurePsi, 0)} PSI = {formatNumber(tankConvertCuFt, 2)} cu ft = {formatNumber(tankConvertLiters, 2)} free gas L.
        </div>
        <div className="table-note">Free gas liters are surface-equivalent gas volume, not metric cylinder water capacity.</div>
      </AccordionItem>

      <UnitConverter />
    </div>
  );
};

const UnitConverter = (): JSX.Element => {
  const depthId = useId();
  const pressureId = useId();
  const [depthValue, setDepthValue] = useState<number | undefined>(10);
  const [depthUnit, setDepthUnit] = useState<"m" | "ft">("m");

  const [pressureValue, setPressureValue] = useState<number | undefined>(200);
  const [pressureUnit, setPressureUnit] = useState<"bar" | "psi">("bar");

  const handleFocus = (event: FocusEvent<HTMLInputElement>): void => {
    requestAnimationFrame(() => event.target.select());
  };

  const convertedDepth = useMemo(() => {
    const val = depthValue ?? 0;
    if (depthUnit === "m") {
      return { value: val * 3.28084, unit: "ft" };
    }
    return { value: val / 3.28084, unit: "m" };
  }, [depthValue, depthUnit]);

  const convertedPressure = useMemo(() => {
    const val = pressureValue ?? 0;
    if (pressureUnit === "bar") {
      return { value: val * 14.5038, unit: "psi" };
    }
    return { value: val / 14.5038, unit: "bar" };
  }, [pressureValue, pressureUnit]);

  return (
    <section className="card">
      <h2>Unit Converter</h2>
      <div className="grid two">
        <div className="field">
          <label htmlFor={depthId}>Depth</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              id={depthId}
              type="number"
              value={depthValue ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setDepthValue(val === "" ? undefined : clampDepth(Number(val)));
              }}
              onFocus={handleFocus}
              style={{ flex: 1 }}
            />
            <select
              aria-label="Depth unit"
              value={depthUnit}
              onChange={(e) => setDepthUnit(e.target.value as "m" | "ft")}
              style={{ width: "auto" }}
            >
              <option value="m">m</option>
              <option value="ft">ft</option>
            </select>
          </div>
          <div>= {formatNumber(convertedDepth.value, 1)} {convertedDepth.unit}</div>
        </div>
        <div className="field">
          <label htmlFor={pressureId}>Pressure</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              id={pressureId}
              type="number"
              value={pressureValue ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setPressureValue(val === "" ? undefined : clampPressure(Number(val)));
              }}
              onFocus={handleFocus}
              style={{ flex: 1 }}
            />
            <select
              aria-label="Pressure unit"
              value={pressureUnit}
              onChange={(e) => setPressureUnit(e.target.value as "bar" | "psi")}
              style={{ width: "auto" }}
            >
              <option value="bar">bar</option>
              <option value="psi">psi</option>
            </select>
          </div>
          <div>= {formatNumber(convertedPressure.value, 0)} {convertedPressure.unit}</div>
        </div>
      </div>
    </section>
  );
};



export default UtilitiesTab;
