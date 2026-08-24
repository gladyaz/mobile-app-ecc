const fs = require('fs');
const path = require('path');

const packageJson = require('./package.json');

const ADMOB_MODULE = 'react-native-google-mobile-ads';
const GOOGLE_SIGN_IN_MODULE = '@react-native-google-signin/google-signin';

/**
 * The gitignored directories holding the offline showcase's bundled clips and
 * posters. Kept in step with the same list in `metro.config.js`, which is what
 * makes a build WITHOUT them possible at all.
 */
const BUNDLED_DEMO_MEDIA_DIRECTORIES = ['assets/videos', 'assets/thumbnails'];

/**
 * Google's published SAMPLE AdMob publisher prefix. `app.json` ships this
 * publisher's test app ids, which is the only safe committed default: the
 * native SDK's `MobileAdsInitProvider` is a ContentProvider that runs before
 * `Application.onCreate`, and it CRASHES ON LAUNCH when
 * `com.google.android.gms.ads.APPLICATION_ID` resolves to an empty string. So
 * there must always be some id; the question is only whether it is the real one.
 */
const GOOGLE_SAMPLE_ADMOB_PUBLISHER = 'ca-app-pub-3940256099942544';


/**
 * The reversed iOS OAuth client ID (`com.googleusercontent.apps.<id>`).
 * A public client identifier, not a secret - but still project-specific, so
 * it comes from the environment and is never committed. See .env.example.
 */
const GOOGLE_IOS_URL_SCHEME_ENV_KEY = 'EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME';

/**
 * app.json holds the production configuration. This file only subtracts from
 * it for the offline demo build, and refuses to let that subtraction leak into
 * a production build unnoticed.
 *
 * Background: the demo build used to drop the AdMob native module because
 * `play-services-ads:25.4.0` ships Kotlin 2.3.0 metadata that a 2.1.x
 * toolchain cannot read. That conflict is FIXED: the root Kotlin Gradle
 * plugin is pinned to 2.2.21 (see plugins/with-root-kotlin-gradle-plugin.js
 * for why expo-build-properties alone could not do it), so the exclusion is
 * no longer needed and package.json no longer carries it.
 *
 * The guard below stays: the exclusion lives in package.json's
 * `expo.autolinking` block, which is static JSON that cannot read an
 * environment variable - so if anyone ever reintroduces it, this turns a
 * silent "production shipped without ads" into a build that stops and says
 * why.
 */
function isDemoBuild() {
  return process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
}

function isAdMobExcludedFromAutolinking() {
  return (packageJson.expo?.autolinking?.exclude ?? []).includes(ADMOB_MODULE);
}

/**
 * True when this build intends to serve the BUNDLED catalog rather than the
 * backend - the offline showcase, or a mock-data build for UI work.
 */
function usesBundledCatalog() {
  return (
    process.env.EXPO_PUBLIC_DEMO_MODE === 'true' ||
    process.env.EXPO_PUBLIC_USE_MOCK_DATA === 'true'
  );
}

/**
 * Refuses a build that asked for the bundled catalog while the media it is
 * made of is not on disk.
 *
 * `metro.config.js` resolves the bundled-media `require`s to an empty module
 * when those gitignored directories are absent. That is what lets a PRODUCTION
 * build compile at all (before it, `expo export --platform android` failed on
 * a clean checkout with "Unable to resolve module
 * ../../assets/videos/pewaris-ep-1.mp4") and what keeps ~62 MB of demo clips
 * out of a release APK. But the same leniency, applied to a build that
 * actually intends to PLAY those clips, would produce a demo APK whose every
 * item resolves to an empty URI and renders "Video unavailable" - a build that
 * installs fine and shows nothing.
 *
 * So the leniency is scoped here: absent media is fine for a build that reads
 * its catalog from the backend, and a hard, explained stop for one that does
 * not. Regenerate the clips (see the ffmpeg command in the demo commit
 * message) or drop the flag.
 */
function assertBundledCatalogMediaPresent() {
  if (!usesBundledCatalog()) {
    return;
  }

  const missingDirectories = BUNDLED_DEMO_MEDIA_DIRECTORIES.filter(
    (relativePath) => !fs.existsSync(path.join(__dirname, relativePath))
  );

  if (missingDirectories.length === 0) {
    return;
  }

  throw new Error(
    'This build sets EXPO_PUBLIC_DEMO_MODE=true or EXPO_PUBLIC_USE_MOCK_DATA=true, so it ' +
      'serves the bundled catalog instead of the backend - but the media that catalog is ' +
      `made of is missing: ${missingDirectories.join(', ')}. Those directories are ` +
      'gitignored (~62 MB of binaries; regenerate them with the ffmpeg command in the demo ' +
      'commit message). Building anyway would produce an app whose every bundled item ' +
      'resolves to an empty URI and shows "Video unavailable". For a PRODUCTION build, ' +
      'unset both flags instead: a production build reads its catalog from ' +
      'EXPO_PUBLIC_API_BASE_URL and needs none of this media.'
  );
}

/**
 * Adds the Google Sign-In config plugin only when this machine/build has an
 * iOS URL scheme to give it.
 *
 * The plugin THROWS without an `iosUrlScheme` (its own `validateOptions`),
 * and with no options at all it switches to its Firebase path and expects
 * `google-services.json` / `GoogleService-Info.plist` - neither of which
 * this repository ships or should. Listing it unconditionally would
 * therefore break `expo prebuild` for every checkout that has no Google
 * project yet, which is all of them today.
 *
 * Skipping it is safe and bounded: on Android the native module autolinks
 * and takes its web client ID at runtime, so Google sign-in still works
 * there. Only iOS needs this scheme registered, so only iOS is affected,
 * and the warning below says exactly that instead of failing silently.
 */
function withGoogleSignIn(config) {
  // Static access, matching the rule `expo/no-dynamic-env-var` enforces in
  // src/: the constant above exists for the message, not for the lookup.
  const iosUrlScheme = process.env.EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME;

  if (!iosUrlScheme) {
    console.warn(
      `[app.config] ${GOOGLE_IOS_URL_SCHEME_ENV_KEY} is not set, so the ` +
        `${GOOGLE_SIGN_IN_MODULE} config plugin is not applied. Android Google ` +
        'sign-in still works (the native module autolinks and reads ' +
        'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID at runtime); iOS will not, until this ' +
        'is set to the reversed iOS client ID and the app is prebuilt again. ' +
        'See .env.example.'
    );

    return config;
  }

  return {
    ...config,
    plugins: [...(config.plugins ?? []), [GOOGLE_SIGN_IN_MODULE, { iosUrlScheme }]],
  };
}

const EXPO_ROUTER_PLUGIN = 'expo-router';

/**
 * True only while the Expo development server is running.
 *
 * `expo start` is the ONLY command that sets this - it calls
 * `setNodeEnv('development')` (see
 * `@expo/cli/build/src/start/index.js`, `setNodeEnv(!args['--no-dev'] ?
 * 'development' : 'production')`). Every command that produces a shippable
 * artifact - `expo export`, `expo export:embed` (which is what
 * `assembleRelease` runs), `expo prebuild`, an EAS build - leaves it unset or
 * sets it to `production`.
 *
 * Written as "is this the dev server?" rather than "is this production?" so
 * the UNKNOWN case fails safe: an unrecognised invocation is treated as
 * shippable and loses the development-only surface, rather than keeping it.
 */
function isDevelopmentServer() {
  return process.env.NODE_ENV === 'development';
}

/**
 * Removes `/_sitemap` from every build that is not the development server.
 *
 * `expo-router` registers a generated `_sitemap` route that lists every
 * route in the app plus a "System Information" panel (NODE_ENV, Expo SDK
 * version, Hermes version). It ships in RELEASE builds, and the app
 * declares a URL scheme, so it stays reachable in an installed APK via
 * `mobileappecc://_sitemap` - an internal route inventory, one deep link
 * away, in an artifact handed to people outside the team.
 *
 * `expo-router/build/global-state/utils.js` gates it on
 * `Constants.expoConfig.extra.router.sitemap !== false`, and that value
 * comes from this plugin's own props - so setting it here removes the route
 * from the root stack AND from the linking config.
 *
 * This used to be scoped to DEMO builds only, which was exactly backwards for
 * store distribution: the demo APK - handed to a known founder or partner -
 * had the route removed, while a PRODUCTION release installed from Google Play
 * by an ordinary user kept it. `/_sitemap` is a genuinely useful development
 * affordance, so it is kept for `expo start` and taken away from everything
 * else, which is the same gate `services/debug/internal-screens.ts` applies to
 * `/processing` for the same reason.
 */
function withoutSitemap(config) {
  return {
    ...config,
    plugins: (config.plugins ?? []).map((plugin) => {
      const [name, props] = Array.isArray(plugin) ? plugin : [plugin, {}];

      return name === EXPO_ROUTER_PLUGIN ? [name, { ...props, sitemap: false }] : plugin;
    }),
  };
}

/**
 * Replaces the committed sample AdMob app ids with this build's real ones.
 *
 * The app id is a project-specific PUBLIC identifier - it ships inside every
 * binary by design and is not a secret - which is exactly the category
 * `.env.example` already keeps out of committed source for the OAuth client ids
 * and the interstitial ad UNIT id. Reading it from the environment makes the
 * app id and the unit id one decision instead of two: a build cannot end up
 * with a real unit and a sample app, or the reverse, and supplying them is a
 * configuration step rather than an edit to a tracked file that would put one
 * AdMob account's identity in everyone's checkout.
 *
 * Absent, the sample ids stay. That is deliberate and safe - no ad is served
 * against them that earns anything, and `npm run release:preflight` BLOCKS on
 * the sample publisher, so the fallback cannot reach a store artifact quietly.
 */
function withAdMobAppIds(config) {
  // Static member access, matching the rule `expo/no-dynamic-env-var` enforces
  // in src/.
  const androidAppId = process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID;
  const iosAppId = process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID;

  if (!androidAppId && !iosAppId) {
    return config;
  }

  return {
    ...config,
    plugins: (config.plugins ?? []).map((plugin) => {
      if (!Array.isArray(plugin) || plugin[0] !== ADMOB_MODULE) {
        return plugin;
      }

      return [
        plugin[0],
        {
          ...plugin[1],
          ...(androidAppId ? { androidAppId } : {}),
          ...(iosAppId ? { iosAppId } : {}),
        },
      ];
    }),
  };
}

module.exports = ({ config }) => {
  assertBundledCatalogMediaPresent();

  const isAdMobUnlinked = isAdMobExcludedFromAutolinking();

  if (!isDemoBuild() && isAdMobUnlinked) {
    throw new Error(
      `This branch excludes ${ADMOB_MODULE} from autolinking so the offline demo build can ` +
        'compile. A production build made from it would ship with no ads and report nothing. ' +
        `Before building for production: remove the "expo.autolinking.exclude" entry from ` +
        'package.json and fix the play-services-ads / Kotlin version conflict that made it ' +
        'necessary.'
    );
  }

  // WHETHER THE ADMOB PLUGIN MAY BE DROPPED TURNS ON ONE THING ONLY: whether
  // the native module is in the binary. So it is keyed off autolinking, NOT
  // off demo mode.
  //
  // This used to filter on `isDemoBuild()`, and back then that was the same
  // question - a demo build also excluded the module from autolinking. It no
  // longer does (see the note on `isDemoBuild` above: the Kotlin conflict
  // that forced the exclusion is fixed, and package.json no longer carries
  // it). Filtering on demo mode alone would now strip
  // `com.google.android.gms.ads.APPLICATION_ID` while LEAVING the SDK
  // linked, and `react-native-google-mobile-ads/android/build.gradle`
  // resolves the `appJSONGoogleMobileAdsAppID` manifest placeholder to an
  // empty string when it finds no app id. `MobileAdsInitProvider` is a
  // ContentProvider, so it runs before `Application.onCreate` and before any
  // JavaScript: the demo APK would crash on launch. That build file says so
  // itself - "The native Google Mobile Ads SDK will crash on startup
  // without it."
  //
  // Keeping the plugin costs a demo build nothing. The app ids in app.json
  // are Google's published TEST ids, `_layout.tsx` does not mount
  // <AdsBridge/> under demo mode, and `ads-config-service.ts` reports ads
  // disabled - so no ad is ever requested. The meta-data is present purely
  // to satisfy the SDK's own start-up requirement.
  const withAdMobResolved = isAdMobUnlinked
    ? {
        ...config,
        plugins: (config.plugins ?? []).filter((plugin) => {
          const name = Array.isArray(plugin) ? plugin[0] : plugin;

          return name !== ADMOB_MODULE;
        }),
      }
    : config;

  const withSitemapResolved = isDevelopmentServer()
    ? withAdMobResolved
    : withoutSitemap(withAdMobResolved);

  return withGoogleSignIn(withAdMobAppIds(withSitemapResolved));
};
