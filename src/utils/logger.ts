/**
 * Centralized logging utility to ensure consistent error handling and security.
 * As per security standards, Error objects are sanitized to redact stack traces
 * and sensitive internal state.
 */

export const logger = {
  error: (message: string, error?: unknown): void => {
    if (error instanceof Error) {
      console.error(message, {
        name: error.name,
        message: error.message
      });
    } else {
      console.error(message, error);
    }
  },
  warn: (message: string, data?: unknown): void => {
    console.warn(message, data);
  },
  info: (message: string, data?: unknown): void => {
    console.info(message, data);
  }
};
