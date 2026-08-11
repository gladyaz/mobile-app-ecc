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
 * IMPORTANT - this is NOT a "prefer-MP4 fallback/rollback", despite how an
 * earlier plan described it. It cannot turn an HLS-ready video into an MP4
 * one: the backend's `GET /videos/:id/playback` returns EITHER an HLS shape
 * OR a legacy/MP4 shape for a given video based on how its media is stored
 * (never both), and an HLS-ready row's own feed `playbackUrl` is the local
 * `/videos/:id/stream` URL that 404s for R2-backed media (the exact Slice 11M
 * root cause). So there is no client-side MP4 source to fall back to for
 * HLS-ready media. When this returns false, an HLS-shaped authorization is
 * simply NOT played - it resolves to the same "video unavailable" state a
 * malformed response would (see `resolvePlaybackSource` in
 * `video-service.ts`) - while every legacy/MP4 response continues to play
 * exactly as it did before Slice 11R, byte for byte. A TRUE HLS->MP4 rollback
 * for HLS-ready media would require the backend to additionally expose an
 * authorized MP4 rendition: a separate contract/product decision NOT
 * implemented by 11R.
 */
export function isHlsPlaybackEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HLS_PLAYBACK_ENABLED !== 'false';
}
