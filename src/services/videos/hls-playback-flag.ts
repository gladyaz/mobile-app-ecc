/**
 * Client-only prefer-MP4 rollback flag for Slice 11R (mobile AUTO adaptive
 * HLS playback) - see the control workspace `DECISIONS.md`, "2026-08-11 -
 * Slice 11R APPROVED". Mirrors how `EXPO_PUBLIC_USE_MOCK_DATA` and
 * `EXPO_PUBLIC_DEMO_MODE` are read (`services/demo/demo-mode.ts`): a plain
 * env lookup, evaluated at call time rather than baked into a module-level
 * constant, so a test can flip it between assertions the same way those two
 * flags already are. No remote config, no new infra - this is the entire
 * rollback mechanism.
 *
 * Defaults to HLS ENABLED - unset, empty, or anything other than the exact
 * string "false" is treated as enabled, so a normal build (this flag absent
 * everywhere including CI and QA) prefers the backend's HLS `masterUrl`
 * whenever a playback authorization is HLS-shaped.
 *
 * When this returns false (prefer-MP4 / rollback mode): an HLS-shaped
 * authorization is never played - it resolves to the same "video
 * unavailable" state a malformed response would, since there is no MP4 URL
 * embedded inside an HLS response to fall back to (see
 * `resolvePlaybackSource` in `video-service.ts`) - while every legacy/MP4
 * response continues to play exactly as it did before Slice 11R, byte for
 * byte.
 */
export function isHlsPlaybackEnabled(): boolean {
  return process.env.EXPO_PUBLIC_HLS_PLAYBACK_ENABLED !== 'false';
}
