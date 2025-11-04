import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PressureUnit = "psi" | "bar";
export type DepthUnit = "ft" | "m";

export type GasDefinition = {
  id: string;
  name: string;
  o2: number;
  he: number;
};

type SettingsState = {
  pressureUnit: PressureUnit;
  depthUnit: DepthUnit;
  defaultMaxPPO2: number;
  defaultContingencyPPO2: number;
  oxygenIsNarcotic: boolean;
  customGases: GasDefinition[];
  setPressureUnit: (unit: PressureUnit) => void;
  setDepthUnit: (unit: DepthUnit) => void;
  setDefaultMaxPPO2: (value: number) => void;
  setDefaultContingencyPPO2: (value: number) => void;
  setOxygenIsNarcotic: (value: boolean) => void;
  upsertCustomGas: (gas: GasDefinition) => void;
  removeCustomGas: (id: string) => void;
};

type SettingsSetter = (
  partial:
    | SettingsState
    | Partial<SettingsState>
    | ((state: SettingsState) => SettingsState | Partial<SettingsState>),
  replace?: boolean
) => void;

const defaultGas: GasDefinition = {
  id: "bank-36",
  name: "Bank 36",
  o2: 36,
  he: 0
};

const settingsCreator = (set: SettingsSetter, get: () => SettingsState): SettingsState => ({
      pressureUnit: "psi",
      depthUnit: "ft",
      defaultMaxPPO2: 1.4,
      defaultContingencyPPO2: 1.6,
      oxygenIsNarcotic: false,
      customGases: [defaultGas],
      setPressureUnit: (unit: PressureUnit) => set({ pressureUnit: unit }),
      setDepthUnit: (unit: DepthUnit) => set({ depthUnit: unit }),
      setDefaultMaxPPO2: (value: number) => set({ defaultMaxPPO2: value }),
      setDefaultContingencyPPO2: (value: number) => set({ defaultContingencyPPO2: value }),
      setOxygenIsNarcotic: (value: boolean) => set({ oxygenIsNarcotic: value }),
      upsertCustomGas: (gas: GasDefinition) => {
        const gases = get().customGases;
        const existingIndex = gases.findIndex((item: GasDefinition) => item.id === gas.id);
        if (existingIndex >= 0) {
          const next = gases.slice();
          next[existingIndex] = gas;
          set({ customGases: next });
        } else {
          set({ customGases: [...gases, gas] });
        }
      },
      removeCustomGas: (id: string) => {
        set({ customGases: get().customGases.filter((item: GasDefinition) => item.id !== id) });
      }
});

export const useSettingsStore = create<SettingsState>()(
  persist(settingsCreator, {
    name: "barefoot-blender-settings"
  })
);

export type SettingsSnapshot = SettingsState;
