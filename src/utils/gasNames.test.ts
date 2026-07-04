import { describe, it, expect } from "vitest";
import { GAS_NAME_MAX_LENGTH, sanitizeGasName } from "./gasNames";

describe("gasNames", () => {
  describe("GAS_NAME_MAX_LENGTH", () => {
    it("should be 32", () => {
      expect(GAS_NAME_MAX_LENGTH).toBe(32);
    });
  });

  describe("sanitizeGasName", () => {
    it("should return empty string if input is empty", () => {
      expect(sanitizeGasName("")).toBe("");
    });

    it("should return the same string if length is less than max", () => {
      const name = "Air";
      expect(sanitizeGasName(name)).toBe(name);
    });

    it("should return the same string if length is exactly max", () => {
      const name = "A".repeat(32);
      expect(sanitizeGasName(name)).toBe(name);
    });

    it("should truncate string if length is greater than max", () => {
      const name = "A".repeat(33);
      expect(sanitizeGasName(name)).toBe("A".repeat(32));
      expect(sanitizeGasName(name).length).toBe(32);
    });

    it("should handle multi-byte characters using standard code unit slice behavior", () => {
      // "🤿" is 2 code units. 20 of them = 40 code units.
      const name = "🤿".repeat(20);
      const expected = name.slice(0, 32);

      expect(sanitizeGasName(name)).toBe(expected);
      expect(sanitizeGasName(name).length).toBe(32);
    });
  });
});
