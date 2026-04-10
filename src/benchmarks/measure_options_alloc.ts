import type { GasSelection } from "../utils/calculations";
import type { GasSourceInput } from "../state/session";

// Mocks
const trimixPresets: GasSelection[] = [
  { id: "trimix-2135", name: "Trimix 21/35", o2: 21, he: 35 },
  { id: "trimix-1845", name: "Trimix 18/45", o2: 18, he: 45 },
  { id: "trimix-1555", name: "Trimix 15/55", o2: 15, he: 55 }
];

const topOffOptions: GasSelection[] = [
  { id: "air", name: "Air", o2: 21, he: 0 },
  { id: "ean32", name: "EAN32", o2: 32, he: 0 },
  { id: "oxygen", name: "Oxygen", o2: 100, he: 0 }
];

// gasOptions includes trimixPresets as per MultiGasTab.tsx logic
const gasOptions: GasSelection[] = [
  ...topOffOptions,
  ...trimixPresets
];

const source: GasSourceInput = {
  id: "custom",
  customO2: 50,
  customHe: 20,
  enabled: true
};

// Current implementation simulation
// Note: In real component, this function is re-created every render, but here we just measure execution time of the logic
const getOptionsBaseline = (source: GasSourceInput): GasSelection[] => {
  const custom: GasSelection = {
    id: "custom",
    name: `Custom (${(source.customO2 ?? 32).toFixed(1)} O2 / ${(source.customHe ?? 0).toFixed(1)} He)`,
    o2: source.customO2 ?? 32,
    he: source.customHe ?? 0
  };
  const existingIds = new Set(gasOptions.map(g => g.id));
  return [...gasOptions, custom, ...trimixPresets.filter(t => !existingIds.has(t.id))];
};

// Optimized implementation simulation
const getOptionsOptimized = (source: GasSourceInput): GasSelection[] => {
  const custom: GasSelection = {
    id: "custom",
    name: `Custom (${(source.customO2 ?? 32).toFixed(1)} O2 / ${(source.customHe ?? 0).toFixed(1)} He)`,
    o2: source.customO2 ?? 32,
    he: source.customHe ?? 0
  };
  return [...gasOptions, custom];
};

const ITERATIONS = 100_000;

const startBase = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  getOptionsBaseline(source);
}
const endBase = performance.now();
const baseTime = endBase - startBase;
console.log(`Baseline: ${baseTime.toFixed(2)}ms`);

const startOpt = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  getOptionsOptimized(source);
}
const endOpt = performance.now();
const optTime = endOpt - startOpt;
console.log(`Optimized: ${optTime.toFixed(2)}ms`);

const improvement = (baseTime - optTime) / baseTime * 100;
console.log(`Improvement: ${improvement.toFixed(2)}%`);
