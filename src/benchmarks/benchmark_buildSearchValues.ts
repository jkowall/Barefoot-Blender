
const MULTI_GAS_O2_TOLERANCE = 1;
const MULTI_GAS_O2_STEP = 0.1;
const MULTI_GAS_HE_TOLERANCE = 5;
const MULTI_GAS_HE_STEP = 0.5;

const buildSearchValuesBaseline = (
  target: number,
  toleranceValue: number,
  step: number,
  minValue: number,
  maxValue: number
): number[] => {
  const values: number[] = [];
  const append = (value: number) => {
    if (value < minValue - 1e-6 || value > maxValue + 1e-6) {
      return;
    }
    const rounded = Number(value.toFixed(4));
    if (!values.some((existing) => Math.abs(existing - rounded) < 1e-4)) {
      values.push(rounded);
    }
  };

  append(target);
  for (let delta = step; delta <= toleranceValue + 1e-6; delta += step) {
    append(target - delta);
    append(target + delta);
  }

  return values;
};

const buildSearchValuesOptimized = (
  target: number,
  toleranceValue: number,
  step: number,
  minValue: number,
  maxValue: number
): number[] => {
  const values: number[] = [];
  const seen = new Set<number>();
  const append = (value: number) => {
    if (value < minValue - 1e-6 || value > maxValue + 1e-6) {
      return;
    }
    const rounded = Number(value.toFixed(4));
    if (!seen.has(rounded)) {
      values.push(rounded);
      seen.add(rounded);
    }
  };

  append(target);
  for (let delta = step; delta <= toleranceValue + 1e-6; delta += step) {
    append(target - delta);
    append(target + delta);
  }

  return values;
};

function runBenchmark(label: string, iterations: number, toleranceO2: number, stepO2: number, toleranceHe: number, stepHe: number) {
  console.log(`--- ${label} (N_o2 ≈ ${Math.round(toleranceO2/stepO2*2)}, N_he ≈ ${Math.round(toleranceHe/stepHe*2)}) ---`);
  const targetO2 = 32;
  const targetHe = 0;

  // Baseline
  const startBase = performance.now();
  for (let i = 0; i < iterations; i++) {
    const o2Candidates = buildSearchValuesBaseline(targetO2, toleranceO2, stepO2, 0, 100);
    for (const o2 of o2Candidates) {
      const heMax = Math.max(0, 100 - o2);
      buildSearchValuesBaseline(targetHe, toleranceHe, stepHe, 0, heMax);
    }
  }
  const endBase = performance.now();
  const baseTime = endBase - startBase;

  // Optimized
  const startOpt = performance.now();
  for (let i = 0; i < iterations; i++) {
    const o2Candidates = buildSearchValuesOptimized(targetO2, toleranceO2, stepO2, 0, 100);
    for (const o2 of o2Candidates) {
      const heMax = Math.max(0, 100 - o2);
      buildSearchValuesOptimized(targetHe, toleranceHe, stepHe, 0, heMax);
    }
  }
  const endOpt = performance.now();
  const optTime = endOpt - startOpt;

  console.log(`Baseline: ${baseTime.toFixed(2)}ms`);
  console.log(`Optimized: ${optTime.toFixed(2)}ms`);
  const improvement = (baseTime - optTime) / baseTime * 100;
  console.log(`Improvement: ${improvement.toFixed(2)}%`);
}

runBenchmark("Standard", 1000, 1, 0.1, 5, 0.5);
runBenchmark("Medium", 100, 5, 0.1, 10, 0.1);
runBenchmark("Large", 10, 10, 0.01, 10, 0.01);
