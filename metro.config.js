const { getDefaultConfig } = require('expo/metro-config');

const {
  isBundledDemoMediaRequest,
  shouldStubBundledDemoMedia,
} = require('./metro/bundled-demo-media');

/**
 * WHY THIS FILE EXISTS.
 *
 * `src/data/mock-drama-videos.ts` and `src/data/qa-fixture-videos.ts` reach the
 * bundled offline-showcase catalog through 21 top-level
 * `require('../../assets/videos/...')` calls. Metro's argument to `require`
 * must be a static literal, so those calls are collected into the dependency
 * graph unconditionally - `getVideoFeed()` only decides which array it RETURNS,
 * never what is bundled. The import chain is `_layout.tsx ->
 * video-catalog-provider -> video-service -> mock-drama-videos`, which every
 * build walks.
 *
 * That produced two defects at once:
 *
 *  1. A production release build FAILED OUTRIGHT on a clean checkout - "Unable
 *     to resolve module ../../assets/videos/pewaris-ep-1.mp4" - because the
 *     media is gitignored and therefore absent from every checkout that has not
 *     built the demo.
 *  2. On a machine where the media HAD been generated, the build succeeded and
 *     silently shipped ~61 MB of demo drama clips plus the synthetic
 *     "QA 16:9 FIXTURE" test card inside the production APK.
 *
 * Both are fixed by resolving those requires to Metro's inert empty module for
 * any build that is not serving the bundled catalog. See
 * `metro/bundled-demo-media.js` for the decision and why it is keyed on the
 * build's declared intent rather than on what happens to be on disk, and
 * `resolveBundledMediaUri` (src/services/media/media-url.ts) for what the app
 * does with the resulting `{}`.
 *
 * Measured on a machine that HAS the media: a production export is 6.8 MB with
 * 43 assets and zero `.mp4`; the demo export is 65 MB with 11.
 */
const config = getDefaultConfig(__dirname);

if (shouldStubBundledDemoMedia()) {
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
