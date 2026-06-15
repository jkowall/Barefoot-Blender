import type { TemperatureUnit } from "../state/settings";

export const DEFAULT_START_TEMPERATURE_F = 70;
export const DEFAULT_FILL_TEMPERATURE_F = 90;
export const DEFAULT_SETTLED_TEMPERATURE_F = 70;

export const fahrenheitToCelsius = (valueF: number): number => (valueF - 32) * (5 / 9);

export const celsiusToFahrenheit = (valueC: number): number => valueC * (9 / 5) + 32;

export const fahrenheitToKelvin = (valueF: number): number => (valueF + 459.67) * (5 / 9);

export const toDisplayTemperature = (valueF: number, unit: TemperatureUnit): number => {
  if (unit === "f") {
    return valueF;
  }
  return fahrenheitToCelsius(valueF);
};

export const fromDisplayTemperature = (value: number, unit: TemperatureUnit): number => {
  if (unit === "f") {
    return value;
  }
  return celsiusToFahrenheit(value);
};

export const temperatureUnitLabel = (unit: TemperatureUnit): string => (unit === "f" ? "F" : "C");
