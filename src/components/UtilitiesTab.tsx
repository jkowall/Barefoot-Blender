import { useMemo, useState, type ChangeEvent, type FocusEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState } from "../state/session";
import {
  calculateBestMix,
  calculateDensity,
  calculateEAD,
  calculateEND,
  calculateMOD
} from "../utils/calculations";
import { formatNumber } from "../utils/format";
import { AccordionItem } from "./Accordion";

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const clampDepth = (value: number): number => Math.max(0, value);

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



  const update = (patch: Parameters<typeof setUtilities>[0]): void => {
    setUtilities(patch);
  };

  const selectOnFocus = (event: FocusEvent<HTMLInputElement>): void => {
    event.target.select();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <AccordionItem title="Maximum Operating Depth" defaultOpen={true}>
        <div className="grid two">
          <div className="field">
            <label>Gas O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.modGasO2 ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ modGasO2: event.target.value === "" ? undefined : clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Max PPO2</label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={utilities.modMaxPPO2 ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ modMaxPPO2: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value)) })}
            />
          </div>
        </div>
        <div style={{ marginTop: "12px" }}>
          <div>Working MOD: {formatNumber(modResult.mod, 1)} {settings.depthUnit}</div>
          <div>Contingency MOD ({settings.defaultContingencyPPO2}): {formatNumber(modResult.contingency, 1)} {settings.depthUnit}</div>
        </div>
      </AccordionItem>

      <AccordionItem title="Best Mix">
        <div className="grid two">
          <div className="field">
            <label>Target Depth ({settings.depthUnit})</label>
            <input
              type="number"
              min={0}
              step={1}
              value={utilities.bestMixDepth ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ bestMixDepth: event.target.value === "" ? undefined : clampDepth(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Target PPO2</label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={utilities.bestMixPPO2 ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ bestMixPPO2: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Max END ({settings.depthUnit})</label>
            <input
              type="number"
              min={0}
              step={1}
              value={utilities.bestMixMaxEND ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ bestMixMaxEND: event.target.value === "" ? undefined : Math.max(0, Number(event.target.value)) })}
            />
          </div>
        </div>
        <div style={{ marginTop: "12px" }}>
          <div>Best Mix: {formatNumber(bestMixResult.o2, 1)}% O2, {formatNumber(bestMixResult.he, 1)}% He</div>
        </div>
      </AccordionItem>

      <AccordionItem title="Equivalent Air Depth">
        <div className="grid two">
          <div className="field">
            <label>Gas O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.eadO2 ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ eadO2: event.target.value === "" ? undefined : clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Depth ({settings.depthUnit})</label>
            <input
              type="number"
              min={0}
              step={1}
              value={utilities.eadDepth ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ eadDepth: event.target.value === "" ? undefined : clampDepth(Number(event.target.value)) })}
            />
          </div>
        </div>
        <div style={{ marginTop: "12px" }}>
          <div>EAD: {formatNumber(eadResult, 1)} {settings.depthUnit}</div>
        </div>
      </AccordionItem>

      <AccordionItem title="Equivalent Narcotic Depth">
        <div className="grid two">
          <div className="field">
            <label>Gas O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.endO2 ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ endO2: event.target.value === "" ? undefined : clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Gas He %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.endHe ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ endHe: event.target.value === "" ? undefined : clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Depth ({settings.depthUnit})</label>
            <input
              type="number"
              min={0}
              step={1}
              value={utilities.endDepth ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ endDepth: event.target.value === "" ? undefined : clampDepth(Number(event.target.value)) })}
            />
          </div>
        </div>
        <div style={{ marginTop: "12px" }}>
          <div>END: {formatNumber(endResult, 1)} {settings.depthUnit}</div>
          <div className="table-note">Oxygen counted as narcotic: {settings.oxygenIsNarcotic ? "Yes" : "No"}</div>
        </div>
      </AccordionItem>

      <AccordionItem title="Gas Density">
        <div className="grid two">
          <div className="field">
            <label>Gas O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.densityO2 ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ densityO2: event.target.value === "" ? undefined : clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Gas He %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.densityHe ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ densityHe: event.target.value === "" ? undefined : clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Depth ({settings.depthUnit})</label>
            <input
              type="number"
              min={0}
              step={1}
              value={utilities.densityDepth ?? ""}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ densityDepth: event.target.value === "" ? undefined : clampDepth(Number(event.target.value)) })}
            />
          </div>
        </div>
        <div style={{ marginTop: "12px" }}>
          <div>Density: {formatNumber(densityResult, 2)} g/L</div>
        </div>
      </AccordionItem>

      <UnitConverter />
    </div>
  );
};

const UnitConverter = (): JSX.Element => {
  const [depthValue, setDepthValue] = useState<number | undefined>(10);
  const [depthUnit, setDepthUnit] = useState<"m" | "ft">("m");

  const [pressureValue, setPressureValue] = useState<number | undefined>(200);
  const [pressureUnit, setPressureUnit] = useState<"bar" | "psi">("bar");

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
          <label>Depth</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="number"
              value={depthValue ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setDepthValue(val === "" ? undefined : Math.max(0, Number(val)));
              }}
              style={{ flex: 1 }}
            />
            <select
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
          <label>Pressure</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="number"
              value={pressureValue ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                setPressureValue(val === "" ? undefined : Math.max(0, Number(val)));
              }}
              style={{ flex: 1 }}
            />
            <select
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
