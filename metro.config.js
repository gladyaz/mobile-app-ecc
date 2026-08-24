const fs = require('fs');
const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');

/**
 * Directories holding the OFFLINE SHOWCASE build's bundled clips and posters.
 *
 * They are gitignored (~62 MB of binaries, regenerated with the ffmpeg command
 * in the demo commit message - see .gitignore), so they exist only on a
 * machine that has deliberately produced them for a demo build. Every other
 * checkout - CI, a fresh clone, and every production release build - has
 * neither directory.
 */
const BUNDLED_DEMO_MEDIA_DIRECTORIES = ['assets/videos', 'assets/thumbnails'];

const bundledDemoMediaRoots = BUNDLED_DEMO_MEDIA_DIRECTORIES.map((relativePath) =>
  path.join(__dirname, relativePath)
);

/**
 * WHY THIS FILE EXISTS.
 *
 * `src/data/mock-drama-videos.ts` and `src/data/qa-fixture-videos.ts` reach the
 * bundled catalog through 21 top-level `require('../../assets/videos/...')`
 * calls. Metro's argument to `require` must be a static literal, so those calls
 * are collected into the dependency graph unconditionally - `getVideoFeed()`
 * only decides which array it RETURNS, never what is bundled. The import chain
 * is `_layout.tsx -> video-catalog-provider -> video-service ->
 * mock-drama-videos`, which every build walks.
 *
 * That produced two defects at once, both confirmed by running
 * `npx expo export --platform android` on a clean checkout:
 *
 *  1. A production release build FAILED OUTRIGHT - "Unable to resolve module
 *     ../../assets/videos/pewaris-ep-1.mp4" - because the media is gitignored
 *     and therefore absent from every checkout that has not built the demo.
 *  2. On a machine where the media HAD been regenerated, the build succeeded
 *     and silently shipped ~62 MB of demo drama clips plus the synthetic
 *     "QA 16:9 FIXTURE" test card inside the production APK.
 *
 * The fix keys off the one fact that already distinguishes the two builds: is
 * the bundled media actually on disk? When it is not, those requires resolve to
 * Metro's inert empty module (`{}`) instead of failing, so the release bundle
 * builds and carries no demo media at all. When it IS on disk, resolution is
 * untouched and a demo build is byte-identical to before.
 *
 * The absent case is not left to be discovered at runtime:
 * `resolveBundledMediaUri` (src/services/media/media-url.ts) turns `{}` into an
 * empty URI, and `app.config.js` REFUSES to configure a build that asked for
 * the bundled catalog (EXPO_PUBLIC_DEMO_MODE / EXPO_PUBLIC_USE_MOCK_DATA) while
 * the media is missing - so "demo build with no clips" fails loudly at config
 * time rather than installing and playing nothing.
 */
function hasBundledDemoMedia() {
  return bundledDemoMediaRoots.every((root) => fs.existsSync(root));
}

/**
 * True only for a RELATIVE require that resolves inside one of the bundled
 * demo-media directories. Resolving the path first (rather than substring-
 * matching the specifier) keeps this from ever catching an unrelated module
 * that merely happens to contain "assets/videos" in its name.
 */
function isBundledDemoMediaRequest(context, moduleName) {
  if (!moduleName.startsWith('.')) {
    return false;
  }

  const absolutePath = path.resolve(path.dirname(context.originModulePath), moduleName);

  return bundledDemoMediaRoots.some((root) => absolutePath.startsWith(root + path.sep));
}

const config = getDefaultConfig(__dirname);

if (!hasBundledDemoMedia()) {
  const defaultResolveRequest = config.resolver.resolveRequest;

  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (isBundledDemoMediaRequest(context, moduleName)) {
      // Metro's documented "resolve to nothing" result: the module becomes
      // `metro-runtime/src/modules/empty-module.js`, so `require(...)`
      // evaluates to `{}` rather than an asset module id.
      return { type: 'empty' };
    }

    return (defaultResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
  };
}

module.exports = config;
