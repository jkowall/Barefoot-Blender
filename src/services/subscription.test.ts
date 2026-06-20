import { beforeEach, describe, expect, test, vi } from "vitest";

type TestNativePlatform = "ios" | "android" | undefined;

type TestEntitlement = {
  isActive: boolean;
  expirationDate?: string | null;
};

type TestPurchasesPackage = {
  packageType: string;
  product: {
    identifier: string;
  };
};

const mocks = vi.hoisted(() => ({
  nativeApp: false,
  nativePlatform: undefined as TestNativePlatform,
  purchases: {
    configure: vi.fn(),
    getCustomerInfo: vi.fn(),
    getOfferings: vi.fn(),
    purchasePackage: vi.fn(),
    restorePurchases: vi.fn()
  }
}));

vi.mock("../utils/platform", () => ({
  getNativePlatform: () => mocks.nativePlatform,
  isNativeApp: () => mocks.nativeApp
}));

vi.mock("@revenuecat/purchases-capacitor", () => ({
  PACKAGE_TYPE: {
    ANNUAL: "ANNUAL"
  },
  Purchases: mocks.purchases
}));

const customerInfo = (entitlement?: TestEntitlement) => ({
  entitlements: {
    active: entitlement ? { pro: entitlement } : {}
  },
  managementURL: null
});

const loadSubscriptionService = async () => import("./subscription");

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  mocks.nativeApp = false;
  mocks.nativePlatform = undefined;
});

describe("subscription service", () => {
  test("keeps the browser PWA ungated", async () => {
    const { getSubscriptionStatus } = await loadSubscriptionService();

    await expect(getSubscriptionStatus()).resolves.toMatchObject({
      loading: false,
      active: true,
      source: "web"
    });
    expect(mocks.purchases.configure).not.toHaveBeenCalled();
  });

  test("returns inactive native status when the matching RevenueCat key is missing", async () => {
    mocks.nativeApp = true;
    mocks.nativePlatform = "android";
    vi.stubEnv("VITE_REVENUECAT_ANDROID_API_KEY", "");

    const { getSubscriptionStatus } = await loadSubscriptionService();

    await expect(getSubscriptionStatus()).resolves.toMatchObject({
      loading: false,
      active: false,
      source: "android",
      error: "Missing RevenueCat API key for android. Set the matching Vite environment variable."
    });
    expect(mocks.purchases.configure).not.toHaveBeenCalled();
  });

  test("activates native app shell for debug subscription bypass builds", async () => {
    mocks.nativeApp = true;
    mocks.nativePlatform = "ios";
    vi.stubEnv("VITE_DEBUG_SUBSCRIPTION_BYPASS", "true");

    const { getSubscriptionStatus } = await loadSubscriptionService();

    await expect(getSubscriptionStatus()).resolves.toMatchObject({
      loading: false,
      active: true,
      source: "ios",
      expiresAt: "debug-build"
    });
    expect(mocks.purchases.configure).not.toHaveBeenCalled();
  });

  test("maps active RevenueCat entitlement to active native status", async () => {
    mocks.nativeApp = true;
    mocks.nativePlatform = "ios";
    vi.stubEnv("VITE_REVENUECAT_IOS_API_KEY", "appl_test_key");
    mocks.purchases.getCustomerInfo.mockResolvedValue({
      customerInfo: customerInfo({
        isActive: true,
        expirationDate: "2026-12-31T00:00:00Z"
      })
    });

    const { getSubscriptionStatus } = await loadSubscriptionService();

    await expect(getSubscriptionStatus()).resolves.toMatchObject({
      loading: false,
      active: true,
      source: "ios",
      expiresAt: "2026-12-31T00:00:00Z"
    });
    expect(mocks.purchases.configure).toHaveBeenCalledWith({
      apiKey: "appl_test_key",
      automaticDeviceIdentifierCollectionEnabled: false
    });
  });

  test("maps missing RevenueCat entitlement to inactive native status", async () => {
    mocks.nativeApp = true;
    mocks.nativePlatform = "android";
    vi.stubEnv("VITE_REVENUECAT_ANDROID_API_KEY", "goog_test_key");
    mocks.purchases.getCustomerInfo.mockResolvedValue({
      customerInfo: customerInfo()
    });

    const { getSubscriptionStatus } = await loadSubscriptionService();

    await expect(getSubscriptionStatus()).resolves.toMatchObject({
      loading: false,
      active: false,
      source: "android"
    });
  });

  test("purchases Android annual package by base-plan product identifier", async () => {
    mocks.nativeApp = true;
    mocks.nativePlatform = "android";
    vi.stubEnv("VITE_REVENUECAT_ANDROID_API_KEY", "goog_test_key");
    const annualPackage: TestPurchasesPackage = {
      packageType: "CUSTOM",
      product: {
        identifier: "barefoot_blender_pro:annual-499"
      }
    };
    mocks.purchases.getOfferings.mockResolvedValue({
      current: {
        availablePackages: [annualPackage]
      }
    });
    mocks.purchases.purchasePackage.mockResolvedValue({
      customerInfo: customerInfo({ isActive: true })
    });

    const { purchaseAnnual } = await loadSubscriptionService();

    await expect(purchaseAnnual()).resolves.toMatchObject({
      loading: false,
      active: true,
      source: "android"
    });
    expect(mocks.purchases.purchasePackage).toHaveBeenCalledWith({
      aPackage: annualPackage
    });
  });

  test("returns inactive native status when restore purchases fails", async () => {
    mocks.nativeApp = true;
    mocks.nativePlatform = "ios";
    vi.stubEnv("VITE_REVENUECAT_IOS_API_KEY", "appl_test_key");
    mocks.purchases.restorePurchases.mockRejectedValue(new Error("Restore failed"));

    const { restorePurchases } = await loadSubscriptionService();

    await expect(restorePurchases()).resolves.toMatchObject({
      loading: false,
      active: false,
      source: "ios",
      error: "Restore failed"
    });
  });

  test("returns inactive native status when annual purchase fails", async () => {
    mocks.nativeApp = true;
    mocks.nativePlatform = "ios";
    vi.stubEnv("VITE_REVENUECAT_IOS_API_KEY", "appl_test_key");
    const annualPackage: TestPurchasesPackage = {
      packageType: "ANNUAL",
      product: { identifier: "barefoot_blender_pro_annual" }
    };
    mocks.purchases.getOfferings.mockResolvedValue({
      current: { availablePackages: [annualPackage] }
    });
    mocks.purchases.purchasePackage.mockRejectedValue(new Error("Purchase failed"));

    const { purchaseAnnual } = await loadSubscriptionService();

    await expect(purchaseAnnual()).resolves.toMatchObject({
      loading: false,
      active: false,
      source: "ios",
      error: "Purchase failed"
    });
  });
});
