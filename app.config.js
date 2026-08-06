const packageJson = require('./package.json');

const ADMOB_MODULE = 'react-native-google-mobile-ads';

/**
 * app.json holds the production configuration. This file only subtracts from
 * it for the offline demo build, and refuses to let that subtraction leak into
 * a production build unnoticed.
 *
 * Background: the demo build drops the AdMob native module, because
 * `play-services-ads:25.4.0` ships Kotlin 2.3.0 metadata that this project's
 * Kotlin 2.1.0 toolchain cannot read, and every Android release build fails on
 * it. That exclusion lives in package.json's `expo.autolinking` block, which is
 * static JSON and cannot read an environment variable - so unlike the plugin
 * below, it cannot be switched off by a flag.
 *
 * Raising the toolchain through expo-build-properties (`android.kotlinVersion:
 * '2.3.0'`) was tried and does NOT resolve it; the compiler still reports 2.1.0.
 * Until that is fixed properly, the guard below turns a silent "production
 * shipped without ads" into a build that stops and says why.
 */
function isDemoBuild() {
  return process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
}

function isAdMobExcludedFromAutolinking() {
  return (packageJson.expo?.autolinking?.exclude ?? []).includes(ADMOB_MODULE);
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

    return config;
  }

  // Demo builds switch ads off and never mount the ads bridge, so the plugin's
  // manifest entries would point at a module that is not in the binary.
  return {
    ...config,
    plugins: (config.plugins ?? []).filter((plugin) => {
      const name = Array.isArray(plugin) ? plugin[0] : plugin;

      return name !== ADMOB_MODULE;
    }),
  };
};
