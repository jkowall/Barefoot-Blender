import { describe, expect, test } from "vitest";
import headers from "../public/_headers?raw";
import privacyPage from "../public/privacy/index.html?raw";
import supportPage from "../public/support/index.html?raw";
import termsPage from "../public/terms/index.html?raw";

const getDirective = (policy: string, name: string): string | undefined =>
  policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part === name || part.startsWith(`${name} `));

describe("production Content-Security-Policy", () => {
  const policy = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? "";

  test("is set for every route", () => {
    expect(headers.trimStart().startsWith("/*")).toBe(true);
    expect(policy).not.toBe("");
  });

  test("only allows same-origin stylesheets", () => {
    expect(getDirective(policy, "style-src")).toBe("style-src 'self'");
  });

  // Store listings link to these pages, so inline styles here would render unstyled in production.
  test.each([
    ["privacy", privacyPage],
    ["support", supportPage],
    ["terms", termsPage]
  ])("%s page uses the shared stylesheet instead of inline styles", (_page, html) => {
    expect(html).toContain('<link rel="stylesheet" href="/legal.css" />');
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/\sstyle\s*=/i);
  });
});
