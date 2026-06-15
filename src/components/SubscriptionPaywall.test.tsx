import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import SubscriptionPaywall from "./SubscriptionPaywall";

describe("SubscriptionPaywall", () => {
  test("renders required subscription legal links in the purchase flow", () => {
    const markup = renderToStaticMarkup(
      <SubscriptionPaywall
        status={{ active: false, loading: false, source: "ios" }}
        onManage={vi.fn()}
        onPurchase={vi.fn()}
        onRestore={vi.fn()}
      />
    );

    expect(markup).toContain("Barefoot Blender Pro");
    expect(markup).toContain("$4.99/year");
    expect(markup).toContain("annual auto-renewing subscription");
    expect(markup).toContain('href="https://trimix-blender.com/privacy/"');
    expect(markup).toContain("Privacy Policy");
    expect(markup).toContain('href="https://trimix-blender.com/terms/"');
    expect(markup).toContain("Terms of Use (EULA)");
  });
});
