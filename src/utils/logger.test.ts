import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

describe("logger utility", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sanitizes Error objects by omitting stack traces", () => {
    const error = new Error("Test error message");
    error.stack = "Sensitive stack trace";

    logger.error("Context message", error);

    expect(console.error).toHaveBeenCalledWith("Context message", {
      name: "Error",
      message: "Test error message"
    });
  });

  it("passes non-Error values through as the second argument", () => {
    const nonError = { some: "data" };

    logger.error("Context message", nonError);

    expect(console.error).toHaveBeenCalledWith("Context message", nonError);
  });

  it("logs warning messages with console.warn", () => {
    logger.warn("Warning message", "arg1");

    expect(console.warn).toHaveBeenCalledWith("Warning message", "arg1");
  });

  it("logs info messages with console.info", () => {
    logger.info("Info message", { data: 123 });

    expect(console.info).toHaveBeenCalledWith("Info message", { data: 123 });
  });
});
