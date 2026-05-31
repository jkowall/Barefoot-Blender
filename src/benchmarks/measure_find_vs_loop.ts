
import { BlendStep } from "../utils/calculations";

const steps: BlendStep[] = [
  { kind: "helium", amount: 100, gasName: "Helium" },
  { kind: "oxygen", amount: 50, gasName: "Oxygen" },
  { kind: "topoff", amount: 2000, gasName: "Air" }
];

const ITERATIONS = 1_000_000;

function baseline(steps: BlendStep[]) {
  const helium = steps.find((step) => step.kind === "helium")?.amount ?? 0;
  const oxygen = steps.find((step) => step.kind === "oxygen")?.amount ?? 0;
  const topoff = steps.find((step) => step.kind === "topoff")?.amount ?? 0;
  return { helium, oxygen, topoff };
}

function optimized(steps: BlendStep[]) {
  let helium = 0;
  let oxygen = 0;
  let topoff = 0;
  for (const step of steps) {
    if (step.kind === "helium") helium = step.amount;
    else if (step.kind === "oxygen") oxygen = step.amount;
    else if (step.kind === "topoff") topoff = step.amount;
  }
  return { helium, oxygen, topoff };
}

const startBase = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  baseline(steps);
}
const endBase = performance.now();
const baseTime = endBase - startBase;
console.log(`Baseline: ${baseTime.toFixed(2)}ms`);

const startOpt = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  optimized(steps);
}
const endOpt = performance.now();
const optTime = endOpt - startOpt;
console.log(`Optimized: ${optTime.toFixed(2)}ms`);

const improvement = (baseTime - optTime) / baseTime * 100;
console.log(`Improvement: ${improvement.toFixed(2)}%`);
