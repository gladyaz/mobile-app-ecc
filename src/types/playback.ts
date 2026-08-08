/**
 * Mirrors the real backend's `GET /videos/:id/playback` response shape
 * exactly (Slice 11M; see the control workspace `DECISIONS.md`, "Slice 11M
 * approved; playback contract decided (Option A, dedicated endpoint)",
 * 2026-08-08). This is the ONE code path the mobile app uses to obtain a
 * playable URL for either storage kind the backend may hold a video in -
 * the app itself never learns which kind it got:
 *
 * - local-backed media: `requiresAuthHeader: true`, `playbackUrl` is the
 *   existing `/videos/:id/stream` URL.
 * - R2-backed media: `requiresAuthHeader: false`, `playbackUrl` is a
 *   short-lived (15 minute) presigned GET URL straight to the storage
 *   provider. Attaching an Authorization header to this source is what
 *   breaks it - the provider rejects a request carrying two auth
 *   mechanisms at once ("only one auth mechanism").
 *
 * `expiresAt` is an ISO timestamp. The caller must request a new
 * authorization once it has passed rather than reusing a dead URL, and
 * must never persist this value anywhere (not AsyncStorage, not a store) -
 * it is component state only, for exactly as long as it's needed.
 */
export type PlaybackAuthorization = {
  readonly playbackUrl: string;
  readonly expiresAt: string;
  readonly requiresAuthHeader: boolean;
};
