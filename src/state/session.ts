import { create } from "zustand";
import { persist } from "zustand/middleware";

export type StandardBlendInput = {
  startO2?: number;
  startHe?: number;
  startPressure?: number;
  targetO2?: number;
  targetHe?: number;
  targetPressure?: number;
  topGasId: string;
};

export type GasSourceInput = {
  id: string;
  customO2?: number;
  customHe?: number;
  enabled: boolean;
};

export type MultiGasInput = {
  gasSources?: GasSourceInput[];
  targetO2?: number;
  targetHe?: number;
  targetPressure?: number;
  startO2?: number;
  startHe?: number;
  startPressure?: number;
  selectedAlternativeIndex: number;
};

export type UtilityInputs = {
  modGasO2: number;
  modMaxPPO2: number;
  eadO2: number;
  eadDepth: number;
  bestMixDepth: number;
  bestMixPPO2: number;
  bestMixMaxEND: number;
  endO2: number;
  endHe: number;
  endDepth: number;
  densityO2: number;
  densityHe: number;
  densityDepth: number;
};

export type TopOffInput = {
  startO2?: number;
  startHe?: number;
  startPressure?: number;
  finalPressure?: number;
  topGasId: string;
};

export type SessionState = {
  standardBlend: StandardBlendInput;
  multiGas: MultiGasInput;
  utilities: UtilityInputs;
  topOff: TopOffInput;
  setStandardBlend: (value: StandardBlendInput) => void;
  setMultiGas: (value: MultiGasInput) => void;
  setUtilities: (value: Partial<UtilityInputs>) => void;
  setTopOff: (value: TopOffInput) => void;
};

type SessionSetter = (
  partial:
    | SessionState
    | Partial<SessionState>
    | ((state: SessionState) => SessionState | Partial<SessionState>),
  replace?: boolean
) => void;

const defaultValues = {
  standardBlend: {
    startO2: 21,
    startHe: 0,
    startPressure: 0,
    targetO2: 32,
    targetHe: 0,
    targetPressure: 3000,
    topGasId: "air"
  },
  multiGas: {
    gasSources: [
      { id: "air", enabled: true },
      { id: "bank-36", customO2: 36, customHe: 0, enabled: true }
    ],
    targetO2: 32,
    targetHe: 0,
    targetPressure: 3000,
    startO2: 21,
    startHe: 0,
    startPressure: 0,
    selectedAlternativeIndex: 0
  },
  utilities: {
    modGasO2: 32,
    modMaxPPO2: 1.4,
    eadO2: 32,
    eadDepth: 100,
    bestMixDepth: 100,
    bestMixPPO2: 1.4,
    bestMixMaxEND: 30,
    endO2: 21,
    endHe: 35,
    endDepth: 150,
    densityO2: 21,
    densityHe: 35,
    densityDepth: 150
  },
  topOff: {
    startO2: 32,
    startHe: 0,
    startPressure: 500,
    finalPressure: 3000,
    topGasId: "air"
  }
};

const sessionCreator = (set: SessionSetter): SessionState => ({
  standardBlend: { ...defaultValues.standardBlend },
  multiGas: { ...defaultValues.multiGas },
  utilities: { ...defaultValues.utilities },
  topOff: { ...defaultValues.topOff },
  setStandardBlend: (value) => set({ standardBlend: value }),
  setMultiGas: (value) => set({ multiGas: value }),
  setUtilities: (value) =>
    set((state) => ({ utilities: { ...state.utilities, ...value } })),
  setTopOff: (value) => set({ topOff: value })
});

export const useSessionStore = create<SessionState>()(
  persist(sessionCreator, {
    name: "barefoot-blender-session"
  })
);
