import { ApiError, request } from '@/services/api/client';
import {
  mapBackendSeries,
  mapBackendSeriesDetail,
  type BackendSeriesDetailDto,
  type BackendSeriesListDto,
} from '@/services/series/series-mapper';
import type { CatalogSeries, CatalogSeriesDetail } from '@/types/series-catalog';

const HTTP_NOT_FOUND = 404;

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
  const response = await request<BackendSeriesListDto>('series');

  if (!response || !Array.isArray(response.items)) {
    throw new ApiError(
      200,
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
