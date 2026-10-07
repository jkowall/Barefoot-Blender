import type { TemperatureUnit } from "../state/settings";

export const DEFAULT_START_TEMPERATURE_F = 70;
export const DEFAULT_FILL_TEMPERATURE_F = 90;
export const DEFAULT_SETTLED_TEMPERATURE_F = 70;
// Free-gas volumes are reported at 70 F and 1 atm, the US compressed-gas (CGA) reference.
export const FREE_GAS_REFERENCE_TEMPERATURE_F = 70;

export const fahrenheitToCelsius = (valueF: number): number => (valueF - 32) * (5 / 9);

export const celsiusToFahrenheit = (valueC: number): number => valueC * (9 / 5) + 32;

export const fahrenheitToKelvin = (valueF: number): number => (valueF + 459.67) * (5 / 9);

export const toDisplayTemperature = (valueF: number, unit: TemperatureUnit): number => {
  if (unit === "f") {
    return valueF;
  }
  return fahrenheitToCelsius(valueF);
};

/**
 * Temperature for an editable input, rounded to 0.01 degrees. Converting a typed Celsius value to
 * the stored Fahrenheit and back adds float noise (12 C reads back as 12.000000000000002), which
 * would otherwise show in the field and rewrite it mid-typing.
 */
export const toDisplayTemperatureInput = (valueF: number, unit: TemperatureUnit): number =>
  Math.round(toDisplayTemperature(valueF, unit) * 100) / 100;

export const fromDisplayTemperature = (value: number, unit: TemperatureUnit): number => {
  if (unit === "f") {
    return value;
  }
  return celsiusToFahrenheit(value);
};

export const temperatureUnitLabel = (unit: TemperatureUnit): string => (unit === "f" ? "F" : "C");
