import { useState, type ChangeEvent } from "react";
import { useSettingsStore, type GasDefinition, type DepthUnit, type PressureUnit } from "../state/settings";
import { formatPercentage } from "../utils/format";
import { NumberInput } from "./NumberInput";

const pressureUnits: PressureUnit[] = ["psi", "bar"];
const depthUnits: DepthUnit[] = ["ft", "m"];

const SettingsPanel = ({ onClose }: { onClose: () => void }): JSX.Element => {
  const settings = useSettingsStore();
  const [activeTab, setActiveTab] = useState<"general" | "gases" | "pricing">("general");

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
        <div className="settings-header">
          <h2>Settings</h2>
          <div className="settings-tabs">
            <button
              className={`settings-tab-button ${activeTab === "general" ? "active" : ""}`}
              onClick={() => setActiveTab("general")}
            >
              General
            </button>
            <button
              className={`settings-tab-button ${activeTab === "gases" ? "active" : ""}`}
              onClick={() => setActiveTab("gases")}
            >
              Gases
            </button>
            <button
              className={`settings-tab-button ${activeTab === "pricing" ? "active" : ""}`}
              onClick={() => setActiveTab("pricing")}
            >
              Pricing
            </button>
          </div>
        </div>

        <div className="settings-content-scroll">
          {activeTab === "general" && (
            <>
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

              <div className="section-title" style={{ marginTop: 16 }}>Defaults</div>
              <div className="grid two">
                <NumberInput
                  label="Max PPO2"
                  min={0}
                  step={0.05}
                  value={settings.defaultMaxPPO2}
                  onChange={(val) => setDefaultMaxPPO2(val === undefined ? undefined : Math.max(0, val))}
                />
                <NumberInput
                  label="Contingency PPO2"
                  min={0}
                  step={0.05}
                  value={settings.defaultContingencyPPO2}
                  onChange={(val) => setDefaultContingencyPPO2(val === undefined ? undefined : Math.max(0, val))}
                />
              </div>
            </>
          )}

          {activeTab === "gases" && (
            <>
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

              <div className="section-title" style={{ marginTop: 16 }}>Custom Banked Gases</div>
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
                    <NumberInput
                      label="O2 %"
                      min={0}
                      max={100}
                      step={0.1}
                      value={gas.o2}
                      onChange={(val) =>
                        handleGasChange(gas, { o2: Math.min(100, Math.max(0, val ?? 0)) })
                      }
                    />
                    <NumberInput
                      label="He %"
                      min={0}
                      max={100}
                      step={0.1}
                      value={gas.he}
                      onChange={(val) =>
                        handleGasChange(gas, { he: Math.min(100, Math.max(0, val ?? 0)) })
                      }
                    />
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
            </>
          )}

          {activeTab === "pricing" && (
            <>
              <div className="section-title">Pricing</div>
              <div className="grid two">
                <NumberInput
                  label="O₂ Price ($/cu ft)"
                  min={0}
                  step={0.01}
                  value={settings.pricePerCuFtO2}
                  onChange={(val) => setPricePerCuFtO2(val === undefined ? undefined : Math.max(0, val))}
                />
                <NumberInput
                  label="He Price ($/cu ft)"
                  min={0}
                  step={0.01}
                  value={settings.pricePerCuFtHe}
                  onChange={(val) => setPricePerCuFtHe(val === undefined ? undefined : Math.max(0, val))}
                />
              </div>

              <div className="section-title" style={{ marginTop: 16 }}>Default Tank</div>
              <div className="grid two">
                <NumberInput
                  label="Tank Size (cu ft)"
                  min={1}
                  step={1}
                  value={settings.defaultTankSizeCuFt}
                  onChange={(val) => setDefaultTankSizeCuFt(val === undefined ? undefined : Math.max(1, val))}
                />
                <NumberInput
                  label="Tank Rated Pressure (PSI)"
                  min={1}
                  step={100}
                  value={settings.tankRatedPressure}
                  onChange={(val) => setTankRatedPressure(val === undefined ? undefined : Math.max(1, val))}
                />
              </div>
              <div className="table-note">Common tanks: AL80 (80 cu ft @ 3000 PSI), HP100 (100 cu ft @ 3442 PSI)</div>
            </>
          )}
        </div>

        <div className="settings-footer">
          <button className="settings-close" type="button" onClick={onClose}>
            Save & Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
