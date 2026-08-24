/**
 * Pins what `app.config.js` subtracts from a SHIPPABLE build.
 *
 * `/_sitemap` is an expo-router-generated route listing every route in the app
 * plus a "System Information" panel. It used to be removed only from demo
 * builds, which was backwards: the demo APK went to a known partner while the
 * Play Store build went to everyone, and only the former had it stripped. The
 * gate now keys off the development server instead, and this is the test that
 * keeps it that way - the mistake is invisible until someone opens
 * `mobileappecc://_sitemap` on a shipped install.
 */
const APP_CONFIG_PATH = '../../../../app.config.js';

type PluginEntry = string | [string, Record<string, unknown>];

type NodeEnv = NodeJS.ProcessEnv['NODE_ENV'];

// `@types/node` declares NODE_ENV as a required union, so neither `delete` nor
// an assignment type-checks against `process.env` directly. This view is the
// narrowest thing that expresses what the test actually does to it.
const mutableEnv = process.env as { NODE_ENV?: NodeEnv };

function resolvePlugins(
  nodeEnv: NodeEnv | undefined,
  inputPlugins: PluginEntry[] = ['expo-router']
): PluginEntry[] {
  const savedNodeEnv = mutableEnv.NODE_ENV;

  if (nodeEnv === undefined) {
    delete mutableEnv.NODE_ENV;
  } else {
    mutableEnv.NODE_ENV = nodeEnv;
  }

  try {
    let plugins: PluginEntry[] = [];

    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const withExpoConfig = require(APP_CONFIG_PATH) as (input: {
        config: { plugins: PluginEntry[] };
      }) => { plugins?: PluginEntry[] };

      plugins = withExpoConfig({ config: { plugins: inputPlugins } }).plugins ?? [];
    });

    return plugins;
  } finally {
    if (savedNodeEnv === undefined) {
      delete mutableEnv.NODE_ENV;
    } else {
      mutableEnv.NODE_ENV = savedNodeEnv;
    }
  }
}

function sitemapProp(plugins: PluginEntry[]): unknown {
  const entry = plugins.find(
    (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'expo-router'
  );

  return Array.isArray(entry) ? entry[1]?.sitemap : undefined;
}

describe('app.config.js release boundary', () => {
  // The config warns, by design, that the Google Sign-In plugin is skipped
  // without an iOS URL scheme. That is correct behaviour and irrelevant here -
  // silenced so a real warning from this file would stand out.
  let warnSpy: jest.SpyInstance;

  beforeAll(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterAll(() => {
    warnSpy.mockRestore();
  });

  it('strips /_sitemap from a production build', () => {
    expect(sitemapProp(resolvePlugins('production'))).toBe(false);
  });

  it('strips /_sitemap when NODE_ENV is unset, so an unrecognised build fails safe', () => {
    expect(sitemapProp(resolvePlugins(undefined))).toBe(false);
  });

  it('keeps /_sitemap for the development server', () => {
    expect(sitemapProp(resolvePlugins('development'))).toBeUndefined();
  });

  it('keeps Google\'s sample AdMob ids when no real app id is configured', () => {
    // The committed default is the SAMPLE publisher, and it has to be
    // something: the native SDK's MobileAdsInitProvider is a ContentProvider
    // that crashes on launch when the app id resolves to an empty string. The
    // preflight is what stops the fallback reaching a store artifact.
    const plugins = resolvePlugins('production', [
      'expo-router',
      ['react-native-google-mobile-ads', { androidAppId: 'ca-app-pub-3940256099942544~3347511713' }],
    ]);
    const admob = plugins.find(
      (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === 'react-native-google-mobile-ads'
    );

    expect(Array.isArray(admob) && admob[1].androidAppId).toMatch(/^ca-app-pub-3940256099942544/);
  });

  // NOT TESTED HERE: that EXPO_PUBLIC_ADMOB_ANDROID_APP_ID actually substitutes.
  // `babel-preset-expo`'s inline-env-vars plugin rewrites static
  // `process.env.EXPO_PUBLIC_*` member expressions during transform, so
  // app.config.js loaded through Jest never sees a value this file assigns -
  // a case written here would pass or fail for reasons unrelated to the code.
  // It is verified instead against the real Expo config resolver in plain Node,
  // which is how a build reads it:
  //
  //   EXPO_PUBLIC_ADMOB_ANDROID_APP_ID=ca-app-pub-XXXX~YYYY \
  //     node -e "console.log(require('expo/config').getConfig(process.cwd(),
  //       { skipSDKVersionRequirement: true, isPublicConfig: true })
  //       .exp.plugins.find(p => Array.isArray(p) &&
  //         p[0] === 'react-native-google-mobile-ads')[1].androidAppId)"
  //
  // and `npm run release:preflight` reads the same resolved config, so its
  // blocker clearing IS the end-to-end proof.
});