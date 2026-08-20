const packageJson = require('./package.json');

const ADMOB_MODULE = 'react-native-google-mobile-ads';
const GOOGLE_SIGN_IN_MODULE = '@react-native-google-signin/google-signin';

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

module.exports = ({ config }) => {
  if (!isDemoBuild()) {
    if (isAdMobExcludedFromAutolinking()) {
      throw new Error(
        `This branch excludes ${ADMOB_MODULE} from autolinking so the offline demo build can ` +
          'compile. A production build made from it would ship with no ads and report nothing. ' +
          `Before building for production: remove the "expo.autolinking.exclude" entry from ` +
          'package.json and fix the play-services-ads / Kotlin version conflict that made it ' +
          'necessary.'
      );
    }

    return withGoogleSignIn(config);
  }

  // Demo builds switch ads off and never mount the ads bridge, so the plugin's
  // manifest entries would point at a module that is not in the binary.
  return withGoogleSignIn({
    ...config,
    plugins: (config.plugins ?? []).filter((plugin) => {
      const name = Array.isArray(plugin) ? plugin[0] : plugin;

      return name !== ADMOB_MODULE;
    }),
  });
};
