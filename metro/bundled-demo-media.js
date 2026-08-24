const fs = require('fs');
const path = require('path');

/**
 * Whether a given build should carry the offline showcase's bundled clips and
 * posters, and which `require`s those are.
 *
 * Lives in its own module, separate from `metro.config.js`, for one reason:
 * `metro.config.js` imports `expo/metro-config`, which Jest cannot transform.
 * Putting the policy here keeps it directly testable
 * (`src/services/demo/__tests__/production-boundary.test.ts`) instead of
 * verifiable only by running a full export and measuring the output.
 */

const projectRoot = path.resolve(__dirname, '..');

/**
 * Directories holding the OFFLINE SHOWCASE build's bundled clips and posters.
 *
 * They are gitignored (~62 MB of binaries, regenerated with the ffmpeg command
 * in the demo commit message), so they exist only on a machine that has
 * deliberately produced them for a demo build.
 */
const BUNDLED_DEMO_MEDIA_DIRECTORIES = ['assets/videos', 'assets/thumbnails'];

const bundledDemoMediaRoots = BUNDLED_DEMO_MEDIA_DIRECTORIES.map((relativePath) =>
  path.join(projectRoot, relativePath)
);

function hasBundledDemoMedia() {
  return bundledDemoMediaRoots.every((root) => fs.existsSync(root));
}

/**
 * True when this build INTENDS to serve the bundled catalog - the offline
 * showcase, or a mock-data build for UI work. Kept identical to
 * `usesBundledCatalog()` in `app.config.js`, which is what refuses a build that
 * asks for the catalog while the media is missing.
 */
function usesBundledCatalog(env = process.env) {
  return env.EXPO_PUBLIC_DEMO_MODE === 'true' || env.EXPO_PUBLIC_USE_MOCK_DATA === 'true';
}

/**
 * Whether the bundled-media `require`s should resolve to nothing.
 *
 * THIS USED TO KEY ON DISK STATE ALONE (`!hasBundledDemoMedia()`), and that was
 * the wrong question. It made a production build's most important property -
 * "ships no demo media" - depend on whether the person building it happened to
 * have run the demo on that machine. On a clean checkout the media is absent
 * and the build is clean; on the machine that produced the showcase APK the
 * very same command silently bundled ~61 MB of drama clips and the synthetic QA
 * test card into a store artifact. The only thing standing between those two
 * outcomes was a preflight blocker telling a human to go move some folders.
 *
 * The right question is what the BUILD is for, which the build already
 * declares: `EXPO_PUBLIC_DEMO_MODE` / `EXPO_PUBLIC_USE_MOCK_DATA` are the same
 * flags that decide whether `video-service.ts` reads the bundled catalog at
 * runtime. A build that will never read those clips has no reason to carry
 * them, whatever is sitting on the disk.
 *
 * Disk state is still consulted, as the second half of an OR: a demo build on a
 * machine that has not generated the media must not fail to RESOLVE. It gets
 * the empty module instead, `resolveBundledMediaUri` turns that into an empty
 * URI, and `app.config.js` has already refused that combination at config time
 * with an explanation - so this is a safety net under a case that cannot
 * normally be reached, not a second policy.
 *
 * `hasMedia` and `env` are parameters with real defaults so the policy can be
 * exercised as a truth table without depending on the machine running the test
 * - which is the exact coupling this function exists to break. `env` is
 * injected rather than read through `process.env` in the test because
 * `babel-preset-expo`'s inline-env-vars plugin REWRITES a static
 * `process.env.EXPO_PUBLIC_*` member expression during transform, so a Jest
 * case that mutates `process.env` would not be seen. Nothing rewrites this file
 * in a real build: Metro's config runs in plain Node, untransformed.
 */
function shouldStubBundledDemoMedia(hasMedia = hasBundledDemoMedia(), env = process.env) {
  return !usesBundledCatalog(env) || !hasMedia;
}

/**
 * True only for a RELATIVE require that resolves inside one of the bundled
 * demo-media directories. Resolving the path first (rather than substring-
 * matching the specifier) keeps this from ever catching an unrelated module
 * that merely happens to contain "assets/videos" in its name - the app's own
 * artwork under `assets/images` must always resolve normally.
 */
function isBundledDemoMediaRequest(context, moduleName) {
  if (!moduleName.startsWith('.')) {
    return false;
  }

  const absolutePath = path.resolve(path.dirname(context.originModulePath), moduleName);

  return bundledDemoMediaRoots.some((root) => absolutePath.startsWith(root + path.sep));
}

module.exports = {
  BUNDLED_DEMO_MEDIA_DIRECTORIES,
  hasBundledDemoMedia,
  isBundledDemoMediaRequest,
  shouldStubBundledDemoMedia,
  usesBundledCatalog,
};
