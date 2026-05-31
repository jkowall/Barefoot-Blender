import type { GasSelection } from "../utils/calculations";
import type { GasSourceInput } from "../state/session";

// Mocks
const topOffOptions: GasSelection[] = [
  { id: "air", name: "Air", o2: 21, he: 0 },
  { id: "ean32", name: "EAN32", o2: 32, he: 0 },
  { id: "oxygen", name: "Oxygen", o2: 100, he: 0 }
];

const gasOptions: GasSelection[] = [
  ...topOffOptions
];

const source: GasSourceInput = {
  id: "custom",
  customO2: 50,
  customHe: 20,
  enabled: true
};

const getOptions = (source: GasSourceInput): GasSelection[] => {
  const custom: GasSelection = {
    id: "custom",
    name: `Custom (${(source.customO2 ?? 32).toFixed(1)} O2 / ${(source.customHe ?? 0).toFixed(1)} He)`,
    o2: source.customO2 ?? 32,
    he: source.customHe ?? 0
  };
  return [...gasOptions, custom];
};

const ITERATIONS = 100_000;

const start = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  getOptions(source);
}
const end = performance.now();
const time = end - start;
console.log(`Execution time for ${ITERATIONS} iterations: ${time.toFixed(2)}ms`);
