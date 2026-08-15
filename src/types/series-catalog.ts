import type { Video, VideoCategory } from '@/types/video';

/**
 * The mobile model of a series as the BACKEND defines it, from
 * `GET /series` (`SeriesPublicDto` in the backend's
 * `src/series/series-public.types.ts`).
 *
 * This is deliberately NOT the same concept as `Series` in
 * `@/types/series`. That one is derived client-side by grouping
 * `/videos/feed` rows and takes its title/cover from a representative
 * episode; it still backs the bundled mock/demo catalog. This one is
 * authoritative: the title is curated server-side, and the aggregates are
 * computed by the backend from that series' own published drama episodes.
 */
export type CatalogSeries = {
  readonly id: string;
  /**
   * Canonical, backend-owned title. Rendered verbatim - never translated,
   * never suffix-stripped. It is the reason this endpoint exists: the
   * client-derived title was the representative episode's, which reads
   * "<Series> - Episode 1" on a series card.
   */
  readonly title: string;
  /**
   * Presigned cover URL, or `null` when no cover has been uploaded through
   * Admin yet. `null` is a normal state, not an error: Discover renders its
   * branded fallback for it and fabricates no artwork.
   */
  readonly coverUrl: string | null;
  /**
   * The category shared by every qualifying episode, or `null` when the
   * series has none or its episodes disagree. The backend never guesses it,
   * and neither does the client: a `null` category stays absent rather than
   * being inferred from one episode.
   */
  readonly category: VideoCategory | null;
  readonly sourceLanguage: string | null;
  /** Published, drama-classified episodes the backend counted. */
  readonly episodeCount: number;
  /** Backend-owned like aggregate. The client never re-sums episode likes. */
  readonly totalLikes: number;
  /**
   * Backend-owned premium aggregate, resolved by the same rule the stream
   * route enforces. The client never re-derives it from episode numbers.
   */
  readonly hasPremiumEpisodes: boolean;
};

/**
 * `GET /series/:id` - the same authoritative metadata plus every qualifying
 * episode, already ordered by `episodeNumber` ascending by the backend.
 * Episodes arrive in the same shape `/videos/feed` returns, so they map
 * through the existing video mapper and stay playable by the existing
 * playback path.
 */
export type CatalogSeriesDetail = CatalogSeries & {
  readonly episodes: readonly Video[];
};
