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
