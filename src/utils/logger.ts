/**
 * Sanitized logging utility to prevent sensitive information leakage.
 * Recreated to match behavior expected by #136 follow-up.
 */

export const logger = {
  /**
   * Logs an error with a context message, redacting the full error object.
   */
  error: (message: string, error: unknown): void => {
    const sanitizedError = error instanceof Error
      ? { name: error.name, message: error.message }
      : error;

    console.error(message, sanitizedError);
  },

  /**
   * Logs a warning.
   */
  warn: (message: string, ...args: unknown[]): void => {
    console.warn(message, ...args);
  },

  /**
   * Logs info.
   */
  info: (message: string, ...args: unknown[]): void => {
    console.info(message, ...args);
  }
};
