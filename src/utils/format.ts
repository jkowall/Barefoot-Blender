import type { DepthUnit, PressureUnit } from "../state/settings";
import { toDisplayDepth, toDisplayPressure } from "./units";

const clampPrecision = (value: number, decimals = 1): number => {
  return Number.isFinite(value) ? Number(Math.round(value * 10 ** decimals) / 10 ** decimals) : 0;
};

export const formatPercentage = (value: number, decimals = 1): string => `${clampPrecision(value, decimals)}%`;

export const formatPressure = (valuePsi: number, unit: PressureUnit, decimals = 0): string =>
  `${clampPrecision(toDisplayPressure(valuePsi, unit), decimals)} ${unit.toUpperCase()}`;

export const formatDepth = (valueFeet: number, unit: DepthUnit, decimals = 0): string =>
  `${clampPrecision(toDisplayDepth(valueFeet, unit), decimals)} ${unit}`;

export const formatNumber = (value: number, decimals = 1): string => `${clampPrecision(value, decimals)}`;
