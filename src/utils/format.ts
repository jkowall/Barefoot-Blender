import type { DepthUnit, PressureUnit, TemperatureUnit } from "../state/settings";
import type { FillCostBasis } from "./calculations";
import { FREE_GAS_REFERENCE_TEMPERATURE_F, temperatureUnitLabel, toDisplayTemperature } from "./temperature";
import { toDisplayDepth, toDisplayPressure } from "./units";
export { GAS_NAME_MAX_LENGTH, sanitizeGasName } from "./gasNames";

const clampPrecision = (value: number, decimals = 1): number => {
  return Number.isFinite(value) ? Number(Math.round(value * 10 ** decimals) / 10 ** decimals) : 0;
};

export const formatPercentage = (value: number, decimals = 1): string => `${clampPrecision(value, decimals)}%`;

export const formatPressure = (valuePsi: number, unit: PressureUnit, decimals = 0): string =>
  `${clampPrecision(toDisplayPressure(valuePsi, unit), decimals)} ${unit.toUpperCase()}`;

export const formatSignedPressure = (valuePsi: number, unit: PressureUnit, decimals = 0): string => {
  const magnitude = formatPressure(Math.abs(valuePsi), unit, decimals);
  if (valuePsi > 0) {
    return `+${magnitude}`;
  }
  if (valuePsi < 0) {
    return `-${magnitude}`;
  }
  return magnitude;
};

export const formatDepth = (valueFeet: number, unit: DepthUnit, decimals = 0): string =>
  `${clampPrecision(toDisplayDepth(valueFeet, unit), decimals)} ${unit}`;

export const formatNumber = (value: number, decimals = 1): string => `${clampPrecision(value, decimals)}`;

export const formatGasVolume = (volumeCuFt: number, volumeLiters: number): string =>
  `${formatNumber(volumeCuFt, 2)} cu ft, ${formatNumber(volumeLiters, 2)} L`;

export const formatGasCostDetail = (
  volumeCuFt: number,
  volumeLiters: number,
  unitPrice: number,
  cost: number
): string => `${formatGasVolume(volumeCuFt, volumeLiters)} × $${unitPrice.toFixed(2)} = $${cost.toFixed(2)}`;

export const formatFillCostBasis = (basis: FillCostBasis, temperatureUnit: TemperatureUnit): string => {
  if (basis === "gerg2008") {
    const referenceTemperature = formatNumber(toDisplayTemperature(FREE_GAS_REFERENCE_TEMPERATURE_F, temperatureUnit), 1);
    return `Volumes: GERG-2008 real gas (Z-corrected), free gas at 1 atm and ${referenceTemperature} ${temperatureUnitLabel(temperatureUnit)}.`;
  }
  if (basis === "idealFallback") {
    return "Volumes: ideal pressure ratio. GERG-2008 volumes are unavailable for this fill.";
  }
  return "Volumes: ideal pressure ratio of tank size to rated pressure.";
};
