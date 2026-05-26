import { Capacitor } from "@capacitor/core";

export type NativePlatform = "ios" | "android";

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

export const getNativePlatform = (): NativePlatform | undefined => {
  const platform = Capacitor.getPlatform();
  return platform === "ios" || platform === "android" ? platform : undefined;
};
