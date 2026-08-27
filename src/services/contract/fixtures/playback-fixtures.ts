/**
 * CANONICAL `GET /videos/:id/playback` WIRE PAYLOADS.
 *
 * ## Why this file declares its own types
 *
 * `@/types/playback` models the NORMALIZED union the app works in
 * (`kind: 'hls' | 'mp4'`), not the wire. The wire is two separate,
 * deliberately un-merged backend DTOs: an HLS row answers
 * `{type:'hls', ...}` and every non-HLS row answers a shape with NO `type`
 * field at all, byte-identical to what it answered before HLS existed.
 * `parsePlaybackAuthorization` is the one place that crosses the two, so the
 * wire shapes have never had a name in this repository.
 *
 * They get one here, TEST-ONLY, because a fixture has to be typed against
 * something for the type checker to grade it - and the discriminant itself
 * (`type` present vs absent) is the single most drift-prone part of this
 * contract. Mirrored from `src/videos/video.types.ts` at the commit in
 * `provenance.ts`.
 *
 * ## Dimensions are portrait
 *
 * Every rung is `shortSide x longSide` for a 1080x1920 vertical source,
 * because that is what a short-drama master actually is. It matters: a label
 * derived from `height` would read "1920p", which is why the quality menu
 * derives from `Math.min(width, height)` and treats the backend's own
 * `quality` name as the authority.
 */

/** One rung, mirroring `HlsRenditionPlaybackDto`. */
export interface HlsRenditionWire {
  quality: string;
  width: number;
  height: number;
  url: string;
}

/** Mirrors `HlsPlaybackResponseDto`. The `type` discriminant is required. */
export interface HlsPlaybackWire {
  type: 'hls';
  masterUrl: string;
  renditions: HlsRenditionWire[];
  expiresAt: string;
}

/**
 * Mirrors `VideoPlaybackResponseDto`. NOTE THE ABSENCE OF `type` - that is
 * the discriminant, and a legacy response that grew one would no longer be a
 * legacy response.
 */
export interface Mp4PlaybackWire {
  playbackUrl: string;
  expiresAt: string;
  requiresAuthHeader: boolean;
}

const GATEWAY = 'https://hls.example.invalid/t/fixture-gateway-token';
const EXPIRES_AT = '2026-08-27T04:15:00.000Z';

const RUNG_360: HlsRenditionWire = {
  quality: '360p',
  width: 360,
  height: 640,
  url: `${GATEWAY}/360p/index.m3u8`,
};
const RUNG_540: HlsRenditionWire = {
  quality: '540p',
  width: 540,
  height: 960,
  url: `${GATEWAY}/540p/index.m3u8`,
};
const RUNG_720: HlsRenditionWire = {
  quality: '720p',
  width: 720,
  height: 1280,
  url: `${GATEWAY}/720p/index.m3u8`,
};
const RUNG_1080: HlsRenditionWire = {
  quality: '1080p',
  width: 1080,
  height: 1920,
  url: `${GATEWAY}/1080p/index.m3u8`,
};

/**
 * A 1080x1920 source: all four rungs. One token covers the master playlist
 * and every variant, and one `expiresAt` covers all of them.
 */
export const HLS_FULL_LADDER = {
  type: 'hls',
  masterUrl: `${GATEWAY}/master.m3u8`,
  renditions: [RUNG_360, RUNG_540, RUNG_720, RUNG_1080],
  expiresAt: EXPIRES_AT,
} satisfies HlsPlaybackWire;

/**
 * A 720x1280 source. The transcoder NEVER adds a rung above the source, so
 * there is simply no 1080p entry - and the quality menu must therefore offer
 * no 1080p option. This is the fixture that proves the app cannot fabricate
 * a rendition the backend did not send.
 */
export const HLS_NO_1080 = {
  type: 'hls',
  masterUrl: `${GATEWAY}/master.m3u8`,
  renditions: [RUNG_360, RUNG_540, RUNG_720],
  expiresAt: EXPIRES_AT,
} satisfies HlsPlaybackWire;

/**
 * A sub-540 source that produced ONE rung. Below two renditions there is
 * nothing to choose between - "Auto" and the single rung would be the same
 * stream under two names - so the quality section is hidden entirely.
 */
export const HLS_SINGLE_RENDITION = {
  type: 'hls',
  masterUrl: `${GATEWAY}/master.m3u8`,
  renditions: [RUNG_360],
  expiresAt: EXPIRES_AT,
} satisfies HlsPlaybackWire;

/**
 * An HLS response from a LATER backend carrying fields this build has never
 * heard of, at both the top level and inside a rendition. It must be
 * accepted and the known fields echoed verbatim: the backend adds fields
 * additively, and a client that refused an unknown key would break on the
 * next server release.
 */
export const HLS_WITH_UNKNOWN_EXTRA_FIELDS: unknown = {
  type: 'hls',
  masterUrl: `${GATEWAY}/master.m3u8`,
  renditions: [
    { ...RUNG_360, codecString: 'avc1.4d401e', bandwidth: 600_000 },
    { ...RUNG_540, codecString: 'avc1.4d401f', bandwidth: 1_200_000 },
  ],
  expiresAt: EXPIRES_AT,
  drmScheme: 'none',
  cdnRegion: 'apac',
};

/* -------------------------------------------------------------------------
 * MP4 / LEGACY
 * ---------------------------------------------------------------------- */

/**
 * A FREE local-backed row. `requiresAuthHeader` is `false` since the
 * "anonymous free-episode playback" work unit: `/stream` now serves free
 * content to anonymous callers, so a guest with no token has nothing to
 * attach and must not invent a `Bearer undefined`.
 */
export const MP4_LOCAL_FREE = {
  playbackUrl: 'https://api.example.invalid/videos/vid_fixture/stream',
  expiresAt: EXPIRES_AT,
  requiresAuthHeader: false,
} satisfies Mp4PlaybackWire;

/**
 * A PREMIUM local-backed row. `/stream` still refuses it without an active
 * entitlement, re-checked on every request, so the header is required.
 *
 * V1 ships `CONTENT_ACCESS_MODE=free`, so no V1 deployment produces this -
 * it is kept because the flag is a function of the CONTENT and the parser
 * must keep reading it correctly if the posture ever changes.
 */
export const MP4_LOCAL_PREMIUM = {
  playbackUrl: 'https://api.example.invalid/videos/vid_fixture_premium/stream',
  expiresAt: EXPIRES_AT,
  requiresAuthHeader: true,
} satisfies Mp4PlaybackWire;

/**
 * An R2-backed row: a short-lived presigned GET straight to the storage
 * provider. Attaching an Authorization header to this is what BREAKS it -
 * the provider rejects a request carrying two auth mechanisms at once.
 */
export const MP4_R2_PRESIGNED = {
  playbackUrl:
    'https://media.example.invalid/vid_fixture.mp4?X-Amz-Signature=fixture-not-a-real-signature',
  expiresAt: EXPIRES_AT,
  requiresAuthHeader: false,
} satisfies Mp4PlaybackWire;

/* -------------------------------------------------------------------------
 * MALFORMED / DRIFTED
 * ---------------------------------------------------------------------- */

/**
 * THE PARTIAL-ROLLOUT TRAP. A row tagged `type: 'hls'` before its
 * `masterUrl` was populated, that ALSO still carries a full legacy triple.
 *
 * It must NOT silently validate as the legacy shape - that would play an MP4
 * while the backend believes it served HLS, hiding a half-finished migration
 * behind working playback. The legacy validator therefore requires the
 * ABSENCE of `type`.
 */
export const HLS_TAGGED_BUT_LEGACY_SHAPED: unknown = {
  type: 'hls',
  playbackUrl: 'https://api.example.invalid/videos/vid_fixture/stream',
  expiresAt: EXPIRES_AT,
  requiresAuthHeader: true,
};

/** Tagged HLS with no master playlist to play. */
export const HLS_MISSING_MASTER_URL: unknown = {
  type: 'hls',
  renditions: [RUNG_360, RUNG_540],
  expiresAt: EXPIRES_AT,
};

/** An empty `masterUrl` - structurally a string, operationally nothing to play. */
export const HLS_EMPTY_MASTER_URL: unknown = {
  type: 'hls',
  masterUrl: '',
  renditions: [RUNG_360],
  expiresAt: EXPIRES_AT,
};

/**
 * ONE malformed rung among good ones. The whole authorization fails rather
 * than the bad entry being dropped: a silently shortened ladder is a menu
 * that lies about what the backend produced.
 */
export const HLS_RENDITION_MISSING_DIMENSIONS: unknown = {
  type: 'hls',
  masterUrl: `${GATEWAY}/master.m3u8`,
  renditions: [RUNG_360, { quality: '540p', url: `${GATEWAY}/540p/index.m3u8` }],
  expiresAt: EXPIRES_AT,
};

/** Dimensions sent as strings - a JSON-serialisation drift, not a rename. */
export const HLS_STRING_DIMENSIONS: unknown = {
  type: 'hls',
  masterUrl: `${GATEWAY}/master.m3u8`,
  renditions: [{ quality: '360p', width: '360', height: '640', url: `${GATEWAY}/360p/index.m3u8` }],
  expiresAt: EXPIRES_AT,
};

/** `NaN`/`Infinity` dimensions, which `Number.isFinite` is there to catch. */
export const HLS_NON_FINITE_DIMENSIONS: unknown = {
  type: 'hls',
  masterUrl: `${GATEWAY}/master.m3u8`,
  renditions: [
    { quality: '360p', width: Number.NaN, height: 640, url: `${GATEWAY}/360p/index.m3u8` },
  ],
  expiresAt: EXPIRES_AT,
};

/** An `expiresAt` that is not a parseable instant. */
export const HLS_UNPARSEABLE_EXPIRY: unknown = {
  type: 'hls',
  masterUrl: `${GATEWAY}/master.m3u8`,
  renditions: [RUNG_360, RUNG_540],
  expiresAt: 'soon',
};

/** A legacy response missing the flag that decides whether to send a header. */
export const MP4_MISSING_REQUIRES_AUTH_HEADER: unknown = {
  playbackUrl: 'https://api.example.invalid/videos/vid_fixture/stream',
  expiresAt: EXPIRES_AT,
};

/** A legacy response with an empty URL - nothing to play, and not an error state. */
export const MP4_EMPTY_PLAYBACK_URL: unknown = {
  playbackUrl: '',
  expiresAt: EXPIRES_AT,
  requiresAuthHeader: false,
};

/**
 * A FUTURE THIRD KIND. Neither branch validates it, so it must surface the
 * shape-mismatch failure rather than be guessed at - the app has no player
 * for a format it has never heard of.
 */
export const PLAYBACK_FUTURE_KIND: unknown = {
  type: 'dash',
  manifestUrl: 'https://dash.example.invalid/vid_fixture/manifest.mpd',
  expiresAt: EXPIRES_AT,
};

export const PLAYBACK_NOT_AN_OBJECT: unknown = 'https://api.example.invalid/stream';
