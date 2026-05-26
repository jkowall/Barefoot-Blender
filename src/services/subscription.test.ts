import { describe, expect, test } from "vitest";
import { getSubscriptionStatus } from "./subscription";

describe("subscription service", () => {
  test("keeps the browser PWA ungated", async () => {
    await expect(getSubscriptionStatus()).resolves.toMatchObject({
      loading: false,
      active: true,
      source: "web"
    });
  });
});
