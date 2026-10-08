import { clampPressure, type BlendResult } from "./calculations";
import type { RealGasBlendResult } from "./realGasBlend";

// Tank pressure after each plan step: a bleed drains to the solved bleed pressure, gas steps add theirs.
export const blendPlanStopPressures = (result: BlendResult, startPsi: number): number[] => {
  let runningPsi = startPsi;
  return result.steps.map((step) => {
    runningPsi = step.kind === "bleed"
      ? result.bleedPressure ?? clampPressure(runningPsi - step.amount)
      : runningPsi + step.amount;
    return runningPsi;
  });
};

// Stop pressures for the displayed plan. idealStartPsi must be the start pressure the ideal result was
// solved from, not the live field, so editing Start Pressure cannot pair old steps with a new start.
// A GERG stage's pressure change is measured at that stage's temperature, so the changes do not sum
// to the next stop when stage temperatures differ; use the solved stop pressures instead.
export const resolveBlendPlanStopPressures = (
  result: BlendResult,
  resultSource: "ideal" | "realGas",
  realGasResult: RealGasBlendResult | null,
  idealStartPsi: number
): number[] => {
  if (resultSource === "realGas" && realGasResult) {
    return realGasResult.steps.length === result.steps.length
      ? realGasResult.steps.map((step) => step.stopPressurePsi)
      : blendPlanStopPressures(result, realGasResult.startHotPressurePsi);
  }
  return blendPlanStopPressures(result, idealStartPsi);
};
