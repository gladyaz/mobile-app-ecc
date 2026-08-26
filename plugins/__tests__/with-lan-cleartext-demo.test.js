const {
  renderNetworkSecurityConfig,
  resolveCleartextHost,
  MAIN_NOTE,
  DEBUG_NOTE,
  DEV_SERVER_DOMAINS,
  RESOURCE_RELATIVE_PATH,
  DEBUG_RESOURCE_RELATIVE_PATH,
} = require('../with-lan-cleartext-demo');

// Regression coverage for the defect found during Android HLS runtime
// verification (2026-08-25): declaring `android:networkSecurityConfig` makes
// Android ignore the debug manifest's `usesCleartextTraffic="true"`, so a
// config listing only the API host blocked the Metro dev server on localhost
// and every `expo run:android` hung on the splash with "Unable to load
// script." The fix is a DEBUG-ONLY resource that also permits localhost; the
// release resource must stay exactly as narrow as it was.

const LAN_HOST = '192.168.110.144';

describe('network security config source sets', () => {
  test('writes the debug resource to the debug source set, not main', () => {
    expect(RESOURCE_RELATIVE_PATH).toContain(`${require('path').sep}main${require('path').sep}`);
    expect(DEBUG_RESOURCE_RELATIVE_PATH).toContain(`${require('path').sep}debug${require('path').sep}`);
    expect(DEBUG_RESOURCE_RELATIVE_PATH).not.toEqual(RESOURCE_RELATIVE_PATH);
  });
});

describe('renderNetworkSecurityConfig', () => {
  test('release config permits the API host and nothing else', () => {
    const xml = renderNetworkSecurityConfig([LAN_HOST], MAIN_NOTE);

    expect(xml).toContain(`<domain includeSubdomains="false">${LAN_HOST}</domain>`);
    expect(xml).not.toContain('localhost');
    expect(xml).not.toContain('127.0.0.1');
    expect(xml.match(/<domain /g)).toHaveLength(1);
  });

  test('debug config permits the API host AND the Metro dev server', () => {
    const xml = renderNetworkSecurityConfig([LAN_HOST, ...DEV_SERVER_DOMAINS], DEBUG_NOTE);

    expect(xml).toContain(`<domain includeSubdomains="false">${LAN_HOST}</domain>`);
    expect(xml).toContain('<domain includeSubdomains="false">localhost</domain>');
    expect(xml).toContain('<domain includeSubdomains="false">127.0.0.1</domain>');
  });

  test('every rendered config still opts in to cleartext for its domains only', () => {
    const xml = renderNetworkSecurityConfig([LAN_HOST, ...DEV_SERVER_DOMAINS], DEBUG_NOTE);

    expect(xml).toContain('<domain-config cleartextTrafficPermitted="true">');
    // No base-config: everything not listed keeps Android's cleartext-denied default.
    expect(xml).not.toContain('base-config');
  });
});

describe('resolveCleartextHost', () => {
  const originalUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalUrl;
    }
  });

  test('returns the hostname for an http backend', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = `http://${LAN_HOST}:3011`;

    expect(resolveCleartextHost()).toBe(LAN_HOST);
  });

  test('returns null for an https backend, so the plugin is a no-op in production', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.example.com';

    expect(resolveCleartextHost()).toBeNull();
  });

  test('returns null when unset', () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;

    expect(resolveCleartextHost()).toBeNull();
  });
});

// The three pure helpers above are the parts that regressed once. What none
// of them covers is the plugin FUNCTION - and the production-safety claim in
// its doc comment ("point a build at an https:// backend and this plugin adds
// no resource, no manifest attribute and no exemption") lives entirely there.
// Move the host check below the manifest mod and every test above still
// passes while a store build gains an android:networkSecurityConfig attribute.
jest.mock('expo/config-plugins', () => {
  const captured = { dangerous: [], manifest: [] };

  return {
    __captured: captured,
    withDangerousMod: jest.fn((config, [platform, action]) => {
      captured.dangerous.push({ platform, action });

      return config;
    }),
    withAndroidManifest: jest.fn((config, action) => {
      captured.manifest.push(action);

      return config;
    }),
    AndroidConfig: {
      Manifest: {
        // Mirrors the real helper's contract: hand back the single
        // <application> node the plugin is about to annotate.
        getMainApplicationOrThrow: (manifest) => manifest.manifest.application[0],
      },
    },
  };
});

describe('withLanCleartextDemo (the plugin function itself)', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  const withLanCleartextDemo = require('../with-lan-cleartext-demo');
  const { __captured: captured } = require('expo/config-plugins');

  const originalUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  const temporaryRoots = [];

  beforeEach(() => {
    captured.dangerous.length = 0;
    captured.manifest.length = 0;
  });

  afterEach(() => {
    if (originalUrl === undefined) {
      delete process.env.EXPO_PUBLIC_API_BASE_URL;
    } else {
      process.env.EXPO_PUBLIC_API_BASE_URL = originalUrl;
    }

    while (temporaryRoots.length > 0) {
      fs.rmSync(temporaryRoots.pop(), { force: true, recursive: true });
    }
  });

  /** A stand-in for the Expo config object the plugin is handed at prebuild. */
  function baseConfig() {
    return { name: 'Red Panda', slug: 'mobile-app-ecc' };
  }

  function runAndroidResourceMod() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'red-panda-cleartext-'));

    temporaryRoots.push(projectRoot);
    captured.dangerous[0].action({ modRequest: { platformProjectRoot: projectRoot } });

    const read = (relativePath) =>
      fs.readFileSync(path.join(projectRoot, relativePath), 'utf8');

    return {
      main: read(RESOURCE_RELATIVE_PATH),
      debug: read(DEBUG_RESOURCE_RELATIVE_PATH),
    };
  }

  /**
   * Reproduces the trap the removal branch exists for: a working tree that
   * built the internal LAN demo, then builds production without wiping
   * `android/`. `expo prebuild` regenerates that directory IN PLACE, so both
   * the resource and the manifest attribute are already there.
   */
  function seedPreviousLanPrebuild() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'red-panda-cleartext-'));

    temporaryRoots.push(projectRoot);

    for (const relativePath of [RESOURCE_RELATIVE_PATH, DEBUG_RESOURCE_RELATIVE_PATH]) {
      const resourcePath = path.join(projectRoot, relativePath);

      fs.mkdirSync(path.dirname(resourcePath), { recursive: true });
      fs.writeFileSync(resourcePath, renderNetworkSecurityConfig([LAN_HOST], MAIN_NOTE), 'utf8');
    }

    return projectRoot;
  }

  function exists(projectRoot, relativePath) {
    return fs.existsSync(path.join(projectRoot, relativePath));
  }

  describe('production (https backend)', () => {
    beforeEach(() => {
      process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.redpanda.example';
      withLanCleartextDemo(baseConfig());
    });

    test('grants no exemption: nothing is written for a clean project', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'red-panda-cleartext-'));

      temporaryRoots.push(projectRoot);
      captured.dangerous[0].action({ modRequest: { platformProjectRoot: projectRoot } });

      expect(exists(projectRoot, RESOURCE_RELATIVE_PATH)).toBe(false);
      expect(exists(projectRoot, DEBUG_RESOURCE_RELATIVE_PATH)).toBe(false);
    });

    test('DELETES a resource left behind by a previous LAN prebuild', () => {
      // The load-bearing case. Returning early instead would leave a
      // production APK carrying a cleartext permission for a private LAN
      // address, purely because nobody wiped android/ in between.
      const projectRoot = seedPreviousLanPrebuild();

      expect(exists(projectRoot, RESOURCE_RELATIVE_PATH)).toBe(true);

      captured.dangerous[0].action({ modRequest: { platformProjectRoot: projectRoot } });

      expect(exists(projectRoot, RESOURCE_RELATIVE_PATH)).toBe(false);
      expect(exists(projectRoot, DEBUG_RESOURCE_RELATIVE_PATH)).toBe(false);
    });

    test('leaves a network_security_config it did not generate alone', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'red-panda-cleartext-'));
      const resourcePath = path.join(projectRoot, RESOURCE_RELATIVE_PATH);
      const handWritten =
        '<network-security-config><!-- somebody else --></network-security-config>';

      temporaryRoots.push(projectRoot);
      fs.mkdirSync(path.dirname(resourcePath), { recursive: true });
      fs.writeFileSync(resourcePath, handWritten, 'utf8');

      captured.dangerous[0].action({ modRequest: { platformProjectRoot: projectRoot } });

      expect(fs.readFileSync(resourcePath, 'utf8')).toBe(handWritten);
    });

    test('clears an android:networkSecurityConfig left on the manifest', () => {
      const manifestConfig = {
        modResults: {
          manifest: {
            application: [
              { $: { 'android:networkSecurityConfig': '@xml/network_security_config' } },
            ],
          },
        },
      };

      const result = captured.manifest[0](manifestConfig);

      expect(result.modResults.manifest.application[0].$).not.toHaveProperty(
        'android:networkSecurityConfig'
      );
    });

    test("does not touch a networkSecurityConfig pointing at somebody else's resource", () => {
      const manifestConfig = {
        modResults: {
          manifest: { application: [{ $: { 'android:networkSecurityConfig': '@xml/other' } }] },
        },
      };

      const result = captured.manifest[0](manifestConfig);

      expect(result.modResults.manifest.application[0].$['android:networkSecurityConfig']).toBe(
        '@xml/other'
      );
    });

    test('never sets the application-wide usesCleartextTraffic flag', () => {
      const manifestConfig = { modResults: { manifest: { application: [{ $: {} }] } } };

      const result = captured.manifest[0](manifestConfig);

      expect(result.modResults.manifest.application[0].$).toEqual({});
    });
  });

  test('also withdraws the exemption when no backend URL is configured at all', () => {
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    withLanCleartextDemo(baseConfig());

    const projectRoot = seedPreviousLanPrebuild();

    captured.dangerous[0].action({ modRequest: { platformProjectRoot: projectRoot } });

    expect(exists(projectRoot, RESOURCE_RELATIVE_PATH)).toBe(false);
  });

  describe('internal LAN demo (http backend)', () => {
    beforeEach(() => {
      process.env.EXPO_PUBLIC_API_BASE_URL = `http://${LAN_HOST}:3011`;
      withLanCleartextDemo(baseConfig());
    });

    test('registers the resource write against the android platform', () => {
      expect(captured.dangerous).toHaveLength(1);
      expect(captured.dangerous[0].platform).toBe('android');
    });

    test('the RELEASE resource permits the LAN host only - never localhost, never a base-config', () => {
      const { main } = runAndroidResourceMod();

      expect(main).toContain(`<domain includeSubdomains="false">${LAN_HOST}</domain>`);
      expect(main).not.toContain('localhost');
      expect(main).not.toContain('127.0.0.1');
      expect(main).not.toContain('base-config');
      expect(main.match(/<domain /g)).toHaveLength(1);
    });

    test('the DEBUG resource adds the Metro dev server, and only there', () => {
      const { debug } = runAndroidResourceMod();

      expect(debug).toContain(`<domain includeSubdomains="false">${LAN_HOST}</domain>`);
      for (const domain of DEV_SERVER_DOMAINS) {
        expect(debug).toContain(`<domain includeSubdomains="false">${domain}</domain>`);
      }
      expect(debug).not.toContain('base-config');
    });

    test('points the manifest at the generated resource without setting usesCleartextTraffic', () => {
      const manifestConfig = {
        modResults: { manifest: { application: [{ $: {} }] }, },
      };

      const result = captured.manifest[0](manifestConfig);
      const application = result.modResults.manifest.application[0].$;

      expect(application['android:networkSecurityConfig']).toBe('@xml/network_security_config');
      // The application-wide flag would permit plaintext to ANY host in ANY
      // build; the whole point of the scoped resource is not to need it.
      expect(application['android:usesCleartextTraffic']).toBeUndefined();
    });
  });

  test('refuses a malformed backend URL loudly rather than silently skipping the exemption', () => {
    process.env.EXPO_PUBLIC_API_BASE_URL = 'not-a-url';

    expect(() => withLanCleartextDemo(baseConfig())).toThrow(/not a valid URL/);
  });
});
