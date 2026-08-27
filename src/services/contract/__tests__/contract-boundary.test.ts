/**
 * THE CONTRACT LAYER IS TEST-ONLY, AND STAYS THAT WAY.
 *
 * Two static guards, both of which a runtime test could never reach:
 *
 *  1. NO PRODUCTION MODULE MAY IMPORT `services/contract/*`. The manifest is
 *     a POLICY TABLE that grades the app; the moment it starts deciding app
 *     behaviour it becomes a second, silently divergent copy of the rules it
 *     exists to check - and the fixtures would start shipping inside the
 *     binary as plausible-looking fake data a screen could render.
 *
 *  2. NO FIXTURE MAY CARRY ANYTHING THAT LOOKS LIKE A REAL CREDENTIAL. A
 *     fixture is checked into git forever; a real Google ID token, refresh
 *     token or OTP committed beside one is a leak no later deletion undoes.
 *
 * Node's `fs`/`path`/`__dirname` are declared locally rather than pulled in
 * from `@types/node`, following the precedent in
 * `services/ads/__tests__/ads-web-import-boundary.test.ts`: this is an Expo
 * app, and adding those ambient types would redefine `setTimeout` and
 * friends repo-wide.
 */
type DirectoryEntry = {
  readonly name: string;
  isDirectory: () => boolean;
};

type FileSystemModule = {
  readdirSync: (directory: string, options: { withFileTypes: true }) => DirectoryEntry[];
  readFileSync: (file: string, encoding: 'utf8') => string;
};

type PathModule = {
  readonly sep: string;
  join: (...segments: string[]) => string;
  resolve: (...segments: string[]) => string;
  relative: (from: string, to: string) => string;
  extname: (file: string) => string;
};

declare const __dirname: string;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as FileSystemModule;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path') as PathModule;

const SRC_ROOT = path.resolve(__dirname, '..', '..', '..');
const CONTRACT_ROOT = path.resolve(__dirname, '..');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*[(]\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

function listSourceFiles(directory: string): string[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const absolute = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listSourceFiles(absolute);
      }

      return SOURCE_EXTENSIONS.includes(path.extname(entry.name)) ? [absolute] : [];
    });
}

/** Comments are stripped first, so a doc comment naming a path is not a hit. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function readSpecifiers(file: string): string[] {
  const source = stripComments(fs.readFileSync(file, 'utf8'));
  const specifiers: string[] = [];

  for (const match of source.matchAll(SPECIFIER_PATTERN)) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

function isTestFile(file: string): boolean {
  return file.includes(`${path.sep}__tests__${path.sep}`) || file.includes('.test.');
}

const ALL_SOURCE_FILES = listSourceFiles(SRC_ROOT);

describe('the contract layer never reaches production code', () => {
  it('found the source tree it is supposed to be scanning', () => {
    // A guard on the guard: a moved directory would otherwise turn this
    // whole suite into a silent no-op that passes forever.
    expect(ALL_SOURCE_FILES.length).toBeGreaterThan(100);
  });

  it('is imported only by test files', () => {
    const offenders = ALL_SOURCE_FILES.filter((file) => {
      if (isTestFile(file)) {
        return false;
      }

      // The contract modules import each other; that is internal, not a leak
      // into the app.
      if (!path.relative(CONTRACT_ROOT, file).startsWith('..')) {
        return false;
      }

      return readSpecifiers(file).some((specifier) =>
        specifier.includes('services/contract/')
      );
    });

    expect(offenders.map((file) => path.relative(SRC_ROOT, file))).toEqual([]);
  });

  it('keeps the fixtures out of every non-test module, including the manifest itself', () => {
    const manifest = path.join(CONTRACT_ROOT, 'v1-contract-manifest.ts');

    // The manifest states POLICY and the fixtures are EVIDENCE. Wiring one
    // to the other would let a fixture edit quietly change what the policy
    // says.
    expect(readSpecifiers(manifest).some((specifier) => specifier.includes('fixtures'))).toBe(
      false
    );
  });

  it('never reads a path inside the backend checkout - the fixtures are the evidence', () => {
    const contractFiles = listSourceFiles(CONTRACT_ROOT);

    contractFiles.forEach((file) => {
      const source = fs.readFileSync(file, 'utf8');

      // A suite that reached across the filesystem would pass on the
      // author's laptop and fail in CI, which is the opposite of a
      // regression layer. The repo must build with no backend beside it.
      expect(source).not.toMatch(/require\(\s*['"]fs['"]\s*\)[\s\S]{0,400}short-drama-backend/);
      expect(source).not.toMatch(/\.\.\/\.\.\/\.\.\/\.\.\/short-drama-backend/);
    });
  });
});

describe('no fixture carries anything that could be a real credential', () => {
  const FIXTURE_FILES = listSourceFiles(path.join(CONTRACT_ROOT, 'fixtures'));

  it('found the fixture modules', () => {
    expect(FIXTURE_FILES.length).toBeGreaterThanOrEqual(3);
  });

  it.each([
    // A real Google ID token is a three-segment JWT; `eyJ` is the base64 of
    // a JSON object's opening brace, which every one of them starts with.
    ['a JWT-shaped value', /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./],
    ['a Google OAuth client id', /\d{10,}-[a-z0-9]{16,}\.apps\.googleusercontent\.com/],
    ['a Google API key', /AIza[0-9A-Za-z_-]{20,}/],
    ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
    ['a Meta/WhatsApp access token', /EAA[A-Za-z0-9]{20,}/],
    // A real Indonesian handset number, which an OTP fixture is the obvious
    // place to paste one into. Masked forms (`+*******7890`) do not match.
    ['an unmasked E.164 phone number', /\+62\d{8,}/],
  ])('contains no %s', (_label, pattern) => {
    FIXTURE_FILES.forEach((file) => {
      expect(fs.readFileSync(file, 'utf8')).not.toMatch(pattern);
    });
  });

  it('points every fixture URL at a reserved, unroutable domain', () => {
    // `.invalid` is reserved by RFC 2606 and can never resolve, so no
    // fixture can accidentally name a host somebody actually owns - and a
    // test that started making a real request would fail loudly.
    FIXTURE_FILES.forEach((file) => {
      const source = stripComments(fs.readFileSync(file, 'utf8'));
      const urls = [...source.matchAll(/https?:\/\/([^/'"`\s]+)/g)].map((match) => match[1]);

      urls.forEach((host) => {
        // The social destinations are the deliberate exception: they must be
        // real platform hosts, because the backend's own allowlist pins them
        // and a fixture on a fake host would not exercise that rule.
        const isSocialPlatform = /(instagram|tiktok|youtube|facebook|threads)\./.test(host);

        expect(isSocialPlatform || host.endsWith('.invalid')).toBe(true);
      });
    });
  });
});
