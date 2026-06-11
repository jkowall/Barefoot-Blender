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

## Cloudflare Release Parity

Treat every Cloudflare production release as a web plus native release candidate. Before pushing `main` for the automatic Cloudflare deployment, or before using Wrangler as a manual fallback, build the native projects locally:

```bash
npm run check
npm run build:mobile:debug
npm run build:mobile
npx cap doctor
(cd android && ./gradlew bundleRelease)
xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone 17' -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

Run `npm run debug:ios` and `npm run debug:android` for local simulator/emulator smoke tests when the required devices are available. The debug/test build validates the local native shell and subscription-bypass path only. Always run `npm run build:mobile` again after any debug build and before Android bundle, Xcode archive, TestFlight, Google Play, or production work so release artifacts contain production subscription behavior. TestFlight and Google Play internal or closed testing must use release-capable native builds, never builds produced with `VITE_DEBUG_SUBSCRIPTION_BYPASS=true`.

Build iOS and Android artifacts locally by default instead of in GitHub Actions. Local builds keep signing identities, provisioning profiles, Android keystore files, RevenueCat environment keys, Xcode, Android Studio, and store-console handoffs under direct control. GitHub Actions can still validate the web build and Cloudflare readiness, but signed native artifacts should move to CI only after an explicit signing, secrets, and manual-approval design exists.

## Release Checkout And Secrets

Use `/Users/jkowall/Barefoot-Blender` as the preferred local release checkout. Temporary Codex worktrees are fine for code edits and validation, but native release artifacts are easier to trust from the canonical checkout because ignored signing files, `.env.local`, Xcode state, Android Studio state, and local store tooling live there.

Before a native release build, confirm these local-only files exist where the build is running:

```bash
test -f .env.local
test -f android/keystore.properties
test -f android/upload-keystore.jks
git check-ignore android/keystore.properties android/upload-keystore.jks
```

If building from a temporary worktree, either switch to `/Users/jkowall/Barefoot-Blender` for the native release or copy the ignored signing files into the worktree's `android/` directory. Never commit or print signing passwords, `.p8` files, service-account JSON, or RevenueCat keys. Keep sensitive local material under ignored paths such as `.env.local`, `private/`, and `android/keystore.properties`.

## Mobile Release Checklist

1. Confirm `package.json`, native app versions, and store target builds match the release plan.
2. Run web and unit validation:

```bash
npm install
npm run check
```

3. Validate the local debug/test shell. These builds must not be uploaded:

```bash
npm run build:mobile:debug
npm run debug:ios
npm run debug:android
```

4. Rebuild production native assets after any debug build:

```bash
npm run build:mobile
npx cap doctor
```

5. Build and verify Android:

```bash
(cd android && ./gradlew bundleRelease)
(cd android && ./gradlew signingReport)
jarsigner -verify -verbose -certs android/app/build/outputs/bundle/release/app-release.aab
```

6. Build and verify iOS simulator compatibility:

```bash
xcodebuild -project ios/App/App.xcodeproj -scheme App -destination 'platform=iOS Simulator,name=iPhone 17' -configuration Debug CODE_SIGNING_ALLOWED=NO build
```

7. Archive iOS in Xcode for TestFlight/App Store Connect. The simulator build proves local compatibility, but it is not an uploadable App Store archive.
8. Upload Android `android/app/build/outputs/bundle/release/app-release.aab` to Google Play internal testing first.
9. Upload iOS through Xcode Organizer to TestFlight first.
10. Validate subscription purchase and restore behavior through TestFlight and Google Play internal testing before promoting release tracks.

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
4. Confirm the marketing version and build number match the release plan and the App Store Connect version being submitted.
5. Use automatic signing unless the account requires manual profiles.
6. Archive in Xcode and upload through Organizer to App Store Connect.
7. Attach the uploaded build to TestFlight internal testing and to the App Store version. App Store Connect build state, TestFlight state, and app-review submission state are separate.
8. Add screenshots, privacy details, support URL, privacy URL, subscription terms, and review notes.
9. Submit to TestFlight first, then submit the same build for App Review after sign-off.

Review notes should state that the app is a calculator for trained divers and fill station operators, no login is required, and the subscription is validated through RevenueCat/StoreKit.

## Android Signing And Upload

1. Open `android/` in Android Studio.
2. Confirm namespace and application ID `com.trimixblender.barefootblender`.
3. Confirm version name and version code match the release plan and the Google Play track being updated.
4. Ensure ignored signing files exist before building: `android/keystore.properties` and `android/upload-keystore.jks`.
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
