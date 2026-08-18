import { ApiError, request } from '@/services/api/client';
import { groupVideosIntoSeries } from '@/services/videos/series-service';
import { getVideoFeed, shouldUseMockData } from '@/services/videos/video-service';
import {
  mapBackendSeries,
  mapBackendSeriesDetail,
  type BackendSeriesDetailDto,
  type BackendSeriesListDto,
} from '@/services/series/series-mapper';
import type { CatalogSeries, CatalogSeriesDetail } from '@/types/series-catalog';
import type { Video } from '@/types/video';

const HTTP_NOT_FOUND = 404;

/**
 * Offline/demo adapter. The bundled catalog is a `Video[]` with no series
 * rows behind it, so mock mode keeps deriving series by grouping those
 * fixtures - the pre-existing `groupVideosIntoSeries` path. This is the ONLY
 * place that derivation is still used for a catalog surface; the real API
 * mode never groups videos.
 *
 * The shape it produces is the same `CatalogSeries` the backend returns, so
 * every screen above stays source-agnostic.
 *
 * `hasPremiumEpisodes` below is the ONE place this client aggregates that
 * boolean itself, and it is NOT a second access policy: offline there is no
 * `GET /series` response to read the backend's aggregate from, and the value
 * is an `.some()` over episode `accessType`s that were themselves copied from
 * each fixture's explicit `accessTier` - never computed from an episode
 * number. Real API mode never reaches this function; it reads the backend's
 * own `hasPremiumEpisodes` through `mapBackendSeries`.
 */
function toCatalogSeriesFromVideos(videos: readonly Video[]): readonly CatalogSeries[] {
  return groupVideosIntoSeries(videos).map((series) => ({
    id: series.id,
    title: series.title,
    coverUrl: series.coverUrl.length > 0 ? series.coverUrl : null,
    category: series.category,
    sourceLanguage: null,
    episodeCount: series.episodeCount,
    totalLikes: videos
      .filter((video) => video.seriesId === series.id)
      .reduce((total, video) => total + video.likeCount, 0),
    hasPremiumEpisodes: series.episodes.some((episode) => episode.accessType === 'premium'),
  }));
}

/**
 * `GET /series` - the authoritative curated catalog.
 *
 * The backend already restricts this to published, `contentKind: "drama"`
 * series, so there is no client-side fixture filter here: the QA rows that
 * `/videos/feed` still carries never reach this endpoint at all. There is
 * also no cap, slice or pagination - the response envelope is
 * `{ items: [...] }` and every item is returned.
 */
export async function getSeriesCatalog(): Promise<readonly CatalogSeries[]> {
  if (shouldUseMockData()) {
    return toCatalogSeriesFromVideos(await getVideoFeed());
  }

  const response = await request<BackendSeriesListDto>('series');

  if (!response || !Array.isArray(response.items)) {
    throw new ApiError(
      0,
      'INVALID_RESPONSE',
      '[series-catalog] GET /series did not return an { items: [] } envelope.'
    );
  }

  return response.items.map(mapBackendSeries);
}

/**
 * `GET /series/:id` - authoritative metadata plus every episode of that
 * series, already ordered by `episodeNumber` ascending server-side.
 *
 * Resolves to `undefined` for a series that does not exist (the backend
 * answers `404 SERIES_NOT_FOUND`), matching how `getVideoById` treats a
 * missing video, so a screen can render "not found" instead of an error.
 * Every other failure propagates as an `ApiError` for the caller's error
 * state.
 */
export async function getSeriesDetail(id: string): Promise<CatalogSeriesDetail | undefined> {
  if (shouldUseMockData()) {
    const videos = await getVideoFeed();
    const series = toCatalogSeriesFromVideos(videos).find((entry) => entry.id === id);

    return series
      ? {
          ...series,
          episodes: videos
            .filter((video) => video.seriesId === id)
            .sort((left, right) => left.episodeNumber - right.episodeNumber),
        }
      : undefined;
  }

  try {
    const dto = await request<BackendSeriesDetailDto>(`series/${encodeURIComponent(id)}`);

    return mapBackendSeriesDetail(dto);
  } catch (error) {
    if (error instanceof ApiError && error.status === HTTP_NOT_FOUND) {
      return undefined;
    }

    throw error;
  }
}
