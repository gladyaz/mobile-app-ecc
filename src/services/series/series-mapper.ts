import { mapBackendVideoToVideo, type BackendVideoDto } from '@/services/videos/video-mapper';
import type { CatalogSeries, CatalogSeriesDetail } from '@/types/series-catalog';
import type { VideoCategory } from '@/types/video';

/**
 * Wire shape of `SeriesPublicDto` (backend
 * `src/series/series-public.types.ts`). `coverUrl`, `category` and
 * `sourceLanguage` are genuinely nullable there and are typed that way here
 * rather than being coerced to `''` - a missing cover is a state Discover
 * renders deliberately, not an empty string to paper over.
 */
export type BackendSeriesDto = {
  readonly id: string;
  readonly title: string;
  readonly coverUrl: string | null;
  readonly category: string | null;
  readonly sourceLanguage: string | null;
  readonly episodeCount: number;
  readonly totalLikes: number;
  readonly hasPremiumEpisodes: boolean;
};

/** `GET /series` envelope - an object, not a bare array, so pagination can be added later. */
export type BackendSeriesListDto = {
  readonly items: readonly BackendSeriesDto[];
};

/** `GET /series/:id` - the same fields plus every qualifying episode. */
export type BackendSeriesDetailDto = BackendSeriesDto & {
  readonly episodes: readonly BackendVideoDto[];
};

const VIDEO_CATEGORIES: readonly VideoCategory[] = [
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
 * The backend sends categories lower-cased (`"action"`), while the mobile
 * union is capitalised. Matching is case-insensitive, exactly as the video
 * mapper already does.
 *
 * An unknown or absent category resolves to `null` - never to a guess and
 * never to a default. The backend itself returns `null` when a series' own
 * episodes disagree, and inventing a value here would be exactly the
 * fabrication this contract exists to avoid.
 */
function normalizeCategory(value: string | null): VideoCategory | null {
  if (typeof value !== 'string') {
    return null;
  }

  return VIDEO_CATEGORIES.find((category) => category.toLowerCase() === value.toLowerCase()) ?? null;
}

function assertField(condition: boolean, fieldName: string, dto: unknown): void {
  if (!condition) {
    throw new Error(
      `[series-mapper] Backend series is missing or has an invalid "${fieldName}" field: ${JSON.stringify(dto)}`
    );
  }
}

/**
 * Maps one `SeriesPublicDto`. The title is copied verbatim: it is the
 * curated, backend-owned string, and the whole point of this endpoint is
 * that the client no longer derives a title from a representative episode.
 * Nothing here strips, splits or rewrites it.
 */
export function mapBackendSeries(dto: BackendSeriesDto): CatalogSeries {
  assertField(typeof dto?.id === 'string' && dto.id.length > 0, 'id', dto);
  assertField(typeof dto.title === 'string' && dto.title.length > 0, 'title', dto);
  assertField(typeof dto.episodeCount === 'number', 'episodeCount', dto);
  assertField(typeof dto.totalLikes === 'number', 'totalLikes', dto);
  assertField(typeof dto.hasPremiumEpisodes === 'boolean', 'hasPremiumEpisodes', dto);

  return {
    id: dto.id,
    title: dto.title,
    coverUrl: typeof dto.coverUrl === 'string' && dto.coverUrl.length > 0 ? dto.coverUrl : null,
    category: normalizeCategory(dto.category),
    sourceLanguage: typeof dto.sourceLanguage === 'string' ? dto.sourceLanguage : null,
    episodeCount: dto.episodeCount,
    totalLikes: dto.totalLikes,
    hasPremiumEpisodes: dto.hasPremiumEpisodes,
  };
}

/**
 * Maps `GET /series/:id`. Episodes reuse the existing video mapper, so a
 * series episode and a feed episode are the same `Video` and stay playable
 * through the untouched playback path. Backend order (`episodeNumber`
 * ascending) is preserved as sent - the client does not re-sort.
 */
export function mapBackendSeriesDetail(dto: BackendSeriesDetailDto): CatalogSeriesDetail {
  assertField(Array.isArray(dto?.episodes), 'episodes', dto);

  return {
    ...mapBackendSeries(dto),
    // Same user-facing boundary `selectUserFacingCatalog` applies to the feed:
    // a QA fixture episode must not reach a normal surface just because it
    // shares a seriesId. The backend is expected to exclude them here too;
    // this keeps the client's own guarantee rather than assuming it.
    episodes: dto.episodes
      .filter((episode) => episode.contentKind === 'drama')
      .map(mapBackendVideoToVideo),
  };
}
