# Mobile Release Guide

Barefoot Blender ships as a Vite PWA and as native iOS and Android apps through Capacitor.

## Accounts And Products

- Apple Developer Program: personal account for Jonah Kowall.
- Google Play Console: personal account for Jonah Kowall.
- App ID and Android package: `com.trimixblender.barefootblender`.
- RevenueCat entitlement: `pro`.
- Apple product: `barefoot_blender_pro_annual`, auto-renewable annual subscription, no trial.
- Google product: subscription `barefoot_blender_pro`, annual base plan `annual-499`, no trial.
- Price target: `$4.99/year` or local store equivalent.

## RevenueCat Setup

1. Create a RevenueCat project with iOS and Android apps.
2. Connect App Store Connect and Google Play service credentials in RevenueCat.
3. Create entitlement `pro`.
4. Create an offering with an annual package mapped to:
   - Apple: `barefoot_blender_pro_annual`
   - Google: `barefoot_blender_pro` with base plan `annual-499`
5. Add the public SDK keys to local build environment:

```bash
VITE_REVENUECAT_IOS_API_KEY=appl_...
VITE_REVENUECAT_ANDROID_API_KEY=goog_...
```

The keys are public SDK keys. Keep them centralized in environment config so test and production projects can be swapped without code changes.

## Local Build

```bash
npm install
npm run check
npm run build:mobile
```

For simulator or local device debugging before RevenueCat products are configured:

```bash
npm run debug:ios
npm run debug:android
```

These commands run `npm run build:mobile:debug` and unlock the native app shell without contacting RevenueCat. The Android command starts the first available emulator, waits for boot completion, installs the app, and launches it through Capacitor. Set `ANDROID_AVD=<device-name>` to choose a specific emulator. These commands are only for local debugging. Do not upload this build to TestFlight, Google Play, or production.

Open native projects when needed:

```bash
npm run mobile:ios
npm run mobile:android
```

## iOS Signing And Upload

1. Open `ios/App/App.xcodeproj` in Xcode.
2. Select Jonah's Apple developer team.
3. Confirm bundle identifier `com.trimixblender.barefootblender`.
4. Confirm version `0.8.0` and build `1`.
5. Use automatic signing unless the account requires manual profiles.
6. Archive in Xcode and upload through Organizer to App Store Connect.
7. Add screenshots, privacy details, support URL, privacy URL, subscription terms, and review notes.
8. Submit to TestFlight first, then submit the same build for App Review after sign-off.

Review notes should state that the app is a calculator for trained divers and fill station operators, no login is required, and the subscription is validated through RevenueCat/StoreKit.

## Android Signing And Upload

1. Open `android/` in Android Studio.
2. Confirm namespace and application ID `com.trimixblender.barefootblender`.
3. Confirm version name `0.8.0` and version code `3`.
4. Create a secure local upload keystore for Play App Signing. The Gradle release build reads local signing credentials from ignored `android/keystore.properties`.
5. Back up `android/upload-keystore.jks` and `android/keystore.properties` somewhere secure. Losing the upload key blocks future updates until Google resets the upload key.
6. Build a release Android App Bundle:

```bash
cd android
./gradlew bundleRelease
```

7. Verify the release variant is signed:

```bash
cd android
./gradlew signingReport
jarsigner -verify -verbose -certs app/build/outputs/bundle/release/app-release.aab
```

8. Upload `android/app/build/outputs/bundle/release/app-release.aab` to Google Play internal testing first.
9. Move to closed testing after internal subscription validation.
10. If the Play account is newly created and personal, run the required closed testing window before production access.

## Store Listing Checklist

- App name: Barefoot Blender.
- Short description: Trimix and Nitrox gas blending toolkit for trained scuba divers and fill station operators.
- Category: Sports or Utilities, choose the closest fit during store setup.
- Support URL: `https://trimix-blender.com/support/`.
- Privacy URL: `https://trimix-blender.com/privacy/`.
- Terms URL: `https://trimix-blender.com/terms/`.
- Safety copy: users must analyze final gas with calibrated oxygen and helium analyzers.
- Privacy disclosures: local settings/history, purchase/subscription data through Apple/Google/RevenueCat, no ads, no health data collection.

## Validation

- Web:
  - `npm run check`
  - Browser PWA install smoke test.
  - Browser offline smoke test after first load.
- Native:
  - `npm run build:mobile`
  - `npx cap doctor`
  - iOS simulator smoke test.
  - Android emulator smoke test with `npm run debug:android`.
  - Subscription purchase in Apple sandbox/TestFlight.
  - Subscription purchase in Google internal testing.
  - Restore purchases after reinstall.
  - Active entitlement survives restart and permits cached offline use after prior verification.
  - Expired or canceled entitlement returns to the paywall.

## Rollback And Support

- Web rollback: revert or redeploy the prior Cloudflare build from `main`.
- iOS rollback: submit a fixed build or remove the app from sale in App Store Connect if needed.
- Android rollback: halt staged rollout or promote a previous stable release if available.
- Subscription support: direct users to Apple or Google for cancellation and refunds. Use RevenueCat customer history only to diagnose entitlement state.
