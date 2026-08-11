/**
 * Mirrors the real backend's `GET /videos/:id/playback` response shape
 * exactly. The backend answers with one of two distinct shapes depending on
 * how the requested video's media is stored - this module models both as a
 * discriminated union, normalized to an internal `kind` tag the wire
 * response itself does not carry the same way (see `video-service.ts`'s
 * `parsePlaybackAuthorization`, the ONE place that turns a raw response into
 * this union):
 *
 * - HLS-ready media (Slice 11R; see the control workspace `DECISIONS.md`,
 *   "2026-08-11 - Slice 11R APPROVED"): `{ type: 'hls', masterUrl,
 *   renditions, expiresAt }` on the wire, normalized to `HlsPlaybackAuthorization`
 *   (`kind: 'hls'`). `masterUrl` is a backend-provided, adaptive-bitrate HLS
 *   manifest URL - the client plays it verbatim and never reconstructs or
 *   guesses at a storage/CDN path itself.
 * - local-backed or R2-backed (legacy/MP4) media (Slice 11M; see
 *   `DECISIONS.md`, "Slice 11M approved; playback contract decided (Option
 *   A, dedicated endpoint)", 2026-08-08): `{ playbackUrl, expiresAt,
 *   requiresAuthHeader }` on the wire (no `type` field), normalized to
 *   `Mp4PlaybackAuthorization` (`kind: 'mp4'`):
 *   - local-backed media: `requiresAuthHeader: true`, `playbackUrl` is the
 *     existing `/videos/:id/stream` URL.
 *   - R2-backed media: `requiresAuthHeader: false`, `playbackUrl` is a
 *     short-lived (15 minute) presigned GET URL straight to the storage
 *     provider. Attaching an Authorization header to this source is what
 *     breaks it - the provider rejects a request carrying two auth
 *     mechanisms at once ("only one auth mechanism").
 *
 * The app itself never learns which underlying storage kind it got beyond
 * this `kind` discriminant - see `resolvePlaybackSource` in
 * `video-service.ts` for the one place that turns this union into an
 * `expo-video` source.
 *
 * `expiresAt` is an ISO timestamp on both shapes. The caller must request a
 * new authorization once it has passed rather than reusing a dead URL, and
 * must never persist this value anywhere (not AsyncStorage, not a store) -
 * it is component state only, for exactly as long as it's needed.
 */
export type PlaybackRendition = {
  readonly quality: string;
  readonly width: number;
  readonly height: number;
  readonly url: string;
};

export type HlsPlaybackAuthorization = {
  readonly kind: 'hls';
  readonly masterUrl: string;
  readonly renditions: readonly PlaybackRendition[];
  readonly expiresAt: string;
};

export type Mp4PlaybackAuthorization = {
  readonly kind: 'mp4';
  readonly playbackUrl: string;
  readonly requiresAuthHeader: boolean;
  readonly expiresAt: string;
};

export type PlaybackAuthorization = HlsPlaybackAuthorization | Mp4PlaybackAuthorization;
