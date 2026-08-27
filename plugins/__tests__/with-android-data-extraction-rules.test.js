/**
 * Proves the Android backup / data-extraction policy that
 * plugins/with-android-data-extraction-rules.js writes.
 *
 * WHAT THESE TESTS ARE FOR. `android:allowBackup="false"` is already set and
 * already gated by the release preflight, and it genuinely settles CLOUD
 * backup. It does not settle DEVICE-TO-DEVICE transfer: per Android's own
 * documentation, for an app targeting Android 12+ that flag "disables
 * cloud-based backup and restore (such as Google Drive backups) but doesn't
 * disable device-to-device transfers for the app" on some manufacturers'
 * devices. The `<device-transfer>` section below is the only thing standing
 * between the access/refresh token pair in AsyncStorage and a new handset set
 * up from the old one, so it is asserted rather than assumed.
 *
 * The rendering half is a pure function of module constants, so it is tested
 * directly. The plugin FUNCTION is tested through the same `expo/config-plugins`
 * mock the sibling cleartext plugin's suite uses, because the properties that
 * would actually regress - which source set the file lands in, whether a stale
 * variant override is cleaned up, whether the manifest attribute is set - live
 * there and nowhere else.
 */
const {
  renderDataExtractionRules,
  EXCLUDED_DOMAINS,
  EXTRACTION_SECTIONS,
  DOMAIN_ROOT_PATH,
  GENERATED_MARKER,
  MANIFEST_ATTRIBUTE,
  CONFIG_RESOURCE_REFERENCE,
  RESOURCE_RELATIVE_PATH,
  VARIANT_RESOURCE_RELATIVE_PATHS,
} = require('../with-android-data-extraction-rules');

/**
 * Every domain `FullBackup.BackupScheme.getDirectoryForCriteriaDomain` can
 * resolve, restated here from the platform source rather than imported from
 * the plugin.
 *
 * Load-bearing duplication: importing the plugin's own list would make the
 * completeness test tautological. `BackupAgent.onFullBackup` walks each of
 * these from its own directory and `manifestExcludesContainFilePath` matches
 * paths by EXACT equality, so a domain missing from the policy is a domain
 * that gets copied in full - which is precisely the failure this pins.
 */
const EVERY_BACKUP_DOMAIN = [
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

/**
 * The resource with its leading explanatory comment removed.
 *
 * Every "the policy does NOT contain X" assertion below runs against this
 * rather than the whole file, because the comment necessarily SAYS the words
 * it is promising not to enforce - it explains why there is no `<include>` and
 * why this is not encryption. `scripts/check-release-android.js` has the same
 * note against its own mock-module rule, for the same reason: an earlier
 * version of that rule fired on the sentence asserting the exact property
 * being checked, and "a guard that fails on a correct file teaches people to
 * delete the guard". Matching the rules instead of the prose also makes these
 * assertions stronger - rewording a comment can no longer break them, and
 * nothing written in a comment can satisfy them.
 */
function rulesBodyOf(xml) {
  return xml.replace(/<!--[\s\S]*?-->/g, '');
}

describe('rendered data-extraction policy', () => {
  const xml = renderDataExtractionRules();
  const rulesBody = rulesBodyOf(xml);

  test('is a well-formed data-extraction-rules resource', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('<data-extraction-rules>');
    expect(xml).toContain('</data-extraction-rules>');
  });

  test('configures BOTH cloud backup and device transfer', () => {
    // An ABSENT section is not a denial: FullBackup.parseSchemeForBackupDestination
    // only honours the new scheme when it finds the matching section, and
    // otherwise falls through to "no rules at all", i.e. copy everything. So a
    // file covering only one destination would leave the other wide open.
    for (const section of ['cloud-backup', 'device-transfer']) {
      expect(EXTRACTION_SECTIONS).toContain(section);
      expect(xml).toContain(`<${section}>`);
      expect(xml).toContain(`</${section}>`);
    }
  });

  test.each(EVERY_BACKUP_DOMAIN)(
    'excludes the %s domain from every extraction section',
    (domain) => {
      const rule = `<exclude domain="${domain}" path="${DOMAIN_ROOT_PATH}" />`;

      expect(xml.split(rule)).toHaveLength(EXTRACTION_SECTIONS.length + 1);
    }
  );

  test('leaves no backup domain unaccounted for', () => {
    // The complement of the case above: not just "the known domains are
    // covered" but "there is no tenth domain the policy forgot".
    expect([...EXCLUDED_DOMAINS].sort()).toEqual([...EVERY_BACKUP_DOMAIN].sort());
  });

  test('excludes the domain directory itself, using the documented path form', () => {
    // Android documents `path` as required on every include/exclude and uses
    // `path="."` for "the domain root" in its own example. `.` canonicalises
    // away, so the rule resolves to the exact string the traversal starts
    // from - which is what makes the exact-equality prune fire.
    expect(DOMAIN_ROOT_PATH).toBe('.');
    expect(xml).not.toMatch(/<exclude(?![^>]*\bpath=)/);
  });

  test('contains NO include rule at all', () => {
    // An include set that is non-empty for one domain makes every OTHER domain
    // fall out of the backup entirely, and an include for a domain re-opens it
    // to everything under the listed path. Neither is wanted: the excludes are
    // the whole policy. A "harmless preferences" allowance would be exactly
    // the broad rule this app must not carry.
    expect(rulesBody).not.toContain('<include');
  });

  test('claims no encryption it does not implement', () => {
    // disableIfNoEncryptionCapabilities would make cloud backup conditional on
    // a client-side-encrypting transport. This app encrypts nothing itself,
    // and the policy denies cloud backup outright, so asserting an encryption
    // capability here would be a security claim with nothing behind it.
    expect(rulesBody).not.toMatch(/encrypt/i);
    // And the prose must not quietly claim one either: it is allowed to
    // mention encryption only to disclaim it.
    expect(xml).toContain('This is an EXTRACTION policy, not encryption');
  });

  test('carries the generated marker so the plugin can recognise its own output', () => {
    expect(xml).toContain(GENERATED_MARKER);
  });

  test('is deterministic - repeated renders are byte-identical', () => {
    // The idempotence of `expo prebuild` rests on this: the plugin overwrites
    // the resource unconditionally, so "written twice" is only harmless while
    // the content cannot vary.
    expect(renderDataExtractionRules()).toBe(xml);
    expect(renderDataExtractionRules()).toBe(renderDataExtractionRules());
  });
});

describe('resource source set', () => {
  const path = require('path');

  test('writes the policy to main, so every variant inherits it', () => {
    expect(RESOURCE_RELATIVE_PATH).toBe(
      path.join('app', 'src', 'main', 'res', 'xml', 'data_extraction_rules.xml')
    );
  });

  test('treats debug, debugOptimized and release copies as stale overrides', () => {
    // Android merges src/<variant>/res over src/main/res, so a copy in any of
    // these would shadow the shared policy for that variant alone - the exact
    // shape of "production and debug quietly disagree".
    expect(VARIANT_RESOURCE_RELATIVE_PATHS).toEqual([
      path.join('app', 'src', 'debug', 'res', 'xml', 'data_extraction_rules.xml'),
      path.join('app', 'src', 'debugOptimized', 'res', 'xml', 'data_extraction_rules.xml'),
      path.join('app', 'src', 'release', 'res', 'xml', 'data_extraction_rules.xml'),
    ]);
    expect(VARIANT_RESOURCE_RELATIVE_PATHS).not.toContain(RESOURCE_RELATIVE_PATH);
  });
});

// The plugin function itself. Everything above is pure; the claims that only
// hold at prebuild time - the file lands in `main`, a stale variant override is
// deleted, the manifest points at the resource - are only reachable here.
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

describe('withAndroidDataExtractionRules (the plugin function itself)', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  const withAndroidDataExtractionRules = require('../with-android-data-extraction-rules');
  const { __captured: captured } = require('expo/config-plugins');

  const temporaryRoots = [];

  beforeEach(() => {
    captured.dangerous.length = 0;
    captured.manifest.length = 0;
    withAndroidDataExtractionRules({ name: 'Red Panda', slug: 'mobile-app-ecc' });
  });

  afterEach(() => {
    while (temporaryRoots.length > 0) {
      fs.rmSync(temporaryRoots.pop(), { force: true, recursive: true });
    }
  });

  function makeProjectRoot() {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'red-panda-extraction-'));

    temporaryRoots.push(projectRoot);

    return projectRoot;
  }

  function runResourceMod(projectRoot) {
    captured.dangerous[0].action({ modRequest: { platformProjectRoot: projectRoot } });

    return projectRoot;
  }

  function write(projectRoot, relativePath, contents) {
    const resourcePath = path.join(projectRoot, relativePath);

    fs.mkdirSync(path.dirname(resourcePath), { recursive: true });
    fs.writeFileSync(resourcePath, contents, 'utf8');

    return resourcePath;
  }

  function exists(projectRoot, relativePath) {
    return fs.existsSync(path.join(projectRoot, relativePath));
  }

  test('registers the resource write against the android platform', () => {
    expect(captured.dangerous).toHaveLength(1);
    expect(captured.dangerous[0].platform).toBe('android');
  });

  test('writes the policy into the main source set', () => {
    const projectRoot = runResourceMod(makeProjectRoot());

    expect(fs.readFileSync(path.join(projectRoot, RESOURCE_RELATIVE_PATH), 'utf8')).toBe(
      renderDataExtractionRules()
    );
  });

  test('creates no variant override of its own', () => {
    const projectRoot = runResourceMod(makeProjectRoot());

    for (const relativePath of VARIANT_RESOURCE_RELATIVE_PATHS) {
      expect(exists(projectRoot, relativePath)).toBe(false);
    }
  });

  test('is idempotent: a second prebuild over the same tree changes nothing', () => {
    // `expo prebuild` WITHOUT --clean re-runs every mod over the directory the
    // last one produced. A plugin that appended, or that threw on an anchor it
    // had already rewritten, would fail here rather than at build time.
    const projectRoot = runResourceMod(makeProjectRoot());
    const first = fs.readFileSync(path.join(projectRoot, RESOURCE_RELATIVE_PATH), 'utf8');

    runResourceMod(projectRoot);

    expect(fs.readFileSync(path.join(projectRoot, RESOURCE_RELATIVE_PATH), 'utf8')).toBe(first);
  });

  test.each(VARIANT_RESOURCE_RELATIVE_PATHS)(
    'DELETES a stale generated override at %s',
    (relativePath) => {
      // The load-bearing cleanup case. `android/` is regenerated in place, so
      // a variant-scoped policy written by an earlier configuration would
      // otherwise survive and shadow `main` for that variant alone.
      const projectRoot = makeProjectRoot();

      write(projectRoot, relativePath, renderDataExtractionRules());
      expect(exists(projectRoot, relativePath)).toBe(true);

      runResourceMod(projectRoot);

      expect(exists(projectRoot, relativePath)).toBe(false);
      expect(exists(projectRoot, RESOURCE_RELATIVE_PATH)).toBe(true);
    }
  );

  test('leaves a data_extraction_rules.xml it did not generate alone', () => {
    // Same restraint as the cleartext plugin: only this plugin's own output,
    // identified by its marker, may ever be removed.
    const projectRoot = makeProjectRoot();
    const handWritten = '<data-extraction-rules><!-- somebody else --></data-extraction-rules>';
    const resourcePath = write(projectRoot, VARIANT_RESOURCE_RELATIVE_PATHS[0], handWritten);

    runResourceMod(projectRoot);

    expect(fs.readFileSync(resourcePath, 'utf8')).toBe(handWritten);
  });

  test('points the manifest at the generated resource', () => {
    const manifestConfig = { modResults: { manifest: { application: [{ $: {} }] } } };

    const application = captured.manifest[0](manifestConfig).modResults.manifest.application[0].$;

    expect(application[MANIFEST_ATTRIBUTE]).toBe(CONFIG_RESOURCE_REFERENCE);
    expect(MANIFEST_ATTRIBUTE).toBe('android:dataExtractionRules');
    expect(CONFIG_RESOURCE_REFERENCE).toBe('@xml/data_extraction_rules');
  });

  test('never touches android:allowBackup', () => {
    // The two settings are complementary, not alternatives: allowBackup="false"
    // is what withdraws the app from cloud backup, and this plugin must not
    // weaken it while adding the transfer half.
    const manifestConfig = {
      modResults: { manifest: { application: [{ $: { 'android:allowBackup': 'false' } }] } },
    };

    const application = captured.manifest[0](manifestConfig).modResults.manifest.application[0].$;

    expect(application['android:allowBackup']).toBe('false');
  });

  test('setting the manifest attribute is idempotent', () => {
    const manifestConfig = {
      modResults: {
        manifest: { application: [{ $: { [MANIFEST_ATTRIBUTE]: CONFIG_RESOURCE_REFERENCE } }] },
      },
    };

    const application = captured.manifest[0](manifestConfig).modResults.manifest.application[0].$;

    expect(application).toEqual({ [MANIFEST_ATTRIBUTE]: CONFIG_RESOURCE_REFERENCE });
  });
});
