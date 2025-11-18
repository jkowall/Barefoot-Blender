import { useMemo, type ChangeEvent, type FocusEvent } from "react";
import type { SettingsSnapshot } from "../state/settings";
import { useSessionStore, type SessionState } from "../state/session";
import {
  calculateBestMix,
  calculateDensity,
  calculateEAD,
  calculateEND,
  calculateMOD
} from "../utils/calculations";
import { formatDepth, formatNumber } from "../utils/format";

const clampPercent = (value: number): number => Math.min(100, Math.max(0, value));

const clampDepth = (value: number): number => Math.max(0, value);

const UtilitiesTab = ({ settings }: { settings: SettingsSnapshot }): JSX.Element => {
  const utilities = useSessionStore((state: SessionState) => state.utilities);
  const setUtilities = useSessionStore((state: SessionState) => state.setUtilities);

  const modResult = useMemo(
    () =>
      calculateMOD(
        utilities.modGasO2,
        utilities.modMaxPPO2 ?? settings.defaultMaxPPO2,
        settings.defaultContingencyPPO2,
        settings.depthUnit
      ),
    [utilities.modGasO2, utilities.modMaxPPO2, settings.defaultMaxPPO2, settings.defaultContingencyPPO2, settings.depthUnit]
  );

  const eadResult = useMemo(
    () => calculateEAD(utilities.eadO2, utilities.eadDepth, settings.depthUnit),
    [utilities.eadO2, utilities.eadDepth, settings.depthUnit]
  );

  const bestMixResult = useMemo(
    () =>
      calculateBestMix(
        utilities.bestMixDepth,
        utilities.bestMixPPO2 ?? settings.defaultMaxPPO2,
        settings.depthUnit
      ),
    [utilities.bestMixDepth, utilities.bestMixPPO2, settings.defaultMaxPPO2, settings.depthUnit]
  );

  const endResult = useMemo(
    () =>
      calculateEND(
        utilities.endO2,
        utilities.endHe,
        utilities.endDepth,
        settings.depthUnit,
        settings.oxygenIsNarcotic
      ),
    [utilities.endO2, utilities.endHe, utilities.endDepth, settings.depthUnit, settings.oxygenIsNarcotic]
  );

  const densityResult = useMemo(
    () => calculateDensity(utilities.densityO2, utilities.densityHe, utilities.densityDepth, settings.depthUnit),
    [utilities.densityO2, utilities.densityHe, utilities.densityDepth, settings.depthUnit]
  );

  const update = (patch: Parameters<typeof setUtilities>[0]): void => {
    setUtilities(patch);
  };

  const selectOnFocus = (event: FocusEvent<HTMLInputElement>): void => {
    event.target.select();
  };

  return (
    <>
      <section className="card">
        <h2>Maximum Operating Depth</h2>
        <div className="grid two">
          <div className="field">
            <label>Gas O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.modGasO2}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ modGasO2: clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Max PPO2</label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={utilities.modMaxPPO2}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ modMaxPPO2: Math.max(0, Number(event.target.value)) })}
            />
          </div>
        </div>
        <div>Working MOD: {formatDepth(modResult.mod, settings.depthUnit, 0)}</div>
        <div>Contingency MOD ({settings.defaultContingencyPPO2}): {formatDepth(modResult.contingency, settings.depthUnit, 0)}</div>
      </section>

      <section className="card">
        <h2>Equivalent Air Depth</h2>
        <div className="grid two">
          <div className="field">
            <label>Gas O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.eadO2}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ eadO2: clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Depth ({settings.depthUnit})</label>
            <input
              type="number"
              min={0}
              step={1}
              value={utilities.eadDepth}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ eadDepth: clampDepth(Number(event.target.value)) })}
            />
          </div>
        </div>
        <div>EAD: {formatDepth(eadResult, settings.depthUnit, 0)}</div>
      </section>

      <section className="card">
        <h2>Best Mix</h2>
        <div className="grid two">
          <div className="field">
            <label>Target Depth ({settings.depthUnit})</label>
            <input
              type="number"
              min={0}
              step={1}
              value={utilities.bestMixDepth}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ bestMixDepth: clampDepth(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Target PPO2</label>
            <input
              type="number"
              min={0}
              step={0.1}
              value={utilities.bestMixPPO2}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ bestMixPPO2: Math.max(0, Number(event.target.value)) })}
            />
          </div>
        </div>
        <div>Best Mix: {formatNumber(bestMixResult, 1)}% O2</div>
      </section>

      <section className="card">
        <h2>Equivalent Narcotic Depth</h2>
        <div className="grid two">
          <div className="field">
            <label>Gas O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.endO2}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ endO2: clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Gas He %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.endHe}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ endHe: clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Depth ({settings.depthUnit})</label>
            <input
              type="number"
              min={0}
              step={1}
              value={utilities.endDepth}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ endDepth: clampDepth(Number(event.target.value)) })}
            />
          </div>
        </div>
        <div>END: {formatDepth(endResult, settings.depthUnit, 0)}</div>
        <div className="table-note">Oxygen counted as narcotic: {settings.oxygenIsNarcotic ? "Yes" : "No"}</div>
      </section>

      <section className="card">
        <h2>Gas Density</h2>
        <div className="grid two">
          <div className="field">
            <label>Gas O2 %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.densityO2}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ densityO2: clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Gas He %</label>
            <input
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={utilities.densityHe}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ densityHe: clampPercent(Number(event.target.value)) })}
            />
          </div>
          <div className="field">
            <label>Depth ({settings.depthUnit})</label>
            <input
              type="number"
              min={0}
              step={1}
              value={utilities.densityDepth}
              onFocus={selectOnFocus}
              onChange={(event: ChangeEvent<HTMLInputElement>) => update({ densityDepth: clampDepth(Number(event.target.value)) })}
            />
          </div>
        </div>
        <div>Density: {formatNumber(densityResult, 2)} g/L</div>
      </section>
    </>
  );
};

export default UtilitiesTab;
