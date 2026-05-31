/**
 * Sanitized logging utility to prevent sensitive information leakage.
 */

export const logger = {
  /**
   * Logs an error with a context message, redacting the full error object
   * to avoid leaking sensitive internal state or stack traces.
   */
  error: (message: string, error: unknown): void => {
    const sanitizedError = error instanceof Error
      ? { name: error.name, message: error.message }
      : String(error);

    // In a real production environment, we might want to send this to a
    // remote logging service, but for this PWA we log to console securely.
    console.error(`[ERROR] ${message}`, sanitizedError);
  },

  /**
   * Standard info log.
   */
  info: (message: string, ...args: unknown[]): void => {
    // Avoid logging potentially sensitive objects directly.
    // For now, we just pass through but this is a central point for future redaction.
    console.log(`[INFO] ${message}`, ...args);
  }
};
