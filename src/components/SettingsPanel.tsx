import { type ChangeEvent } from "react";
import { useSettingsStore, type GasDefinition, type DepthUnit, type PressureUnit } from "../state/settings";
import { formatPercentage } from "../utils/format";

const pressureUnits: PressureUnit[] = ["psi", "bar"];
const depthUnits: DepthUnit[] = ["ft", "m"];

const SettingsPanel = ({ onClose }: { onClose: () => void }): JSX.Element => {
  const settings = useSettingsStore();
  const {
    setPressureUnit,
    setDepthUnit,
    setDefaultMaxPPO2,
    setDefaultContingencyPPO2,
    setOxygenIsNarcotic,
    upsertCustomGas,
    removeCustomGas,
    setPricePerCuFtO2,
    setPricePerCuFtHe,
    setDefaultTankSizeCuFt,
    setTankRatedPressure
  } = settings;

  const handleGasChange = (gas: GasDefinition, patch: Partial<GasDefinition>): void => {
    const next = { ...gas, ...patch };
    upsertCustomGas(next);
  };

  const addGas = (): void => {
    const id = `custom-${Date.now()}`;
    upsertCustomGas({ id, name: "New Bank", o2: 32, he: 0 });
  };

  return (
    <div className="settings-panel">
      <div className="card settings-card">
        <h2>Settings</h2>

        <div className="section-title">Units</div>
        <div className="grid two">
          <div className="field">
            <label>Pressure</label>
            <select
              value={settings.pressureUnit}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setPressureUnit(event.target.value as PressureUnit)}
            >
              {pressureUnits.map((unit) => (
                <option key={unit} value={unit}>
                  {unit.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Depth</label>
            <select
              value={settings.depthUnit}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => setDepthUnit(event.target.value as DepthUnit)}
            >
              {depthUnits.map((unit) => (
                <option key={unit} value={unit}>
                  {unit.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="section-title">Defaults</div>
        <div className="grid two">
          <div className="field">
            <label>Max PPO2</label>
            <input
              type="number"
              min={0}
              step={0.05}
              value={settings.defaultMaxPPO2}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setDefaultMaxPPO2(Math.max(0, Number(event.target.value)))
              }
            />
          </div>
          <div className="field">
            <label>Contingency PPO2</label>
            <input
              type="number"
              min={0}
              step={0.05}
              value={settings.defaultContingencyPPO2}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setDefaultContingencyPPO2(Math.max(0, Number(event.target.value)))
              }
            />
          </div>
        </div>

        <div className="section-title">Equivalent Narcotic Gas</div>
        <div className="field">
          <label>Oxygen is narcotic?</label>
          <select
            value={settings.oxygenIsNarcotic ? "yes" : "no"}
            onChange={(event: ChangeEvent<HTMLSelectElement>) =>
              setOxygenIsNarcotic(event.target.value === "yes")
            }
          >
            <option value="no">No</option>
            <option value="yes">Yes</option>
          </select>
        </div>

        <div className="section-title">Pricing</div>
        <div className="grid two">
          <div className="field">
            <label>O₂ Price ($/cu ft)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={settings.pricePerCuFtO2 ?? 1.0}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setPricePerCuFtO2(Math.max(0, Number(event.target.value)))
              }
            />
          </div>
          <div className="field">
            <label>He Price ($/cu ft)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={settings.pricePerCuFtHe ?? 3.5}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setPricePerCuFtHe(Math.max(0, Number(event.target.value)))
              }
            />
          </div>
          <div className="field">
            <label>Tank Size (cu ft)</label>
            <input
              type="number"
              min={1}
              step={1}
              value={settings.defaultTankSizeCuFt ?? 80}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setDefaultTankSizeCuFt(Math.max(1, Number(event.target.value)))
              }
            />
          </div>
          <div className="field">
            <label>Tank Rated Pressure (PSI)</label>
            <input
              type="number"
              min={1}
              step={100}
              value={settings.tankRatedPressure ?? 3000}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setTankRatedPressure(Math.max(1, Number(event.target.value)))
              }
            />
          </div>
        </div>
        <div className="table-note">Common tanks: AL80 (80 cu ft @ 3000 PSI), HP100 (100 cu ft @ 3442 PSI)</div>

        <div className="section-title">Custom Banked Gases</div>
        {settings.customGases.map((gas) => (
          <div key={gas.id} className="card" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>Name</label>
              <input
                type="text"
                value={gas.name}
                onChange={(event: ChangeEvent<HTMLInputElement>) => handleGasChange(gas, { name: event.target.value })}
              />
            </div>
            <div className="grid two">
              <div className="field">
                <label>O2 %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={gas.o2}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    handleGasChange(gas, { o2: Math.min(100, Math.max(0, Number(event.target.value))) })
                  }
                />
              </div>
              <div className="field">
                <label>He %</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={gas.he}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    handleGasChange(gas, { he: Math.min(100, Math.max(0, Number(event.target.value))) })
                  }
                />
              </div>
            </div>
            <div className="table-note">Remaining N2: {formatPercentage(Math.max(0, 100 - gas.o2 - gas.he))}</div>
            {settings.customGases.length > 1 && (
              <div className="settings-actions">
                <button className="settings-close" type="button" onClick={() => removeCustomGas(gas.id)}>
                  Remove
                </button>
              </div>
            )}
          </div>
        ))}

        {settings.customGases.length < 6 && (
          <button className="calculate-button" type="button" onClick={addGas}>
            Add Gas
          </button>
        )}

        <div className="settings-actions">
          <button className="settings-close" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
