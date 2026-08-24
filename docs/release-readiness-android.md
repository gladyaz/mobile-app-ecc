# Android release readiness — Google Play V1

Scope: shipping this app to the **Google Play Store** as a free, ad-supported
Android V1. That is a different bar from
[android-local-demo.md](./android-local-demo.md) (internal LAN demo APK) and
[android-offline-demo-apk.md](./android-offline-demo-apk.md) (offline showcase
APK), both of which remain accurate for their own purposes.

Describes branch **`feat/playstore-v1-release`**. Every claim below is either
verified from this repository or explicitly marked NOT VERIFIED. Nothing here
asserts that a third-party console (Google Cloud, AdMob, Play) is configured
correctly — this repository cannot see those, and a document that guessed would
be worse than one that says so. No URL, key, package name, ad unit id or
fingerprint has been invented anywhere in this branch.

Before any external build:

```bash
npm run release:preflight
```

It reads the same `.env` and resolved Expo config the build does, and exits
non-zero on anything that would make an externally-distributed artifact wrong.
It never writes, never contacts a network, and never invents a value.

**Product shape for V1:** Android only, free install, monetised by AdMob
interstitials. There is no payment, subscription or in-app purchase surface —
the entitlement architecture stays, and remains backend-owned.

---

## 1. What this branch changed

Grouped by the defect each change closes. Everything here is in this
repository; nothing depends on a console.

### 1.1 The production bundle could not be built, and when it could, it shipped demo media

`src/data/mock-drama-videos.ts` and `src/data/qa-fixture-videos.ts` make 21
top-level `require('../../assets/videos/…')` calls. Metro requires a static
literal there, so those files enter the graph **unconditionally**. Those
directories are gitignored (~62 MB), so a clean checkout failed with
`Unable to resolve module ../../assets/videos/pewaris-ep-1.mp4`, and a machine
that *had* the media shipped every demo clip plus the synthetic
"QA 16:9 FIXTURE" card inside the production artifact.

- `metro.config.js` resolves those requires to Metro's inert empty module when
  the directories are absent.
- `src/services/media/media-url.ts` returns `''` for a non-asset value instead
  of throwing inside `Asset.fromModule` at module evaluation.
- `app.config.js` **refuses** a build that sets `EXPO_PUBLIC_DEMO_MODE=true` or
  `EXPO_PUBLIC_USE_MOCK_DATA=true` while that media is missing, so "demo build
  that plays nothing" cannot be produced silently.
- `jest/bundled-demo-media-stub.js` plus one `moduleNameMapper` entry give Jest
  the same answer Metro gives, so tests and a release build agree.

### 1.2 Internal surfaces were reachable in a store artifact

- **`/processing`** rendered fabricated job ids, invented progress percentages
  and the backend's internal storage layout (`storage/raw-videos/…`) as fact.
  It was gated on `!isDemoMode()` — exactly backwards: the demo APK hid it, a
  *production* APK showed it. Now gated by `isInternalScreenEnabled()`
  (`src/services/debug/internal-screens.ts`), which is `__DEV__`, enforced both
  at the Profile entry point and in the route itself, so
  `mobileappecc://processing` cannot reach past it.
- **`/_sitemap`** — expo-router's generated route inventory plus a System
  Information panel — shipped in release and stayed reachable through the app's
  URL scheme. `app.config.js` now strips it from every build that is not the
  development server.

### 1.3 The release identity lived only in a regenerated, gitignored file

`android/` is produced by `expo prebuild` and gitignored, so anything expressed
only there is destroyed by the next prebuild. Moved into `app.json`:

| Key | Value | Why it has to be owned here |
|---|---|---|
| `android.versionCode` | `1` | Google Play orders uploads by this integer. Left unset, Expo emitted `versionCode 1` into a file nobody edits and nobody reviews. Owned in `app.json`, it is incremented deliberately, once per upload, in a diff. **Every subsequent upload must increase it.** |
| `android.allowBackup` | `false` | See 1.4. |
| `android.blockedPermissions` | 3 permissions | See 1.5. |

`version: "1.0.0"` remains the `versionName` (the string users see); the two are
independent and both matter.

### 1.4 Auth tokens were eligible for Google Drive backup

`src/services/storage/local-storage.ts` persists the auth envelope — access
**and** refresh token — to AsyncStorage as plaintext JSON, which lives in the
app's private storage. Android's `allowBackup` defaults to `true`, and
auto-backup copies private storage to the user's Google Drive and restores it
onto another device.

`android.allowBackup: false` in `app.json` is the documented SDK 57 key
(`@expo/config-plugins`' `AllowBackup` mod writes `android:allowBackup` into the
manifest from it), so no custom plugin was needed.

**Consequence, stated plainly:** an app reinstall or device migration no longer
restores the session. The user signs in again. That is the correct trade for
bearer tokens, and it is a behaviour change.

### 1.5 The manifest requested three permissions the app does not use

Confirmed in the merged `android/app/src/main/AndroidManifest.xml` and in the
107 MB APK built during the earlier audit:

| Permission | Where it came from | Why it is gone |
|---|---|---|
| `SYSTEM_ALERT_WINDOW` | Expo prebuild template | "Display over other apps". Nothing in this app uses it, and it is among the permissions Google Play scrutinises hardest on a new listing. |
| `READ_EXTERNAL_STORAGE` (`maxSdkVersion=32`) | `expo-file-system`, and `expo-image`'s bundled Glide manifest | This app reads no user files. Every image and video is a bundled asset or an `https` URL. |
| `WRITE_EXTERNAL_STORAGE` (`maxSdkVersion=32`) | `expo-file-system` | This app writes no user files. |

**`android.permissions` cannot do this.** It is additive only — see
`setAndroidPermissions` in `@expo/config-plugins`, which adds and never removes,
and the SDK 57 docs describe it as "a list of permissions to **add**".
`android.blockedPermissions` is the mechanism that writes `tools:node="remove"`
and actually deletes a permission from the merged manifest, including one a
library merged in. So `blockedPermissions` is what this branch uses.

**Deliberately kept:**

- `INTERNET` — every backend call.
- `ACCESS_NETWORK_STATE` and `WAKE_LOCK` — merged in by
  `react-native-google-mobile-ads` (verified in
  `node_modules/react-native-google-mobile-ads/android/src/main/AndroidManifest.xml`)
  and by expo-image's Glide manifest. Blocking these would break ad loading.
- The AdMob advertising-id set (`AD_ID`, `ACCESS_ADSERVICES_*`) — merged in by
  play-services-ads itself. It is what monetisation runs on.
- `VIBRATE` — template default, harmless, and not part of the brief.

**Known cost:** React Native's *debug* manifest
(`react-native/ReactAndroid/src/debug/AndroidManifest.xml`) also declares
`SYSTEM_ALERT_WINDOW`, for `DebugOverlayController` (the FPS/perf monitor
overlay). `tools:node="remove"` in the app's main manifest outranks a library
manifest in every variant, so **debug builds lose that overlay too**.
`DebugOverlayController` checks `Settings.canDrawOverlays` and degrades rather
than crashing, and the dev menu and LogBox are in-activity dialogs that are
unaffected — but this is a real, if small, developer-experience cost, taken
knowingly.

### 1.6 Release signing now survives a prebuild

The template ships `release { signingConfig signingConfigs.debug }`. Google Play
rejects a debug-signed upload outright, and `android/` is regenerated, so the
fix could not be an edit to `android/`.

**`plugins/with-android-release-signing.js`** patches the generated
`android/app/build.gradle` on every prebuild:

- When release keystore credentials **are** available, it wires a real
  `signingConfigs.release` and points the `release` build type at it.
- When they are **absent**, the template's debug signing is left exactly as it
  was and the build does **not** fail.
- A **partially** configured keystore stops the build, naming only the missing
  key *names*.
- Gradle prints which key it is about to use, on every build.

Credentials are read **by Gradle, at build time**, from
`<repo-root>/keystore.properties` (already gitignored) or from the environment:

| `keystore.properties` key | Environment variable |
|---|---|
| `storeFile` (relative paths resolve from the repository root) | `ANDROID_RELEASE_STORE_FILE` |
| `storePassword` | `ANDROID_RELEASE_STORE_PASSWORD` |
| `keyAlias` | `ANDROID_RELEASE_KEY_ALIAS` |
| `keyPassword` | `ANDROID_RELEASE_KEY_PASSWORD` |

The plugin itself runs in Node during prebuild and **never opens that file**. It
emits the Groovy that makes Gradle read it. No password is ever held in
JavaScript, written into a generated file, or printed.

**Why the fallback is deliberate and not laziness:** the internal LAN demo APK
and the offline demo APK are both `assembleRelease`, built on machines with no
release keystore, and the Google OAuth Android client that works today is
registered against the debug keystore's SHA-1. Hard-failing `assembleRelease`
without a keystore would destroy two working internal workflows to chase a key
that does not exist yet.

The unsafe state was never "debug-signed" — it was **"debug-signed and nobody
said so"**. Both halves are closed: Gradle announces the key, and
`npm run release:preflight` **blocks** when release signing is not configured.
`src/services/debug/__tests__/android-release-signing-plugin.test.ts` covers the
transform, the fallback, prebuild idempotence, and the throw on template drift.

### 1.7 Network correctness for a phone on mobile data

- `src/services/api/client.ts` pins the access token across the `401`
  refresh-and-retry, so a token rotated by a concurrent request cannot make the
  retry replay a stale credential.
- The same client has a 20 s `AbortController` timeout emitting
  `ApiError` code `TIMEOUT`, so a black-holed connection surfaces as a truthful
  error state with Retry instead of a spinner that never resolves.
- Both sync drains (`src/stores/video-interactions.tsx`,
  `src/stores/series-progress.tsx`) re-check the session epoch **after** their
  network await, so a logout that lands mid-flight cannot write one account's
  data under another's session.

### 1.8 The preflight got sharper

`scripts/check-release-android.js` now **blocks** on:

- release signing not configured, or only partly configured;
- `./plugins/with-android-release-signing` missing from `app.json`'s plugins
  (without it, prebuild silently restores debug signing);
- `keystore.properties` existing while `.gitignore` no longer ignores it;
- `android.allowBackup` not `false`;
- any of the three unused permissions missing from `android.blockedPermissions`;
- `android.versionCode` not being a positive integer (was a warning).

alongside what it already blocked: a missing / non-HTTPS / localhost / LAN API
base URL, the three release-unsafe flags, bundled demo media on disk, a
`com.anonymous.*` package, and the sample AdMob app id.

The signing check reads `keystore.properties` for **key names only** — it
captures the text to the left of the first `=` and nothing else, so no password
enters the process and none can appear in any message it prints.

---

## 2. Verified ready

| Area | Evidence |
|---|---|
| **Standalone artifact needs no Metro** | `expo.modules.updates.ENABLED=false` in the generated manifest; `assembleRelease` / `bundleRelease` embed the JS. No dev-server dependency. |
| **Production JS bundle builds** | `NODE_ENV=production npx expo export --platform android` exits 0 and emits a ~4.3 MB Hermes bundle, with **zero** `pewaris` / `nona-shen` / `qa-16x9` assets. |
| **One HTTP client, no local shortcuts** | Every backend call in `src/services/**` goes through `request()` in `src/services/api/client.ts`. There is no second fetch path and no per-feature base URL. |
| **No localhost / LAN / emulator address in app code** | Repo-wide search for `localhost`, `127.0.0.1`, `10.0.2.2`, RFC-1918 ranges, `exp://`, `:8081`: the only hits are a dev operator script (never bundled), one test fixture string, and prose. |
| **Missing API base URL fails truthfully** | `getBaseUrl()` returns `''`; `request()` throws `ApiError(0, 'MISSING_BASE_URL')`. It never falls back to a local address and never substitutes mock data. |
| **Mock mode cannot activate by accident** | `shouldUseMockData()` requires the exact string `'true'` or demo mode. Real API errors are never replaced with mock data — the feed shows an error state with Retry. |
| **QA fixtures are opt-in** | `shouldIncludeQaFixtures()` requires `'true'`, and `selectUserFacingCatalog()` additionally drops `contentKind: 'qa_fixture'` rows from the backend feed. |
| **Premium gate fails closed** | `stores/entitlement.tsx` reports `isPremium: false` while logged out, while hydrating, and for any user it has never had an answer for. `GET /videos/:id/playback` is the only real authority. A malformed `accessTier` degrades to `premium`, never `free`. |
| **Rewards never fabricates numbers** | `src/services/rewards/rewards-service.ts` sends intent only, has no dev-tools route, and throws rather than falling back to fixtures. |
| **Session survives restart; expiry handled** | Tokens persist to AsyncStorage and rehydrate on mount; one refresh-and-retry on `401 INVALID_ACCESS_TOKEN`; a failed refresh clears tokens and forces logout. Provider credentials (Google ID token, OTP) are consumed once and never persisted. |
| **Debug diagnostics are stripped from the release bundle** | Confirmed by `strings` on the exported Hermes bundle: `[PlaybackDecision]`, `[api-client]`, `[media-url]` and the dev "Reset Local Data" button are all absent. `__DEV__` dead-code elimination works as the code assumes. |
| **No cleartext exemption in a default build** | `plugins/with-lan-cleartext-demo.js` keys off the scheme of `EXPO_PUBLIC_API_BASE_URL`, so an `https://` backend makes it a no-op with nothing to remember to switch off. `usesCleartextTraffic="true"` exists only in the `debug` / `debugOptimized` manifests. |
| **No certificate pinning bypass, no trust-manager override** | None present anywhere in the repo. |
| **No secrets in committed source** | The only committed credential-shaped values are Google's *published sample* AdMob ids (see B3) and the Android template debug keystore password, which is public by definition. `.gitignore` covers `*.jks`, `*.keystore`, `*.p12`, `*.key`, `keystore.properties`, `upload-keystore.properties`, `google-services.json`, `play-service-account*.json`. |

---

## 3. External blockers

None of these can be resolved from this repository, and none was guessed at.

### B1 — A release keystore does not exist yet. **BLOCKER.**

The *mechanism* now exists (§1.6) and survives prebuild. The *key* does not.
Until one is generated, every `assembleRelease` / `bundleRelease` here is signed
with `android/app/debug.keystore`:

```
Owner: CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US
SHA1:  5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
```

That is the **shared Android debug certificate from the Expo template**,
identical on every developer machine. Play rejects it, and registering its SHA-1
as this app's OAuth certificate would let any debug-signed build of the same
package authenticate as this app.

Generate an upload key (do not commit it; do not paste its password anywhere but
the gitignored file):

```bash
keytool -genkeypair -v \
  -keystore upload-keystore.jks \
  -alias upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

Then create `keystore.properties` at the repository root — gitignored, never
committed — with the four keys from the table in §1.6, and re-run
`npm run release:preflight`. The signing blocker clears.

Register the fingerprint Google actually serves. Under **Play App Signing**
(mandatory for new apps) that is the *app signing key* shown in Play Console →
Setup → App integrity, **not** your upload key. Read your own with:

```bash
keytool -list -v -keystore <path-to-release-keystore> -alias <your-alias>
```

There is no `eas.json` in this repository, so EAS-managed credentials are not
wired up. Local Gradle is the only supported path today (§4).

### B2 — `android.package` is `com.anonymous.mobileappecc`. **OWNER DECISION.**

Unchanged in this branch, deliberately. It is permanent once published, and it
is the identity the existing Google OAuth Android client is registered against —
changing it invalidates that client and every fingerprint registered under it.
It is a product-owner decision, not an engineering one. The preflight blocks on
it so it cannot be reached by drift.

The iOS bundle identifier (`com.anonymous.mobile-app-ecc`) is not even
consistent with it. Settle both in the same decision.

### B3 — AdMob app id is Google's public sample. **BLOCKER.**

`app.json` carries `androidAppId: "ca-app-pub-3940256099942544~3347511713"`,
baked into the manifest as `com.google.android.gms.ads.APPLICATION_ID`. A real
AdMob app id must replace it. It is not a secret, but it is account-specific and
cannot be guessed.

Separately, `EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID` unset means
`interstitial-adapter.ts` serves `TestIds.INTERSTITIAL` — a *safe* default (it
can never serve a real ad by accident) but not a monetising one. Since AdMob
interstitials are V1's only revenue, this is the difference between shipping and
shipping a business.

### B4 — Google Sign-In: release OAuth client NOT VERIFIED. **BLOCKER for that feature.**

The client-side path is complete: `webClientId` from
`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, ID token exchanged once at
`POST /auth/google` and never persisted. What this repository cannot prove:

- that an **Android** OAuth client exists for the final package name **and the
  release signing certificate's SHA-1**. A release-signed APK presents a
  different certificate than a debug build and fails with a bare
  `DEVELOPER_ERROR` until its SHA-1 is registered. This depends on B1 and B2.
- that a **Web** OAuth client exists and that `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
  is its id — Google issues the ID token against the web client on both
  platforms.
- that the backend has `GOOGLE_AUTH_ENABLED=true` and lists that client id, or
  `POST /auth/google` answers `503 GOOGLE_AUTH_DISABLED`.

`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is inlined at **build** time. Setting it
later requires a new build.

### B5 — Production backend URL. **EXTERNAL CONFIG.**

`EXPO_PUBLIC_API_BASE_URL` must be a public **HTTPS** origin. The `.env` in this
checkout points at a LAN address (correct for the internal demo, wrong for the
store), and the preflight blocks on it. The backend's own `PUBLIC_BASE_URL` must
also be publicly reachable: a `playbackUrl` pointing at a private address fails
on an external device even when the API call succeeds.

### B6 — App display name is the scaffold slug. **OWNER DECISION.**

`name: "mobile-app-ecc"` is the label under the launcher icon. Unchanged in this
branch for the same reason as B2: it is a product decision. The preflight warns.

Icons, adaptive icon (all three layers), splash, `scheme: mobileappecc` and the
orientation setup are present and coherent. No placeholder assets.

### B7 — WhatsApp OTP delivery is a **backend** capability. NOT VERIFIED.

Mobile is clean and has no machine dependency. Whether a message is ever *sent*
is entirely `WHATSAPP_OTP_PROVIDER_DRIVER` on the backend; the local `fake`
provider sends nothing. A real provider must be configured and verified
server-side before WhatsApp login works for an external user.

### B8 — Backend reachable from the public internet. NOT VERIFIED.

Every feature except guest browsing depends on it. Not inspectable from here.

---

## 4. Building the Play artifact

Google Play has required an **Android App Bundle (`.aab`)** for new apps since
August 2021. The only artifact this repository has ever produced is a 107 MB
universal APK. The AAB is the upload; APKs remain the right thing for sideloaded
internal testing.

### 4.1 Environment

A non-interactive shell has neither of these. Export them in the same shell that
runs Gradle:

```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
```

### 4.2 The `.env` trap — read this before an incremental build

`EXPO_PUBLIC_*` values are inlined by Babel **at bundle time**, and **`.env` is
not a Gradle input**. Gradle cannot see that it changed, so an incremental
`assembleRelease` / `bundleRelease` happily reuses the previously bundled JS and
**ships the OLD inlined values** — a build that looks fresh and points at
yesterday's backend.

After any `.env` change, delete the build directory first:

```bash
rm -rf android/app/build
```

`npx expo prebuild --clean` does **not** cover this: it regenerates the Android
project sources, not Gradle's output cache.

### 4.3 App Bundle (the Play upload)

```bash
npm run release:preflight          # must exit 0

rm -rf android/app/build           # see §4.2
npx expo prebuild --clean --platform android --no-install
cd android && ./gradlew bundleRelease
# → android/app/build/outputs/bundle/release/app-release.aab
```

Watch the Gradle log for the line the signing plugin prints:

```
> release signing: project release keystore
```

If it says `DEBUG keystore` instead, stop — that artifact cannot be uploaded.

Confirm the signature before uploading (an AAB is a jar):

```bash
"$JAVA_HOME/bin/jarsigner" -verify -verbose -certs \
  android/app/build/outputs/bundle/release/app-release.aab | head -40
```

The certificate must **not** read `CN=Android Debug`.

Do **not** pass `-PreactNativeArchitectures` to a `bundleRelease`. An AAB is
meant to carry every ABI; Play generates the per-device split. That flag belongs
to the internal APK workflow only, where it exists to shrink a sideloaded file.

### 4.4 APK (internal sideloading only)

```bash
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a
# → android/app/build/outputs/apk/release/app-release.apk
```

Verify what actually shipped:

```bash
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
aapt2 dump badging android/app/build/outputs/apk/release/app-release.apk | grep -E 'package|permission'
```

**There is deliberately no npm script that runs Gradle.** A release build is an
act, not a convenience — it consumes credentials and produces something
uploadable.

### 4.5 JS bundle only, without the Android toolchain

```bash
NODE_ENV=production npx expo export --platform android
```

---

## 5. Device-QA-gated follow-ups

Not done in this branch, and each one needs a physical device to sign off. None
is a Play blocker.

### 5.1 R8 / `minifyEnabled` / `shrinkResources` — **do not enable without device QA**

Both are `false` today. Java/Kotlin ships unminified and unshrunk (Hermes still
compiles JS to bytecode, so the JS is unaffected either way). Enabling them is a
real size and obfuscation win, and it is also the single change most likely to
break this exact app **silently at runtime, in release only**:

- AdMob and play-services rely on reflection over classes R8 will strip or
  rename without the right `-keep` rules;
- Google Sign-In does the same;
- `react-native-reanimated` 4 / `react-native-worklets` resolve worklet code
  reflectively.

None of that fails at build time. It fails on a handset, in a release build,
after upload. No physical device is available to QA it, so it stays off. When a
device is available: enable, then re-run the entire §6 smoke test — not a subset.

### 5.2 Mock catalog strings remain in the release bundle

`pewaris`, `Kontrak Cinta CEO Dingin`, `job_001`, `storage/raw-videos/…` are
still in the bundle because those modules remain in the import graph, even
though the media is not bundled and the screens are gated. A few KB of
unreachable data; the storage paths are a minor information disclosure to anyone
who unpacks the bundle. Removing it means deleting the bundled-catalog and
processing modules outright.

### 5.3 No OTA channel

`expo-updates` is disabled. Every fix needs a new upload and a new
`versionCode`.

### 5.4 npm advisories

20 reported by `npm ci` (13 moderate, 7 high). Not triaged.

---

## 6. Final smoke test

Run on a **physical device that has never had this app**, on mobile data or a
different network from the build machine — that is what proves no LAN
dependency. Record pass/fail per line.

| # | Step | Expected |
|---|---|---|
| 1 | **Signature check before install** | `apksigner verify --print-certs` (APK) or `jarsigner -verify -certs` (AAB) does **not** report `CN=Android Debug` |
| 2 | **Permissions check** | `aapt2 dump badging` lists **no** `SYSTEM_ALERT_WINDOW`, **no** `READ_/WRITE_EXTERNAL_STORAGE`. `INTERNET`, `ACCESS_NETWORK_STATE`, `WAKE_LOCK`, `VIBRATE` and the AdMob `AD_ID` set are present |
| 3 | **Backup flag check** | `aapt2 dump xmltree --file AndroidManifest.xml <artifact>` shows `allowBackup=false` |
| 4 | **Cleartext check** | Same dump shows no `usesCleartextTraffic` and no `networkSecurityConfig` |
| 5 | **Fresh install** | Installs; launcher and adaptive icon render; label is the intended product name |
| 6 | **Cold start with the build machine off-network** | Splash → Home. No Metro, no "unable to connect to development server" |
| 7 | **Guest playback** | A free episode plays without signing in. No sign-in wall on free content |
| 8 | **Google login** | Account chooser appears and sign-in completes. `DEVELOPER_ERROR` means the release SHA-1 is not registered (B1/B4) |
| 9 | **WhatsApp login / OTP** | The code actually arrives on WhatsApp. If nothing arrives, the backend provider is not real (B7) |
| 10 | **Restart persistence** | Force-stop, reopen: still signed in, Saved and Progress intact |
| 11 | **Reinstall does NOT restore the session** | After `allowBackup=false`, a reinstall lands on the signed-out state. This is the intended trade (§1.4), not a defect |
| 12 | **Rewards** | Balance, streak and tasks load from the server. Daily check-in credits once; a second tap reports "already checked in" and does not move the balance |
| 13 | **Premium entitlement gate** | A premium episode shows the upsell for a non-entitled account and plays for an entitled one |
| 14 | **Redeem flow** | Redemption debits points and unlocks Premium; the gate in 13 opens without a relaunch |
| 15 | **Series episode selection** | Opening episode N from Series Detail lands on exactly episode N in the feed |
| 16 | **Progress persistence** | Watch partway, leave, return: resumes at the same position. Survives a restart |
| 17 | **Like / Save** | Both persist across a restart and are scoped to the signed-in account |
| 18 | **Network off → on** | Airplane mode: a truthful error state with Retry, never stale mock content, never a crash. Restoring network plus Retry recovers |
| 19 | **Dead network, not just absent** | A request into a black hole resolves as an error within ~20 s (`ApiError` `TIMEOUT`), not an endless spinner |
| 20 | **Logout → login** | Logout clears the session; the next Google sign-in shows the account chooser rather than silently reusing the last account |
| 21 | **HLS playback** | An HLS-backed episode plays and adapts quality |
| 22 | **MP4 playback** | A legacy/MP4-backed episode plays. This is *not* a fallback for a failed HLS stream — it is a separate storage shape |
| 23 | **Ads** | Interstitials appear at the counter-based cadence. If they read "Test Ad", B3 is unresolved |
| 24 | **No mock or internal surfaces** | Profile shows no "Processing History / INTERNAL" entry; the catalog has no "QA 16:9 FIXTURE" card and no `pewaris` / `nona-shen` clips |
| 25 | **Deep links to internal routes** | `adb shell am start -a android.intent.action.VIEW -d "mobileappecc://processing"` and `…"mobileappecc://_sitemap"` both fail to open an internal screen |
