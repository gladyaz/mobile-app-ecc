# Android release readiness — external distribution

Scope: shipping a **standalone Android APK to devices outside the developer's
machine and network**. That is a different bar from
[android-local-demo.md](./android-local-demo.md), which documents the internal
LAN demo build and is still accurate for its own purpose.

Audited on branch `chore/release-readiness-audit`, based on
`origin/feat/final-internal-demo` @ `32c5f02`.

Every claim below is either verified from this repository or explicitly marked
NOT VERIFIED. Nothing here asserts that a third-party console (Google Cloud,
AdMob, Play) is configured correctly — this repository cannot see those, and a
document that guessed would be worse than one that says so.

Before any external build:

```bash
npm run release:preflight
```

It reads the same `.env` and resolved Expo config the build does, and exits
non-zero on anything that would make an externally-distributed APK wrong. It
never writes, never uploads, and never invents a value.

---

## READY

Verified from the repository, and where noted, from a real build.

| Area | Evidence |
|---|---|
| **Standalone APK needs no Metro** | `expo.modules.updates.ENABLED=false` in the generated manifest, and `assembleRelease` bundles JS into the APK. No dev-server dependency in a release artifact. |
| **Production JS bundle builds** | `NODE_ENV=production npx expo export --platform android` exits 0 and emits a 4.3 MB Hermes bundle. (It did **not** before the fix below.) |
| **One HTTP client, no local shortcuts** | Every backend call in `src/services/**` goes through `request()` in `src/services/api/client.ts` — auth, series catalog, playback authorization, progress, likes/saves, rewards, entitlement, ads config, analytics, account security, export, account deletion. Verified by enumerating all 37 call sites; there is no second fetch path and no per-feature base URL. |
| **No localhost / LAN / emulator address in app code** | Repo-wide search for `localhost`, `127.0.0.1`, `10.0.2.2`, RFC-1918 ranges, `exp://`, `:8081`: the only hits are a dev operator script (`scripts/dev-grant-reward-points.sh`, never bundled), one test fixture string, and prose in comments/docs. |
| **`http://localhost:8081/` in the bundle is React Native's own** | It is the `FALLBACK` constant in `node_modules/react-native/Libraries/Core/Devtools/getDevServer.js:15`. Release builds do not load from a dev server, so it is never used. Not app code, not a defect. |
| **Missing API base URL fails truthfully** | `getBaseUrl()` returns `''` and `request()` throws `ApiError(0, 'MISSING_BASE_URL')`. It never falls back to a local address, and it never silently substitutes mock data. |
| **Mock mode cannot activate by accident** | `shouldUseMockData()` requires `EXPO_PUBLIC_USE_MOCK_DATA === 'true'` or demo mode. Unset, empty, `"1"`, `"TRUE"` all mean false. Real API errors are never replaced with mock data — the feed shows an error state with Retry. |
| **QA fixtures are already opt-in** | `shouldIncludeQaFixtures()` requires the exact string `'true'`, and applies only inside the bundled catalog. `selectUserFacingCatalog()` additionally drops `contentKind: 'qa_fixture'` rows from the backend feed. |
| **HLS defaults to enabled** | `isHlsPlaybackEnabled()` returns true unless the value is exactly `'false'`. Correct default for release. Note it is a kill switch, not an MP4 fallback — see `src/services/videos/hls-playback-flag.ts`. |
| **Premium gate fails closed** | `stores/entitlement.tsx` reports `isPremium: false` while logged out, while hydrating, and for any user it has never had an answer for. `GET /videos/:id/playback` remains the only real authority. A malformed `accessTier` degrades to `premium`, never to `free`. |
| **Rewards never fabricates numbers** | `src/services/rewards/rewards-service.ts` sends intent only (no amounts, no dates, no balances), has no dev-tools route, and throws rather than falling back to fixtures. |
| **Session survives restart; expiry is handled** | Tokens persist to AsyncStorage (`STORAGE_KEYS.auth`, version 3) and rehydrate in `AuthProvider`'s mount effect. `client.ts` refreshes once on `401 INVALID_ACCESS_TOKEN` and retries once; a failed refresh clears tokens and forces a client-side logout through `token-store.ts`'s subscription. Provider credentials (Google ID token, OTP) are consumed once and never persisted. |
| **Debug diagnostics are stripped from the release bundle** | Confirmed by `strings` on the exported Hermes bundle: `[PlaybackDecision]`, `[PlaybackInvariantViolation]`, `[DramaFeedItem]`, `[api-client]`, `[media-url]`, and the dev "Reset Local Data" button are all absent. `__DEV__` dead-code elimination works as the code assumes. |
| **No cleartext exemption in a default build** | `npx expo prebuild` with no `EXPO_PUBLIC_API_BASE_URL` produced a manifest with **no** `android:networkSecurityConfig` and **no** `usesCleartextTraffic`. `plugins/with-lan-cleartext-demo.js` keys off the URL scheme, so an `https://` backend makes it a no-op automatically. `usesCleartextTraffic="true"` exists only in the `debug` and `debugOptimized` manifests. |
| **No certificate pinning bypass, no trust-manager override** | None present anywhere in the repo. |
| **No secrets in committed source** | No API keys, tokens, or passwords. The only committed credential-shaped values are Google's *published sample* AdMob ids (see blockers) and the Android template debug keystore password, which is public by definition. |

---

## CODE FIXED IN THIS BRANCH

### 1. The production Android bundle could not be built at all — **fixed**

`src/data/mock-drama-videos.ts` and `src/data/qa-fixture-videos.ts` make 21
top-level `require('../../assets/videos/…')` / `…/thumbnails/…` calls. Metro
requires a static literal there, so those files are collected into the graph
**unconditionally** — `getVideoFeed()` only chooses which array it *returns*.
The import chain is `_layout.tsx → video-catalog-provider → video-service →
mock-drama-videos`, which every build walks.

Those directories are gitignored (~62 MB of demo binaries), so:

```
Android Bundling failed
Error: Unable to resolve module ../../assets/videos/pewaris-ep-1.mp4
```

Two defects in one:

1. A release build from a clean checkout **failed outright**.
2. On a machine where the media *had* been regenerated, the build succeeded and
   silently shipped every demo clip **and the synthetic "QA 16:9 FIXTURE" test
   card** inside the production APK.

Fixed by keying off the one fact that already separates the two builds — is the
media on disk?

- `metro.config.js` (new) resolves those requires to Metro's inert empty module
  when the directories are absent. Release builds compile and carry no demo
  media.
- `src/services/media/media-url.ts` — `resolveBundledMediaUri` returns `''` for
  a non-asset value instead of throwing inside `Asset.fromModule` at module
  evaluation, which would have crashed the app at startup.
- `app.config.js` **refuses** a build that sets `EXPO_PUBLIC_DEMO_MODE=true` or
  `EXPO_PUBLIC_USE_MOCK_DATA=true` while the media is missing. Absent media is
  fine for a build that reads its catalog from the backend, and a hard,
  explained stop for one that does not — so "demo build that plays nothing"
  cannot be produced silently.

Verified: `expo export --platform android` now exits 0, and the export contains
**zero** `pewaris` / `nona-shen` / `qa-16x9` asset files.

### 2. An INTERNAL fixture screen was visible in production — **fixed**

`/processing` ("Processing History", badged INTERNAL in Profile) renders
`src/data/mock-processing-jobs.ts` verbatim: invented job ids, invented progress
percentages, and the backend's internal storage layout
(`storage/raw-videos/…`, `storage/subtitles/…`) presented as fact. It was gated
only by `!isDemoMode()` — exactly backwards for external distribution: the demo
APK hid it, a **production** APK showed it to every signed-in user.

Now gated by `isInternalScreenEnabled()`
(`src/services/debug/internal-screens.ts`), which is `__DEV__` — structurally
false in every shippable artifact. Enforced in two places: the Profile entry
point, and the route itself (a `Redirect`), so `mobileappecc://processing`
cannot reach past it.

**Consequence, stated plainly:** internal *release* builds — including the LAN
demo APK, which is `assembleRelease` — no longer show this screen either. That
is intended, but it is a behaviour change. If it is ever wanted in a release
artifact, give it a real backend or an explicit `EXPO_PUBLIC_*` opt-in; do not
widen the gate back to "everything except demo builds".

### 3. `npm test` was red on this branch — **fixed**

The same missing gitignored media broke Jest's resolver: **13 suites failed**,
8 of them unable to run at all. CI runs `npm test` on a fresh checkout, so CI
was red for the same reason.

`jest/bundled-demo-media-stub.js` plus one `moduleNameMapper` entry map those
specifiers to `{}` — byte-for-byte what Metro's empty module evaluates to, so a
test and a release build agree about what a bundled clip resolves to. The
mapping is unconditional so CI and a demo laptop run identical tests. No test
asserted a bundled asset URI.

### 4. A demo build now announces itself at build time

`app.config.js` prints a warning when `EXPO_PUBLIC_DEMO_MODE=true`, naming what
that build does (any credentials accepted, bundled catalog, ads off). The
demo/production difference was otherwise invisible until the APK was installed
and opened.

### 5. New: `npm run release:preflight`

`scripts/check-release-android.js` — read-only, no network, no writes. Blocks on
a missing / non-HTTPS / localhost / LAN API base URL, on any of the three
release-unsafe flags, on bundled demo media being present, on a
`com.anonymous.*` package, and on the sample AdMob app id. Warns on an unset
Google web client id, an unset AdMob unit id, a missing `versionCode`, a
disabled HLS kill switch, and the placeholder app name.

The production-only rules live here rather than in `app.config.js` because that
file is also evaluated for `expo start`, for the internal demo build, and for
CI's `npx expo config --type public` (which runs with no `.env` at all). A rule
that failed those would simply be switched off.

### Changed files

```
new:      metro.config.js
new:      jest/bundled-demo-media-stub.js
new:      scripts/check-release-android.js
new:      src/services/debug/internal-screens.ts
new:      src/services/debug/__tests__/internal-screens.test.ts
new:      src/services/media/__tests__/media-url.test.ts
new:      docs/release-readiness-android.md
modified: app.config.js
modified: package.json
modified: src/app/(tabs)/profile.tsx
modified: src/app/processing.tsx
modified: src/data/mock-drama-videos.ts
modified: src/services/media/media-url.ts
```

---

## EXTERNAL BLOCKERS / MANUAL CONFIG

None of these can be resolved from this repository. None was guessed at.

### B1 — Release signing does not exist. **BLOCKER.**

`android/app/build.gradle` (generated by prebuild, gitignored):

```gradle
release {
    // Caution! In production, you need to generate your own keystore file.
    signingConfig signingConfigs.debug
}
```

Every `assembleRelease` APK is signed with `android/app/debug.keystore`, whose
certificate is:

```
Owner: CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US
SHA1:  5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

That is the **shared Android debug certificate shipped in the Expo template** —
not a project key. It is the same on every developer's machine. Consequences:

- Google Play rejects debug-signed artifacts.
- Registering that SHA-1 as this app's Google OAuth Android client would let
  *any* debug-signed build of the same package name authenticate as this app.

Also: `android/` is gitignored and regenerated by `expo prebuild`, so **this
repository currently has no way to express a release signing config at all**,
and there is no `eas.json`. Pick one before an external build:

- **EAS Build** — add `eas.json`, run `eas credentials` to generate or upload a
  release keystore, build with `eas build -p android --profile production`.
  Credentials live in EAS, not in the repo.
- **Local** — generate a keystore, keep it *out* of git (`.gitignore` already
  covers `*.jks`, `*.p12`, `*.key`), put its passwords in an untracked
  `android/gradle.properties` or the environment, and add a
  `signingConfigs.release` via an Expo config plugin so prebuild does not
  discard it.

Read the fingerprints you will need to register (run against **your** release
keystore, never the debug one):

```bash
keytool -list -v -keystore <path-to-release-keystore> -alias <your-alias>
```

Or, if the key is managed by EAS:

```bash
eas credentials -p android
```

Under Play App Signing, the fingerprint Google actually serves is the **app
signing key** shown in Play Console → Setup → App integrity, not your upload
key. Register that one.

### B2 — Android package is the Expo placeholder. **BLOCKER.**

`com.anonymous.mobileappecc` (and iOS is `com.anonymous.mobile-app-ecc`, which
is not even consistent with it). `com.anonymous.*` is the scaffold default. It
is permanent once published, and it is the identity the Google OAuth Android
client and the AdMob app are registered against — so it has to be decided
**before** B1 and B3, not after.

### B3 — Google Sign-In: release OAuth client NOT VERIFIED. **BLOCKER for that feature.**

The client-side path is complete and correct:
`@react-native-google-signin/google-signin` via
`src/services/auth/google-sign-in.ts`, `webClientId` from
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, ID token exchanged once at
`POST /auth/google` and never persisted (`provider-auth-service.ts`). The
Android module autolinks; the config plugin is iOS-only and is correctly skipped
when `EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME` is unset.

What this repository **cannot** prove, and what a working dev build does **not**
prove:

- that an **Android** OAuth client exists in Google Cloud for the final package
  name **and the release signing certificate's SHA-1**. Native Google Sign-In on
  Android matches package + signing cert. A dev build works because the debug
  cert is registered (or because Google is not configured at all and the button
  correctly reports "not configured"). A release-signed APK presents a different
  certificate and will fail with a bare `DEVELOPER_ERROR` until its SHA-1 is
  registered.
- that a **Web** OAuth client exists and that its client id is the one in
  `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`. Google issues the ID token against the web
  client on both platforms, and the backend verifies that audience.
- that the backend has `GOOGLE_AUTH_ENABLED=true` and lists that same client id
  in `GOOGLE_OAUTH_CLIENT_IDS`. Otherwise `POST /auth/google` answers
  `503 GOOGLE_AUTH_DISABLED`.

No SHA fingerprint has been invented here, and no Google Cloud configuration was
inspected or modified.

`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is inlined at **build** time. Setting it
later requires a new build.

### B4 — AdMob app id is Google's public sample. **BLOCKER.**

`app.json` carries `androidAppId: "ca-app-pub-3940256099942544~3347511713"` and
the iOS equivalent — Google's published sample ids. Confirmed baked into the
generated manifest as `com.google.android.gms.ads.APPLICATION_ID`. A real AdMob
app id must replace it before external distribution. It is not a secret, but it
is account-specific and cannot be guessed.

Separately, `EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID` unset means
`interstitial-adapter.ts` serves `TestIds.INTERSTITIAL` — test ads, no revenue.
That is a *safe* default (it can never serve a real ad by accident) but it is
not a shippable monetisation state.

### B5 — Production backend URL. **EXTERNAL CONFIG.**

`EXPO_PUBLIC_API_BASE_URL` must be a public **HTTPS** origin. Today no `.env`
exists in this checkout, so a build made right now produces an APK where every
call throws `MISSING_BASE_URL`. `.env.example` still documents LAN defaults —
correct for the internal demo, wrong for external distribution.

If the backend were pointed at `http://`,
`plugins/with-lan-cleartext-demo.js` would write a `network_security_config`
permitting cleartext to that one host. That is by design for the LAN demo and is
**not acceptable** for an external build. `npm run release:preflight` blocks it.

The backend's own `PUBLIC_BASE_URL` must also be publicly reachable: a
`playbackUrl` pointing at a private address fails on an external device even
when the API call itself succeeds.

### B6 — App name and versioning. **MANUAL CONFIG.**

- `app.json` `name: "mobile-app-ecc"` is the launcher label. It is the repo
  slug, not a product name.
- `android.versionCode` is unset → Expo emits `versionCode 1`. Fine for a first
  artifact; every later build distributed to the same devices must increase it
  or Android refuses the upgrade.
- Icons, adaptive icon (all three layers), splash, `scheme: mobileappecc`, and
  the orientation setup (`orientation: "default"` in config, locked to portrait
  at runtime in `_layout.tsx` so fullscreen video can rotate) are all present
  and coherent. No placeholder assets.

### B7 — WhatsApp OTP delivery is a **backend** capability. NOT VERIFIED.

Mobile is clean and has no machine dependency: `startWhatsAppOtp` →
`verifyWhatsAppOtp` → `adoptSession` → AsyncStorage, all through the shared
client; the number is the challenge handle; anti-enumeration is preserved
(single generic `INVALID_OTP`, no "account exists" signal); resend timing comes
from the server and is shape-validated.

But whether a real message is ever **sent** is entirely
`WHATSAPP_OTP_PROVIDER_DRIVER` on the backend. `docs/android-local-demo.md` §6
documents the local `fake` provider, which sends nothing and exposes the code
only via a `devCode` field gated behind `DEV_TOOLS_ENABLED` — unreadable on a
handset. **A real provider must be configured and verified server-side before
WhatsApp login works for an external user.** This repository cannot confirm it.

### B8 — Backend must be reachable from the public internet. NOT VERIFIED.

Every feature except guest browsing of a cached catalog depends on it. Not
inspectable from here.

---

## Advisory (not blockers)

- **`android:allowBackup="true"`** (Expo default) means Android auto-backup can
  copy AsyncStorage — which holds the access **and refresh** tokens — to the
  user's Google Drive, and restore it onto another device. Consider
  `android.allowBackup: false` in `app.json`, or excluding the auth key.
  Deliberately not changed here: it affects restore UX and is the owner's call.
- **`SYSTEM_ALERT_WINDOW`** ("Display over other apps") is in the *main*
  manifest, so it ships in release. Nothing in this app needs it. Remove with
  `"android": { "blockedPermissions": ["android.permission.SYSTEM_ALERT_WINDOW"] }`
  after checking it does not disturb the dev overlay.
- **`READ_/WRITE_EXTERNAL_STORAGE`** (`maxSdkVersion="32"`) come from
  `expo-file-system`. Harmless on modern Android but they show in the Play
  listing.
- **`minifyEnabled` and `shrinkResources` are false** for release. Java/Kotlin
  is unminified and unshrunk. Hermes still compiles JS to bytecode. Enabling
  ProGuard is a size and obfuscation win but needs its own testing pass.
- **Mock catalog *strings* remain in the release bundle** (`pewaris`,
  `Kontrak Cinta CEO Dingin`, `job_001`, `storage/raw-videos/…`) because those
  modules are still in the import graph even though the media is not and the
  screens are gated. A few KB of unreachable data; the storage paths are a minor
  information disclosure to anyone who unpacks the bundle. Removing it entirely
  means deleting the bundled-catalog and processing modules from this branch — a
  bigger change than this audit should make.
- **`expo-updates` is disabled**, so there is no OTA channel. Every fix needs a
  new APK.
- **20 npm advisories** (13 moderate, 7 high) reported by `npm ci`. Not triaged
  here.

---

## Build

There is no `eas.json`, so the only path this repository supports today is a
local Gradle build:

```bash
npm ci
npm run release:preflight          # must pass
npx expo prebuild --platform android --clean
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

`android/` is gitignored and regenerated, so **anything you edit inside it is
destroyed by the next prebuild** — release signing has to be expressed as an
Expo config plugin, or moved to EAS (B1).

To verify the JS bundle alone, without the Android toolchain:

```bash
NODE_ENV=production npx expo export --platform android
```

**Until B1 is resolved, any APK this repository produces is debug-signed and is
not a production artifact**, regardless of the `release` build type in its name.

### An APK was actually built during this audit

`./gradlew assembleRelease` → `BUILD SUCCESSFUL in 19m 40s`, 698 tasks.

| | |
|---|---|
| Artifact | `android/app/build/outputs/apk/release/app-release.apk` (gitignored) |
| Size | 107 MB — a universal APK carrying all four ABIs (`armeabi-v7a`, `arm64-v8a`, `x86`, `x86_64`) with `minifyEnabled=false` |
| Build type | Gradle `release`; JS bundled in, `expo-updates` disabled — no Metro needed |
| **Signing** | **DEBUG.** `apksigner verify --print-certs` reports `CN=Android Debug, OU=Android, O=Unknown`, SHA-1 `5e8f1606…f625` — the shared template key, not a project key |
| Installed on a device? | **No.** Nothing was installed, uploaded, or published |

What the artifact itself proves (`aapt2 dump`, `unzip -l`, `apksigner`):

- `package='com.anonymous.mobileappecc' versionCode='1' versionName='1.0.0'` —
  placeholder package confirmed at the artifact level (B2).
- **No `usesCleartextTraffic` and no `networkSecurityConfig`** in the shipped
  manifest. Cleartext is off in the release APK.
- `com.google.android.gms.ads.APPLICATION_ID` =
  `ca-app-pub-3940256099942544~3347511713` — the sample id ships (B4).
- **Zero** `pewaris` / `nona-shen` / `qa-16x9` entries in the APK: no demo media.
- Permissions shipped: `INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`,
  `VIBRATE`, `READ_/WRITE_EXTERNAL_STORAGE` (`maxSdkVersion=32`),
  `SYSTEM_ALERT_WINDOW`, and the AdMob set (`AD_ID`, `ACCESS_ADSERVICES_AD_ID`,
  `ACCESS_ADSERVICES_ATTRIBUTION`, `ACCESS_ADSERVICES_TOPICS`).

This artifact is suitable for **internal** functional testing only. It is
**not production-ready**: it is debug-signed, carries a placeholder package and
the sample AdMob id, and was built with no `EXPO_PUBLIC_API_BASE_URL`, so it has
no backend to reach.

---

## Final APK smoke test

Run on a **physical device that has never had this app**, on mobile data or a
different network from the build machine — that is what proves no LAN
dependency. Record pass/fail per line.

| # | Step | Expected |
|---|---|---|
| 1 | **Fresh install** of the APK on a clean device | Installs; launcher icon and adaptive icon render correctly; label is the intended product name |
| 2 | **Cold start** with the build machine powered off / off-network | Splash → Home. No Metro, no "unable to connect to development server" |
| 3 | **Guest playback** without signing in | A free episode plays. No sign-in wall on free content |
| 4 | **Google login** | Account chooser appears; sign-in completes and Profile shows the account. A `DEVELOPER_ERROR` here means the release SHA-1 is not registered (B3) |
| 5 | **WhatsApp login / OTP** | Code actually arrives on WhatsApp; verifying signs in. If nothing arrives, the backend provider is not real (B7) |
| 6 | **Restart persistence** | Force-stop, reopen: still signed in, no re-login, Saved and Progress intact |
| 7 | **Rewards** | Balance, streak and tasks load from the server. Daily check-in credits once; a second tap reports "already checked in" and does not move the balance |
| 8 | **Premium entitlement gate** | A premium episode shows the upsell for a non-entitled account, and plays for an entitled one |
| 9 | **Redeem flow** | Redemption debits points and unlocks Premium; the gate in step 8 opens without a relaunch |
| 10 | **Series episode selection** | Opening episode N from Series Detail lands on exactly episode N in the feed |
| 11 | **Progress persistence** | Watch partway, leave, return: resumes at the same position. Survives a restart |
| 12 | **Like / Save** | Both persist across a restart and are scoped to the signed-in account (sign out, sign in as another account: not carried over) |
| 13 | **Network off → on** | Airplane mode: a truthful error state with Retry, never stale mock content and never a crash. Restoring network plus Retry recovers |
| 14 | **Logout → login** | Logout clears the session; the next Google sign-in shows the account chooser again rather than silently reusing the last account |
| 15 | **HLS playback** | An HLS-backed episode plays and adapts quality |
| 16 | **MP4 playback** | A legacy/MP4-backed episode plays. (This is *not* a fallback for a failed HLS stream — an HLS-ready video has no client-side MP4 to fall back to; it is a separate storage shape) |
| 17 | **Ads** | Interstitials appear at the counter-based cadence. If they read "Test Ad", B4 is unresolved |
| 18 | **No mock or internal surfaces** | Profile shows **no** "Processing History / INTERNAL" entry; the catalog contains no "QA 16:9 FIXTURE" card and no `pewaris` / `nona-shen` demo clips |
| 19 | **Deep link** | `adb shell am start -a android.intent.action.VIEW -d "mobileappecc://processing"` does **not** open the internal screen |
| 20 | **Cleartext is off** | `aapt2 dump xmltree --file AndroidManifest.xml <apk>` shows no `usesCleartextTraffic` and no `networkSecurityConfig` |
