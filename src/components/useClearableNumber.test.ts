import { describe, expect, it } from "vitest";
import { clearableDisplayValue, endClearedKeyEdit, updateClearedKeys } from "./useClearableNumber";

type Key = "startTemperatureF" | "settledTemperatureF";

describe("clearable number fields", () => {
  it("keeps an emptied field empty instead of showing its default", () => {
    const cleared = updateClearedKeys<Key>([], "startTemperatureF", undefined);
    expect(cleared).toEqual(["startTemperatureF"]);
    expect(clearableDisplayValue(cleared, "startTemperatureF", 21.111)).toBeUndefined();
    expect(clearableDisplayValue(cleared, "settledTemperatureF", 21.111)).toBe(21.111);
  });

  it("shows the typed value once a number follows a leading minus", () => {
    // Typing "-" reports an empty value; typing "5" next reports -5.
    let cleared = updateClearedKeys<Key>([], "startTemperatureF", undefined);
    cleared = updateClearedKeys(cleared, "startTemperatureF", -5);
    expect(cleared).toEqual([]);
    expect(clearableDisplayValue(cleared, "startTemperatureF", -5)).toBe(-5);
  });

  it("shows the default again when focus leaves an emptied field", () => {
    const cleared = updateClearedKeys<Key>(["settledTemperatureF"], "startTemperatureF", undefined);
    const afterBlur = endClearedKeyEdit(cleared, "startTemperatureF");
    expect(afterBlur).toEqual(["settledTemperatureF"]);
    expect(clearableDisplayValue(afterBlur, "startTemperatureF", 21.111)).toBe(21.111);
  });

  it("does not duplicate keys or change the list when nothing was cleared", () => {
    const once = updateClearedKeys<Key>([], "startTemperatureF", undefined);
    expect(updateClearedKeys(once, "startTemperatureF", undefined)).toEqual(["startTemperatureF"]);
    const untouched: Key[] = ["settledTemperatureF"];
    expect(endClearedKeyEdit(untouched, "startTemperatureF")).toBe(untouched);
  });
});
