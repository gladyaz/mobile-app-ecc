/**
 * Client-only HLS playback ENABLE/DISABLE flag (a kill switch) for Slice 11R
 * (mobile AUTO adaptive HLS playback) - see the control workspace
 * `DECISIONS.md`, "2026-08-11 - Slice 11R APPROVED". Mirrors how
 * `EXPO_PUBLIC_USE_MOCK_DATA` and `EXPO_PUBLIC_DEMO_MODE` are read
 * (`services/demo/demo-mode.ts`): a plain env lookup, evaluated at call time
 * rather than baked into a module-level constant, so a test can flip it
 * between assertions the same way those two flags already are. No remote
 * config, no new infra.
 *
 * Defaults to HLS ENABLED - unset, empty, or anything other than the exact
 * string "false" is treated as enabled, so a normal build (this flag absent
 * everywhere including CI and QA) uses the backend's HLS `masterUrl` whenever
 * a playback authorization is HLS-shaped.
 *
 * This IS a real prefer-MP4 rollback as of work unit "HLS MP4 FALLBACK".
 *
 * It did not used to be, and the reason is worth keeping: Slice 11R's
 * `GET /videos/:id/playback` returned EITHER an HLS shape OR a legacy/MP4
 * shape for a given video, never both, and an HLS-ready row's own feed
 * `playbackUrl` is the local `/videos/:id/stream` URL that 404s for R2-backed
 * media (the exact Slice 11M root cause). With no authorized MP4 anywhere in
 * an HLS response, there was nothing to fall back TO - so turning this flag
 * off did not roll back to MP4, it just stopped the video playing at all.
 *
 * The backend now additionally exposes `fallback` on an HLS response (an
 * authorized MP4 for the same row - see `types/playback.ts`'s
 * `Mp4PlaybackFallback`), which is precisely the "separate contract decision"
 * this comment used to say was missing. So when this returns false,
 * `resolvePlaybackSource` (`video-service.ts`) now resolves that MP4 instead
 * of returning `null`, and playback continues. It still degrades to the
 * "video unavailable" state for the one case where the backend genuinely has
 * no MP4 to offer (`fallback` absent).
 *
 * Every legacy/MP4 response continues to play exactly as it did before Slice
 * 11R, byte for byte, regardless of this flag.
 */
export function isHlsPlaybackEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HLS_PLAYBACK_ENABLED !== 'false';
}
