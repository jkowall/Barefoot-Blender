import { describe, expect, test } from "vitest";
import {
  buildBugReport,
  buildBugReportMailtoLink,
  collectBrowserDiagnostics,
  sanitizeBugReportDiagnostics
} from "./bugReport";

const baseReport = {
  appVersion: "0.9.1",
  platform: "web" as const,
  source: "footer" as const,
  whatHappened: "The result panel did not update.",
  expectedBehavior: "The result should recalculate.",
  includeDiagnostics: false
};

describe("bug report service", () => {
  test("builds a subject and body with app version and platform", () => {
    const report = buildBugReport(baseReport);

    expect(report.subject).toBe("Barefoot Blender bug report (web, v0.9.1, footer)");
    expect(report.body).toContain("What happened?\nThe result panel did not update.");
    expect(report.body).toContain("What did you expect?\nThe result should recalculate.");
    expect(report.body).toContain("Diagnostics\nNot included");
  });

  test("includes diagnostics only when explicitly enabled", () => {
    const diagnostics = {
      appVersion: "0.9.1",
      platform: "ios" as const,
      runtimeContext: "native" as const,
      activeTab: "standard",
      pressureUnit: "psi",
      depthUnit: "ft"
    };

    expect(buildBugReport({ ...baseReport, diagnostics }).diagnostics).toBeUndefined();
    expect(buildBugReport({ ...baseReport, includeDiagnostics: true, diagnostics }).body).toContain("activeTab: standard");
  });

  test("redacts sensitive diagnostic fields", () => {
    const diagnostics = sanitizeBugReportDiagnostics({
      appVersion: "0.9.1",
      platform: "android",
      runtimeContext: "native",
      currentInputs: {
        targetO2: 32,
        revenueCatCustomerId: "customer-id",
        receipt: "signed-receipt",
        nested: {
          apiKey: "secret-key",
          startPressure: 500
        }
      },
      errorMessage: "Render failed"
    });

    const serialized = JSON.stringify(diagnostics);
    expect(serialized).toContain("targetO2");
    expect(serialized).toContain("startPressure");
    expect(serialized).not.toContain("customer-id");
    expect(serialized).not.toContain("signed-receipt");
    expect(serialized).not.toContain("secret-key");
  });

  test("handles missing browser APIs safely", () => {
    expect(collectBrowserDiagnostics({})).toEqual({
      runtimeContext: "browser",
      userAgent: undefined,
      urlPath: undefined,
      online: undefined,
      viewport: undefined
    });
  });

  test("shortens mailto bodies when the encoded URL would be too large", () => {
    const report = buildBugReport({
      ...baseReport,
      whatHappened: "A".repeat(5000),
      expectedBehavior: "B".repeat(5000)
    });
    const mailto = buildBugReportMailtoLink(report, 700);

    expect(mailto.truncated).toBe(true);
    expect(mailto.url.length).toBeLessThanOrEqual(700);
    expect(mailto.url).toContain("Email%20body%20shortened");
  });
});
