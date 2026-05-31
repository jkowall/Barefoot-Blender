import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger } from "./logger";

describe("logger utility", () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should sanitize Error objects by redacting stack traces", () => {
    const error = new Error("Test error message");
    error.stack = "Sensitive stack trace";

    logger.error("Context message", error);

    expect(console.error).toHaveBeenCalled();
    const [msg, errObj] = (console.error as any).mock.calls[0];
    expect(msg).toBe("Context message");
    expect(errObj).toEqual({ name: "Error", message: "Test error message" });
    expect(errObj.stack).toBeUndefined();
  });

  it("should handle non-Error objects by passing them through", () => {
    const nonError = { some: "data" };
    logger.error("Context message", nonError);

    expect(console.error).toHaveBeenCalled();
    const [msg, errObj] = (console.error as any).mock.calls[0];
    expect(msg).toBe("Context message");
    expect(errObj).toBe(nonError);
  });

  it("should log warning messages using console.warn", () => {
    logger.warn("Warning message", "arg1");
    expect(console.warn).toHaveBeenCalledWith("Warning message", "arg1");
  });

  it("should log info messages using console.info", () => {
    logger.info("Info message", { data: 123 });
    expect(console.info).toHaveBeenCalledWith("Info message", { data: 123 });
  });
});
