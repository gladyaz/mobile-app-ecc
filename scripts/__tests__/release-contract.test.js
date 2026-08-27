/**
 * Proves that a Play Store release CANNOT be cut with any of the nine
 * configurations that would embarrass or break V1.
 *
 * WHY THESE ARE UNIT TESTS AND NOT A SUBPROCESS RUN OF THE PREFLIGHT.
 * `scripts/check-release-android.js` reads `.env` through `@expo/env`, the
 * resolved Expo config, and `keystore.properties` from the repository root.
 * Shelling out to it would test whatever happens to be on the machine running
 * the suite: a developer who has created a real `keystore.properties` (the
 * docs tell them to, and it is gitignored so CI never has one) would see the
 * debug-signing case pass for the wrong reason, and a stray `.env` would
 * decide half the others. So the script exposes `evaluateReleaseContract`,
 * which is PURE, and every case below hands it a world it fully controls.
 *
 * Each case perturbs exactly ONE fact away from a release that passes, so a
 * failure names the rule that broke rather than "something is wrong". The
 * first test pins the passing world itself: without it every case below could
 * pass because the contract rejects everything.
 *
 * NOTHING HERE IS A REAL CREDENTIAL. Every value is visibly synthetic and
 * points at `.invalid`/`.example`, the reserved names that can never resolve.
 */
const {
  evaluateReleaseContract,
  collectImportSpecifiers,
  EXPECTED_ANDROID_PACKAGE,
  GOOGLE_SAMPLE_ADMOB_PUBLISHER,
  ANDROID_DATA_EXTRACTION_PLUGIN,
  REQUIRED_EXTRACTION_DOMAINS,
  REQUIRED_EXTRACTION_SECTIONS,
} = require('../check-release-android.js');

const {
  renderDataExtractionRules,
} = require('../../plugins/with-android-data-extraction-rules.js');

/**
 * A build that satisfies the whole V1 contract. Synthetic throughout - the ids
 * below are shaped like the real thing so the format checks are exercised, and
 * belong to nobody.
 */
const VALID_ENV = {
  EXPO_PUBLIC_API_BASE_URL: 'https://api.redpanda.example',
  EXPO_PUBLIC_PRIVACY_POLICY_URL: 'https://redpanda.example/privacy',
  EXPO_PUBLIC_ACCOUNT_DELETION_URL: 'https://redpanda.example/account-deletion',
  EXPO_PUBLIC_TERMS_URL: 'https://redpanda.example/terms',
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID:
    '408130275874-b9j3k2m1n4p5q6r7s8t9u0v1w2x3y4z5.apps.googleusercontent.com',
  EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID: 'ca-app-pub-7654321098765432/1234512345',
  // Release signing supplied through the environment rather than a file, so
  // these cases never depend on whether the machine has a keystore.properties.
  ANDROID_RELEASE_STORE_FILE: 'upload-keystore.jks',
  ANDROID_RELEASE_STORE_PASSWORD: 'test-only-not-a-secret',
  ANDROID_RELEASE_KEY_ALIAS: 'upload',
  ANDROID_RELEASE_KEY_PASSWORD: 'test-only-not-a-secret',
};

const VALID_EXP = {
  name: 'Red Panda',
  slug: 'mobile-app-ecc',
  version: '1.0.0',
  ios: { bundleIdentifier: EXPECTED_ANDROID_PACKAGE },
  android: {
    package: EXPECTED_ANDROID_PACKAGE,
    versionCode: 1,
    allowBackup: false,
    blockedPermissions: [
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  plugins: [
    'expo-router',
    './plugins/with-android-release-signing',
    './plugins/with-android-data-extraction-rules',
    ['react-native-google-mobile-ads', { androidAppId: 'ca-app-pub-7654321098765432~1122334455' }],
  ],
};

const VALID_FACTS = {
  env: VALID_ENV,
  exp: VALID_EXP,
  dependencyNames: ['expo', 'react-native', 'react-native-google-mobile-ads', 'zustand'],
  declaredKeystoreKeys: new Set(),
  keystorePropertiesExists: false,
  isKeystorePropertiesIgnored: true,
  rewardsRouteExists: true,
  rewardsServiceSource:
    "import { request } from '@/services/api/client';\n" +
    "request('rewards/snapshot', { method: 'GET' });\n",
  whatsAppServiceSource:
    "import { request } from '@/services/api/client';\n" +
    "request('auth/whatsapp/otp/request');\n" +
    "request('auth/whatsapp/otp/verify');\n",
  // The REAL rendered policy, not a fixture. It is a pure function of the
  // plugin's constants, so using it here means the passing world below is
  // asserting that what the plugin actually renders today satisfies the gate -
  // a hand-written stand-in could drift from the plugin and hide that.
  dataExtractionPolicyXml: renderDataExtractionRules(),
};

/** Evaluates the passing world with `overrides` merged over it. */
function evaluate(overrides = {}) {
  return evaluateReleaseContract({
    ...VALID_FACTS,
    ...overrides,
    env: { ...VALID_ENV, ...(overrides.env ?? {}) },
    exp: { ...VALID_EXP, ...(overrides.exp ?? {}) },
  });
}

/** The blocker titles, so a failure message shows what actually fired. */
function blockerTitles(result) {
  return result.blockers.map((entry) => entry.title);
}

function expectBlocked(result, pattern) {
  const titles = blockerTitles(result);

  expect(titles.filter((title) => pattern.test(title)).join(' | ')).toMatch(pattern);
}

describe('release contract: the passing world', () => {
  it('lets a fully configured V1 release through with no blockers', () => {
    // Load-bearing. Every case below asserts a blocker APPEARS; if the
    // contract rejected everything they would all pass while the preflight
    // was unusable. This is the test that says the gate can be opened.
    expect(blockerTitles(evaluate())).toEqual([]);
  });

  it('still warns that the WhatsApp backend credential is owed', () => {
    // Offered is correct for V1. The server half is a credential this
    // repository cannot supply, so it stays a warning and never a blocker.
    expect(evaluate().warnings.map((entry) => entry.title)).toEqual([
      'WhatsApp sign-in is offered (EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED is not "false")',
    ]);
  });
});

describe('release contract: a release cannot ship pointed at the build machine', () => {
  it.each([
    'http://localhost:3000',
    'https://localhost:3000',
    'http://127.0.0.1:3000',
    'http://10.0.2.2:3000',
  ])('blocks a localhost API base URL: %s', (apiBaseUrl) => {
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_API_BASE_URL: apiBaseUrl } }),
      /points at the build machine/
    );
  });

  it.each([
    'http://192.168.1.42:3000',
    'https://192.168.1.42:3000',
    'http://10.1.2.3:3000',
    'http://172.16.0.9:3000',
  ])('blocks a private LAN API base URL: %s', (apiBaseUrl) => {
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_API_BASE_URL: apiBaseUrl } }),
      /is a private LAN address/
    );
  });

  it('blocks a cleartext http backend even on a public hostname', () => {
    // http is what makes plugins/with-lan-cleartext-demo.js write a
    // network_security_config exemption into the artifact.
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_API_BASE_URL: 'http://api.redpanda.example' } }),
      /is not https/
    );
  });

  it('blocks a missing API base URL', () => {
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_API_BASE_URL: undefined } }),
      /EXPO_PUBLIC_API_BASE_URL is not set/
    );
  });
});

describe('release contract: a release cannot ship in demo or mock mode', () => {
  it.each([
    'EXPO_PUBLIC_DEMO_MODE',
    'EXPO_PUBLIC_USE_MOCK_DATA',
    'EXPO_PUBLIC_INCLUDE_QA_FIXTURES',
  ])('blocks %s=true', (flag) => {
    expectBlocked(evaluate({ env: { [flag]: 'true' } }), new RegExp(`^${flag}=true$`));
  });

  it('blocks a rewards service that imports fabricated data', () => {
    // Distinct from the flags above: a mock path compiled into the service
    // itself is one no configuration can switch off.
    expectBlocked(
      evaluate({
        rewardsServiceSource:
          "import { MOCK_REWARDS } from '@/data/mock-rewards';\nrequest('rewards/snapshot');",
      }),
      /imports a mock\/fixture module/
    );
  });

  it('blocks a rewards service that stopped reading the backend snapshot', () => {
    expectBlocked(
      evaluate({ rewardsServiceSource: "import { request } from '@/services/api/client';" }),
      /no longer reads rewards\/snapshot/
    );
  });

  it('blocks a build whose Rewards tab route is missing', () => {
    expectBlocked(evaluate({ rewardsRouteExists: false }), /Rewards tab route is missing/);
  });
});

describe('release contract: a release cannot ship with sample Google config', () => {
  it('blocks a missing Google web client id, because Google Login is required in V1', () => {
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: undefined } }),
      /EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set/
    );
  });

  it.each([
    '1234567890-abcdefghijklmnop.apps.googleusercontent.com',
    'YOUR_WEB_CLIENT_ID',
    'your-client-id.apps.googleusercontent.com',
    '<google-web-client-id>',
    'xxxxxxxx.apps.googleusercontent.com',
    'changeme',
  ])('blocks the placeholder Google web client id %s', (clientId) => {
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: clientId } }),
      /is a placeholder|is not a Google web client id/
    );
  });

  it.each([
    // An ANDROID client id: real, from the right project, and still unable to
    // mint the ID token the backend verifies.
    '408130275874-abc.apps.googleusercontent.example',
    'GOCSPX-a1b2c3d4e5f6g7h8',
    '408130275874',
    'not-a-client-id',
  ])('blocks a Google web client id of the wrong shape: %s', (clientId) => {
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: clientId } }),
      /is not a Google web client id|is a placeholder/
    );
  });
});

describe('release contract: a release cannot ship with sample AdMob ids', () => {
  it("blocks Google's sample AdMob APP id, which app.json ships as its committed default", () => {
    expectBlocked(
      evaluate({
        exp: {
          plugins: [
            './plugins/with-android-release-signing',
            [
              'react-native-google-mobile-ads',
              { androidAppId: `${GOOGLE_SAMPLE_ADMOB_PUBLISHER}~3347511713` },
            ],
          ],
        },
      }),
      /AdMob androidAppId is Google's public SAMPLE id/
    );
  });

  it("blocks Google's sample AdMob AD UNIT id being set explicitly", () => {
    // The gap this closes: setting the variable is not the same as
    // configuring it. An unset unit already blocked; a unit set to the sample
    // used to pass, and would have served watermarked test ads to real users.
    expectBlocked(
      evaluate({
        env: {
          EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID: `${GOOGLE_SAMPLE_ADMOB_PUBLISHER}/1033173712`,
        },
      }),
      /is a Google SAMPLE ad unit/
    );
  });

  it('blocks an unset AdMob ad unit, which falls back to the sample at runtime', () => {
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID: undefined } }),
      /EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID is not set/
    );
  });
});

describe('release contract: a release cannot ship with WhatsApp Login withdrawn', () => {
  it('blocks EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED=false, because WhatsApp Login is required in V1', () => {
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED: 'false' } }),
      /^EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED=false$/
    );
  });

  it('blocks a WhatsApp client that no longer calls the real OTP endpoints', () => {
    // The failure this guards against is a local shortcut that reports a
    // session the server never granted.
    expectBlocked(
      evaluate({ whatsAppServiceSource: "request('auth/whatsapp/otp/request');" }),
      /no longer calls the real OTP endpoints/
    );
  });

  it('blocks a WhatsApp client that imports a fake driver', () => {
    expectBlocked(
      evaluate({
        whatsAppServiceSource:
          "import { fakeOtp } from '@/services/auth/fake-whatsapp-driver';\n" +
          "request('auth/whatsapp/otp/request');\nrequest('auth/whatsapp/otp/verify');",
      }),
      /imports a fake\/mock module/
    );
  });

  it('keeps HLS playback required: a kill-switched build cannot ship', () => {
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_HLS_PLAYBACK_ENABLED: 'false' } }),
      /^EXPO_PUBLIC_HLS_PLAYBACK_ENABLED=false$/
    );
  });
});

describe('release contract: a release cannot ship with premium or payment enabled', () => {
  it('blocks EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED=true', () => {
    expectBlocked(
      evaluate({ env: { EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED: 'true' } }),
      /^EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED=true$/
    );
  });

  it.each([
    'midtrans-client',
    '@stripe/stripe-react-native',
    'react-native-purchases',
    'expo-in-app-purchases',
    'react-native-iap',
    '@xendit/node',
    'braintree-web',
    'react-native-google-pay',
  ])('blocks the payment SDK dependency %s', (dependency) => {
    expectBlocked(
      evaluate({ dependencyNames: ['expo', 'react-native', dependency] }),
      /A payment \/ billing SDK is declared/
    );
  });

  it('does not mistake the app\'s own legitimate dependencies for a payment rail', () => {
    // The pattern deliberately omits "premium" and "subscribe": premium is a
    // modelled access tier and `rewards.ctaSubscribe` asks a viewer to
    // subscribe to a YouTube channel. A guard that fires on those gets muted.
    expect(blockerTitles(evaluate())).toEqual([]);
  });
});

describe('release contract: a release cannot ship debug-signed', () => {
  it('blocks a build with no release signing credentials at all', () => {
    expectBlocked(
      evaluate({
        env: {
          ANDROID_RELEASE_STORE_FILE: undefined,
          ANDROID_RELEASE_STORE_PASSWORD: undefined,
          ANDROID_RELEASE_KEY_ALIAS: undefined,
          ANDROID_RELEASE_KEY_PASSWORD: undefined,
        },
      }),
      /this build would be DEBUG-signed/
    );
  });

  it('blocks a partly configured keystore rather than letting it fall back to debug', () => {
    expectBlocked(
      evaluate({
        env: {
          ANDROID_RELEASE_STORE_PASSWORD: undefined,
          ANDROID_RELEASE_KEY_PASSWORD: undefined,
        },
      }),
      /only partly configured; missing: storePassword, keyPassword/
    );
  });

  it('accepts credentials declared in keystore.properties instead of the environment', () => {
    // The two sources are interchangeable by design: a build machine may have
    // either. This is what stops the rule above from being a false alarm.
    expect(
      blockerTitles(
        evaluate({
          env: {
            ANDROID_RELEASE_STORE_FILE: undefined,
            ANDROID_RELEASE_STORE_PASSWORD: undefined,
            ANDROID_RELEASE_KEY_ALIAS: undefined,
            ANDROID_RELEASE_KEY_PASSWORD: undefined,
          },
          declaredKeystoreKeys: new Set([
            'storeFile',
            'storePassword',
            'keyAlias',
            'keyPassword',
          ]),
          keystorePropertiesExists: true,
        })
      )
    ).toEqual([]);
  });

  it('blocks a keystore.properties that git would track', () => {
    expectBlocked(
      evaluate({ keystorePropertiesExists: true, isKeystorePropertiesIgnored: false }),
      /\.gitignore does not ignore it/
    );
  });

  it('blocks removal of the signing config plugin, which silently restores debug signing', () => {
    // Without the plugin, prebuild regenerates build.gradle with
    // `release { signingConfig signingConfigs.debug }` and every credential
    // above is ignored - a debug-signed artifact with all four values set.
    expectBlocked(
      evaluate({
        exp: {
          plugins: [
            ['react-native-google-mobile-ads', { androidAppId: 'ca-app-pub-7654321098765432~1' }],
          ],
        },
      }),
      /is not in app\.json's plugins/
    );
  });
});

describe('release contract: Android identity and privacy posture', () => {
  it('blocks the scaffold package name', () => {
    expectBlocked(
      evaluate({ exp: { android: { ...VALID_EXP.android, package: 'com.anonymous.mobileappecc' } } }),
      /still the Expo placeholder/
    );
  });

  it('blocks package identity drift away from the published application id', () => {
    // Permanent once uploaded, and the identity the Google OAuth client, the
    // AdMob app and the Play listing are all registered against.
    expectBlocked(
      evaluate({ exp: { android: { ...VALID_EXP.android, package: 'com.spark.redpanda2' } } }),
      /drifted from the published identity/
    );
  });

  it('blocks android.allowBackup being anything but false', () => {
    // AsyncStorage holds the access and refresh tokens as plaintext JSON.
    expectBlocked(
      evaluate({ exp: { android: { ...VALID_EXP.android, allowBackup: true } } }),
      /allowBackup is not false/
    );
  });

  it('blocks a release whose data-extraction plugin is no longer registered', () => {
    // allowBackup="false" is NOT a substitute. Android documents that for an
    // app targeting Android 12+, that flag disables cloud backup but "doesn't
    // disable device-to-device transfers for the app" on some manufacturers'
    // devices - so without this plugin the token pair in AsyncStorage is still
    // eligible to be copied onto a new handset.
    expectBlocked(
      evaluate({
        exp: {
          plugins: VALID_EXP.plugins.filter(
            (plugin) => plugin !== ANDROID_DATA_EXTRACTION_PLUGIN
          ),
        },
      }),
      /with-android-data-extraction-rules is not in app\.json's plugins/
    );
  });

  it('blocks a registered plugin whose policy cannot be read', () => {
    // Registration that cannot be evaluated is not evidence. Silence here
    // would let the gate pass on a plugin that fails to load at prebuild.
    expectBlocked(
      evaluate({ dataExtractionPolicyXml: null }),
      /policy could not be read/
    );
  });

  it.each(REQUIRED_EXTRACTION_SECTIONS)(
    'blocks a policy that drops its <%s> section entirely',
    (section) => {
      // An ABSENT section is not a denial: Android falls back to "no rules at
      // all" for that destination, i.e. copy everything.
      const gutted = renderDataExtractionRules().replace(
        new RegExp(`<${section}>[\\s\\S]*?</${section}>`),
        ''
      );

      expectBlocked(
        evaluate({ dataExtractionPolicyXml: gutted }),
        new RegExp(`${section} \\(section absent\\)`)
      );
    }
  );

  it.each(REQUIRED_EXTRACTION_DOMAINS)(
    'blocks a policy that stops excluding the %s domain',
    (domain) => {
      // Exclusion is matched by EXACT path, so every domain needs its own
      // rule - dropping `database` alone would re-expose AsyncStorage (and
      // with it the access and refresh tokens) while the file still looked
      // like a deny-all policy.
      const gutted = renderDataExtractionRules()
        .split('\n')
        .filter((line) => !line.includes(`<exclude domain="${domain}"`))
        .join('\n');

      expectBlocked(
        evaluate({ dataExtractionPolicyXml: gutted }),
        new RegExp(`no longer denies:.*${domain}`)
      );
    }
  );

  it('blocks a policy that grows an <include> rule', () => {
    // A single include for any domain makes Android skip every OTHER domain's
    // rules entirely, so "just whitelist the language preference" silently
    // changes what the other eight domains do.
    const widened = renderDataExtractionRules().replace(
      '</device-transfer>',
      '    <include domain="sharedpref" path="language.xml" />\n    </device-transfer>'
    );

    expectBlocked(evaluate({ dataExtractionPolicyXml: widened }), /grown an <include> rule/);
  });

  it.each([
    'android.permission.SYSTEM_ALERT_WINDOW',
    'android.permission.READ_EXTERNAL_STORAGE',
    'android.permission.WRITE_EXTERNAL_STORAGE',
  ])('blocks a release that stops removing the unused permission %s', (permission) => {
    expectBlocked(
      evaluate({
        exp: {
          android: {
            ...VALID_EXP.android,
            blockedPermissions: VALID_EXP.android.blockedPermissions.filter(
              (entry) => entry !== permission
            ),
          },
        },
      }),
      new RegExp(`^${permission} is not in android.blockedPermissions$`)
    );
  });

  it.each(['EXPO_PUBLIC_PRIVACY_POLICY_URL', 'EXPO_PUBLIC_ACCOUNT_DELETION_URL'])(
    'blocks a missing %s, which Google Play requires',
    (key) => {
      expectBlocked(
        evaluate({ env: { [key]: undefined } }),
        new RegExp(`^${key} is not set to an https URL$`)
      );
    }
  );

  it.each(['http://redpanda.example/privacy', 'not-a-url', 'redpanda.example/privacy'])(
    'blocks a privacy policy URL the app would refuse to render: %s',
    (url) => {
      // src/constants/legal.ts renders a legal row only for absolute https,
      // so a value it rejects means the Profile screen shows NO policy link.
      expectBlocked(
        evaluate({ env: { EXPO_PUBLIC_PRIVACY_POLICY_URL: url } }),
        /EXPO_PUBLIC_PRIVACY_POLICY_URL is not set to an https URL/
      );
    }
  );

  it.each([0, -1, 1.5, undefined, '1'])(
    'blocks a versionCode Google Play could not order uploads by: %s',
    (versionCode) => {
      expectBlocked(
        evaluate({ exp: { android: { ...VALID_EXP.android, versionCode } } }),
        /versionCode is not a positive integer/
      );
    }
  );
});

describe('release contract: the real repository satisfies the structural rules', () => {
  // The cases above prove the RULES work against constructed worlds. These
  // prove the rules are currently SATISFIED by the checked-in source, so a
  // refactor that quietly breaks one fails here rather than at release time.
  const fs = require('fs');
  const path = require('path');

  const projectRoot = path.resolve(__dirname, '../..');

  it('ships the Rewards tab route', () => {
    expect(fs.existsSync(path.join(projectRoot, 'src/app/(tabs)/rewards.tsx'))).toBe(true);
  });

  it('keeps the rewards service on the real backend, importing no fabricated data', () => {
    const source = fs.readFileSync(
      path.join(projectRoot, 'src/services/rewards/rewards-service.ts'),
      'utf8'
    );

    expect(source).toContain("'rewards/snapshot'");
    expect(collectImportSpecifiers(source)).toEqual([
      '@/services/api/client',
      '@/services/rewards/rewards-dto',
    ]);
  });

  it('keeps WhatsApp sign-in on the real OTP endpoints, importing no fake driver', () => {
    const source = fs.readFileSync(
      path.join(projectRoot, 'src/services/auth/provider-auth-service.ts'),
      'utf8'
    );

    expect(source).toContain("'auth/whatsapp/otp/request'");
    expect(source).toContain("'auth/whatsapp/otp/verify'");
    expect(collectImportSpecifiers(source).filter((s) => /mock|fake|stub|fixture/i.test(s))).toEqual(
      []
    );
  });

  it('declares no payment or billing dependency', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    );

    expect(
      blockerTitles(
        evaluate({
          dependencyNames: Object.keys({
            ...manifest.dependencies,
            ...manifest.devDependencies,
          }),
        })
      )
    ).toEqual([]);
  });

  it('pins the published Android identity in app.json', () => {
    const appJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'));

    expect(appJson.expo.android.package).toBe(EXPECTED_ANDROID_PACKAGE);
    expect(appJson.expo.ios.bundleIdentifier).toBe(EXPECTED_ANDROID_PACKAGE);
    expect(appJson.expo.android.allowBackup).toBe(false);
  });

  it('registers the data-extraction plugin in app.json, alongside allowBackup=false', () => {
    // The two are complements, not alternatives: allowBackup="false" closes
    // cloud backup, the plugin closes device-to-device transfer. This asserts
    // the CHECKED-IN config satisfies the rule, so deleting the plugin entry
    // fails here rather than at release time.
    const appJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'));

    expect(
      appJson.expo.plugins.map((plugin) => (Array.isArray(plugin) ? plugin[0] : plugin))
    ).toContain(ANDROID_DATA_EXTRACTION_PLUGIN);
    expect(
      fs.existsSync(path.join(projectRoot, 'plugins/with-android-data-extraction-rules.js'))
    ).toBe(true);
  });

  it("the plugin's real rendered policy passes the release gate", () => {
    // The passing world already uses the real render; this states it as its
    // own case so a policy edit that breaks the gate names itself.
    expect(blockerTitles(evaluate({ dataExtractionPolicyXml: renderDataExtractionRules() }))).toEqual(
      []
    );
  });
});
