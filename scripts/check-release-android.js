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
//
// SHAPE: `evaluateReleaseContract` below is PURE - every fact it judges is
// handed to it. `readReleaseFacts` is the only part that touches the
// environment, the Expo resolver and the disk. That split is what lets
// `scripts/__tests__/release-contract.test.js` prove each rule against a
// constructed world rather than against whatever happens to be on the machine
// running the suite; a rule that can only be checked by running a real build
// is a rule nobody checks.

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

// --- The V1 contract, as constants ------------------------------------------
//
// Red Panda V1 is: free content + ads + rewards, signed in with Google or
// WhatsApp, played over HLS. Everything below encodes one half of that
// sentence. See docs/v1-product-scope.md.

/** The published Android application id. Permanent once uploaded to Play. */
const EXPECTED_ANDROID_PACKAGE = 'com.spark.redpanda';

/**
 * Google's public SAMPLE AdMob publisher. It prefixes both the sample APP ids
 * (`~` separator) that `app.json` ships as its committed default and the
 * sample AD UNIT ids (`/` separator) that `interstitial-adapter.ts` falls back
 * to. Neither may reach a store artifact: they serve watermarked "Test Ad"
 * creatives that earn nothing, under Google's account rather than this one.
 */
const GOOGLE_SAMPLE_ADMOB_PUBLISHER = 'ca-app-pub-3940256099942544';

/** A real Google OAuth web client id. Anything else cannot mint an ID token. */
const GOOGLE_WEB_CLIENT_ID_PATTERN = /^\d+-[A-Za-z0-9_]+\.apps\.googleusercontent\.com$/;

/**
 * Values that PARSE as a client id (or nearly) but are documentation filler.
 * `1234567890-` is the canonical placeholder in Google's own setup guides and
 * in most copied-from-a-blog `.env` files.
 */
const GOOGLE_PLACEHOLDER_PATTERN =
  /^1234567890-|your[-_.]?(web|ios|client)|placeholder|changeme|change[-_]me|<[^>]*>|xxxx|\btodo\b|\bdummy\b/i;

/**
 * Payment rails, card processors and store-billing bridges. Kept identical to
 * `src/services/entitlement/__tests__/v1-payment-boundary.test.ts`, which
 * guards the same boundary from the source side. Deliberately does NOT include
 * the word "premium" or "subscribe": premium is an access tier this app
 * legitimately models, and `rewards.ctaSubscribe` is the label on a task that
 * asks a viewer to subscribe to a YouTube channel.
 */
const PAYMENT_SDK_PATTERN =
  /midtrans|xendit|stripe|braintree|paypal|adyen|revenuecat|in-?app-?purchase|\biap\b|play-?billing|google-?pay|expo-in-app|react-native-purchases/i;

/**
 * Modules that serve fabricated data. A REQUIRED V1 service that imports one
 * has stopped being real, whatever its own comments say.
 *
 * Matched against IMPORT SPECIFIERS ONLY, never against the file's prose. An
 * earlier version of this rule scanned the whole source for the words
 * "mock/fake/stub/fixture" and fired on `rewards-service.ts`'s own comment -
 * "It never falls back to fixture data" - i.e. on the sentence asserting the
 * exact property being checked. A guard that fails on a correct file teaches
 * people to delete the guard.
 */
const MOCK_MODULE_PATTERN = /\bmock|\bfixture|\bstub|\bfake|\/demo\//i;

/** Every module specifier a file imports or requires. */
function collectImportSpecifiers(source) {
  return Array.from(source.matchAll(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/g)).map(
    (match) => match[1]
  );
}

const RELEASE_SIGNING_PLUGIN = './plugins/with-android-release-signing';

/**
 * The plugin that writes `android:dataExtractionRules`. Registration in
 * `app.json` is the CANONICAL source - `android/` is gitignored and
 * regenerated, so checking the generated manifest would be checking whatever
 * the last prebuild on this machine happened to produce.
 */
const ANDROID_DATA_EXTRACTION_PLUGIN = './plugins/with-android-data-extraction-rules';

/**
 * Every domain the policy must deny, restated here rather than imported from
 * the plugin so that gutting the plugin's own list cannot also silence the
 * check that guards it. Matches
 * `FullBackup.BackupScheme.getDirectoryForCriteriaDomain`; see the plugin for
 * why exclusion has to be per-domain rather than `root` alone.
 */
const REQUIRED_EXTRACTION_DOMAINS = [
  'root',
  'file',
  'database',
  'sharedpref',
  'device_root',
  'device_file',
  'device_database',
  'device_sharedpref',
  'external',
];

/** The two extraction destinations the policy must cover. */
const REQUIRED_EXTRACTION_SECTIONS = ['cloud-backup', 'device-transfer'];

/**
 * The resource with its leading explanatory comment stripped.
 *
 * The rules below are judged against this, never against the whole file. The
 * comment necessarily NAMES the things it promises the policy does not do
 * ("no <include> element appears below"), and a rule that scanned the prose
 * would fire on the sentence asserting the exact property being checked -
 * the same trap `MOCK_MODULE_PATTERN` above documents.
 */
function extractionRulesBody(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

// --- Secure session storage -------------------------------------------------
//
// These rules exist so a production V1 cannot regress to keeping bearer tokens
// as plaintext JSON in AsyncStorage, which is what it did before the
// secure-session work.
//
// EVERY RULE BELOW IS STRUCTURAL - an import specifier, a plugin registration,
// or an identifier in comment-stripped code. None of them reads prose. That is
// deliberate and it is the same trap `MOCK_MODULE_PATTERN` above documents: a
// rule that scanned doc comments would fire on the sentences that EXPLAIN the
// property being checked, and a guard that fails on a correct file teaches
// people to delete the guard.

const SECURE_STORE_MODULE = 'expo-secure-store';

/**
 * The single module allowed to import `expo-secure-store`.
 *
 * Checked as an EXCLUSIVE list, not just a presence check. Scattered
 * `SecureStore.setItemAsync` calls across screens would leave no one file that
 * can be reviewed to answer "where do the tokens live, and what happens when
 * the write fails" - and no single place for the migration to be correct in.
 */
const SESSION_SECRET_STORE_PATH = 'src/services/auth/session-secret-store.ts';

/** The store that must reach persistence only through the session boundary. */
const AUTH_STORE_PATH = 'src/stores/auth.tsx';

/**
 * The AsyncStorage modules `stores/auth.tsx` must NOT import.
 *
 * This is the rule that actually enforces "no tokens in AsyncStorage", and it
 * enforces it by construction rather than by inspection: the store holds the
 * live token pair in React state, so if it cannot reach AsyncStorage at all,
 * it cannot put them there. Persistence goes through
 * `services/auth/session-store.ts`, whose two destinations are each
 * single-purpose.
 */
const ASYNC_STORAGE_MODULES = [
  '@react-native-async-storage/async-storage',
  '@/services/storage/local-storage',
];

/**
 * The field names that identify bearer-token material.
 *
 * Matched against the CODE of `persisted-account.ts` with comments stripped -
 * the module that owns the `@mobile-app-ecc/auth` AsyncStorage key. That file
 * exists to persist four non-secret account fields and has no legitimate
 * reason to name either of these, so their appearance is a reliable signal
 * that a token is on its way back into the plaintext store.
 */
const TOKEN_FIELD_NAMES = ['accessToken', 'refreshToken'];

const PERSISTED_ACCOUNT_PATH = 'src/services/auth/persisted-account.ts';

/**
 * Source with `//` and block comments removed.
 *
 * Same technique as `extractionRulesBody` above, and for the same reason: the
 * doc comments in these files necessarily NAME the things they promise the
 * code does not do.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * expo-secure-store's own config plugin, which by default writes an
 * `android:dataExtractionRules` of its own.
 *
 * Its policy is `<include domain="sharedpref" path="."/>` plus one exclude for
 * its own file - an INCLUDE-based rule covering a single domain, where this
 * app's policy denies all nine. Letting it win would replace an audited
 * deny-all with something strictly weaker, so app.json must register it with
 * `configureAndroidBackup: false` and leave
 * `./plugins/with-android-data-extraction-rules` as the only backup authority.
 */
const SECURE_STORE_PLUGIN = 'expo-secure-store';

const RELEASE_SIGNING_KEYS = [
  ['storeFile', 'ANDROID_RELEASE_STORE_FILE'],
  ['storePassword', 'ANDROID_RELEASE_STORE_PASSWORD'],
  ['keyAlias', 'ANDROID_RELEASE_KEY_ALIAS'],
  ['keyPassword', 'ANDROID_RELEASE_KEY_PASSWORD'],
];

const RELEASE_UNSAFE_FLAGS = [
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

/** True for a Google sample AdMob app id (`~`) or ad unit id (`/`). */
function isGoogleSampleAdMobId(value) {
  return typeof value === 'string' && value.trim().startsWith(GOOGLE_SAMPLE_ADMOB_PUBLISHER);
}

/**
 * Judges one release against the V1 contract. PURE: no environment, no disk,
 * no network - everything it knows arrives in `facts` (see `readReleaseFacts`).
 *
 * @param {{
 *   env: Record<string, string | undefined>,
 *   exp: Record<string, any>,
 *   dependencyNames: readonly string[],
 *   declaredKeystoreKeys: ReadonlySet<string>,
 *   keystorePropertiesExists: boolean,
 *   isKeystorePropertiesIgnored: boolean,
 *   rewardsRouteExists: boolean,
 *   rewardsServiceSource: string,
 *   whatsAppServiceSource: string,
 *   dataExtractionPolicyXml: string | null,
 *   secureStoreImporters: readonly string[],
 *   authStoreSource: string,
 *   persistedAccountSource: string,
 *   sessionSecretStoreSource: string,
 * }} facts
 * @returns {{ blockers: {title: string, detail: string}[], warnings: {title: string, detail: string}[] }}
 */
function evaluateReleaseContract(facts) {
  const {
    env,
    exp,
    dependencyNames,
    declaredKeystoreKeys,
    keystorePropertiesExists,
    isKeystorePropertiesIgnored,
    rewardsRouteExists,
    rewardsServiceSource,
    whatsAppServiceSource,
    dataExtractionPolicyXml,
    secureStoreImporters,
    authStoreSource,
    persistedAccountSource,
    sessionSecretStoreSource,
  } = facts;

  const blockers = [];
  const warnings = [];

  function blocker(title, detail) {
    blockers.push({ title, detail });
  }

  function warning(title, detail) {
    warnings.push({ title, detail });
  }

  // --- Environment ---------------------------------------------------------

  const apiBaseUrl = env.EXPO_PUBLIC_API_BASE_URL;

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

  for (const [key, detail] of RELEASE_UNSAFE_FLAGS) {
    if (env[key] === 'true') {
      blocker(`${key}=true`, detail);
    }
  }

  // --- Legal surfaces ------------------------------------------------------

  if (!isUsableLegalUrl(env.EXPO_PUBLIC_PRIVACY_POLICY_URL)) {
    blocker(
      'EXPO_PUBLIC_PRIVACY_POLICY_URL is not set to an https URL',
      'Google Play requires a privacy policy URL in the store listing for any app that collects ' +
        'account data or serves ads - this app does both. The URL is also what the Profile ' +
        "screen's Privacy Policy row opens; without it that row is not rendered at all " +
        '(src/constants/legal.ts). Publish the page and set this; it cannot be guessed, and a ' +
        'link that 404s is worse than no link.'
    );
  }

  if (!isUsableLegalUrl(env.EXPO_PUBLIC_ACCOUNT_DELETION_URL)) {
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

  if (!isUsableLegalUrl(env.EXPO_PUBLIC_TERMS_URL)) {
    warning(
      'EXPO_PUBLIC_TERMS_URL is not set to an https URL',
      'Optional for Play. The Profile screen simply renders no Terms row without it.'
    );
  }

  // --- V1 FEATURE CONTRACT: REQUIRED ---------------------------------------
  //
  // Google Login, WhatsApp Login, Rewards, Ads and HLS are the five things V1
  // ships. Each one below is a build that would install, launch, and be missing
  // one of them - which is the failure mode a preflight exists to catch,
  // because none of them is visible in a diff.

  // GOOGLE LOGIN. `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` is inlined at BUILD time,
  // so "configured" is a permanent property of the artifact: a release built
  // without it can never offer Google sign-in, and
  // `provider-availability.ts` correctly HIDES the button rather than
  // offering a dead one (`__DEV__` is false in a release bundle). A required
  // V1 method that is silently absent is exactly what this must not allow.
  const googleWebClientId = (env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID || '').trim();

  if (!googleWebClientId) {
    blocker(
      'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set',
      'Google Login is a REQUIRED V1 feature. This value is inlined into the bundle at build ' +
        'time, so an artifact built without it can never offer Google sign-in - and the button ' +
        'is not rendered at all in a release build (src/services/auth/provider-availability.ts), ' +
        'so the method disappears silently rather than failing loudly. Use the WEB client id ' +
        '(Google mints the ID token against the web client on Android too), from an OAuth client ' +
        `registered against ${EXPECTED_ANDROID_PACKAGE}. Setting it later needs a new build.`
    );
  } else if (GOOGLE_PLACEHOLDER_PATTERN.test(googleWebClientId)) {
    blocker(
      `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is a placeholder: "${googleWebClientId}"`,
      'This is documentation filler, not a client id from a real Google Cloud project. Google ' +
        'would reject every token request, so the button would render and then fail for every ' +
        'user. Copy the real web client id out of the Google Cloud console.'
    );
  } else if (!GOOGLE_WEB_CLIENT_ID_PATTERN.test(googleWebClientId)) {
    blocker(
      `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not a Google web client id: "${googleWebClientId}"`,
      'A web client id looks like `<digits>-<token>.apps.googleusercontent.com`. A value of any ' +
        'other shape (an ANDROID client id, a client SECRET, a project number) cannot mint the ' +
        'ID token this app exchanges with its backend, and the failure only shows up on a ' +
        'device. Note the ANDROID client still has to exist in the same project and be ' +
        "registered against the release keystore's SHA-1 - it is just not this value."
    );
  }

  // WHATSAPP LOGIN. A confirmed V1 method, offered by default. The flag is a
  // kill switch; using it in a V1 release withdraws a required feature.
  if (env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED === 'false') {
    blocker(
      'EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED=false',
      'WhatsApp Login is a REQUIRED V1 feature and this flag withdraws its entry point ' +
        'entirely (src/services/auth/provider-availability.ts) - the login screen would ship ' +
        'with no WhatsApp option at all. Leave it unset or "true" for V1. It exists as a kill ' +
        'switch for a deliberate rollback, which is a decision to take on purpose and not one ' +
        'to inherit from a stale .env.'
    );
  } else {
    // Offered, which is correct - but the SERVER half is a credential the
    // repository cannot supply or verify. Still a warning, not a blocker.
    warning(
      'WhatsApp sign-in is offered (EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED is not "false")',
      'Confirmed V1 feature, offered by default. The backend now ships a PRODUCTION WhatsApp ' +
        'driver (cloud-api, Meta WhatsApp Cloud API), so this is no longer blocked on a missing ' +
        'implementation - it is blocked on CREDENTIALS. Until a real WhatsApp Business sender ' +
        'and its four Meta values are configured server-side, a deployed backend answers 503 ' +
        'WHATSAPP_AUTH_DISABLED and the viewer sees the truthful "not active on this server" ' +
        'message; with them configured but delivery failing, it answers 503 ' +
        'WHATSAPP_PROVIDER_UNAVAILABLE and the viewer is told the code could not be sent. ' +
        'NOTE: no real WhatsApp message has ever been sent by either side, so one end-to-end ' +
        'OTP to a handset you control is still owed before release. See ' +
        'src/services/auth/provider-availability.ts and the backend docs/WHATSAPP_LOGIN_SETUP.md.'
    );
  }

  // REWARDS. There is no client kill switch to check - which is the point:
  // the way rewards goes missing is structural, not configured. Either the
  // tab stops existing, or the service stops talking to the backend.
  if (!rewardsRouteExists) {
    blocker(
      'The Rewards tab route is missing: src/app/(tabs)/rewards.tsx',
      'Rewards is a REQUIRED V1 feature and expo-router derives every navigable screen from ' +
        'the route files on disk, so a missing file is a missing tab - in a build that ' +
        'otherwise compiles, tests green, and installs.'
    );
  }

  if (rewardsServiceSource && !rewardsServiceSource.includes("'rewards/snapshot'")) {
    blocker(
      'The rewards service no longer reads rewards/snapshot from the backend',
      'Rewards is a REQUIRED V1 feature and its balance, ledger and redemptions must come from ' +
        'the real backend (docs/rewards-domain-contract.md). A service that stopped calling ' +
        '`rewards/snapshot` is either broken or serving fabricated points.'
    );
  }

  // --- V1 FEATURE CONTRACT: NOT ALLOWED ------------------------------------

  // MOCK REWARDS. Distinct from the demo/mock FLAGS blocked above: this catches
  // a mock path compiled into the service itself, which no flag can switch off.
  const rewardsMockImports = collectImportSpecifiers(rewardsServiceSource || '').filter(
    (specifier) => MOCK_MODULE_PATTERN.test(specifier)
  );

  if (rewardsMockImports.length > 0) {
    blocker(
      `The rewards service imports a mock/fixture module: ${rewardsMockImports.join(', ')}`,
      'V1 rewards must be REAL: every point a viewer earns or spends is the backend\'s, and ' +
        'fabricated balances shown as earnings are the one thing a rewards feature must never ' +
        'do. Nothing in src/services/rewards/rewards-service.ts may serve invented points. Use ' +
        'EXPO_PUBLIC_USE_MOCK_DATA for local work instead - it is a blocker here in its own right.'
    );
  }

  // FAKE WHATSAPP. The client flow must stay real end to end: it calls the
  // canonical endpoints and propagates the server's refusal. The failure this
  // guards against is a "helpful" local shortcut that mints a session the
  // server never granted - which would be a sign-in that authenticates nobody.
  if (whatsAppServiceSource) {
    const callsRealOtpEndpoints =
      whatsAppServiceSource.includes("'auth/whatsapp/otp/request'") &&
      whatsAppServiceSource.includes("'auth/whatsapp/otp/verify'");

    if (!callsRealOtpEndpoints) {
      blocker(
        'The WhatsApp sign-in service no longer calls the real OTP endpoints',
        'WhatsApp Login must be real end to end. `startWhatsAppOtp` / `verifyWhatsAppOtp` ' +
          '(src/services/auth/provider-auth-service.ts) must POST auth/whatsapp/otp/request and ' +
          'auth/whatsapp/otp/verify and propagate the ApiError untouched. A client that ' +
          'shortcuts either one is fabricating a session the server never granted.'
      );
    }

    const whatsAppMockImports = collectImportSpecifiers(whatsAppServiceSource).filter(
      (specifier) => MOCK_MODULE_PATTERN.test(specifier)
    );

    if (whatsAppMockImports.length > 0) {
      blocker(
        `The WhatsApp sign-in service imports a fake/mock module: ${whatsAppMockImports.join(', ')}`,
        'The backend has a `fake` OTP driver for development; the CLIENT must never grow one. ' +
          'A viewer who is told they are signed in without the server saying so is the worst ' +
          'available outcome for an auth method.'
      );
    }
  }

  // PREMIUM / PAYWALL.
  //
  // V1 is FREE + ADS. Enabling the premium experience re-exposes the access
  // badges, the episode locks and the coin-priced VIP redemptions - a paywall in
  // a build whose backend runs CONTENT_ACCESS_MODE=free, so every lock is one the
  // viewer can neither clear nor pay to clear.
  if (env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED === 'true') {
    blocker(
      'EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED=true',
      'V1 scope is free content + ads: no paywall, no subscription, no payment, no coin ' +
        'purchase. This flag restores the premium/paywall UI (Discover access badge, per-episode ' +
        'access chip, Series Detail and feed episode locks, the "activate Premium" playback gate ' +
        'and the coin-priced VIP redemption offers). Leave it unset for V1. See ' +
        'src/services/config/v1-scope.ts.'
    );
  }

  // PAYMENT / SUBSCRIPTION / MIDTRANS. A structural boundary, not a flag: V1
  // has no way to spend money, and the way that changes is a dependency.
  const paymentDependencies = dependencyNames.filter((name) => PAYMENT_SDK_PATTERN.test(name));

  if (paymentDependencies.length > 0) {
    blocker(
      `A payment / billing SDK is declared: ${paymentDependencies.join(', ')}`,
      'V1 ships NO payment, subscription, or in-app-purchase rail of any kind - not Midtrans, ' +
        'not a card processor, not Play Billing. Money changing hands also changes what must be ' +
        'declared in the Play Data safety form and which policies the listing is reviewed ' +
        'against. See src/services/entitlement/__tests__/v1-payment-boundary.test.ts.'
    );
  }

  // ADS. Required - and required to be REAL ads, not Google's watermarked
  // samples. The app id and the unit id are one decision: a build with one and
  // not the other cannot serve a real ad.
  const interstitialUnitAndroid = (
    env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID || ''
  ).trim();

  if (!interstitialUnitAndroid) {
    blocker(
      'EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID is not set',
      "`resolveAdUnitId` falls back to Google's published TEST interstitial when this is unset " +
        '(src/services/ads/interstitial-adapter.ts), so a store build would interrupt real users ' +
        'with a full-screen sample ad carrying a "Test Ad" watermark, earning nothing. That is ' +
        'the app showing fabricated content as its own monetization. The AdMob app id and the ad ' +
        'unit id are one decision: a build with one and not the other cannot serve a real ad.'
    );
  } else if (isGoogleSampleAdMobId(interstitialUnitAndroid)) {
    blocker(
      `EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID is a Google SAMPLE ad unit: "${interstitialUnitAndroid}"`,
      'Setting the variable is not the same as configuring it. Google\'s sample units serve ' +
        'watermarked "Test Ad" creatives against Google\'s own account: real users would be ' +
        'interrupted by a full-screen test ad and this app would earn nothing from any of them. ' +
        'Use the interstitial unit from the real AdMob app registered against ' +
        `${EXPECTED_ANDROID_PACKAGE}.`
    );
  }

  const interstitialUnitIos = (env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_IOS || '').trim();

  if (isGoogleSampleAdMobId(interstitialUnitIos)) {
    warning(
      `EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_IOS is a Google SAMPLE ad unit: "${interstitialUnitIos}"`,
      'Not an Android blocker - iOS is deferred past V1 - but it is the same mistake waiting ' +
        'for the iOS build. Leave it unset until a real iOS AdMob app exists.'
    );
  }

  // HLS. A kill switch, not a fallback: there is no MP4 rendition behind an
  // HLS-ready episode, so "disabled" means "unplayable", not "degraded".
  if (env.EXPO_PUBLIC_HLS_PLAYBACK_ENABLED === 'false') {
    blocker(
      'EXPO_PUBLIC_HLS_PLAYBACK_ENABLED=false',
      'HLS playback is a REQUIRED V1 feature and this is a kill switch, not a fallback: every ' +
        'HLS-backed episode resolves to "Video unavailable" with NO MP4 to fall back to, because ' +
        "an HLS-ready row's feed playbackUrl 404s for R2-backed media. A store build with this " +
        'set ships a video app that cannot play its videos. Intended only as a deliberate ' +
        'rollback. See src/services/videos/hls-playback-flag.ts.'
    );
  }

  // --- Resolved Expo config ------------------------------------------------

  const androidPackage = exp.android && exp.android.package;

  if (!androidPackage || androidPackage.startsWith('com.anonymous.')) {
    blocker(
      `Android package is still the Expo placeholder: "${androidPackage}"`,
      '`com.anonymous.*` is the scaffold default. It is permanent once published, and it is the ' +
        'identity the Google Cloud Android OAuth client and the AdMob app are registered against. ' +
        'Decide the real application id before any external build.'
    );
  } else if (androidPackage !== EXPECTED_ANDROID_PACKAGE) {
    // PACKAGE IDENTITY DRIFT. The application id is not just a name: the
    // Google OAuth Android client, the AdMob app and the Play listing are all
    // registered against it, and it can never be changed after the first
    // upload. A rename between two builds silently invalidates all three.
    blocker(
      `Android package drifted from the published identity: "${androidPackage}"`,
      `V1 is published as "${EXPECTED_ANDROID_PACKAGE}" (docs/play-store-v1-owner-checklist.md). ` +
        'The application id is permanent once uploaded, and the Google OAuth Android client, the ' +
        'AdMob app and the Play listing are all registered against it - a rename invalidates all ' +
        'three at once and cannot be undone on the store side. If the identity is genuinely ' +
        'changing, change it here in the same commit and re-register everything downstream.'
    );
  }

  const iosBundleIdentifier = exp.ios && exp.ios.bundleIdentifier;

  if (iosBundleIdentifier && iosBundleIdentifier.startsWith('com.anonymous.')) {
    warning(
      `iOS bundle identifier is still the Expo placeholder: "${iosBundleIdentifier}"`,
      'Not an Android blocker, but it should be settled in the same decision as the Android ' +
        'package (note the two are not even consistent with each other today).'
    );
  } else if (iosBundleIdentifier && androidPackage && iosBundleIdentifier !== androidPackage) {
    warning(
      `iOS bundle identifier "${iosBundleIdentifier}" does not match the Android package "${androidPackage}"`,
      'Not an Android blocker - iOS is deferred past V1 - but the two are meant to be one ' +
        'identity, and a mismatch discovered during the iOS build is a second round of OAuth and ' +
        'AdMob registration.'
    );
  }

  const adMobPlugin = (exp.plugins || []).find(
    (plugin) => Array.isArray(plugin) && plugin[0] === 'react-native-google-mobile-ads'
  );
  const adMobAndroidAppId = adMobPlugin && adMobPlugin[1] && adMobPlugin[1].androidAppId;

  if (isGoogleSampleAdMobId(adMobAndroidAppId)) {
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

  if (typeof exp.version !== 'string' || !/^\d+\.\d+\.\d+/.test(exp.version)) {
    blocker(
      `expo.version is not a dotted version string in app.json: ${exp.version}`,
      'This is `versionName` in the manifest and the version string Play shows to users. Unlike ' +
        'versionCode it is not required to be unique, but an absent or malformed one ships as ' +
        'whatever the template defaults to.'
    );
  }

  // --- Android release identity --------------------------------------------

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

  // `allowBackup="false"` above closes CLOUD backup. It does NOT close
  // device-to-device transfer: Android documents that for an app targeting
  // Android 12 or higher, that flag "disables cloud-based backup and restore
  // (such as Google Drive backups) but doesn't disable device-to-device
  // transfers for the app" on some manufacturers' devices. So on the ordinary
  // "set up the new phone from the old phone" path, the same AsyncStorage
  // database - access token and refresh token included - could still be copied
  // onto another handset. `plugins/with-android-data-extraction-rules.js` is
  // what answers that; these two rules keep it from silently disappearing.
  const isDataExtractionPluginRegistered = (exp.plugins || []).some(
    (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === ANDROID_DATA_EXTRACTION_PLUGIN
  );

  if (!isDataExtractionPluginRegistered) {
    blocker(
      `${ANDROID_DATA_EXTRACTION_PLUGIN} is not in app.json's plugins`,
      'Without it, `expo prebuild` emits no android:dataExtractionRules at all (Expo itself ' +
        'never writes one), and the release APK falls back to Android\'s default: every ' +
        'app-private domain is eligible for device-to-device transfer, AsyncStorage included. ' +
        'allowBackup="false" does not cover that case.'
    );
  } else if (typeof dataExtractionPolicyXml !== 'string') {
    // Registered but unloadable. Silence here would be the worst outcome: the
    // gate would pass on the strength of a plugin that cannot even be required.
    blocker(
      `${ANDROID_DATA_EXTRACTION_PLUGIN} is registered but its policy could not be read`,
      'The plugin must export `renderDataExtractionRules()` so this check can prove what the ' +
        'build would actually deny. A registration that cannot be evaluated is not evidence.'
    );
  } else {
    // Registration alone is not the property worth gating on: a plugin that is
    // listed but renders an empty <data-extraction-rules/> would pass it while
    // denying nothing. So the rendered policy is judged directly. It is a pure
    // function of the plugin's own constants, so this needs no build and no
    // generated android/ directory.
    const rulesBody = extractionRulesBody(dataExtractionPolicyXml);

    const missingRules = REQUIRED_EXTRACTION_SECTIONS.flatMap((section) => {
      const sectionBody = (
        rulesBody.match(new RegExp(`<${section}[^>]*>([\\s\\S]*?)</${section}>`)) || []
      )[1];

      if (sectionBody === undefined) {
        return [`${section} (section absent)`];
      }

      return REQUIRED_EXTRACTION_DOMAINS.filter(
        (domain) => !sectionBody.includes(`<exclude domain="${domain}"`)
      ).map((domain) => `${section}/${domain}`);
    });

    if (missingRules.length > 0) {
      blocker(
        `The Android data-extraction policy no longer denies: ${missingRules.join(', ')}`,
        'Both sections must exclude every backup domain. An ABSENT section is not a denial - ' +
          'Android falls back to copying everything for that destination - and exclusion is ' +
          'matched by EXACT path, so excluding `root` alone does not exclude `database`, which ' +
          'is where AsyncStorage (and the token pair) actually lives. See ' +
          `${ANDROID_DATA_EXTRACTION_PLUGIN}.`
      );
    }

    if (rulesBody.includes('<include')) {
      blocker(
        'The Android data-extraction policy has grown an <include> rule',
        'Excludes are the whole policy. A single include re-opens whatever it names, and an ' +
          'include for any domain makes Android skip every other domain\'s excludes entirely - ' +
          'so one added to whitelist a harmless preference would change what the other eight ' +
          'domains do. Persist a new preference somewhere it can be re-derived instead.'
      );
    }
  }

  // --- Secure session storage ----------------------------------------------
  //
  // Before this, `stores/auth.tsx` wrote `{ user, tokens }` straight into
  // AsyncStorage, so the access AND refresh token sat as plaintext JSON in
  // RKStorage. The rules below make that specific regression fail the gate.
  // See the constants block near the top of this file for why each one is
  // structural rather than a text search.

  if (!dependencyNames.includes(SECURE_STORE_MODULE)) {
    blocker(
      `${SECURE_STORE_MODULE} is not a dependency`,
      'It is the Keystore-backed store the session credentials live in: on Android it holds ' +
        'them as AES-256-GCM ciphertext under a key generated inside the Android Keystore. ' +
        'Without it there is nowhere for the access/refresh pair to go except AsyncStorage, ' +
        'which is a plain SQLite database this app must never put a bearer token in. ' +
        'Install it with `npx expo install expo-secure-store`.'
    );
  }

  // The plugin's own backup rules must stay switched off, or the app ships with
  // whichever android:dataExtractionRules won the merge - and its policy is an
  // include-based single-domain rule where this app denies all nine.
  const secureStorePluginEntry = (exp.plugins || []).find(
    (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === SECURE_STORE_PLUGIN
  );

  if (!secureStorePluginEntry) {
    blocker(
      `${SECURE_STORE_PLUGIN} is not registered in app.json's plugins`,
      'It must be registered explicitly WITH `{ "configureAndroidBackup": false }`. Left ' +
        'unregistered the module still autolinks, but nothing states which backup policy wins, ' +
        'and a future prebuild ordering change could let its own rules replace ' +
        `${ANDROID_DATA_EXTRACTION_PLUGIN}'s deny-all. Registering it with the flag off makes ` +
        'this app\'s policy the single, stated authority.'
    );
  } else if (
    !Array.isArray(secureStorePluginEntry) ||
    (secureStorePluginEntry[1] || {}).configureAndroidBackup !== false
  ) {
    blocker(
      `${SECURE_STORE_PLUGIN} is registered without \`configureAndroidBackup: false\``,
      'With the default (true) its plugin writes android:fullBackupContent and ' +
        'android:dataExtractionRules pointing at its OWN resource, whose policy is ' +
        '`<include domain="sharedpref" path="."/>` with one exclude for its own file. An ' +
        'include-based rule for one domain is strictly weaker than this app\'s nine-domain ' +
        `deny-all, and only one of the two attributes can survive. Set the flag to false so ` +
        `${ANDROID_DATA_EXTRACTION_PLUGIN} stays the only backup authority.`
    );
  }

  // The canonical boundary must exist and must be the ONLY importer. A second
  // importer is how "where do the tokens live" stops having one answer.
  if (!sessionSecretStoreSource) {
    blocker(
      `${SESSION_SECRET_STORE_PATH} is missing`,
      'It is the canonical session-secret boundary - the one module that may talk to ' +
        'expo-secure-store, and the one place the write-then-read-back verification the ' +
        'legacy migration depends on is implemented.'
    );
  } else if (!collectImportSpecifiers(sessionSecretStoreSource).includes(SECURE_STORE_MODULE)) {
    blocker(
      `${SESSION_SECRET_STORE_PATH} no longer imports ${SECURE_STORE_MODULE}`,
      'The boundary file exists but does not reach Keystore-backed storage, so whatever it ' +
        'now persists the session credentials to is not encrypted by the Android Keystore.'
    );
  }

  const straySecureStoreImporters = (secureStoreImporters || []).filter(
    (modulePath) => modulePath !== SESSION_SECRET_STORE_PATH
  );

  if (straySecureStoreImporters.length > 0) {
    blocker(
      `${SECURE_STORE_MODULE} is imported outside the session-secret boundary: ` +
        straySecureStoreImporters.join(', '),
      `Only ${SESSION_SECRET_STORE_PATH} may import it. Every other caller goes through ` +
        'services/auth/session-store.ts, so that failure handling, the read-back verification ' +
        'and the legacy migration are implemented once rather than re-decided per call site.'
    );
  }

  // The store must not be able to reach AsyncStorage at all. It holds the live
  // token pair, so this is what makes "the tokens are not in AsyncStorage" a
  // property of the code rather than of somebody having checked.
  if (authStoreSource) {
    const authStorageImports = collectImportSpecifiers(authStoreSource).filter((specifier) =>
      ASYNC_STORAGE_MODULES.includes(specifier)
    );

    if (authStorageImports.length > 0) {
      blocker(
        `${AUTH_STORE_PATH} imports AsyncStorage directly: ${authStorageImports.join(', ')}`,
        'It holds the live access/refresh pair in React state, so direct access to the ' +
          'plaintext store is exactly how the pair used to end up persisted there. Session ' +
          'persistence belongs to services/auth/session-store.ts, which sends the credentials ' +
          'to Keystore-backed storage and only the non-secret account fields to AsyncStorage.'
      );
    }
  }

  // The module that owns the AsyncStorage auth key must not so much as name a
  // token field. Comments are stripped first; see `stripComments`.
  if (persistedAccountSource) {
    const persistedAccountCode = stripComments(persistedAccountSource);
    const leakedFields = TOKEN_FIELD_NAMES.filter((field) =>
      persistedAccountCode.includes(field)
    );

    if (leakedFields.length > 0) {
      blocker(
        `${PERSISTED_ACCOUNT_PATH} references token material: ${leakedFields.join(', ')}`,
        'That module is the only writer of the "@mobile-app-ecc/auth" AsyncStorage key, and it ' +
          'exists to persist four non-secret account fields (id, name, username, email). Naming ' +
          'a token field there means one is being written to, or read from, the plaintext ' +
          'store. The pair belongs in services/auth/session-secret-store.ts.'
      );
    }
  }

  const blockedPermissions = (exp.android && exp.android.blockedPermissions) || [];
  const unblockedPermissions = UNUSED_MERGED_PERMISSIONS.filter(
    ([permission]) => !blockedPermissions.includes(permission)
  );

  for (const [permission, detail] of unblockedPermissions) {
    blocker(`${permission} is not in android.blockedPermissions`, detail);
  }

  // --- Release signing -----------------------------------------------------

  const missingSigningKeys = RELEASE_SIGNING_KEYS.filter(
    ([propertyKey, environmentKey]) =>
      !declaredKeystoreKeys.has(propertyKey) && !env[environmentKey]
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
  if (keystorePropertiesExists && !isKeystorePropertiesIgnored) {
    blocker(
      'keystore.properties exists but .gitignore does not ignore it',
      'It holds the release keystore passwords. Restore the `keystore.properties` line in ' +
        '.gitignore before running any other git command.'
    );
  }

  if (exp.name === 'mobile-app-ecc' || exp.slug === exp.name) {
    warning(
      `App display name is still the scaffold slug: "${exp.name}"`,
      'This is the label under the launcher icon. A product name belongs here before anyone ' +
        'outside the team installs it.'
    );
  }

  return { blockers, warnings };
}

// --- Fact gathering: the only part that touches the world -------------------

/**
 * Reads `keystore.properties` for the NAMES of the keys it declares. It never
 * reads a value: only the text to the left of the first `=` is ever captured,
 * so no password is loaded into this process, and none can be printed by any
 * message above.
 */
function readDeclaredKeystoreKeys(keystorePropertiesPath) {
  const declared = new Set();

  if (!fs.existsSync(keystorePropertiesPath)) {
    return declared;
  }

  for (const line of fs.readFileSync(keystorePropertiesPath, 'utf8').split('\n')) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) {
      continue;
    }

    const separator = trimmed.indexOf('=');

    if (separator > 0) {
      declared.add(trimmed.slice(0, separator).trim());
    }
  }

  return declared;
}

function readFileIfPresent(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function readReleaseFacts() {
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

  const { exp } = getConfig(projectRoot, {
    skipSDKVersionRequirement: true,
    isPublicConfig: true,
  });

  const manifest = JSON.parse(readFileIfPresent(path.join(projectRoot, 'package.json')) || '{}');

  const keystorePropertiesPath = path.join(projectRoot, 'keystore.properties');
  const keystorePropertiesExists = fs.existsSync(keystorePropertiesPath);

  return {
    env: process.env,
    exp,
    dependencyNames: Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    }),
    declaredKeystoreKeys: readDeclaredKeystoreKeys(keystorePropertiesPath),
    keystorePropertiesExists,
    isKeystorePropertiesIgnored: readFileIfPresent(path.join(projectRoot, '.gitignore'))
      .split('\n')
      .some((line) => line.trim() === 'keystore.properties'),
    rewardsRouteExists: fs.existsSync(
      path.join(projectRoot, 'src', 'app', '(tabs)', 'rewards.tsx')
    ),
    rewardsServiceSource: readFileIfPresent(
      path.join(projectRoot, 'src', 'services', 'rewards', 'rewards-service.ts')
    ),
    whatsAppServiceSource: readFileIfPresent(
      path.join(projectRoot, 'src', 'services', 'auth', 'provider-auth-service.ts')
    ),
    dataExtractionPolicyXml: readDataExtractionPolicy(),
    secureStoreImporters: collectSecureStoreImporters(),
    authStoreSource: readFileIfPresent(path.join(projectRoot, ...AUTH_STORE_PATH.split('/'))),
    persistedAccountSource: readFileIfPresent(
      path.join(projectRoot, ...PERSISTED_ACCOUNT_PATH.split('/'))
    ),
    sessionSecretStoreSource: readFileIfPresent(
      path.join(projectRoot, ...SESSION_SECRET_STORE_PATH.split('/'))
    ),
  };
}

/**
 * Every module under `src/` whose imports include `expo-secure-store`, as
 * repo-relative POSIX paths.
 *
 * WHY THE WHOLE TREE rather than a fixed list of files: the rule being checked
 * is that there is exactly ONE importer, and a rule that only looks at files it
 * already knows about cannot notice a NEW one - which is precisely the
 * regression it exists to catch.
 *
 * Test files are skipped. A suite that reaches for the module directly is
 * exercising the boundary, not bypassing it, and shipping code is what this
 * gate is about.
 */
function collectSecureStoreImporters() {
  const sourceRoot = path.join(projectRoot, 'src');
  const importers = [];

  if (!fs.existsSync(sourceRoot)) {
    return importers;
  }

  const pending = [sourceRoot];

  while (pending.length > 0) {
    const directory = pending.pop();

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'node_modules') {
          pending.push(absolutePath);
        }

        continue;
      }

      if (!/\.(ts|tsx|js|jsx)$/.test(entry.name) || /\.test\./.test(entry.name)) {
        continue;
      }

      if (collectImportSpecifiers(readFileIfPresent(absolutePath)).includes(SECURE_STORE_MODULE)) {
        importers.push(path.relative(projectRoot, absolutePath).split(path.sep).join('/'));
      }
    }
  }

  return importers.sort();
}

/**
 * Renders the Android data-extraction policy the plugin would write, WITHOUT
 * running a prebuild.
 *
 * `renderDataExtractionRules()` is a pure function of the plugin's own
 * constants, so what it returns here is byte-identical to what would land in
 * `android/app/src/main/res/xml/`. That is the point: the check reads the
 * canonical source (the plugin) rather than the gitignored `android/` tree,
 * which on any given machine reflects whatever the last prebuild happened to
 * be pointed at.
 *
 * Returns null rather than throwing when the plugin is missing or broken; the
 * contract turns that into its own blocker, so a preflight run never dies with
 * a stack trace where it should have printed a finding.
 */
function readDataExtractionPolicy() {
  try {
    const { renderDataExtractionRules } = require('../plugins/with-android-data-extraction-rules');

    return typeof renderDataExtractionRules === 'function' ? renderDataExtractionRules() : null;
  } catch {
    return null;
  }
}

// --- Report -----------------------------------------------------------------

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

function main() {
  const { blockers, warnings } = evaluateReleaseContract(readReleaseFacts());

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
}

module.exports = {
  evaluateReleaseContract,
  collectImportSpecifiers,
  isGoogleSampleAdMobId,
  isUsableLegalUrl,
  EXPECTED_ANDROID_PACKAGE,
  GOOGLE_SAMPLE_ADMOB_PUBLISHER,
  GOOGLE_WEB_CLIENT_ID_PATTERN,
  PAYMENT_SDK_PATTERN,
  ASYNC_STORAGE_MODULES,
  AUTH_STORE_PATH,
  PERSISTED_ACCOUNT_PATH,
  SECURE_STORE_MODULE,
  SECURE_STORE_PLUGIN,
  SESSION_SECRET_STORE_PATH,
  TOKEN_FIELD_NAMES,
  stripComments,
  RELEASE_SIGNING_KEYS,
  RELEASE_SIGNING_PLUGIN,
  RELEASE_UNSAFE_FLAGS,
  UNUSED_MERGED_PERMISSIONS,
  ANDROID_DATA_EXTRACTION_PLUGIN,
  REQUIRED_EXTRACTION_DOMAINS,
  REQUIRED_EXTRACTION_SECTIONS,
};

// Only runs the checks when invoked as a command, so the pure evaluator above
// can be imported by tests without loading `.env` into the test process.
if (require.main === module) {
  main();
}
