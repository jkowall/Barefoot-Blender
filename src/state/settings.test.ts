import { describe, expect, test } from "bun:test";
import { GAS_NAME_MAX_LENGTH } from "../utils/gasNames";
import { migrateSettingsState, sanitizeCustomGas } from "./settings";

describe("sanitizeCustomGas", () => {
  test("truncates names at the persistence boundary", () => {
    const gas = sanitizeCustomGas({
      id: "custom-1",
      name: "A".repeat(50),
      o2: 32,
      he: 15
    });

    expect(gas).toEqual({
      id: "custom-1",
      name: "A".repeat(GAS_NAME_MAX_LENGTH),
      o2: 32,
      he: 15
    });
  });
});

describe("migrateSettingsState", () => {
  test("sanitizes persisted custom gas names for current settings data", () => {
    const migrated = migrateSettingsState({
      customGases: [
        {
          id: "custom-1",
          name: "B".repeat(50),
          o2: 32,
          he: 0
        }
      ],
      pricePerCuFtTopOff: 0.25
    });

    expect(migrated.customGases?.[0]?.name).toBe("B".repeat(GAS_NAME_MAX_LENGTH));
    expect(migrated.pricePerCuFtTopOff).toBe(0.25);
  });

  test("preserves legacy air price migration while sanitizing custom gas names", () => {
    const migrated = migrateSettingsState({
      customGases: [
        {
          id: "custom-2",
          name: "Trimix ".repeat(10),
          o2: 18,
          he: 45
        }
      ],
      pricePerCuFtAir: 0.15
    });

    expect(migrated.customGases?.[0]?.name).toBe("Trimix ".repeat(10).slice(0, GAS_NAME_MAX_LENGTH));
    expect(migrated.pricePerCuFtTopOff).toBe(0.15);
  });
});
