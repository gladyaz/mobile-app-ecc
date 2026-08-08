import { mockDramaVideos } from '@/data/mock-drama-videos';
import { ApiError, request } from '@/services/api/client';
import { isDemoMode } from '@/services/demo/demo-mode';
import { mapBackendVideoToVideo, type BackendVideoDto } from '@/services/videos/video-mapper';
import type { PlaybackAuthorization } from '@/types/playback';
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
function shouldUseMockData(): boolean {
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
export async function getVideoFeed(): Promise<readonly Video[]> {
  if (shouldUseMockData()) {
    return mockDramaVideos;
  }

  const feed = await request<readonly BackendVideoDto[]>('videos/feed');

  return feed.map(mapBackendVideoToVideo);
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
 * Validates the shape of a `GET /videos/:id/playback` response at the
 * boundary, instead of trusting a bare generic-typed cast. A malformed or
 * drifted response (a missing/renamed field, a non-string `expiresAt`, an
 * empty `playbackUrl`) would otherwise either throw a render-time
 * TypeError deep inside the player-source logic, or - worse - silently
 * resolve to an unusable "success," neither of which is the designed
 * "video unavailable" failure mode. `mapBackendVideoToVideo`
 * (`video-mapper.ts`) validates its own DTO the same way, for the same
 * reason.
 */
function isValidPlaybackAuthorization(value: unknown): value is PlaybackAuthorization {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<Record<keyof PlaybackAuthorization, unknown>>;

  return (
    typeof candidate.playbackUrl === 'string' &&
    candidate.playbackUrl.length > 0 &&
    typeof candidate.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(candidate.expiresAt)) &&
    typeof candidate.requiresAuthHeader === 'boolean'
  );
}

/**
 * Fetches short-lived authorization to play one video (Slice 11M, `GET
 * /videos/:id/playback` - see the control workspace `DECISIONS.md`, "Slice
 * 11M approved; playback contract decided (Option A, dedicated endpoint)",
 * 2026-08-08). Requires auth. Callers must attach `Authorization: Bearer
 * <accessToken>` to the returned `playbackUrl` ONLY when
 * `requiresAuthHeader` is true - a presigned R2 GET URL rejects a request
 * that also carries an Authorization header.
 *
 * Throws for every failure mode: an `ApiError` for 404 (not found / not
 * published), 401 (unauthenticated), 403 `ENTITLEMENT_REQUIRED` (premium
 * episode, no entitlement), 409 `MEDIA_PLAYBACK_SOURCE_UNAVAILABLE` (row
 * has no usable storage); a plain `Error` (never containing the URL or any
 * other response field - see `isValidPlaybackAuthorization` above) for a
 * 200 response whose shape doesn't validate. None of these are caught
 * here; callers are expected to fold all of them into the same "video
 * unavailable" error state rather than distinguishing them in the UI.
 *
 * In mock-data mode this never reaches the network: it synthesizes an
 * authorization from the matching mock video's own bundled `playbackUrl`,
 * mirroring how `getVideoFeed`/`getVideoById` above already short-circuit
 * for mock data - and, like the real path, throws (rather than resolving
 * an empty URL) when no mock video matches the id, so an unknown id
 * behaves the same "unavailable" way a real backend's 404 would. A demo
 * build's bundled clips resolve to a local asset URI with nothing to
 * authorize, so `requiresAuthHeader` is false there, matching the
 * pre-Slice-11M "no Authorization header for a bundled clip" contract;
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

    if (!isValidPlaybackAuthorization(authorization)) {
      throw new Error(`[video-service] No mock video found for id "${videoId}".`);
    }

    return authorization;
  }

  const response = await request<unknown>(
    `videos/${videoId}/playback`,
    { method: 'GET' },
    { requiresAuth: true }
  );

  if (!isValidPlaybackAuthorization(response)) {
    throw new Error(
      '[video-service] GET /videos/:id/playback returned a response that did not match the expected shape.'
    );
  }

  return response;
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
