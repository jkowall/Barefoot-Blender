import { expect, test, describe } from "vitest";
import { listTopOffOptions } from "./calculations";
import type { GasDefinition } from "../state/settings";

describe("listTopOffOptions", () => {
  test("returns only default gases when no custom gases are provided", () => {
    expect(listTopOffOptions([])).toEqual([
      { id: "air", name: "Air", o2: 21, he: 0 },
      { id: "oxygen", name: "Oxygen", o2: 100, he: 0 },
      { id: "helium", name: "Helium", o2: 0, he: 100 }
    ]);
  });

  test("includes custom gases with correct mapping", () => {
    const customGases: GasDefinition[] = [
      { id: "ean32", name: "EAN32", o2: 32, he: 0 }
    ];

    expect(listTopOffOptions(customGases)).toEqual([
      { id: "air", name: "Air", o2: 21, he: 0 },
      { id: "oxygen", name: "Oxygen", o2: 100, he: 0 },
      { id: "helium", name: "Helium", o2: 0, he: 100 },
      { id: "ean32", name: "EAN32", o2: 32, he: 0 }
    ]);
  });

  test("maintains order and handles multiple custom gases", () => {
    const customGases: GasDefinition[] = [
      { id: "ean32", name: "EAN32", o2: 32, he: 0 },
      { id: "trimix-21-35", name: "21/35", o2: 21, he: 35 }
    ];

    expect(listTopOffOptions(customGases)).toEqual([
      { id: "air", name: "Air", o2: 21, he: 0 },
      { id: "oxygen", name: "Oxygen", o2: 100, he: 0 },
      { id: "helium", name: "Helium", o2: 0, he: 100 },
      { id: "ean32", name: "EAN32", o2: 32, he: 0 },
      { id: "trimix-21-35", name: "21/35", o2: 21, he: 35 }
    ]);
  });
});
