export type GergGasFractions = {
  o2: number;
  he: number;
  n2: number;
};

export type GergState = {
  pressureKpa: number;
  densityMolPerLiter: number;
  z: number;
  warnings: string[];
};

export type GergPressureResult = GergState & {
  success: boolean;
  errors: string[];
  dPdD: number;
};

export type GergDensityResult = GergState & {
  success: boolean;
  errors: string[];
};

type GergComponentKey = keyof GergGasFractions;

type GergComponent = {
  key: GergComponentKey;
  criticalDensityMolPerLiter: number;
  criticalTemperatureK: number;
  polynomialTerms: number;
  coefficients: number[];
  densityExponents: number[];
  temperatureExponents: number[];
  exponentialExponents: number[];
};

type PairParameters = {
  betaV: number;
  gammaV: number;
  betaT: number;
  gammaT: number;
};

type PreparedPairParameters = {
  betaV: number;
  gammaV: number;
  betaT: number;
  gammaT: number;
};

type ResidualDerivatives = {
  ar01: number;
  ar02: number;
};

export const ATM_PRESSURE_PSI = 14.6959488;
export const KPA_PER_PSI = 6.894757293168;
export const PSI_PER_KPA = 1 / KPA_PER_PSI;
export const GERG_MIN_TEMPERATURE_K = 250;
export const GERG_MAX_PRESSURE_KPA = 40000;

const R_GERG = 8.314472;
const EPSILON = 1e-12;
const DENSITY_TOLERANCE = 1e-7;

const COMMON_DENSITY_EXPONENTS = [1, 1, 1, 2, 3, 7, 2, 5, 1, 4, 3, 4];
const COMMON_TEMPERATURE_EXPONENTS = [0.25, 1.125, 1.5, 1.375, 0.25, 0.875, 0.625, 1.75, 3.625, 3.625, 14.5, 12];
const COMMON_EXPONENTIAL_EXPONENTS = [0, 0, 0, 0, 0, 0, 1, 1, 2, 2, 3, 3];

const NITROGEN_COMPONENT: GergComponent = {
  key: "n2",
  criticalDensityMolPerLiter: 11.1839,
  criticalTemperatureK: 126.192,
  polynomialTerms: 6,
  coefficients: [
    0.59889711801201,
    -1.6941557480731,
    0.24579736191718,
    -0.23722456755175,
    0.017954918715141,
    0.014592875720215,
    0.10008065936206,
    0.73157115385532,
    -0.88372272336366,
    0.31887660246708,
    0.20766491728799,
    -0.019379315454158,
    -0.16936641554983,
    0.13546846041701,
    -0.033066712095307,
    -0.060690817018557,
    0.012797548292871,
    0.0058743664107299,
    -0.018451951971969,
    0.0047226622042472,
    -0.0052024079680599,
    0.043563505956635,
    -0.036251690750939,
    -0.0028974026866543
  ],
  densityExponents: [1, 1, 2, 2, 4, 4, 1, 1, 1, 2, 3, 6, 2, 3, 3, 4, 4, 2, 3, 4, 5, 6, 6, 7],
  temperatureExponents: [
    0.125,
    1.125,
    0.375,
    1.125,
    0.625,
    1.5,
    0.625,
    2.625,
    2.75,
    2.125,
    2,
    1.75,
    4.5,
    4.75,
    5,
    4,
    4.5,
    7.5,
    14,
    11.5,
    26,
    28,
    30,
    16
  ],
  exponentialExponents: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 6, 6, 6, 6]
};

const OXYGEN_COMPONENT: GergComponent = {
  key: "o2",
  criticalDensityMolPerLiter: 13.63,
  criticalTemperatureK: 154.595,
  polynomialTerms: 6,
  coefficients: [
    0.88878286369701,
    -2.4879433312148,
    0.59750190775886,
    0.0096501817061881,
    0.07197042871277,
    0.00022337443000195,
    0.18558686391474,
    -0.03812936803576,
    -0.15352245383006,
    -0.026726814910919,
    -0.025675298677127,
    0.0095714302123668
  ],
  densityExponents: COMMON_DENSITY_EXPONENTS,
  temperatureExponents: COMMON_TEMPERATURE_EXPONENTS,
  exponentialExponents: COMMON_EXPONENTIAL_EXPONENTS
};

const HELIUM_COMPONENT: GergComponent = {
  key: "he",
  criticalDensityMolPerLiter: 17.399,
  criticalTemperatureK: 5.1953,
  polynomialTerms: 4,
  coefficients: [
    -0.45579024006737,
    1.2516390754925,
    -1.5438231650621,
    0.020467489707221,
    -0.34476212380781,
    -0.020858459512787,
    0.016227414711778,
    -0.057471818200892,
    0.019462416430715,
    -0.03329568012302,
    -0.010863577372367,
    -0.022173365245954
  ],
  densityExponents: [1, 1, 1, 4, 1, 3, 5, 5, 5, 2, 1, 2],
  temperatureExponents: [0, 0.125, 0.75, 1, 0.75, 2.625, 0.125, 1.25, 2, 1, 4.5, 5],
  exponentialExponents: [0, 0, 0, 0, 1, 1, 1, 1, 1, 2, 3, 3]
};

const COMPONENTS = [NITROGEN_COMPONENT, OXYGEN_COMPONENT, HELIUM_COMPONENT];

const RAW_PAIR_PARAMETERS: Record<string, PairParameters> = {
  "n2-o2": {
    betaV: 0.99952177,
    gammaV: 0.997082328,
    betaT: 0.997190589,
    gammaT: 0.995157044
  },
  "n2-he": {
    betaV: 0.969501055,
    gammaV: 0.932629867,
    betaT: 0.692868765,
    gammaT: 1.47183158
  },
  "o2-he": {
    betaV: 1,
    gammaV: 1,
    betaT: 1,
    gammaT: 1
  }
};

const orderedPairKey = (left: GergComponentKey, right: GergComponentKey): string => {
  const leftIndex = COMPONENTS.findIndex((component) => component.key === left);
  const rightIndex = COMPONENTS.findIndex((component) => component.key === right);
  const keys = leftIndex <= rightIndex ? [left, right] : [right, left];
  return `${keys[0]}-${keys[1]}`;
};

const preparePairParameters = (left: GergComponent, right: GergComponent): PreparedPairParameters => {
  if (left.key === right.key) {
    return {
      betaV: 1,
      gammaV: 1 / left.criticalDensityMolPerLiter,
      betaT: 1,
      gammaT: left.criticalTemperatureK
    };
  }

  const raw = RAW_PAIR_PARAMETERS[orderedPairKey(left.key, right.key)];
  const betaV = raw.betaV;
  const betaT = raw.betaT;
  const leftCriticalVolumeRoot = 1 / Math.cbrt(left.criticalDensityMolPerLiter) / 2;
  const rightCriticalVolumeRoot = 1 / Math.cbrt(right.criticalDensityMolPerLiter) / 2;

  return {
    betaV: betaV ** 2,
    gammaV: raw.gammaV * betaV * (leftCriticalVolumeRoot + rightCriticalVolumeRoot) ** 3,
    betaT: betaT ** 2,
    gammaT: raw.gammaT * betaT * Math.sqrt(left.criticalTemperatureK) * Math.sqrt(right.criticalTemperatureK)
  };
};

const validateEnvelope = (temperatureK: number, pressureKpa: number): { warnings: string[]; errors: string[] } => {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!Number.isFinite(temperatureK) || temperatureK <= 0) {
    errors.push("Temperature must be a positive absolute temperature.");
  } else if (temperatureK < GERG_MIN_TEMPERATURE_K) {
    errors.push("GERG-2008 correction is limited to temperatures at or above 250 K.");
  } else if (temperatureK > 400) {
    warnings.push("GERG-2008 correction is outside the normal scuba fill temperature range above 400 K.");
  }

  if (!Number.isFinite(pressureKpa) || pressureKpa < 0) {
    errors.push("Pressure must be zero or greater.");
  } else if (pressureKpa > GERG_MAX_PRESSURE_KPA) {
    errors.push("GERG-2008 correction is limited to pressures at or below 400 bar absolute.");
  }

  return { warnings, errors };
};

export const gaugePsiToAbsoluteKpa = (pressurePsi: number): number =>
  (Math.max(0, pressurePsi) + ATM_PRESSURE_PSI) * KPA_PER_PSI;

export const absoluteKpaToGaugePsi = (pressureKpa: number): number =>
  Math.max(0, pressureKpa * PSI_PER_KPA - ATM_PRESSURE_PSI);

export const gasFractionsFromPercents = (o2Percent: number, hePercent: number): GergGasFractions => {
  const o2 = o2Percent / 100;
  const he = hePercent / 100;
  return {
    o2,
    he,
    n2: 1 - o2 - he
  };
};

export const normalizeGergFractions = (fractions: GergGasFractions): GergGasFractions => {
  const total = fractions.o2 + fractions.he + fractions.n2;
  if (!Number.isFinite(total) || total <= EPSILON) {
    return { o2: 0, he: 0, n2: 0 };
  }
  return {
    o2: fractions.o2 / total,
    he: fractions.he / total,
    n2: fractions.n2 / total
  };
};

const validateFractions = (fractions: GergGasFractions): string[] => {
  const values = [fractions.o2, fractions.he, fractions.n2];
  if (values.some((value) => !Number.isFinite(value))) {
    return ["Gas fractions must be finite values."];
  }
  if (values.some((value) => value < -1e-9)) {
    return ["Gas fractions cannot be negative."];
  }
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= EPSILON) {
    return ["At least one gas fraction is required."];
  }
  return [];
};

const fractionForComponent = (fractions: GergGasFractions, key: GergComponentKey): number => fractions[key];

const reducingParameters = (fractions: GergGasFractions): { reducingTemperatureK: number; reducingDensityMolPerLiter: number } => {
  let reducingVolume = 0;
  let reducingTemperatureK = 0;

  for (let i = 0; i < COMPONENTS.length; i += 1) {
    const left = COMPONENTS[i];
    const leftFraction = fractionForComponent(fractions, left.key);
    if (leftFraction <= EPSILON) {
      continue;
    }

    let factor = 1;
    for (let j = i; j < COMPONENTS.length; j += 1) {
      const right = COMPONENTS[j];
      const rightFraction = fractionForComponent(fractions, right.key);
      if (rightFraction <= EPSILON) {
        continue;
      }

      const pair = preparePairParameters(left, right);
      const combinedFraction = factor * leftFraction * rightFraction * (leftFraction + rightFraction);
      reducingVolume += combinedFraction * pair.gammaV / (pair.betaV * leftFraction + rightFraction);
      reducingTemperatureK += combinedFraction * pair.gammaT / (pair.betaT * leftFraction + rightFraction);
      factor = 2;
    }
  }

  return {
    reducingTemperatureK,
    reducingDensityMolPerLiter: reducingVolume > EPSILON ? 1 / reducingVolume : 0
  };
};

const residualDerivatives = (
  temperatureK: number,
  densityMolPerLiter: number,
  fractions: GergGasFractions
): ResidualDerivatives => {
  const { reducingTemperatureK, reducingDensityMolPerLiter } = reducingParameters(fractions);
  const delta = densityMolPerLiter / reducingDensityMolPerLiter;
  const tau = reducingTemperatureK / temperatureK;
  let ar01 = 0;
  let ar02 = 0;

  for (const component of COMPONENTS) {
    const moleFraction = fractionForComponent(fractions, component.key);
    if (moleFraction <= EPSILON) {
      continue;
    }

    for (let index = 0; index < component.coefficients.length; index += 1) {
      const coefficient = component.coefficients[index];
      const densityExponent = component.densityExponents[index];
      const temperatureExponent = component.temperatureExponents[index];
      const exponentialExponent = component.exponentialExponents[index];
      const base =
        moleFraction *
        coefficient *
        delta ** densityExponent *
        tau ** temperatureExponent;

      if (index < component.polynomialTerms) {
        const densityDerivative = base * densityExponent;
        ar01 += densityDerivative;
        ar02 += densityDerivative * (densityExponent - 1);
        continue;
      }

      const exponentialTerm = Math.exp(-(delta ** exponentialExponent));
      const term = base * exponentialTerm;
      const correction = exponentialExponent * delta ** exponentialExponent;
      const first = densityExponent - correction;
      ar01 += term * first;
      ar02 += term * (first * (first - 1) - exponentialExponent * correction);
    }
  }

  return { ar01, ar02 };
};

const pressureFromDensityCore = (
  temperatureK: number,
  densityMolPerLiter: number,
  fractions: GergGasFractions
): { pressureKpa: number; z: number; dPdD: number } => {
  const residual = residualDerivatives(temperatureK, densityMolPerLiter, fractions);
  const z = 1 + residual.ar01;
  return {
    pressureKpa: densityMolPerLiter * R_GERG * temperatureK * z,
    z,
    dPdD: R_GERG * temperatureK * (1 + 2 * residual.ar01 + residual.ar02)
  };
};

export const gergPressureFromDensity = (
  temperatureK: number,
  densityMolPerLiter: number,
  inputFractions: GergGasFractions
): GergPressureResult => {
  const fractionErrors = validateFractions(inputFractions);
  if (fractionErrors.length > 0) {
    return {
      success: false,
      pressureKpa: 0,
      densityMolPerLiter: 0,
      z: 1,
      dPdD: 0,
      warnings: [],
      errors: fractionErrors
    };
  }

  const fractions = normalizeGergFractions(inputFractions);
  if (densityMolPerLiter <= EPSILON) {
    const envelope = validateEnvelope(temperatureK, 0);
    return {
      success: envelope.errors.length === 0,
      pressureKpa: 0,
      densityMolPerLiter: 0,
      z: 1,
      dPdD: R_GERG * temperatureK,
      warnings: envelope.warnings,
      errors: envelope.errors
    };
  }

  const state = pressureFromDensityCore(temperatureK, densityMolPerLiter, fractions);
  const envelope = validateEnvelope(temperatureK, state.pressureKpa);
  return {
    success: envelope.errors.length === 0,
    pressureKpa: state.pressureKpa,
    densityMolPerLiter,
    z: state.z,
    dPdD: state.dPdD,
    warnings: envelope.warnings,
    errors: envelope.errors
  };
};

export const gergDensityFromPressure = (
  temperatureK: number,
  pressureKpa: number,
  inputFractions: GergGasFractions
): GergDensityResult => {
  const fractionErrors = validateFractions(inputFractions);
  const envelope = validateEnvelope(temperatureK, pressureKpa);
  const errors = [...fractionErrors, ...envelope.errors];
  if (errors.length > 0) {
    return {
      success: false,
      pressureKpa,
      densityMolPerLiter: 0,
      z: 1,
      warnings: envelope.warnings,
      errors
    };
  }

  if (pressureKpa <= EPSILON) {
    return {
      success: true,
      pressureKpa: 0,
      densityMolPerLiter: 0,
      z: 1,
      warnings: envelope.warnings,
      errors: []
    };
  }

  const fractions = normalizeGergFractions(inputFractions);
  const targetLogPressure = Math.log(pressureKpa);
  let densityMolPerLiter = pressureKpa / R_GERG / temperatureK;
  let logVolume = -Math.log(densityMolPerLiter);

  for (let iteration = 0; iteration < 50; iteration += 1) {
    densityMolPerLiter = Math.exp(-logVolume);
    const lastState = pressureFromDensityCore(temperatureK, densityMolPerLiter, fractions);

    if (lastState.dPdD <= EPSILON || lastState.pressureKpa <= EPSILON) {
      logVolume += densityMolPerLiter > 1 ? -0.05 : 0.05;
      continue;
    }

    const pressureVolumeDerivative = -densityMolPerLiter * lastState.dPdD;
    const volumeDelta = (Math.log(lastState.pressureKpa) - targetLogPressure) * lastState.pressureKpa / pressureVolumeDerivative;
    logVolume -= volumeDelta;

    if (Math.abs(volumeDelta) < DENSITY_TOLERANCE) {
      densityMolPerLiter = Math.exp(-logVolume);
      const convergedState = pressureFromDensityCore(temperatureK, densityMolPerLiter, fractions);
      return {
        success: true,
        pressureKpa,
        densityMolPerLiter,
        z: convergedState.z,
        warnings: envelope.warnings,
        errors: []
      };
    }
  }

  return {
    success: false,
    pressureKpa,
    densityMolPerLiter: pressureKpa / R_GERG / temperatureK,
    z: 1,
    warnings: envelope.warnings,
    errors: ["GERG-2008 density solver failed to converge."]
  };
};

export const gergMolarMass = (fractions: GergGasFractions): number => {
  const normalized = normalizeGergFractions(fractions);
  return (
    normalized.n2 * 28.0134 +
    normalized.o2 * 31.9988 +
    normalized.he * 4.002602
  );
};
