#!/usr/bin/env node
//
// Production Android release preflight.
//
// WHY THIS IS A SCRIPT AND NOT A THROW IN app.config.js
// -----------------------------------------------------
// Most of what makes a build "production" is invisible to the config file:
// `app.config.js` is evaluated for `expo start`, for CI's
// `npx expo config --type public` (which runs with no `.env` at all), and for
// the internal LAN demo APK, none of which are production. A rule that failed
// those would just be switched off. So the production-only rules live here, in
// something a human runs deliberately, once, before an external build:
//
//   npm run release:preflight
//
// It reads the SAME sources the build does - `.env` through `@expo/env` (the
// loader Expo CLI itself uses) and the resolved Expo config through
// `expo/config` - so what it checks is what would actually ship, rather than a
// restatement of it that can drift.
//
// It reads only. It never writes a file, never contacts a network, and never
// invents a value: every finding names the thing to fix and stops.

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// `@expo/env` picks which `.env*` files to load from NODE_ENV, and a release
// build is a production one - `expo export` sets exactly this. Without it the
// loader warns and falls back to a narrower set, so the check would be reading
// different values than the build it is vouching for. Set here rather than in
// the npm script so it holds however the file is invoked.
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

// Loads the `.env*` files exactly as `expo export` does, so this check sees
// the same values the build would.
require('@expo/env').load(projectRoot);

const { getConfig } = require('expo/config');

const blockers = [];
const warnings = [];

function blocker(title, detail) {
  blockers.push({ title, detail });
}

function warning(title, detail) {
  warnings.push({ title, detail });
}

// --- Environment -----------------------------------------------------------

const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

if (!apiBaseUrl) {
  blocker(
    'EXPO_PUBLIC_API_BASE_URL is not set',
    'Every backend call would throw ApiError MISSING_BASE_URL and the app would show its ' +
      'error state on every surface. Set it to the production HTTPS backend.'
  );
} else {
  let parsed = null;

  try {
    parsed = new URL(apiBaseUrl);
  } catch {
    blocker(
      `EXPO_PUBLIC_API_BASE_URL is not a valid URL: "${apiBaseUrl}"`,
      'The APK would be unable to reach any backend at all.'
    );
  }

  if (parsed && parsed.protocol !== 'https:') {
    blocker(
      `EXPO_PUBLIC_API_BASE_URL is not https: "${apiBaseUrl}"`,
      'Android 9+ refuses cleartext by default, and plugins/with-lan-cleartext-demo.js would ' +
        `respond by writing a network_security_config permitting cleartext to "${parsed.hostname}". ` +
        'That exemption exists for the internal LAN demo only. A build distributed externally ' +
        'must talk to an https backend, and then that plugin becomes a no-op on its own.'
    );
  }

  if (parsed && /^(localhost|127\.0\.0\.1|10\.0\.2\.2|\[?::1\]?)$/i.test(parsed.hostname)) {
    blocker(
      `EXPO_PUBLIC_API_BASE_URL points at the build machine: "${apiBaseUrl}"`,
      "On a phone, localhost is the phone, and 10.0.2.2 is the emulator's alias for its host. " +
        'Neither resolves to your backend on an external device.'
    );
  }

  if (parsed && /^(10|127)\.|^192\.168\.|^172\.(1[6-9]|2[0-9]|3[01])\./.test(parsed.hostname)) {
    blocker(
      `EXPO_PUBLIC_API_BASE_URL is a private LAN address: "${apiBaseUrl}"`,
      'Reachable only from the same Wi-Fi as the build machine. That is the internal demo ' +
        'configuration (docs/android-local-demo.md), not an externally distributable one.'
    );
  }
}

const releaseUnsafeFlags = [
  [
    'EXPO_PUBLIC_DEMO_MODE',
    'The offline showcase: login accepts ANY credentials locally and mints synthetic tokens, ' +
      'the catalog is bundled clips, ads are off. See src/services/demo/demo-mode.ts.',
  ],
  [
    'EXPO_PUBLIC_USE_MOCK_DATA',
    'Serves the bundled mock catalog instead of the backend on every catalog surface.',
  ],
  [
    'EXPO_PUBLIC_INCLUDE_QA_FIXTURES',
    'Appends the synthetic "QA 16:9 FIXTURE - SYNTHETIC TEST VIDEO" card to the catalog.',
  ],
];

for (const [key, detail] of releaseUnsafeFlags) {
  if (process.env[key] === 'true') {
    blocker(`${key}=true`, detail);
  }
}

if (process.env.EXPO_PUBLIC_HLS_PLAYBACK_ENABLED === 'false') {
  warning(
    'EXPO_PUBLIC_HLS_PLAYBACK_ENABLED=false',
    'HLS playback is DISABLED, and this is a kill switch, not a fallback: every HLS-backed ' +
      'episode resolves to "Video unavailable" with no MP4 to fall back to. Intended only as ' +
      'a deliberate rollback. See src/services/videos/hls-playback-flag.ts.'
  );
}

// --- Legal surfaces --------------------------------------------------------

/**
 * Mirrors `readHttpsUrl` in src/constants/legal.ts. The app renders a legal row
 * only for a URL that parses as absolute https, so a value this rejects
 * produces NO row - checking the raw presence of the variable would vouch for a
 * build whose Profile screen has no privacy policy link at all.
 */
function isUsableLegalUrl(value) {
  if (!value) {
    return false;
  }

  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

if (!isUsableLegalUrl(process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL)) {
  blocker(
    'EXPO_PUBLIC_PRIVACY_POLICY_URL is not set to an https URL',
    'Google Play requires a privacy policy URL in the store listing for any app that collects ' +
      'account data or serves ads - this app does both. The URL is also what the Profile ' +
      "screen's Privacy Policy row opens; without it that row is not rendered at all " +
      '(src/constants/legal.ts). Publish the page and set this; it cannot be guessed, and a ' +
      'link that 404s is worse than no link.'
  );
}

if (!isUsableLegalUrl(process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL)) {
  blocker(
    'EXPO_PUBLIC_ACCOUNT_DELETION_URL is not set to an https URL',
    'Google Play requires a web account-deletion page reachable WITHOUT installing the app, ' +
      'declared in the Data safety form. It is a blocker rather than a warning because the ' +
      'BINARY depends on it too: an account with no password cannot use the in-app path (the ' +
      'backend requires the current password and fails closed), so this URL is the only ' +
      'deletion route the app can offer such an account, and without it the Profile row that ' +
      'would carry it is not rendered at all. See src/app/account-data.tsx and ' +
      'src/constants/legal.ts.'
  );
}

if (!isUsableLegalUrl(process.env.EXPO_PUBLIC_TERMS_URL)) {
  warning(
    'EXPO_PUBLIC_TERMS_URL is not set to an https URL',
    'Optional for Play. The Profile screen simply renders no Terms row without it.'
  );
}

// --- Provider availability -------------------------------------------------

if (process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED === 'true') {
  blocker(
    'EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED=true',
    'This offers a WhatsApp sign-in button. docs/api-contract.md records that the backend ' +
      '"CANNOT be enabled in production - only a `fake` driver exists and the process refuses ' +
      'to boot with WhatsApp enabled outside development/test", so a deployed server answers ' +
      'every attempt with 503 WHATSAPP_AUTH_DISABLED. Set this only once a real WhatsApp ' +
      'Business provider is live on the backend. See ' +
      'src/services/auth/provider-availability.ts.'
  );
}

if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
  warning(
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set',
    'The Google sign-in button will report its "not configured" state. Every other sign-in ' +
      'method still works. This is a build-time value; setting it later needs a new build.'
  );
}

if (!process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID) {
  blocker(
    'EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID is not set',
    "`resolveAdUnitId` falls back to Google's published TEST interstitial when this is unset " +
      '(src/services/ads/interstitial-adapter.ts), so a store build would interrupt real users ' +
      'with a full-screen sample ad carrying a "Test Ad" watermark, earning nothing. That is ' +
      'the app showing fabricated content as its own monetization. The AdMob app id and the ad ' +
      'unit id are one decision: a build with one and not the other cannot serve a real ad.'
  );
}

// --- Bundled demo media ----------------------------------------------------
//
// THERE IS DELIBERATELY NO CHECK HERE ANY MORE.
//
// This used to block whenever `assets/videos` / `assets/thumbnails` existed,
// because Metro collected their `require`s unconditionally and a build made on
// the machine that had produced the showcase APK silently shipped ~61 MB of
// drama clips and the synthetic QA test card inside a store artifact.
//
// That is now structurally impossible rather than procedurally avoided:
// `metro.config.js` stubs those requires for any build that does not set
// EXPO_PUBLIC_DEMO_MODE / EXPO_PUBLIC_USE_MOCK_DATA, whatever is on disk.
// Measured on a machine that HAS the media: a production export is 6.8 MB with
// 43 assets and zero `.mp4`, while the demo export is still 65 MB with 11.
// Both flags remain blockers in their own right above, so the only build that
// can carry the clips is one that has declared it wants them.
//
// Re-adding a disk check would make the preflight demand a pointless chore -
// "go move some folders" - for a risk that no longer exists, and a preflight
// that cries wolf gets ignored. The guarantee is pinned by
// `src/services/demo/__tests__/production-boundary.test.ts`.

// --- Resolved Expo config --------------------------------------------------

const { exp } = getConfig(projectRoot, {
  skipSDKVersionRequirement: true,
  isPublicConfig: true,
});

const androidPackage = exp.android && exp.android.package;

if (!androidPackage || androidPackage.startsWith('com.anonymous.')) {
  blocker(
    `Android package is still the Expo placeholder: "${androidPackage}"`,
    '`com.anonymous.*` is the scaffold default. It is permanent once published, and it is the ' +
      'identity the Google Cloud Android OAuth client and the AdMob app are registered against. ' +
      'Decide the real application id before any external build.'
  );
}

const iosBundleIdentifier = exp.ios && exp.ios.bundleIdentifier;

if (iosBundleIdentifier && iosBundleIdentifier.startsWith('com.anonymous.')) {
  warning(
    `iOS bundle identifier is still the Expo placeholder: "${iosBundleIdentifier}"`,
    'Not an Android blocker, but it should be settled in the same decision as the Android ' +
      'package (note the two are not even consistent with each other today).'
  );
}

const GOOGLE_SAMPLE_ADMOB_PUBLISHER = 'ca-app-pub-3940256099942544';

const adMobPlugin = (exp.plugins || []).find(
  (plugin) => Array.isArray(plugin) && plugin[0] === 'react-native-google-mobile-ads'
);
const adMobAndroidAppId = adMobPlugin && adMobPlugin[1] && adMobPlugin[1].androidAppId;

if (adMobAndroidAppId && adMobAndroidAppId.startsWith(GOOGLE_SAMPLE_ADMOB_PUBLISHER)) {
  blocker(
    `AdMob androidAppId is Google's public SAMPLE id: "${adMobAndroidAppId}"`,
    'It is baked into AndroidManifest.xml as com.google.android.gms.ads.APPLICATION_ID, so a ' +
      'store build would register with Google under the sample publisher. Set ' +
      'EXPO_PUBLIC_ADMOB_ANDROID_APP_ID (app.config.js substitutes it into the plugin) rather ' +
      "than editing app.json - it is not a secret, but it is one AdMob account's identity and " +
      'does not belong in every checkout. It cannot be guessed, and it must be registered ' +
      'against the final package name.'
  );
}

if (!exp.android || !Number.isInteger(exp.android.versionCode) || exp.android.versionCode < 1) {
  blocker(
    `android.versionCode is not a positive integer in app.json: ${exp.android && exp.android.versionCode}`,
    'Unset, Expo emits `versionCode 1` into a gitignored, prebuild-regenerated build.gradle - so ' +
      'the number Google Play uses to order your uploads would be owned by a file nobody edits ' +
      'and nobody reviews. app.json owns it precisely so it can be incremented deliberately, ' +
      'once per upload, in a diff.'
  );
}

// --- Android release identity ----------------------------------------------

// Auto-backup is the one Android default that silently copies application
// private storage off the device. `src/services/storage/local-storage.ts`
// persists the auth blob - access AND refresh token - to AsyncStorage as
// plaintext JSON, and AsyncStorage lives in that private storage. Left true,
// the tokens land in the user's Google Drive and restore onto another device.
if (!exp.android || exp.android.allowBackup !== false) {
  blocker(
    `android.allowBackup is not false: ${exp.android && exp.android.allowBackup}`,
    "Android's auto-backup would copy AsyncStorage - which holds the access and refresh " +
      'tokens as plaintext JSON - to the user\'s Google Drive, and restore it onto another ' +
      'device. Set "allowBackup": false in app.json\'s android block.'
  );
}

// Permissions this app does not use, that the Expo prebuild template or a
// transitive library merges into the manifest anyway. `android.permissions` is
// ADDITIVE ONLY (see @expo/config-plugins' setAndroidPermissions - it never
// removes), so an allowlist cannot take these back out; `blockedPermissions`
// is the mechanism that writes `tools:node="remove"` and actually deletes them
// from the merged manifest.
const UNUSED_MERGED_PERMISSIONS = [
  [
    'android.permission.SYSTEM_ALERT_WINDOW',
    'Draw over other apps. It comes from the prebuild template, nothing in this app uses it, ' +
      'and it is one of the permissions Google Play scrutinises hardest on a new listing.',
  ],
  [
    'android.permission.READ_EXTERNAL_STORAGE',
    'Merged in by expo-file-system and expo-image (Glide) with maxSdkVersion=32. This app reads ' +
      'no user files; every image and video it loads is a bundled asset or an https URL.',
  ],
  [
    'android.permission.WRITE_EXTERNAL_STORAGE',
    'Merged in by expo-file-system with maxSdkVersion=32. This app writes no user files.',
  ],
];

const blockedPermissions = (exp.android && exp.android.blockedPermissions) || [];
const unblockedPermissions = UNUSED_MERGED_PERMISSIONS.filter(
  ([permission]) => !blockedPermissions.includes(permission)
);

for (const [permission, detail] of unblockedPermissions) {
  blocker(`${permission} is not in android.blockedPermissions`, detail);
}

// --- Release signing -------------------------------------------------------
//
// This section reads `keystore.properties` to learn WHICH keys are present.
// It never reads a value out of that file: only the text to the left of the
// first `=` is ever captured, so no password is loaded into this process, and
// none can be printed by any message below.

const RELEASE_SIGNING_PLUGIN = './plugins/with-android-release-signing';

const RELEASE_SIGNING_KEYS = [
  ['storeFile', 'ANDROID_RELEASE_STORE_FILE'],
  ['storePassword', 'ANDROID_RELEASE_STORE_PASSWORD'],
  ['keyAlias', 'ANDROID_RELEASE_KEY_ALIAS'],
  ['keyPassword', 'ANDROID_RELEASE_KEY_PASSWORD'],
];

const keystorePropertiesPath = path.join(projectRoot, 'keystore.properties');
const keystorePropertiesExists = fs.existsSync(keystorePropertiesPath);
const declaredKeystoreKeys = new Set();

if (keystorePropertiesExists) {
  for (const line of fs.readFileSync(keystorePropertiesPath, 'utf8').split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }

    const separator = trimmed.indexOf('=');

    if (separator > 0) {
      declaredKeystoreKeys.add(trimmed.slice(0, separator).trim());
    }
  }
}

const missingSigningKeys = RELEASE_SIGNING_KEYS.filter(
  ([propertyKey, environmentKey]) =>
    !declaredKeystoreKeys.has(propertyKey) && !process.env[environmentKey]
).map(([propertyKey]) => propertyKey);

if (missingSigningKeys.length === RELEASE_SIGNING_KEYS.length) {
  blocker(
    'Release signing is not configured - this build would be DEBUG-signed',
    'The Expo template signs the `release` build type with android/app/debug.keystore, the ' +
      'shared Android debug certificate that is identical on every developer machine. Google ' +
      'Play rejects it outright. Generate a keystore, keep it out of git, and put its four ' +
      'values in a `keystore.properties` at the repository root (storeFile, storePassword, ' +
      'keyAlias, keyPassword) or in the ANDROID_RELEASE_* environment variables. ' +
      'plugins/with-android-release-signing.js then wires a real signingConfig that survives ' +
      'prebuild. Absent them the build deliberately still succeeds debug-signed, because the ' +
      'internal demo APKs depend on that - which is exactly why this check exists.'
  );
} else if (missingSigningKeys.length > 0) {
  blocker(
    `Release signing is only partly configured; missing: ${missingSigningKeys.join(', ')}`,
    'Gradle would stop the build rather than fall back to debug signing, but it would stop ' +
      'minutes in. Fill all four, or clear all four for an internal debug-signed artifact.'
  );
}

const isReleaseSigningPluginRegistered = (exp.plugins || []).some(
  (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === RELEASE_SIGNING_PLUGIN
);

if (!isReleaseSigningPluginRegistered) {
  blocker(
    `${RELEASE_SIGNING_PLUGIN} is not in app.json's plugins`,
    'Without it, `expo prebuild` regenerates android/app/build.gradle with ' +
      '`release { signingConfig signingConfigs.debug }` and every credential above is ignored.'
  );
}

// A password file at the repository root is one `git add -A` away from being
// public forever. .gitignore already lists it; this makes deleting that line a
// blocker rather than a thing discovered later.
if (keystorePropertiesExists) {
  const gitignorePath = path.join(projectRoot, '.gitignore');
  const isKeystorePropertiesIgnored =
    fs.existsSync(gitignorePath) &&
    fs
      .readFileSync(gitignorePath, 'utf8')
      .split('\n')
      .some((line) => line.trim() === 'keystore.properties');

  if (!isKeystorePropertiesIgnored) {
    blocker(
      'keystore.properties exists but .gitignore does not ignore it',
      'It holds the release keystore passwords. Restore the `keystore.properties` line in ' +
        '.gitignore before running any other git command.'
    );
  }
}

if (exp.name === 'mobile-app-ecc' || exp.slug === exp.name) {
  warning(
    `App display name is still the scaffold slug: "${exp.name}"`,
    'This is the label under the launcher icon. A product name belongs here before anyone ' +
      'outside the team installs it.'
  );
}

// --- Report ----------------------------------------------------------------

function print(heading, entries) {
  if (entries.length === 0) {
    return;
  }

  console.log(`\n${heading}\n`);

  for (const { title, detail } of entries) {
    console.log(`  - ${title}`);
    console.log(`      ${detail}`);
  }
}

print(`BLOCKERS (${blockers.length})`, blockers);
print(`WARNINGS (${warnings.length})`, warnings);

if (blockers.length > 0) {
  console.log(
    '\nNot ready for external Android distribution. See docs/release-readiness-android.md.\n'
  );
  process.exit(1);
}

console.log(
  warnings.length > 0
    ? '\nNo blockers. Review the warnings above before distributing.\n'
    : '\nNo blockers and no warnings.\n'
);
