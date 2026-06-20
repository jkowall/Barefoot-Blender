import { describe, it, expect } from "vitest";
import {
  DEFAULT_START_TEMPERATURE_F,
  DEFAULT_FILL_TEMPERATURE_F,
  DEFAULT_SETTLED_TEMPERATURE_F,
  fahrenheitToCelsius,
  celsiusToFahrenheit,
  fahrenheitToKelvin,
  toDisplayTemperature,
  fromDisplayTemperature,
  temperatureUnitLabel,
} from "./temperature";

describe("Temperature Constants", () => {
  it("should have correct default temperatures", () => {
    expect(DEFAULT_START_TEMPERATURE_F).toBe(70);
    expect(DEFAULT_FILL_TEMPERATURE_F).toBe(90);
    expect(DEFAULT_SETTLED_TEMPERATURE_F).toBe(70);
  });
});

describe("Temperature Conversions", () => {
  describe("fahrenheitToCelsius", () => {
    it("should convert correctly", () => {
      expect(fahrenheitToCelsius(32)).toBe(0);
      expect(fahrenheitToCelsius(212)).toBe(100);
      expect(fahrenheitToCelsius(-40)).toBe(-40);
      expect(fahrenheitToCelsius(98.6)).toBeCloseTo(37, 1);
    });
  });

  describe("celsiusToFahrenheit", () => {
    it("should convert correctly", () => {
      expect(celsiusToFahrenheit(0)).toBe(32);
      expect(celsiusToFahrenheit(100)).toBe(212);
      expect(celsiusToFahrenheit(-40)).toBe(-40);
      expect(celsiusToFahrenheit(37)).toBeCloseTo(98.6, 1);
    });
  });

  describe("fahrenheitToKelvin", () => {
    it("should convert correctly", () => {
      expect(fahrenheitToKelvin(-459.67)).toBe(0); // Absolute zero
      expect(fahrenheitToKelvin(32)).toBeCloseTo(273.15, 2);
      expect(fahrenheitToKelvin(212)).toBeCloseTo(373.15, 2);
    });
  });
});

describe("Display Temperatures", () => {
  describe("toDisplayTemperature", () => {
    it("should return same value for fahrenheit", () => {
      expect(toDisplayTemperature(100, "f")).toBe(100);
      expect(toDisplayTemperature(32, "f")).toBe(32);
    });

    it("should convert to celsius when unit is c", () => {
      expect(toDisplayTemperature(32, "c")).toBe(0);
      expect(toDisplayTemperature(212, "c")).toBe(100);
    });
  });

  describe("fromDisplayTemperature", () => {
    it("should return same value for fahrenheit", () => {
      expect(fromDisplayTemperature(100, "f")).toBe(100);
      expect(fromDisplayTemperature(32, "f")).toBe(32);
    });

    it("should convert from celsius when unit is c", () => {
      expect(fromDisplayTemperature(0, "c")).toBe(32);
      expect(fromDisplayTemperature(100, "c")).toBe(212);
    });
  });

  describe("temperatureUnitLabel", () => {
    it("should return 'F' for fahrenheit", () => {
      expect(temperatureUnitLabel("f")).toBe("F");
    });

    it("should return 'C' for celsius", () => {
      expect(temperatureUnitLabel("c")).toBe("C");
    });
  });
});
