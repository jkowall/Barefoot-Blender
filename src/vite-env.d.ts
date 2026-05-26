/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_REVENUECAT_IOS_API_KEY?: string;
  readonly VITE_REVENUECAT_ANDROID_API_KEY?: string;
  readonly VITE_DEBUG_SUBSCRIPTION_BYPASS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
