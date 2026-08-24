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

function resolvePlugins(nodeEnv: NodeEnv | undefined): PluginEntry[] {
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

      plugins = withExpoConfig({ config: { plugins: ['expo-router'] } }).plugins ?? [];
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
});
