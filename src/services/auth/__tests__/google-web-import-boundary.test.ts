/**
 * Static guard on the Expo Web import boundary for the Google Sign-In SDK.
 *
 * Same rule, same reason, as `services/ads/__tests__/ads-web-import-boundary.test.ts`
 * enforces for the AdMob SDK: Jest resolves modules with the NATIVE platform
 * extensions, so no runtime test in this suite can notice a module quietly
 * importing a native-only package with no web counterpart - but Metro's
 * `platform: web` resolution would, at bundle time, by failing the build.
 *
 * The rule: any production module that imports
 * `@react-native-google-signin/google-signin` must have a `.web.ts`/`.web.tsx`
 * sibling for Metro to pick instead on web, and no `.web` module may import
 * it at all.
 *
 * Node's `fs`/`path`/`__dirname` are declared locally rather than pulled in
 * from `@types/node`, matching the ads guard: this is an Expo app, and adding
 * those ambient types would redefine `setTimeout` and friends repo-wide.
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

const NATIVE_GOOGLE_PACKAGE = '@react-native-google-signin/google-signin';
const SRC_ROOT = path.resolve(__dirname, '..', '..', '..');
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

/** Matches `from 'm'`, `require('m')`, `import('m')` (including the
 * `typeof import('m')` type position) and the side-effect `import 'm'`.
 *
 * Backticks are included alongside `'` and `"`: Metro resolves a
 * template-literal `require(\`pkg\`)` just as it resolves a quoted one, so a
 * scanner that only looked at quotes could be walked straight past. */
const SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\brequire\s*\(\s*|\bimport\s*[(]\s*|^\s*import\s+)['"`]([^'"`]+)['"`]/gm;

/** Line and block comments are stripped first: the adapters' own headers
 * name the package while explaining the boundary, which is documentation,
 * not a violation. Strings are skipped so a `//` inside one survives. */
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

type SourceFile = {
  readonly absolutePath: string;
  /** POSIX-style and relative to `src/`, so failures read cleanly. */
  readonly relativePath: string;
  readonly specifiers: readonly string[];
};

function listProductionSourceFiles(directory: string): SourceFile[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry): SourceFile[] => {
    const absolutePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      // Tests are excluded on purpose: this very file names the package in a
      // `jest.mock` tripwire, which is the opposite of a violation.
      return entry.name === '__tests__' ? [] : listProductionSourceFiles(absolutePath);
    }

    if (!SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
      return [];
    }

    const source = stripComments(fs.readFileSync(absolutePath, 'utf8'));
    const specifiers = [...source.matchAll(SPECIFIER_PATTERN)].map((match) => match[1]);

    return [
      {
        absolutePath,
        relativePath: path.relative(SRC_ROOT, absolutePath).split(path.sep).join('/'),
        specifiers,
      },
    ];
  });
}

function isWebModule(file: SourceFile): boolean {
  return /\.web\.tsx?$/.test(file.relativePath);
}

function hasWebSibling(file: SourceFile): boolean {
  const extension = path.extname(file.absolutePath);
  const withoutExtension = file.absolutePath.slice(0, -extension.length);

  return SOURCE_EXTENSIONS.some((candidate) =>
    fs.existsSync(`${withoutExtension}.web${candidate}`)
  );
}

const productionFiles = listProductionSourceFiles(SRC_ROOT);
const nativeGoogleFiles = productionFiles.filter((file) =>
  file.specifiers.some(
    (specifier) =>
      specifier === NATIVE_GOOGLE_PACKAGE || specifier.startsWith(`${NATIVE_GOOGLE_PACKAGE}/`)
  )
);

describe('google sign-in web import boundary', () => {
  it('finds the production tree to scan', () => {
    // Guards the guard: a moved `src/` or a broken scan would otherwise turn
    // every assertion below into a vacuous pass.
    expect(productionFiles.length).toBeGreaterThan(50);
    expect(productionFiles.flatMap((file) => file.specifiers).length).toBeGreaterThan(100);
  });

  it('still has a native Google module to guard', () => {
    expect(nativeGoogleFiles.map((file) => file.relativePath)).toEqual([
      'services/auth/google-sign-in.ts',
    ]);
  });

  it('gives every module that imports the native Google SDK a web override', () => {
    const missingWebOverride = nativeGoogleFiles
      .filter((file) => !hasWebSibling(file))
      .map((file) => file.relativePath);

    expect(missingWebOverride).toEqual([]);
  });

  it('never imports the native Google SDK from a .web module', () => {
    const offendingWebModules = nativeGoogleFiles.filter(isWebModule).map((file) => file.relativePath);

    expect(offendingWebModules).toEqual([]);
  });

  it('lets Metro pick the platform file instead of importing one directly', () => {
    // A production import of `...google-sign-in.web` would ship the no-op
    // adapter to iOS and Android; an explicit `.ts` specifier would ship the
    // native one to web. Both defeat the platform split.
    const directPlatformImports = productionFiles
      .filter((file) =>
        file.specifiers.some((specifier) =>
          /google-sign-in(\.web)?\.tsx?$|google-sign-in\.web$/.test(specifier)
        )
      )
      .map((file) => file.relativePath);

    expect(directPlatformImports).toEqual([]);
  });
});
