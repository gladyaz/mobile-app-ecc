/**
 * Static guard on the Expo Web import boundary.
 *
 * `interstitial-adapter.web.test.ts` proves the web adapter's own module
 * graph is clean. This file proves the boundary holds for the WHOLE `src`
 * tree, which a runtime test cannot reach: Jest resolves modules with the
 * native platform extensions, so it never exercises Metro's `platform: web`
 * resolution and could never notice a second module quietly importing the
 * native SDK with no web counterpart.
 *
 * The rule enforced here is the one that actually keeps the web bundle
 * building: any production module that IMPORTS `react-native-google-mobile-ads`
 * must have a `.web.ts`/`.web.tsx` sibling for Metro to pick instead on web.
 *
 * Node's `fs`/`path`/`__dirname` are declared locally rather than pulled in
 * from `@types/node`. This is an Expo app, not a Node package: adding those
 * ambient types would redefine `setTimeout` and friends repo-wide, which is
 * far more disruptive than the handful of members this file actually uses.
 */
type DirectoryEntry = {
  readonly name: string;
  isDirectory: () => boolean;
};

type FileSystemModule = {
  readdirSync: (directory: string, options: { withFileTypes: true }) => DirectoryEntry[];
  readFileSync: (file: string, encoding: 'utf8') => string;
  existsSync: (file: string) => boolean;
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

const NATIVE_ADS_PACKAGE = 'react-native-google-mobile-ads';
const SRC_ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/**
 * Matches every form of module specifier the codebase uses:
 * `import x from 'm'`, `export * from 'm'`, `require('m')`, `import('m')`
 * (including the `typeof import('m')` type position), and the side-effect
 * `import 'm'`.
 */
const SPECIFIER_PATTERN = /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*[(]\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

/**
 * Comments are stripped before specifiers are read, because the adapters'
 * own header comments quote `require('react-native-google-mobile-ads')`
 * while explaining the boundary - prose that must not read as a violation.
 * The scanner tracks string and template literals so a `//` inside a URL is
 * not mistaken for a comment. It does not track regex literals; no
 * production module in `src/` contains one, and this file (which does) is
 * excluded along with the rest of `__tests__`.
 */
function stripComments(source: string): string {
  let output = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      // Keep a separator so `from/* c */'m'` cannot be glued into a match
      // that the real parser would never see.
      output += ' ';
      continue;
    }

    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      output += char;
      index += 1;

      while (index < source.length && source[index] !== quote) {
        if (source[index] === '\\') {
          output += source[index];
          index += 1;
        }
        output += source[index];
        index += 1;
      }

      output += quote;
      index += 1;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function readSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const code = stripComments(source);

  for (const match of code.matchAll(SPECIFIER_PATTERN)) {
    specifiers.push(match[1]);
  }

  return specifiers;
}

type SourceFile = {
  readonly absolutePath: string;
  /** POSIX-style and relative to `src/`, so failure messages are readable. */
  readonly relativePath: string;
  readonly specifiers: readonly string[];
};

function listProductionSourceFiles(directory: string): SourceFile[] {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry): SourceFile[] => {
      const absolutePath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        // Tests are excluded deliberately: several of them name the package
        // in a `jest.mock` tripwire, which is the opposite of a violation.
        return entry.name === '__tests__' ? [] : listProductionSourceFiles(absolutePath);
      }

      if (!SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
        return [];
      }

      return [
        {
          absolutePath,
          relativePath: path.relative(SRC_ROOT, absolutePath).split(path.sep).join('/'),
          specifiers: readSpecifiers(fs.readFileSync(absolutePath, 'utf8')),
        },
      ];
    });
}

function isWebModule(file: SourceFile): boolean {
  return /\.web\.tsx?$/.test(file.relativePath);
}

function importsNativeAdsPackage(file: SourceFile): boolean {
  return file.specifiers.some(
    (specifier) =>
      specifier === NATIVE_ADS_PACKAGE || specifier.startsWith(`${NATIVE_ADS_PACKAGE}/`)
  );
}

function hasWebSibling(file: SourceFile): boolean {
  const extension = path.extname(file.absolutePath);
  const withoutExtension = file.absolutePath.slice(0, -extension.length);

  return SOURCE_EXTENSIONS.some((candidate) => fs.existsSync(`${withoutExtension}.web${candidate}`));
}

const productionFiles = listProductionSourceFiles(SRC_ROOT);
const nativeAdsFiles = productionFiles.filter(importsNativeAdsPackage);

describe('ads web import boundary', () => {
  it('finds the production tree to scan', () => {
    // Guards the guard: a moved `src/`, a changed extension list or a broken
    // specifier scan would otherwise turn every assertion below into a
    // vacuous pass.
    expect(productionFiles.length).toBeGreaterThan(50);
    expect(productionFiles.flatMap((file) => file.specifiers).length).toBeGreaterThan(100);
  });

  it('still has a native ads module to guard', () => {
    // If this ever legitimately drops to zero the package is gone and this
    // whole file should go with it - but silently reaching zero would mean
    // the assertions below stopped checking anything.
    expect(nativeAdsFiles.map((file) => file.relativePath)).toEqual([
      'services/ads/interstitial-adapter.ts',
    ]);
  });

  it('gives every module that imports the native ads SDK a web override', () => {
    const missingWebOverride = nativeAdsFiles
      .filter((file) => !hasWebSibling(file))
      .map((file) => file.relativePath);

    expect(missingWebOverride).toEqual([]);
  });

  it('never imports the native ads SDK from a .web module', () => {
    const offendingWebModules = nativeAdsFiles.filter(isWebModule).map((file) => file.relativePath);

    expect(offendingWebModules).toEqual([]);
  });

  it('lets Metro pick the platform file instead of importing one directly', () => {
    // A production import of `...interstitial-adapter.web` would ship the
    // no-op adapter to iOS and Android; an explicit `.ts` specifier would
    // ship the native one to web. Both defeat the platform split.
    const directPlatformImports = productionFiles
      .filter((file) =>
        file.specifiers.some((specifier) =>
          /interstitial-adapter(\.web)?\.tsx?$|interstitial-adapter\.web$/.test(specifier)
        )
      )
      .map((file) => file.relativePath);

    expect(directPlatformImports).toEqual([]);
  });
});
