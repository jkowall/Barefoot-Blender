import type { DepthUnit, PressureUnit } from "../state/settings";

export const PSI_PER_BAR = 14.5037738;
export const FEET_PER_METER = 3.2808399;
export const FEET_PER_ATM = 33;
export const METERS_PER_ATM = 10;

export const toDisplayPressure = (valuePsi: number, unit: PressureUnit): number => {
  if (unit === "psi") {
    return valuePsi;
  }
  return valuePsi / PSI_PER_BAR;
};

export const fromDisplayPressure = (value: number, unit: PressureUnit): number => {
  if (unit === "psi") {
    return value;
  }
  return value * PSI_PER_BAR;
};

// Fill pressure assumed while a Final or Target Pressure field is empty mid-edit. It is defined in PSI so
// bar mode falls back to the same fill (about 206.8 bar) instead of reading 3000 as a bar value.
export const DEFAULT_FILL_PRESSURE_PSI = 3000;

export const resolveFillPressureDisplay = (value: number | undefined, unit: PressureUnit): number =>
  value ?? toDisplayPressure(DEFAULT_FILL_PRESSURE_PSI, unit);

export const toDisplayDepth = (valueFeet: number, unit: DepthUnit): number => {
  if (unit === "ft") {
    return valueFeet;
  }
  return valueFeet / FEET_PER_METER;
};

export const fromDisplayDepth = (value: number, unit: DepthUnit): number => {
  if (unit === "ft") {
    return value;
  }
  return value * FEET_PER_METER;
};

export const depthPerAtm = (unit: DepthUnit): number => (unit === "ft" ? FEET_PER_ATM : METERS_PER_ATM);
