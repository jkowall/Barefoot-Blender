import {
  PACKAGE_TYPE,
  Purchases,
  type CustomerInfo,
  type PurchasesPackage
} from "@revenuecat/purchases-capacitor";
import { getNativePlatform, isNativeApp, type NativePlatform } from "../utils/platform";

const ENTITLEMENT_ID = "pro";
const ANNUAL_PRODUCT_IDS = new Set(["barefoot_blender_pro_annual", "barefoot_blender_pro"]);

const apiKeys: Record<NativePlatform, string | undefined> = {
  ios: import.meta.env.VITE_REVENUECAT_IOS_API_KEY,
  android: import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY
};
const debugSubscriptionBypass = import.meta.env.VITE_DEBUG_SUBSCRIPTION_BYPASS === "true";

export type SubscriptionSource = "web" | "ios" | "android" | "unknown";

export type SubscriptionStatus = {
  loading: boolean;
  active: boolean;
  source: SubscriptionSource;
  expiresAt?: string;
  error?: string;
};

let configuredPlatform: NativePlatform | undefined;
let lastManagementUrl: string | undefined;

const webStatus = (): SubscriptionStatus => ({
  loading: false,
  active: true,
  source: "web"
});

const debugStatus = (source: SubscriptionSource): SubscriptionStatus => ({
  loading: false,
  active: true,
  source,
  expiresAt: "debug-build"
});

const inactiveStatus = (source: SubscriptionSource, error?: string): SubscriptionStatus => ({
  loading: false,
  active: false,
  source,
  error
});

const messageFromError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    return String(error.message);
  }
  return "Subscription service is unavailable.";
};

const statusFromCustomerInfo = (customerInfo: CustomerInfo, source: SubscriptionSource): SubscriptionStatus => {
  const entitlement = customerInfo.entitlements.active[ENTITLEMENT_ID];
  lastManagementUrl = customerInfo.managementURL ?? undefined;

  return {
    loading: false,
    active: entitlement?.isActive === true,
    source,
    expiresAt: entitlement?.expirationDate ?? undefined
  };
};

const configurePurchases = async (): Promise<NativePlatform | undefined> => {
  if (!isNativeApp()) {
    return undefined;
  }

  const platform = getNativePlatform();
  if (!platform) {
    throw new Error("Barefoot Blender subscriptions are only configured for iOS and Android.");
  }

  if (configuredPlatform === platform) {
    return platform;
  }

  const apiKey = apiKeys[platform];
  if (!apiKey) {
    throw new Error(`Missing RevenueCat API key for ${platform}. Set the matching Vite environment variable.`);
  }

  await Purchases.configure({
    apiKey,
    automaticDeviceIdentifierCollectionEnabled: false
  });
  configuredPlatform = platform;
  return platform;
};

const getAnnualPackage = async (): Promise<PurchasesPackage> => {
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  const annualPackage =
    current?.annual ??
    current?.availablePackages.find((item) => item.packageType === PACKAGE_TYPE.ANNUAL) ??
    current?.availablePackages.find((item) => ANNUAL_PRODUCT_IDS.has(item.product.identifier));

  if (!annualPackage) {
    throw new Error("RevenueCat annual subscription package is not configured.");
  }

  return annualPackage;
};

export const getSubscriptionStatus = async (): Promise<SubscriptionStatus> => {
  if (!isNativeApp()) {
    return webStatus();
  }

  const platform = getNativePlatform() ?? "unknown";
  if (debugSubscriptionBypass) {
    return debugStatus(platform);
  }

  try {
    const configured = await configurePurchases();
    const { customerInfo } = await Purchases.getCustomerInfo();
    return statusFromCustomerInfo(customerInfo, configured ?? platform);
  } catch (error) {
    return inactiveStatus(platform, messageFromError(error));
  }
};

export const purchaseAnnual = async (): Promise<SubscriptionStatus> => {
  const platform = getNativePlatform() ?? "unknown";
  if (debugSubscriptionBypass) {
    return debugStatus(platform);
  }

  try {
    const configured = await configurePurchases();
    const aPackage = await getAnnualPackage();
    const { customerInfo } = await Purchases.purchasePackage({ aPackage });
    return statusFromCustomerInfo(customerInfo, configured ?? platform);
  } catch (error) {
    return inactiveStatus(platform, messageFromError(error));
  }
};

export const restorePurchases = async (): Promise<SubscriptionStatus> => {
  const platform = getNativePlatform() ?? "unknown";
  if (debugSubscriptionBypass) {
    return debugStatus(platform);
  }

  try {
    const configured = await configurePurchases();
    const { customerInfo } = await Purchases.restorePurchases();
    return statusFromCustomerInfo(customerInfo, configured ?? platform);
  } catch (error) {
    return inactiveStatus(platform, messageFromError(error));
  }
};

export const openManageSubscription = async (): Promise<void> => {
  const platform = getNativePlatform();
  const fallbackUrl =
    platform === "android"
      ? "https://play.google.com/store/account/subscriptions"
      : "https://apps.apple.com/account/subscriptions";

  window.open(lastManagementUrl ?? fallbackUrl, "_blank", "noopener,noreferrer");
};
