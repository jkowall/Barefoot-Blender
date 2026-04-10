import { create } from "zustand";
import { persist } from "zustand/middleware";
import { sanitizeGasName } from "../utils/gasNames";

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
  defaultMaxPPO2?: number;
  defaultContingencyPPO2?: number;
  oxygenIsNarcotic: boolean;
  customGases: GasDefinition[];
  pricePerCuFtO2?: number;
  pricePerCuFtHe?: number;
  pricePerCuFtTopOff?: number;
  defaultTankSizeCuFt?: number;
  tankRatedPressure?: number;
  setPressureUnit: (unit: PressureUnit) => void;
  setDepthUnit: (unit: DepthUnit) => void;
  setDefaultMaxPPO2: (value: number | undefined) => void;
  setDefaultContingencyPPO2: (value: number | undefined) => void;
  setOxygenIsNarcotic: (value: boolean) => void;
  upsertCustomGas: (gas: GasDefinition) => void;
  removeCustomGas: (id: string) => void;
  setPricePerCuFtO2: (value: number | undefined) => void;
  setPricePerCuFtHe: (value: number | undefined) => void;
  setPricePerCuFtTopOff: (value: number | undefined) => void;
  setDefaultTankSizeCuFt: (value: number | undefined) => void;
  setTankRatedPressure: (value: number | undefined) => void;
};

export type PersistedSettingsState = Partial<SettingsState> & {
  // Legacy field name kept for migration from v0.6.12
  pricePerCuFtAir?: number;
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

export const sanitizeCustomGas = (gas: GasDefinition): GasDefinition => ({
  ...gas,
  name: sanitizeGasName(gas.name)
});

const sanitizePersistedCustomGases = (state: PersistedSettingsState): PersistedSettingsState =>
  state.customGases === undefined
    ? state
    : {
        ...state,
        customGases: state.customGases.map(sanitizeCustomGas)
      };

export const migrateSettingsState = (persisted: PersistedSettingsState): PersistedSettingsState => {
  const sanitized = sanitizePersistedCustomGases(persisted);
  if (sanitized.pricePerCuFtTopOff !== undefined) {
    return sanitized;
  }
  if (sanitized.pricePerCuFtAir !== undefined) {
    return {
      ...sanitized,
      pricePerCuFtTopOff: sanitized.pricePerCuFtAir
    };
  }
  return sanitized;
};

const settingsCreator = (set: SettingsSetter, get: () => SettingsState): SettingsState => ({
  pressureUnit: "psi",
  depthUnit: "ft",
  defaultMaxPPO2: 1.4,
  defaultContingencyPPO2: 1.6,
  oxygenIsNarcotic: false,
  customGases: [defaultGas],
  pricePerCuFtO2: 1.0,
  pricePerCuFtHe: 3.5,
  pricePerCuFtTopOff: 0.1,
  defaultTankSizeCuFt: 80,
  tankRatedPressure: 3000,
  setPressureUnit: (unit: PressureUnit) => set({ pressureUnit: unit }),
  setDepthUnit: (unit: DepthUnit) => set({ depthUnit: unit }),
  setDefaultMaxPPO2: (value: number | undefined) => set({ defaultMaxPPO2: value }),
  setDefaultContingencyPPO2: (value: number | undefined) => set({ defaultContingencyPPO2: value }),
  setOxygenIsNarcotic: (value: boolean) => set({ oxygenIsNarcotic: value }),
  upsertCustomGas: (gas: GasDefinition) => {
    const sanitizedGas = sanitizeCustomGas(gas);
    const gases = get().customGases;
    const existingIndex = gases.findIndex((item: GasDefinition) => item.id === sanitizedGas.id);
    if (existingIndex >= 0) {
      const next = gases.slice();
      next[existingIndex] = sanitizedGas;
      set({ customGases: next });
    } else {
      set({ customGases: [...gases, sanitizedGas] });
    }
  },
  removeCustomGas: (id: string) => {
    set({ customGases: get().customGases.filter((item: GasDefinition) => item.id !== id) });
  },
  setPricePerCuFtO2: (value: number | undefined) => set({ pricePerCuFtO2: value }),
  setPricePerCuFtHe: (value: number | undefined) => set({ pricePerCuFtHe: value }),
  setPricePerCuFtTopOff: (value: number | undefined) => set({ pricePerCuFtTopOff: value }),
  setDefaultTankSizeCuFt: (value: number | undefined) => set({ defaultTankSizeCuFt: value }),
  setTankRatedPressure: (value: number | undefined) => set({ tankRatedPressure: value })
});

export const useSettingsStore = create<SettingsState>()(
  persist(settingsCreator, {
    name: "barefoot-blender-settings",
    version: 3,
    migrate: (persisted): PersistedSettingsState => migrateSettingsState((persisted ?? {}) as PersistedSettingsState)
  })
);

export type SettingsSnapshot = SettingsState;
