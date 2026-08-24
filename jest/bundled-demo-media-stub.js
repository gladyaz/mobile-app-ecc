// Stands in for the offline showcase's bundled clips and posters
// (`assets/videos/*`, `assets/thumbnails/*`) in Jest.
//
// Those directories are gitignored ~62 MB of binaries, so they are absent from
// CI and from every checkout that has not built the demo. Without this stub,
// Jest's resolver throws "Cannot find module
// '../../assets/videos/qa-16x9-fullscreen.mp4'" and takes down 8 whole suites
// plus everything that transitively imports the catalog - `src/app/_layout.tsx`
// reaches `src/data/mock-drama-videos.ts` through
// video-catalog-provider -> video-service, so most screen tests are downstream
// of it.
//
// `{}` is not an arbitrary placeholder: it is byte-for-byte what
// `metro-runtime/src/modules/empty-module.js` evaluates to, which is what
// `metro.config.js` resolves these same requires to in a build without the
// media. `resolveBundledMediaUri` (src/services/media/media-url.ts) turns that
// into an empty URI in both places, so a test and a release build agree about
// what a bundled clip resolves to instead of disagreeing silently.
//
// The mapping is unconditional rather than "only when the files are missing",
// so the suite produces the same result on CI and on a laptop that has built
// the demo. Nothing is lost: no test asserts on a bundled asset's URI - the
// catalog tests assert ids, `contentKind` and `accessTier`, and the playback
// tests use explicit `https://media.example.com/...` fixtures of their own.
module.exports = {};
