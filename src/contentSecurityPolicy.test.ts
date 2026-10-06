import { describe, expect, test } from "vitest";
import indexPage from "../index.html?raw";
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

// Capacitor iOS/Android apps load index.html from the bundle with no server headers, so the meta tag is their only CSP.
// No 'unsafe-inline' is needed there: Capacitor injects its bridge natively (WKUserScript on iOS,
// addDocumentStartJavaScript on Android), which page CSP does not govern. Android WebViews too old for
// addDocumentStartJavaScript fall back to an inline script, but they predate the build's browser target
// and cannot run the app anyway. RevenueCat runs in the native SDK, so connect-src 'self' is enough.
// The comment in index.html must not name Android: scripts/verify-ios-store-copy.mjs rejects it.
describe("in-app Content-Security-Policy meta tag", () => {
  const headerPolicy = /Content-Security-Policy:\s*(.+)/.exec(headers)?.[1] ?? "";
  const metaPolicy =
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i.exec(indexPage)?.[1] ?? "";
  const directives = (policy: string): string[] =>
    policy
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean);

  test("is present in index.html", () => {
    expect(metaPolicy).not.toBe("");
  });

  test("does not allow inline or eval script and style", () => {
    expect(getDirective(metaPolicy, "script-src")).toBe("script-src 'self'");
    expect(getDirective(metaPolicy, "style-src")).toBe("style-src 'self'");
    expect(metaPolicy).not.toContain("'unsafe-inline'");
    expect(metaPolicy).not.toContain("'unsafe-eval'");
  });

  // frame-ancestors is ignored in a meta tag, so it is the only header directive the meta tag omits.
  test("matches the production header apart from frame-ancestors", () => {
    const headerDirectives = directives(headerPolicy).filter((part) => !part.startsWith("frame-ancestors"));
    expect(directives(metaPolicy).sort()).toEqual(headerDirectives.sort());
  });
});
