import { describe, it, expect, vi, beforeEach, afterEach } from "bun:test";
import { logger } from "./logger";

describe("logger utility", () => {
  const originalError = console.error;
  const originalLog = console.log;
  let errorMock: any;
  let logMock: any;

  beforeEach(() => {
    errorMock = vi.fn();
    logMock = vi.fn();
    console.error = errorMock;
    console.log = logMock;
  });

  afterEach(() => {
    console.error = originalError;
    console.log = originalLog;
  });

  it("should sanitize Error objects by redacting stack traces", () => {
    const error = new Error("Test error message");
    error.stack = "Sensitive stack trace";

    logger.error("Context message", error);

    expect(errorMock).toHaveBeenCalled();
    const [msg, errObj] = errorMock.mock.calls[0];
    expect(msg).toContain("[ERROR] Context message");
    expect(errObj).toEqual({ name: "Error", message: "Test error message" });
    expect(errObj.stack).toBeUndefined();
  });

  it("should handle non-Error objects by converting to string", () => {
    logger.error("Context message", "Simple string error");

    expect(errorMock).toHaveBeenCalled();
    const [msg, errObj] = errorMock.mock.calls[0];
    expect(msg).toContain("[ERROR] Context message");
    expect(errObj).toBe("Simple string error");
  });

  it("should log info messages", () => {
    logger.info("Some info", { data: 123 });

    expect(logMock).toHaveBeenCalled();
    const [msg, data] = logMock.mock.calls[0];
    expect(msg).toContain("[INFO] Some info");
    expect(data).toEqual({ data: 123 });
  });
});
