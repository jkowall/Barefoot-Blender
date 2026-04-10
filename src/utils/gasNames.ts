export const GAS_NAME_MAX_LENGTH = 32;

export const sanitizeGasName = (name: string): string => name.slice(0, GAS_NAME_MAX_LENGTH);
