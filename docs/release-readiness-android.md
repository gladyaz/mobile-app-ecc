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

> **Historical.** At the time of this entry `stores/auth.tsx` persisted the
> access **and** refresh token to AsyncStorage as plaintext JSON. That is no
> longer true — see **§1.11**, which moved the pair into Android
> Keystore-backed storage. This entry is kept because the backup decision it
> records still stands on its own: the AsyncStorage database still holds
> account metadata, watch history and preferences worth not shipping to
> another device.

`src/services/storage/local-storage.ts` persisted the auth envelope — access
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

**This closed cloud backup only — see §1.10.** `allowBackup="false"` does not
disable device-to-device transfer on Android 12+, which is a separate
destination with its own configuration.

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
- `android.versionCode` not being a positive integer (was a warning);
- `EXPO_PUBLIC_PRIVACY_POLICY_URL` unset or not absolute HTTPS — Play requires a
  privacy policy for an app that collects account data and serves ads, and the
  Profile row that carries it is not rendered without one;
- `EXPO_PUBLIC_ACCOUNT_DELETION_URL` unset or not absolute HTTPS — the *binary*
  depends on it, not just the Data safety form: an account with no password
  cannot use the in-app deletion path, so this is the only route the app can
  offer it (was a warning);
- `EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID` unset — a store build would
  otherwise serve Google's TEST interstitial, a watermarked sample ad presented
  as the app's own monetization (was a warning);
- ~~`EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED=true`~~ — **withdrawn 2026-08-26.**
  WhatsApp Login is a confirmed V1 feature and is now offered by default, so
  `=true` is not a blocker: until the parallel WhatsApp backend ships, a
  deployed server answers `503 WHATSAPP_AUTH_DISABLED` and the app shows its
  specific "not active on this server yet" message. An honest unavailable
  state, not a fake success. The owed credential is reported as a WARNING on
  every build. See `docs/v1-product-scope.md`;
- `EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED=true` — **added 2026-08-26.** V1 is
  free content + ads; this flag restores the premium/paywall UI against a
  backend running `CONTENT_ACCESS_MODE=free`, so every lock it brings back is
  one no viewer could clear or pay to clear. See `docs/v1-product-scope.md`.

alongside what it already blocked: a missing / non-HTTPS / localhost / LAN API
base URL, the three release-unsafe flags, bundled demo media on disk, a
`com.anonymous.*` package (now `com.spark.redpanda`, see B2), and the sample
AdMob app id.

### 1.9 The preflight now encodes the V1 feature contract

**Added 2026-08-27.** Everything above answers "is this artifact safe to
distribute". This section answers the other half — "is it the product V1 was
scoped to" — because a build can be perfectly safe and still be missing a
confirmed feature, and nothing in a diff shows that.

V1 REQUIRES Google Login, WhatsApp Login, Rewards, Ads and HLS. The preflight
now **blocks** on:

- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` unset (**was a warning**) — Google Login is
  a required V1 method, the value is inlined at build time, and a release built
  without it does not render the button at all
  (`services/auth/provider-availability.ts`), so the method disappears
  *silently* rather than failing loudly;
- `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` set to a placeholder (`YOUR_...`,
  `1234567890-...`, `<...>`) or to something that is not shaped
  `<digits>-<token>.apps.googleusercontent.com` — an ANDROID client id or a
  client *secret* pasted here cannot mint the ID token the backend verifies,
  and the failure only appears on a device;
- `EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED=false` — withdraws a required V1 login
  method entirely;
- `EXPO_PUBLIC_HLS_PLAYBACK_ENABLED=false` (**was a warning**) — a kill switch,
  not a fallback: every HLS-backed episode resolves to "Video unavailable" with
  no MP4 behind it, i.e. a video app that cannot play its videos;
- the Rewards tab route missing, or `services/rewards/rewards-service.ts` no
  longer reading `rewards/snapshot` from the backend;
- `EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID` **set to a Google sample
  unit** — the previous rule only caught the unset case, so a build that set
  the variable to `ca-app-pub-3940256099942544/...` passed and would have shown
  watermarked test ads to real users. Setting a variable is not the same as
  configuring it;
- a payment / billing / in-app-purchase dependency (Midtrans, Stripe, Xendit,
  RevenueCat, Play Billing, Google Pay, …) — V1 has no way to spend money, and
  the way that changes is a dependency;
- the rewards or WhatsApp service importing a mock / fixture / fake module — a
  fabricated path compiled into a required service is one no flag switches off;
- the WhatsApp client no longer calling `auth/whatsapp/otp/request` **and**
  `auth/whatsapp/otp/verify` — the client must never report a session the
  server did not grant;
- the Android package drifting from `com.spark.redpanda` — permanent once
  uploaded, and the identity the Google OAuth client, the AdMob app and the
  Play listing are all registered against;
- `expo.version` missing or not a dotted version string.

**How these are proved.** `evaluateReleaseContract` in
`scripts/check-release-android.js` is a pure function: every fact it judges is
passed in. `scripts/__tests__/release-contract.test.js` hands it a fully
configured release that passes with zero blockers, then perturbs exactly one
fact per case and asserts the specific blocker fires. That is what makes the
debug-signing rule testable at all — shelling out to the preflight would read
whatever `.env` and `keystore.properties` happen to be on the machine running
the suite.

The signing check reads `keystore.properties` for **key names only** — it
captures the text to the left of the first `=` and nothing else, so no password
enters the process and none can appear in any message it prints.

### 1.10 `allowBackup=false` did not cover device-to-device transfer

**Added 2026-08-27.** §1.4 withdrew the app from Google Drive auto-backup and
called the token-exposure problem solved. It was solved for *cloud backup* and
not for the other half.

**The gap.** Android's own documentation, on `allowBackup`: for an app
targeting Android 12 (API 31) or higher, "On devices from some device
manufacturers, specifying `android:allowBackup="false"` disables cloud-based
backup and restore (such as Google Drive backups) but **doesn't disable
device-to-device transfers for the app**." This app targets API 36. So on the
single most ordinary migration path an Android user takes — set up the new
phone from the old phone — the AsyncStorage database, and therefore the access
and refresh token pair `stores/auth.tsx` persists into it, was still eligible
to be copied onto the new handset.

The platform sources agree: `FullBackup.IGNORE_FULL_BACKUP_CONTENT_IN_D2D` is
`@EnabledSince(targetSdkVersion = S)`, so for a modern target the legacy
`fullBackupContent` rules are *ignored* during a transfer. The Android 12+
`android:dataExtractionRules` resource, and specifically its `<device-transfer>`
section, is the only thing that speaks for that destination — and the previous
static audit confirmed the attribute was absent, because Expo never emits one
(nothing in the installed `@expo/config-plugins` or `@expo/prebuild-config`
mentions `dataExtractionRules`).

**The fix.** `plugins/with-android-data-extraction-rules.js` writes
`android/app/src/main/res/xml/data_extraction_rules.xml` and sets
`android:dataExtractionRules="@xml/data_extraction_rules"` on `<application>`.
It is a config plugin for the same reason release signing is one: `android/` is
gitignored and regenerated, so a resource typed in by hand is destroyed by the
next prebuild and the artifact after that silently loses the policy.

**The policy is deny-all, in both sections, with no `<include>` anywhere.**

| Decision | Reason |
|---|---|
| Both `<cloud-backup>` and `<device-transfer>` | An **absent** section is not a denial. `FullBackup.parseSchemeForBackupDestination` only treats the new scheme as authoritative when it finds the matching section, and otherwise falls through to "no rules at all", i.e. copy everything. A file covering only transfer would be a trap for whoever eventually flips `allowBackup`. |
| One `<exclude>` per domain, all nine | Exclusion is matched by **exact path**, not prefix (`BackupAgent.manifestExcludesContainFilePath` uses `equals`), and `onFullBackup` runs a separate traversal per domain starting at that domain's own directory. So `<exclude domain="root"/>` alone does **not** exclude `databases/` — which is exactly where AsyncStorage (`RKStorage`) lives, and `sharedpref` is where SecureStore's encrypted file lives. Excluding the data directory is not the same as excluding what is inside it. |
| `path="."` | Android documents `path` as required and uses `.` for "the domain root" in its own example. `.` canonicalises away, so the rule resolves to the same string the traversal starts from, which is what makes the exact-match prune fire. |
| No `<include>` at all | An include for any one domain makes Android skip **every other domain's** rules entirely. Adding one to whitelist a harmless preference would silently change what the other eight domains do. |
| Deny-all rather than excluding just the auth key | AsyncStorage is one database file; no path names a single key inside it. The narrowest rule that can exclude anything in it already excludes the whole store. What remains (a language choice, an ad-frequency counter) is not worth an allow rule that would need re-auditing on every new persisted key. |
| `main` source set only | It applies to every variant, so debug and release deny identically. The plugin also **deletes** a generated copy from `debug` / `debugOptimized` / `release`, since a variant override would shadow `main` for that variant alone. |
| No `fullBackupContent` resource | That is the pre-Android-12 mechanism, and it is only consulted when backup is *enabled*. On API < 31 devices (this app's `minSdk` is 24), `allowBackup="false"` already disables backup and restore outright, and D2D-as-a-separate-destination is an Android 12 concept. A `fullBackupContent` file would be inert. |
| No `disableIfNoEncryptionCapabilities` | It would assert an encryption capability this app does not implement. **Nothing here encrypts anything** — this is an *extraction* policy: it removes an OS-driven copy path off the device. It makes no claim about data at rest, and none should be made on its behalf. |

**No data is lost by this.** Likes, saved videos and watch progress all sync to
the backend and are re-merged at first login (`stores/video-interactions.tsx`,
`stores/series-progress.tsx`), so a transferred device re-fetches them after
sign-in. The language preference and ad-gate counters reset, which is the same
behaviour a fresh install already has. **Development is unaffected** — nothing
in `expo start`, `expo run:android` or either internal demo APK depends on
backup or transfer.

**Verified without a device.** `expo config --type introspect` and a real
`expo prebuild --platform android` both produce `<application …
android:allowBackup="false" … android:dataExtractionRules="@xml/data_extraction_rules">`
with the resource on disk; a second in-place prebuild leaves both files
byte-identical (same MD5), and no variant copy is created. The `debug` and
`debugOptimized` manifests override only `usesCleartextTraffic`, never the
backup policy.

**Known residual.** Android 36 sources also contain a `cross-platform-transfer`
section, gated behind the unreleased `Flags.enableCrossPlatformTransfer()`
aconfig flag and absent from the public documentation. No shipping Android
release performs that transfer, and its schema is not stable, so no rule is
written for it. Revisit when the API is documented.

**Gated by the preflight.** `npm run release:preflight` now blocks if the plugin
leaves `app.json`, if it is registered but cannot be loaded, if either section
or any domain stops being denied, or if an `<include>` appears. It reads the
plugin's pure `renderDataExtractionRules()` rather than the gitignored
`android/` output, so the check reflects the canonical source rather than
whatever the last prebuild on the machine happened to be pointed at.

**What §1.4 and §1.10 together do NOT do.** They stop the OS copying this app's
data *off* the device. They do nothing about the copy that stays on it: at the
close of §1.10 the token pair was still plaintext JSON at rest, readable by
anyone with a shell on a rooted or debuggable device. That is a different
problem with a different mechanism, and it is **§1.11**.

---

### 1.11 The token pair was plaintext at rest on the handset

**Added 2026-08-27.** §1.4 and §1.10 closed both OS-driven paths by which this
app's storage could *leave* the device. Neither made the token pair unreadable
in the copy that remains on it, and neither claimed to — §1.10's own table says
"**Nothing here encrypts anything** … It makes no claim about data at rest".
This entry is that claim being made good.

**Two protections, deliberately separate.** Keep these apart when reading or
extending this document:

| | Mechanism | What it stops | Where it is documented |
|---|---|---|---|
| **Backup / transfer protection** | `android:allowBackup="false"` + deny-all `android:dataExtractionRules` | The OS copying app-private storage to Google Drive, or onto a new handset during device-to-device setup | §1.4, §1.10 |
| **Token at-rest protection** | `expo-secure-store` — Android Keystore + AES-256-GCM | The token pair being *readable* in the storage that stays on the device | This section |

Neither substitutes for the other. Backup protection still matters with tokens
encrypted (the account metadata, watch history, and the ciphertext itself are
all still worth not transferring), and encryption still matters with backup
denied (a rooted or debuggable handset never involved the OS backup path at
all).

**The gap.** `stores/auth.tsx` wrote `{ user, tokens }` through
`services/storage/local-storage.ts` into AsyncStorage under
`@mobile-app-ecc/auth`. On Android, AsyncStorage is a SQLite database
(`RKStorage`) under `databases/` in the app's private data directory. Private
is an *access-control* property enforced by the Linux UID sandbox — it is not
encryption. `adb shell run-as com.spark.redpanda` on a debuggable build, or any
root shell, reads the file directly, and the access and refresh token were
sitting in it in the clear.

**The fix.** `src/services/auth/session-secret-store.ts` is now the one module
that may import `expo-secure-store`, and the pair is stored there.

Verified against the **installed** implementation
(`node_modules/expo-secure-store@57.0.2/android/src/main/java/expo/modules/securestore/`),
not against marketing copy:

| Property | Evidence in the installed source |
|---|---|
| Key lives in the Android Keystore | `SecureStoreModule.kt`: `KEYSTORE_PROVIDER = "AndroidKeyStore"`, opened via `KeyStore.getInstance(KEYSTORE_PROVIDER)` |
| AES-256-GCM | `encryptors/AESEncryptor.kt`: `AES_CIPHER = "AES/GCM/NoPadding"`, `AES_KEY_SIZE_BITS = 256`, `KeyGenParameterSpec.Builder(...).setBlockModes(BLOCK_MODE_GCM).setEncryptionPaddings(ENCRYPTION_PADDING_NONE)` |
| Fresh IV per item, authenticated | A new IV per `encryptItem`; the GCM tag length is stored beside the value and rejected below 96 bits on read |
| Ciphertext location | `getSharedPreferences("SecureStore", Context.MODE_PRIVATE)` |
| Not gated on biometrics | `setUserAuthenticationRequired(options.requireAuthentication)` — this app leaves `requireAuthentication` unset (see below) |

**What this does and does not buy.** The bytes on disk are still inside the
app's private data directory; what changed is that they are ciphertext under a
key the process cannot extract. On hardware with a TEE or StrongBox the key
material never enters userspace. It is **not** protection against a debugger
attached to a debuggable build, and **not** protection against a rooted device
where an attacker can simply ask the Keystore to decrypt on the app's behalf —
Keystore binds the key to the *device* and to this app's signing identity, not
to a human. **AsyncStorage is not encrypted by any of this**, and must never be
described as such; what changed is that no token is put there.

`requireAuthentication` is deliberately **not** set. It would put a biometric
prompt in front of every cold start and every background token refresh, and
such keys are invalidated when enrolled biometrics change — which would
permanently sign people out for adding a fingerprint. That is a product
decision V1 has not taken.

**The persisted shape, exactly.**

| Store | Key | Contents |
|---|---|---|
| AsyncStorage | `@mobile-app-ecc/auth` | `{ "version": 4, "data": { "id", "name", "username", "email" } }` — four non-secret account fields. `id` is a non-empty string; the other three are `string \| null`. **No token, and no field derived from one.** |
| SecureStore | `mobile-app-ecc.session-tokens.v1` | `{ "accessToken", "refreshToken" }`, JSON, stored as AES-256-GCM ciphertext |

The AsyncStorage **key name is unchanged**; the envelope `version` went 3 → 4.
Renaming the key would have stranded every installed build's stored account
behind a key nothing reads. Everything else AsyncStorage holds — language,
likes, saved videos, watch progress, ad counters — is untouched and stays
exactly where it was.

Why one SecureStore value rather than two keys: the pair must move together. A
crash between two writes would leave a fresh access token beside a spent
refresh token — a session that works until the first 401 and then cannot be
refreshed.

**The upgrade path.** An already-installed handset holds a version-3 payload
with the plaintext pair. `services/auth/session-store.ts`'s `restoreSession()`
migrates it on the next launch, in this order, and only this order:

1. Read secure storage. If it already holds a pair, that wins.
2. Otherwise read the version-3 payload and validate both halves.
3. Write the pair to secure storage — **and read it back** to confirm it is
   retrievable and unchanged.
4. Only then write the version-4 envelope, which overwrites the version-3 one
   and is therefore what removes the plaintext copy.

The legacy token is never deleted before the secure write has demonstrably
succeeded, so a failure at any point leaves the handset in its original state
and the next launch retries from there. The read-back exists because a write
that merely *resolves* is not proof the value can be read again.

Every state a handset can be in is enumerated in `restoreSession()`'s doc
comment and covered by `src/services/auth/__tests__/session-store.test.ts`:
already-migrated, partially-migrated (secure write landed, rewrite did not),
malformed legacy payload, orphaned credential with no metadata, failed secure
write, failed secure read, and a platform with no secure storage at all.

**Failure semantics: truthful sign-out, never a fake session.** An
authenticated state is produced only when a secure credential was actually read
or actually written — account metadata alone never authenticates. A failed
secure *read* signs the viewer out and touches nothing (not knowing whether a
credential exists is not a licence to delete or overwrite one). A failed secure
*write* at sign-in throws, so the screen reports a failed sign-in rather than
showing a signed-in app whose credential was never stored. A failed *delete* at
sign-out still completes the sign-out, and the orphaned credential is cleared
on the next launch.

**Web is memory-only, by design.** `expo-secure-store`'s web implementation is
literally `export default {}` (`build/ExpoSecureStore.web.js`), so
`isAvailableAsync()` is `false` there. Sign-in on `npm run web` still works and
the session lives for that run, but nothing is persisted — the alternative
would be writing the pair to `localStorage` in the clear, which is the exact
exposure this work removes. A pre-existing version-3 payload on such a platform
is left **untouched** rather than deleted, because deleting the only copy
without a successful secure write is the one thing the migration must never do.
V1 ships an Android artifact; web is a development preview.

**Backup-policy interaction — checked, and closed.** `expo-secure-store` ships a
config plugin that, with its default `configureAndroidBackup: true`, sets
`android:fullBackupContent` **and** `android:dataExtractionRules` to resources
of its own. Its `secure_store_data_extraction_rules.xml` is
`<include domain="sharedpref" path="."/>` plus one `<exclude>` for its own
file — an *include*-based rule covering a single domain, where this app denies
all nine in both sections. Only one `android:dataExtractionRules` can survive
the merge, so `app.json` registers the plugin as
`["expo-secure-store", { "configureAndroidBackup": false }]`, leaving
`plugins/with-android-data-extraction-rules.js` as the single backup authority.
The deny-all policy already covers SecureStore's own file through its
`sharedpref` and `device_sharedpref` excludes, so nothing is lost by switching
the plugin's rules off — the app's policy is a strict superset.

Note also that SecureStore data does not survive an uninstall regardless: the
Keystore key is destroyed with the app, so a restored copy of the ciphertext
would be undecryptable even if one existed.

**Gated by the preflight.** `npm run release:preflight` now blocks a release
that:

- does not depend on `expo-secure-store`;
- does not register it with `configureAndroidBackup: false`;
- has lost `src/services/auth/session-secret-store.ts`, or that file no longer
  imports `expo-secure-store`;
- imports `expo-secure-store` from any **other** module under `src/` (the whole
  tree is walked, so a *new* importer is caught, which is the point);
- lets `src/stores/auth.tsx` import AsyncStorage or
  `@/services/storage/local-storage` directly — the store holds the live pair,
  so denying it reach to the plaintext store is what makes "the tokens are not
  in AsyncStorage" a property of the code rather than of somebody having
  checked;
- lets `src/services/auth/persisted-account.ts` — the only writer of the
  AsyncStorage auth key — so much as name `accessToken` or `refreshToken`.

Every rule is structural: an import specifier, a plugin registration, or an
identifier in **comment-stripped** code. None reads prose. That is the trap
`MOCK_MODULE_PATTERN` documents in the preflight itself: a rule that scanned doc
comments would fire on the sentences explaining the very property being checked,
and a guard that fails on a correct file teaches people to delete the guard.
`scripts/__tests__/release-contract.test.js` proves each rule fires when its
fact is perturbed, proves the comment-stripping case explicitly, and asserts the
checked-in source satisfies all of them.

---

## 2. Verified ready

| Area | Evidence |
|---|---|
| **Standalone artifact needs no Metro** | `expo.modules.updates.ENABLED=false` in the generated manifest; `assembleRelease` / `bundleRelease` embed the JS. No dev-server dependency. |
| **Production JS bundle builds** | `NODE_ENV=production npx expo export --platform android` exits 0 and emits a ~4.3 MB Hermes bundle. On a machine that has *not* built the demo, `metro.config.js` stubs the bundled-media requires and the export carries none of them; on a machine that HAS (this one), the same export carries ~61 MB of demo assets — which is exactly why "bundled demo media is present on disk" is a preflight BLOCKER rather than a note. Verified on this machine: export exits 0, and the shipped bundle contains neither the dev-era "local media server" copy nor the removed "Segera Hadir" purchase CTA. |
| **One HTTP client, no local shortcuts** | Every backend call in `src/services/**` goes through `request()` in `src/services/api/client.ts`. There is no second fetch path and no per-feature base URL. |
| **No localhost / LAN / emulator address in app code** | Repo-wide search for `localhost`, `127.0.0.1`, `10.0.2.2`, RFC-1918 ranges, `exp://`, `:8081`: the only hits are a dev operator script (never bundled), one test fixture string, and prose. |
| **Missing API base URL fails truthfully** | `getBaseUrl()` returns `''`; `request()` throws `ApiError(0, 'MISSING_BASE_URL')`. It never falls back to a local address and never substitutes mock data. |
| **Mock mode cannot activate by accident** | `shouldUseMockData()` requires the exact string `'true'` or demo mode. Real API errors are never replaced with mock data — the feed shows an error state with Retry. |
| **QA fixtures are opt-in** | `shouldIncludeQaFixtures()` requires `'true'`, and `selectUserFacingCatalog()` additionally drops `contentKind: 'qa_fixture'` rows from the backend feed. |
| **No paywall in a V1 build** | The premium/paywall UI is switched off by one policy module (`services/config/v1-scope.ts`, default OFF, and `EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED=true` is a preflight blocker). The entitlement architecture underneath is preserved, not deleted, and each gated surface has a test pinning both states. See `docs/v1-product-scope.md`. |
| **Premium gate fails closed** (preserved, off in V1) | `stores/entitlement.tsx` reports `isPremium: false` while logged out, while hydrating, and for any user it has never had an answer for. `GET /videos/:id/playback` is the only real authority. A malformed `accessTier` degrades to `premium`, never `free`. |
| **Rewards never fabricates numbers** | `src/services/rewards/rewards-service.ts` sends intent only, has no dev-tools route, and throws rather than falling back to fixtures. |
| **Session survives restart; expiry handled; concurrent 401s are safe** | The token pair persists to Android Keystore-backed secure storage (AES-256-GCM) and the non-secret account fields to AsyncStorage; a launch rebuilds the session from both, and produces a signed-in state only when a secure credential was actually read (§1.11). A `401 INVALID_ACCESS_TOKEN` refreshes once and retries once. The refresh is **single-flight**, so the three providers `_layout.tsx` mounts together cannot each spend the same (rotating) refresh token and force-log-out a valid session at launch. The retry is gated on an identity *generation*, not on the token string, so a sibling request's rotation is retried under the new token while a genuine account change is refused — a request issued by user A can never be committed to user B. Provider credentials (Google ID token, OTP) are consumed once and never persisted. |
| **Debug diagnostics are stripped from the release bundle** | Confirmed by `strings` on the exported Hermes bundle: `[PlaybackDecision]`, `[api-client]`, `[media-url]` and the dev "Reset Local Data" button are all absent. `__DEV__` dead-code elimination works as the code assumes. |
| **Native identity matches the app config** | `expo prebuild --platform android --clean` regenerated `android/`, then `:app:processReleaseManifest` produced a real merged **release** manifest carrying `package="com.spark.redpanda"` and `android:label` -> `Red Panda`. `applicationId`, `namespace` and the Java package directory (`com/spark/redpanda`) all agree, and `grep -rl com.anonymous android/` returns 0 files. |
| **Unused permissions really are stripped** | Verified in the MERGED release manifest, not just the source one: `SYSTEM_ALERT_WINDOW`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE` are all absent. What ships is `INTERNET`, `ACCESS_NETWORK_STATE`, `VIBRATE`, `WAKE_LOCK`, `FOREGROUND_SERVICE`, `AD_ID` and the three `ACCESS_ADSERVICES_*` - every one of them from React Native or the AdMob SDK. |
| **Release manifest flags** | Merged release manifest: `android:allowBackup="false"`, **no** `android:debuggable`, **no** app-wide `android:usesCleartextTraffic`. |
| **App data cannot leave the device by backup or transfer** | `android:allowBackup="false"` **and** `android:dataExtractionRules="@xml/data_extraction_rules"` on `<application>`, verified in a real `expo prebuild` manifest. The resource denies all nine backup domains in **both** `<cloud-backup>` and `<device-transfer>`, with no `<include>` rule — so the AsyncStorage database (account metadata, watch history, preferences) *and* SecureStore's encrypted SharedPreferences file are both excluded from Google Drive backup and from device-to-device transfer, which `allowBackup=false` alone does not cover on Android 12+. This is backup/transfer protection; at-rest protection for the token pair is separate — see §1.11. Written to `main` only, so debug and release share one policy; generation is idempotent (byte-identical across a second in-place prebuild). See §1.10. |
| **No demo media in a production build, structurally** | `metro/bundled-demo-media.js` keys the exclusion on the build's declared intent rather than on disk state. Measured on a machine that HAS the media: production export 6.8 MB / 43 assets / **zero** `.mp4`; showcase export 65 MB / 11 `.mp4`. |
| **No payment remnant in the shipped bundle** | `strings` over the release Hermes bundle: `midtrans`, `Segera Hadir`, `billing`, `Play Billing`, `in-app purchase`, `pricing` and `Rp ` are all absent. The only `checkout`/`subscription` hits are the Material Symbols icon name `add_shopping_cart_checkout` and React Native's own `Must pass in a valid subscription`. |
| **No cleartext exemption in a default build** | `plugins/with-lan-cleartext-demo.js` keys off the scheme of `EXPO_PUBLIC_API_BASE_URL`, so an `https://` backend makes it grant nothing, with nothing to remember to switch off. It also **actively removes** a resource and manifest attribute left by an earlier LAN prebuild — `expo prebuild` without `--clean` regenerates `android/` in place, so returning early would let the tree that built the internal demo ship a production APK still carrying a LAN cleartext exemption. Removal is narrow: only a file bearing the plugin's own generated marker, and only an attribute pointing at its own resource. `usesCleartextTraffic="true"` exists only in the `debug` / `debugOptimized` manifests. See [`playback-quality.md` §4](./playback-quality.md). |
| **No certificate pinning bypass, no trust-manager override** | None present anywhere in the repo. |
| **No secrets in committed source** | The only committed credential-shaped values are Google's *published sample* AdMob ids (see B3) and the Android template debug keystore password, which is public by definition. `.gitignore` covers `*.jks`, `*.keystore`, `*.p12`, `*.key`, `keystore.properties`, `upload-keystore.properties`, `google-services.json`, `play-service-account*.json`. |

---

## 3. External blockers

None of these can be resolved from this repository, and none was guessed at.

### B0 — Privacy policy and account-deletion web pages. **BLOCKER.**

Google Play requires a privacy policy URL in the store listing for any app that
collects account data or serves ads — this app does both — and a web
account-deletion page reachable **without installing the app**, declared in the
Data safety form.

Neither page exists, and neither may be guessed: a URL that 404s in a store
listing is a policy problem, not a cosmetic one. `src/constants/legal.ts` reads
them from `EXPO_PUBLIC_PRIVACY_POLICY_URL`, `EXPO_PUBLIC_TERMS_URL` and
`EXPO_PUBLIC_ACCOUNT_DELETION_URL`, accepts only absolute HTTPS, and Profile
renders a row **only** for a URL the build actually has. So publishing the pages
is a configuration step, not a code change.

The deletion URL is load-bearing in the binary, not only in the console:
`POST /users/me/deletion` requires the current password and fails closed for an
account that has none, so a Google-only account's only route is that web page
(`src/app/account-data.tsx`).

**To close:** publish both pages, set the two variables, rebuild.

---

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

### B2 — Production identity. **DECIDED — `com.spark.redpanda` / "Red Panda".**

Settled by the product owner and applied to `app.json`:

| | |
|---|---|
| `android.package` | `com.spark.redpanda` |
| `ios.bundleIdentifier` | `com.spark.redpanda` |
| Display name (`expo.name`) | `Red Panda` |

This value is **permanent once published** — Google Play never allows an
`applicationId` to be renamed or reused. It is now the identity that every
external registration must bind to, and two of them are currently bound to the
old placeholder:

1. **The Google OAuth Android client is now invalid.** It was registered for
   `com.anonymous.mobileappecc` with the debug keystore's SHA-1. A new Android
   client is required for `com.spark.redpanda`, carrying the SHA-1 of whichever
   keystore signs the build — see B1 and `docs/android-local-demo.md`. There is
   **no user-visible regression in V1**, because the Google button is not
   offered unless `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is set
   (`src/services/auth/provider-availability.ts`), and it is not set. What
   breaks is the local developer workflow, until the new client exists.
2. **The AdMob app must be created against `com.spark.redpanda`** (B3).

**The generated `android/` tree has been regenerated and verified.** It was
stale - it carried `applicationId 'com.anonymous.mobileappecc'` and `app_name`
`mobile-app-ecc` from the previous prebuild. `expo prebuild --platform android
--clean` rebuilt it from `app.json`, and the merged release manifest now carries
`com.spark.redpanda` / `Red Panda` (§2). `android/` is gitignored build output
(0 tracked files), so this is not in any commit; **anyone building from a fresh
clone must run the prebuild themselves before `bundleRelease`, or the native
identity will not exist at all.** See §4.

The shared Android debug certificate's fingerprints, for the OAuth registration
below - these are not secret, the same certificate ships with every Android SDK
install on earth:

```
SHA1:   5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25
SHA256: FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C
```

They are useful only for a **development** OAuth client. The Play-distributed
build is signed by the upload/app-signing certificate from B1, whose SHA-1 does
not exist yet and must be registered separately.

**Still scaffold-derived, deliberately not changed:**

- `expo.slug` (`mobile-app-ecc`) — an Expo/EAS project identifier, not
  user-facing and not part of the Android identity. Changing it can re-point EAS
  project linking, so it is left alone until there is an EAS project to link.
- `expo.scheme` (`mobileappecc://`) — the custom deep-link scheme. It is not the
  applicationId and nothing published depends on it, but it is what
  `mobileappecc://` links resolve to. Renaming it is a separate, safe decision
  that nobody has asked for yet.
- The `@mobile-app-ecc/*` AsyncStorage key prefixes. These are **storage keys,
  not identity**: renaming them would orphan every existing install's auth
  tokens, likes, saves and watch progress on upgrade. They must not be tidied.

### B3 — AdMob app id AND interstitial unit id are Google's samples/unset. **BLOCKER.**

`app.json` carries Google's sample `androidAppId`
(`ca-app-pub-3940256099942544~3347511713`), baked into the manifest as
`com.google.android.gms.ads.APPLICATION_ID`. That default is deliberate and
cannot simply be emptied: the SDK's `MobileAdsInitProvider` is a ContentProvider
that runs before `Application.onCreate` and **crashes on launch** when the app id
resolves to an empty string.

Supply the real ids as configuration, not as a source edit:

```
EXPO_PUBLIC_ADMOB_ANDROID_APP_ID=ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY
EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID=ca-app-pub-XXXXXXXXXXXXXXXX/ZZZZZZZZZZ
```

`app.config.js` substitutes the app id into the plugin; the preflight blocks
until both are set, because a build with one and not the other cannot serve a
real ad. Register the AdMob app against **`com.spark.redpanda`**.

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

**Since 2026-08-26 the button ships visible** — WhatsApp Login is in the V1
scope and is not withdrawn while its backend is built on a parallel branch. So
an external user on a build cut today reaches a real phone-number form, and the
server refuses it with `503`, which the app reports as "not active on this
server yet". Nothing is faked: no build hardcodes an OTP or mints a session the
server did not grant. `EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED=false` withdraws the
entry point if that trade is not wanted for a given build.

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

> **There are TWO caches, not one.** Metro caches the transformed JS with the
> `EXPO_PUBLIC_*` values already inlined, and Gradle does not track `.env` as an
> input. Measured here: `expo export` after changing the variable kept the stale
> LAN host, while the same command with `--clear` inlined the new origin. Clear
> BOTH, then verify the artifact itself with `strings` - `npm run
> release:preflight` reads the environment and cannot see what a cached bundle
> actually contains. Full procedure:
> docs/play-store-v1-owner-checklist.md §9.


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

Both are `false` today. **Re-audited 2026-08-27** against the generated Gradle
files, which name the exact switches: `minifyEnabled` reads
`android.enableMinifyInReleaseBuilds` and `shrinkResources` reads
`android.enableShrinkResourcesInReleaseBuilds`; neither property appears in
`android/gradle.properties`, so both default to `false`. `proguardFiles` is
wired (`proguard-android.txt` + `proguard-rules.pro`) but inert while
`minifyEnabled` is false. `hermesEnabled=true`, so the JavaScript already ships
as Hermes bytecode rather than readable source, and `newArchEnabled=true`.

Java/Kotlin ships unminified and unshrunk (Hermes still compiles JS to bytecode,
so the JS is unaffected either way). **This is not a data-protection gap:**
minification is not a secrecy control, and every `EXPO_PUBLIC_*` value is inlined
into the bundle and readable whether or not R8 runs. Enabling them is a real
size and obfuscation win, and it is also the single change most likely to break
this exact app **silently at runtime, in release only**:

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

## 5.5 What was NOT verified, and cannot be from this machine

Stated plainly so this document is not mistaken for a sign-off:

- **No physical Android device is connected** (as of 2026-08-26), so nothing
  below §6 has been executed. Every orientation, ad-pacing, consent-form,
  deep-link and install-size claim in this document is derived from source and
  from Jest, not from a handset.
- **One exception, recorded for accuracy:** a device *was* attached on
  2026-08-25 (`25078RA3EY`, Android 15) for HLS runtime verification, using a
  debug build against the LAN backend. That session confirmed **Auto /
  adaptive** switching only — it ran with `requested=auto` throughout.
  **Manual rendition pinning has never been observed on a handset.** See
  [`playback-quality.md` §5](./playback-quality.md) for exactly what that
  session did and did not establish.
- **No AAB has ever been produced from this repository.** `expo prebuild
  --platform android --clean` HAS now been run and its output verified (see
  §2), and `:app:processReleaseManifest` HAS been run to produce and inspect a
  real merged release manifest - but no `bundleRelease`, and no signed
  artifact.
- **No release-signed artifact exists.** The only artifact ever built here is a
  debug-signed APK predating this work.
- **The UMP consent flow has never shown a form**, because no consent message is
  published in the AdMob console (see B3). The client sequence is unit-tested;
  its real behaviour is unobserved.

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
| 4 | **Cleartext check** | Same dump shows no `usesCleartextTraffic` and no `networkSecurityConfig`. This is the check that catches a stale LAN exemption surviving a non-`--clean` prebuild |
| 5 | **Fresh install** | Installs; launcher and adaptive icon render; label is the intended product name |
| 6 | **Cold start with the build machine off-network** | Splash → Home. No Metro, no "unable to connect to development server" |
| 7 | **Guest playback** | A free episode plays without signing in. No sign-in wall on free content |
| 8 | **Google login** | Account chooser appears and sign-in completes. `DEVELOPER_ERROR` means the release SHA-1 is not registered (B1/B4) |
| 9 | **WhatsApp login / OTP** | The button is present and opens a real phone-number form. On a build cut before the WhatsApp backend ships, sending a code must show "belum aktif di server ini" — an honest refusal. It must NEVER sign anyone in. Once the backend is live, the code actually arrives on WhatsApp (B7) |
| 10 | **Restart persistence** | Force-stop, reopen: still signed in, Saved and Progress intact |
| 11 | **Reinstall does NOT restore the session** | After `allowBackup=false`, a reinstall lands on the signed-out state. This is the intended trade (§1.4), not a defect |
| 12 | **Rewards** | Balance, streak and tasks load from the server. Daily check-in credits once; a second tap reports "already checked in" and does not move the balance |
| 13 | **No paywall anywhere** | V1 scope check (`docs/v1-product-scope.md`): no "Premium" badge on Discover, no access chip on an episode row, no lock or modal on Series Detail or the feed's Next Episode, and no "activate Premium" gate. Every published episode opens |
| 14 | **Redeem panel** | V1 shows the Redeem section with its empty state — the coin-priced VIP offers are filtered out of scope. It must not offer a way to buy premium, buy coins, or pay for anything |
| 15 | **Series episode selection** | Opening episode N from Series Detail lands on exactly episode N in the feed |
| 16 | **Progress persistence** | Watch partway, leave, return: resumes at the same position. Survives a restart |
| 17 | **Like / Save** | Both persist across a restart and are scoped to the signed-in account |
| 18 | **Network off → on** | Airplane mode: a truthful error state with Retry, never stale mock content, never a crash. Restoring network plus Retry recovers |
| 19 | **Dead network, not just absent** | A request into a black hole resolves as an error within ~20 s (`ApiError` `TIMEOUT`), not an endless spinner |
| 20 | **Logout → login** | Logout clears the session; the next Google sign-in shows the account chooser rather than silently reusing the last account |
| 21 | **HLS playback — Auto** | An HLS-backed episode plays and adapts quality on its own |
| 21a | **HLS playback — manual rendition** | Playback Settings lists Auto plus only the rungs this video really has. Selecting `720p` pins the decoder at 720&times;1280 and it does **not** drift; `1080p HD` appears only for a video whose ladder contains it. **Never verified on a device — see §5.5** |
| 21b | **Quality change preserves state** | Switching rungs keeps the position, the play/pause intent and the chosen speed; audio never doubles |
| 22 | **MP4 playback** | A legacy/MP4-backed episode plays. This is *not* a fallback for a failed HLS stream — it is a separate storage shape |
| 23 | **Ads** | Interstitials appear at the counter-based cadence. If they read "Test Ad", B3 is unresolved |
| 24 | **No mock or internal surfaces** | Profile shows no "Processing History / INTERNAL" entry; the catalog has no "QA 16:9 FIXTURE" card and no `pewaris` / `nona-shen` clips |
| 25 | **Deep links to internal routes** | `adb shell am start -a android.intent.action.VIEW -d "mobileappecc://processing"` and `…"mobileappecc://_sitemap"` both fail to open an internal screen |
