import { describe, expect, test } from "vitest";
import { useSessionStore } from "./session";

describe("session defaults", () => {
  test("leaves stage temperature schema fields unset for legacy fallback semantics", () => {
    const standardBlend = useSessionStore.getState().standardBlend;

    expect(standardBlend.fillTemperatureF).toBeUndefined();
    expect(standardBlend.stageTemperaturesF).toBeUndefined();
    expect(standardBlend.stageTemperatureTouched).toBeUndefined();
  });
});
