import { mapBackendVideoToVideo, type BackendVideoDto } from '@/services/videos/video-mapper';
import type { CatalogSeries, CatalogSeriesDetail } from '@/types/series-catalog';
import type { Video, VideoCategory } from '@/types/video';

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
 * Orders episodes for display: by episode number ascending, with the id as a
 * tie-break so two rows sharing a number still land in a stable, repeatable
 * order rather than whatever the input happened to be.
 *
 * This REVERSES an earlier deliberate decision to render the backend's order
 * verbatim (pinned by its own test, "does not re-sort the episodes the backend
 * already ordered"). That decision rested on an assumption the client cannot
 * check: nothing in docs/api-contract.md promises an ordering for this
 * endpoint's `episodes[]`, so "the backend already ordered them" was a hope,
 * not a contract. Sorting is a no-op when that hope holds and repairs the list
 * when it does not, and a deterministic episode list is a release requirement
 * - a viewer scrolling "Episode 3, Episode 1, Episode 2" reads that as a
 * broken app, not as a faithful rendering of a response.
 */
function byEpisodeNumber(left: Video, right: Video): number {
  return left.episodeNumber - right.episodeNumber || left.id.localeCompare(right.id);
}

/**
 * Maps `GET /series/:id`. Episodes reuse the existing video mapper, so a
 * series episode and a feed episode are the same `Video` and stay playable
 * through the untouched playback path.
 */
export function mapBackendSeriesDetail(dto: BackendSeriesDetailDto): CatalogSeriesDetail {
  assertField(Array.isArray(dto?.episodes), 'episodes', dto);

  return {
    ...mapBackendSeries(dto),
    // MAP FIRST, THEN FILTER. Filtering the raw wire value inverted
    // `resolveContentKind`'s production policy, which degrades an
    // unrecognised or missing `contentKind` to `drama` precisely because
    // "mislabelling real content as a fixture would erase it from every
    // user-facing surface" (see video-mapper.ts). Reading `episode.contentKind`
    // off the DTO skipped that degradation entirely: a backend that stopped
    // sending the field - or renamed its value - would match nothing here and
    // silently empty EVERY series, while the feed built from the same rows
    // carried on working. Filtering the mapped value routes both surfaces
    // through the one policy.
    //
    // The filter itself stays: it is the same user-facing boundary
    // `selectUserFacingCatalog` applies to the feed, so a QA fixture episode
    // cannot reach a normal surface just because it shares a seriesId.
    episodes: dto.episodes
      .map(mapBackendVideoToVideo)
      .filter((episode) => episode.contentKind === 'drama')
      .sort(byEpisodeNumber),
  };
}
