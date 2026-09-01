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
 *   - local-backed media: `playbackUrl` is the existing `/videos/:id/stream`
 *     URL. `requiresAuthHeader` used to be an unconditional `true` here, but
 *     since the backend work unit "ANONYMOUS FREE-EPISODE PLAYBACK" it is
 *     DERIVED from the row's authoritative effective access tier: `false`
 *     for a FREE row (that route now serves free content to anonymous
 *     callers, so a guest with no token has nothing to attach and must not
 *     invent a `Bearer undefined`), `true` for a PREMIUM one (that route
 *     still refuses it without an active entitlement). It is a function of
 *     the CONTENT, never of the caller - the same row yields the same value
 *     for a guest, a signed-in non-entitled viewer, and a subscriber - so it
 *     leaks nothing about who asked and never contradicts the authorization
 *     decision the backend will actually make.
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

/**
 * Work unit "HLS MP4 FALLBACK": the progressive-MP4 source the backend now
 * additionally exposes on an HLS response (`HlsPlaybackResponseDto.fallback`).
 *
 * This is the thing `services/videos/hls-playback-flag.ts` used to say did
 * not exist. Before it, an HLS-ready video had exactly ONE playable source:
 * if the HLS engine could not play it - the kill switch was off, the browser
 * has no HLS support, or the player errored on the manifest - there was
 * nothing else to try and the item resolved to "video unavailable".
 *
 * Same three fields as `Mp4PlaybackAuthorization` (minus the `kind` tag)
 * because it IS the same thing: the backend builds it with the same helper
 * that produces a non-HLS row's whole response, so falling back lands on
 * exactly the source this video served before it was transcoded.
 *
 * OPTIONAL on the wire and optional here. The backend omits it rather than
 * sending something wrong when the row has no usable MP4 (e.g. its raw
 * source was reclaimed after transcoding), so its PRESENCE is a promise
 * there is something to play and its absence is not an error.
 *
 * `expiresAt` is this URL's own expiry, deliberately NOT the HLS token's -
 * a presigned R2 GET is minutes where the gateway token is an hour.
 */
export type Mp4PlaybackFallback = {
  readonly playbackUrl: string;
  readonly requiresAuthHeader: boolean;
  readonly expiresAt: string;
};

export type HlsPlaybackAuthorization = {
  readonly kind: 'hls';
  readonly masterUrl: string;
  readonly renditions: readonly PlaybackRendition[];
  readonly expiresAt: string;
  /** See `Mp4PlaybackFallback`. Absent when the backend has no MP4 to offer. */
  readonly fallback?: Mp4PlaybackFallback;
};

export type Mp4PlaybackAuthorization = {
  readonly kind: 'mp4';
  readonly playbackUrl: string;
  readonly requiresAuthHeader: boolean;
  readonly expiresAt: string;
};

export type PlaybackAuthorization = HlsPlaybackAuthorization | Mp4PlaybackAuthorization;
