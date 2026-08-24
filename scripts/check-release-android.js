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

if (!process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID) {
  warning(
    'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set',
    'The Google sign-in button will report its "not configured" state. Every other sign-in ' +
      'method still works. This is a build-time value; setting it later needs a new build.'
  );
}

if (!process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID) {
  warning(
    'EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID is not set',
    "Interstitials will serve Google's published TEST unit, which earns nothing. See " +
      'src/services/ads/interstitial-adapter.ts.'
  );
}

// --- Bundled demo media ----------------------------------------------------

const bundledDemoMediaPresent = ['assets/videos', 'assets/thumbnails'].filter((relativePath) =>
  fs.existsSync(path.join(projectRoot, relativePath))
);

if (bundledDemoMediaPresent.length > 0) {
  blocker(
    `Bundled demo media is present on disk: ${bundledDemoMediaPresent.join(', ')}`,
    'Those directories are gitignored offline-showcase clips/posters (~62 MB). Metro collects ' +
      'their `require`s unconditionally from src/data/mock-drama-videos.ts, so a build made now ' +
      'would ship every demo clip and the QA test card inside the production APK. Move or ' +
      'delete them, or build from a clean checkout.'
  );
}

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
    'It is baked into AndroidManifest.xml as com.google.android.gms.ads.APPLICATION_ID. A real ' +
      'AdMob app id has to replace it in app.json before external distribution; it is not a ' +
      'secret, but it is account-specific and cannot be guessed.'
  );
}

if (!exp.android || exp.android.versionCode === undefined) {
  warning(
    'android.versionCode is not set in app.json',
    'Expo defaults it to 1. Fine for a first artifact, but every subsequent build distributed ' +
      'to the same devices must increase it or Android refuses the upgrade.'
  );
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
