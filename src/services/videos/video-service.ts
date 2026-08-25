import { mockDramaVideos } from '@/data/mock-drama-videos';
import { ApiError, request } from '@/services/api/client';
import { isDemoMode } from '@/services/demo/demo-mode';
import { mapBackendVideoToVideo, type BackendVideoDto } from '@/services/videos/video-mapper';
import { AUTO_PLAYBACK_QUALITY, type PlaybackQuality } from '@/constants/playback-quality';
import type { Mp4PlaybackAuthorization, PlaybackAuthorization, PlaybackRendition } from '@/types/playback';
import type { Video, VideoCategory } from '@/types/video';

// Matches the backend's real presigned-GET/stream-URL expiry window (Slice
// 11M) so the synthesized mock-data response below behaves the same way a
// real one would if a test or a long-running demo session ever checked it.
const MOCK_PLAYBACK_AUTH_TTL_MS = 15 * 60 * 1000;

export type VideoCategoryFilter = 'All' | VideoCategory;

const categoryFilters: readonly VideoCategoryFilter[] = [
  'All',
  'Romance',
  'Revenge',
  'Family',
  'CEO',
  'Historical',
  'Action',
  'Comedy',
  'Drama',
];

/**
 * Demo mode implies mock data: an offline showcase build has no backend to
 * fetch a feed from, so it resolves the bundled catalog for the same reason
 * EXPO_PUBLIC_USE_MOCK_DATA does. Folding it in here means a demo build
 * needs one flag set, not two kept in sync.
 */
/**
 * Exported so the Series catalog service can honour the SAME offline rule
 * rather than keeping a second copy of it. An offline showcase build must
 * never reach the network from any catalog surface.
 */
export function shouldUseMockData(): boolean {
  return process.env.EXPO_PUBLIC_USE_MOCK_DATA === 'true' || isDemoMode();
}

function normalizeSearchValue(value: string) {
  return value.trim().toLowerCase();
}

function videoMatchesSearch(video: Video, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const searchableValues = [video.title, video.caption, video.channelName, video.category];

  return searchableValues.some((value) => value.toLowerCase().includes(normalizedQuery));
}

/**
 * Fetches the video feed from the backend, or resolves the bundled mock
 * data when EXPO_PUBLIC_USE_MOCK_DATA=true. Real API errors are not caught
 * here and are not silently replaced with mock data; callers (the video
 * catalog provider) surface them as a visible error state.
 */
/**
 * THE catalog boundary for the EPISODE feed.
 *
 * Home reads the catalog through `VideoCatalogProvider`, which calls exactly
 * this function. Discover and Series Detail no longer route through it: they
 * read `GET /series` and `GET /series/:id`, where the backend applies its own
 * published/drama restriction, and `mapBackendSeriesDetail` keeps the same
 * fixture exclusion on the episodes it returns - so filtering
 * here is what keeps those three surfaces derived from one identical source.
 * Filtering per-screen instead would let them drift, and Series Detail (which
 * resolves a series out of the same array) could still surface a fixture.
 *
 * `qa_fixture` rows are excluded from the USER-FACING catalog only. The
 * backend deliberately keeps serving them (they are `published`, and the 11R
 * HLS sample exists to be played) - this is a presentation decision, made on
 * the backend's explicit `contentKind` and on nothing else.
 *
 * No cap, no pagination, no slice: every `drama` row the backend returns
 * reaches the app.
 */
export function selectUserFacingCatalog(videos: readonly Video[]): readonly Video[] {
  return videos.filter((video) => video.contentKind === 'drama');
}

export async function getVideoFeed(): Promise<readonly Video[]> {
  if (shouldUseMockData()) {
    // The bundled catalog is its own source of truth and carries the same
    // classification, so the QA fixtures appended behind
    // EXPO_PUBLIC_INCLUDE_QA_FIXTURES stay reachable for local playback QA
    // exactly as before - they are opt-in by an env flag, not by accident.
    return mockDramaVideos;
  }

  const feed = await request<readonly BackendVideoDto[]>('videos/feed');

  return selectUserFacingCatalog(feed.map(mapBackendVideoToVideo));
}

export async function getVideoById(id: string): Promise<Video | undefined> {
  if (shouldUseMockData()) {
    return mockDramaVideos.find((video) => video.id === id);
  }

  try {
    const dto = await request<BackendVideoDto>(`videos/${id}`);

    return mapBackendVideoToVideo(dto);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return undefined;
    }

    throw error;
  }
}

/**
 * Validates the legacy/R2-MP4 response shape at the boundary, instead of
 * trusting a bare generic-typed cast: `{ playbackUrl, expiresAt,
 * requiresAuthHeader }`. A malformed or drifted response (a missing/renamed
 * field, a non-string `expiresAt`, an empty `playbackUrl`) would otherwise
 * either throw a render-time TypeError deep inside the player-source logic,
 * or - worse - silently resolve to an unusable "success," neither of which
 * is the designed "video unavailable" failure mode. `mapBackendVideoToVideo`
 * (`video-mapper.ts`) validates its own DTO the same way, for the same
 * reason. Used both for the real endpoint's legacy branch (via
 * `parsePlaybackAuthorization` below) and directly by mock-data mode, which
 * always synthesizes this shape.
 *
 * Requires the ABSENCE of a `type` field: a response that carries `type:
 * 'hls'` but fails HLS validation (e.g. a backend partial-rollout state
 * where a video is tagged `type: 'hls'` before its `masterUrl` is
 * populated) must never be allowed to fall through and silently validate
 * as the legacy shape just because it happens to also carry a legacy
 * `playbackUrl`/`requiresAuthHeader`/`expiresAt` triple - it must surface
 * the shape-mismatch throw instead.
 */
function isValidLegacyPlaybackAuthorization(
  value: unknown
): value is Omit<Mp4PlaybackAuthorization, 'kind'> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<
    Record<'type' | 'playbackUrl' | 'expiresAt' | 'requiresAuthHeader', unknown>
  >;

  return (
    candidate.type === undefined &&
    typeof candidate.playbackUrl === 'string' &&
    candidate.playbackUrl.length > 0 &&
    typeof candidate.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.expiresAt)) &&
    typeof candidate.requiresAuthHeader === 'boolean'
  );
}

function isValidPlaybackRendition(value: unknown): value is PlaybackRendition {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<Record<keyof PlaybackRendition, unknown>>;

  return (
    typeof candidate.quality === 'string' &&
    candidate.quality.length > 0 &&
    typeof candidate.width === 'number' &&
    Number.isFinite(candidate.width) &&
    typeof candidate.height === 'number' &&
    Number.isFinite(candidate.height) &&
    typeof candidate.url === 'string' &&
    candidate.url.length > 0
  );
}

/**
 * Validates the HLS-ready response shape (Slice 11R): `{ type: 'hls',
 * masterUrl, renditions, expiresAt }`. Every rendition entry is validated
 * too - a partially-malformed `renditions` array falls through to the same
 * shape-mismatch failure as a wholly wrong shape, rather than silently
 * dropping the bad entries.
 */
function isValidHlsWireResponse(
  value: unknown
): value is { type: 'hls'; masterUrl: string; renditions: PlaybackRendition[]; expiresAt: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<
    Record<'type' | 'masterUrl' | 'renditions' | 'expiresAt', unknown>
  >;

  return (
    candidate.type === 'hls' &&
    typeof candidate.masterUrl === 'string' &&
    candidate.masterUrl.length > 0 &&
    typeof candidate.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.expiresAt)) &&
    Array.isArray(candidate.renditions) &&
    candidate.renditions.every(isValidPlaybackRendition)
  );
}

const PLAYBACK_SHAPE_MISMATCH_MESSAGE =
  '[video-service] GET /videos/:id/playback returned a response that did not match the expected shape.';

/**
 * THE one place a raw `GET /videos/:id/playback` response is turned into
 * the internal discriminated union (`types/playback.ts`). A `type: 'hls'`
 * response normalizes to `{ kind: 'hls', ... }`; the legacy shape (no
 * `type` field) normalizes to `{ kind: 'mp4', ... }`; anything else throws
 * the same shape-mismatch error as before this slice - never containing the
 * URL or any other response field, so a signed URL never lands in a thrown
 * message.
 */
function parsePlaybackAuthorization(value: unknown): PlaybackAuthorization {
  if (isValidHlsWireResponse(value)) {
    return {
      kind: 'hls',
      masterUrl: value.masterUrl,
      renditions: value.renditions,
      expiresAt: value.expiresAt,
    };
  }

  if (isValidLegacyPlaybackAuthorization(value)) {
    return {
      kind: 'mp4',
      playbackUrl: value.playbackUrl,
      requiresAuthHeader: value.requiresAuthHeader,
      expiresAt: value.expiresAt,
    };
  }

  throw new Error(PLAYBACK_SHAPE_MISMATCH_MESSAGE);
}

/**
 * THE single, testable decision point for turning a resolved playback
 * authorization into an `expo-video` source - components must call this
 * rather than re-deriving the branching themselves.
 *
 * - `kind: 'hls'` and HLS preference enabled: plays the backend-provided
 *   `masterUrl` verbatim, with NO headers - the gateway token is
 *   path-embedded in the manifest URL, so attaching an Authorization header
 *   would break it the same way one breaks a presigned R2 MP4 URL (see
 *   `types/playback.ts`).
 * - `kind: 'mp4'`: byte-identical to the pre-Slice-11R behavior - the
 *   backend's `playbackUrl`, with an `Authorization: Bearer <token>` header
 *   attached only when `requiresAuthHeader` is true.
 * - `kind: 'hls'` and HLS preference disabled (the prefer-MP4 rollback
 *   flag): returns `null`. There is no MP4 URL embedded inside an HLS
 *   response to fall back to, so this resolves to the existing "video
 *   unavailable" state rather than attempting a reconstructed or guessed
 *   URL.
 *
 * Never reconstructs or guesses at a storage/CDN path - the `masterUrl`
 * and `playbackUrl` values are echoed exactly as the backend provided them.
 */
export function resolvePlaybackSource(
  auth: PlaybackAuthorization,
  accessToken: string | undefined,
  hlsEnabled: boolean,
  quality: PlaybackQuality = AUTO_PLAYBACK_QUALITY
): { uri: string; headers?: Record<string, string> } | null {
  if (auth.kind === 'hls') {
    if (!hlsEnabled) {
      return null;
    }

    if (quality.mode === 'manual') {
      const rendition = auth.renditions.find((entry) => entry.quality === quality.quality);

      // A requested rendition that this authorization does not list falls
      // through to the adaptive master rather than failing playback. That
      // happens when a refresh returns a re-transcoded ladder without the
      // chosen rung - degrading to adaptive is strictly better than a black
      // frame, and `resolveEffectiveQuality` makes the MENU agree by showing
      // Auto, so the UI never claims a rendition the player is not on.
      if (rendition) {
        return { uri: rendition.url };
      }
    }

    return { uri: auth.masterUrl };
  }

  return {
    uri: auth.playbackUrl,
    headers: auth.requiresAuthHeader ? { Authorization: `Bearer ${accessToken}` } : undefined,
  };
}

/**
 * Fetches short-lived authorization to play one video (Slice 11M, `GET
 * /videos/:id/playback` - see the control workspace `DECISIONS.md`, "Slice
 * 11M approved; playback contract decided (Option A, dedicated endpoint)",
 * 2026-08-08). Callers must attach `Authorization: Bearer <accessToken>` to
 * the returned `playbackUrl` ONLY when `requiresAuthHeader` is true - a
 * presigned R2 GET URL rejects a request that also carries an Authorization
 * header, and (work unit "ANONYMOUS FREE-EPISODE PLAYBACK") a FREE
 * local-backed row now reports `requiresAuthHeader: false` precisely so a
 * guest with no token has nothing to attach. `resolvePlaybackSource` above
 * is the one place that reads the flag.
 *
 * Work unit "ANONYMOUS FREE-EPISODE PLAYBACK": this endpoint no longer
 * REQUIRES a session. It is `OptionalJwtAuthGuard`-guarded on the backend -
 * no `Authorization` header at all is a valid anonymous request, and the
 * backend's single `enforceEntitlementGate` then decides FREE-vs-PREMIUM
 * and entitlement identically for guests and signed-in callers. Note that
 * `requiresAuth: true` below is therefore NOT "refuse without a token":
 * `request`'s auth handling attaches a header only when one exists
 * (`buildAuthHeader` returns `{}` otherwise) and, critically, keeps the
 * refresh-and-retry-once behavior on a `401 INVALID_ACCESS_TOKEN`. Dropping
 * it would silently turn an expired session into an anonymous request -
 * exactly the downgrade the backend's guard refuses to make.
 *
 * Throws for every failure mode: an `ApiError` for 404 (not found / not
 * published), 401 `INVALID_ACCESS_TOKEN` (a SUPPLIED but invalid/expired
 * credential - never a guest, who supplies none), 403 `ENTITLEMENT_REQUIRED`
 * (premium episode, no entitlement - returned byte-for-byte identically to a
 * guest and to a signed-in non-entitled caller), 409
 * `MEDIA_PLAYBACK_SOURCE_UNAVAILABLE` (row has no usable storage); a plain
 * `Error` (never containing the URL or any other response field - see
 * `parsePlaybackAuthorization` above) for a 200 response whose shape doesn't
 * validate as either the HLS (Slice 11R) or legacy/MP4 (Slice 11M) shape.
 * None of these are caught here; callers decide how to present them - see
 * `drama-feed-item.tsx`'s `isSignInActionablePlaybackAuthError`, which
 * LABELS a refusal for display and never makes one.
 *
 * In mock-data mode this never reaches the network: it synthesizes a
 * `kind: 'mp4'` authorization from the matching mock video's own bundled
 * `playbackUrl`, mirroring how `getVideoFeed`/`getVideoById` above already
 * short-circuit for mock data - and, like the real path, throws (rather
 * than resolving an empty URL) when no mock video matches the id, so an
 * unknown id behaves the same "unavailable" way a real backend's 404
 * would. A demo build's bundled clips resolve to a local asset URI with
 * nothing to authorize, so `requiresAuthHeader` is false there, matching
 * the pre-Slice-11M "no Authorization header for a bundled clip" contract;
 * non-demo mock-data mode keeps requiring a header, matching the real
 * backend default it stands in for.
 */
export async function getPlaybackAuthorization(videoId: string): Promise<PlaybackAuthorization> {
  if (shouldUseMockData()) {
    const mockVideo = mockDramaVideos.find((video) => video.id === videoId);
    const authorization = {
      playbackUrl: mockVideo?.playbackUrl ?? '',
      expiresAt: new Date(Date.now() + MOCK_PLAYBACK_AUTH_TTL_MS).toISOString(),
      requiresAuthHeader: !isDemoMode(),
    };

    if (!isValidLegacyPlaybackAuthorization(authorization)) {
      throw new Error(`[video-service] No mock video found for id "${videoId}".`);
    }

    return { kind: 'mp4', ...authorization };
  }

  const response = await request<unknown>(
    `videos/${videoId}/playback`,
    { method: 'GET' },
    { requiresAuth: true }
  );

  return parsePlaybackAuthorization(response);
}

export function searchVideos(
  videos: readonly Video[],
  query: string,
  category: VideoCategoryFilter = 'All'
): readonly Video[] {
  const normalizedQuery = normalizeSearchValue(query);

  return videos.filter((video) => {
    const matchesCategory = category === 'All' || video.category === category;
    const matchesSearch = videoMatchesSearch(video, normalizedQuery);

    return matchesCategory && matchesSearch;
  });
}

/**
 * Resolves saved video IDs against the given catalog. IDs with no matching
 * video in the catalog (e.g. removed from the backend) are safely skipped.
 */
export function getSavedVideos(
  videos: readonly Video[],
  savedVideoIds: readonly string[]
): readonly Video[] {
  const savedVideoIdSet = new Set(savedVideoIds);

  return videos.filter((video) => savedVideoIdSet.has(video.id));
}

export function getCategories(): readonly VideoCategoryFilter[] {
  return categoryFilters;
}
