import type { VideoCategory } from '@/types/video';

/**
 * Discover sub-navigation tabs. These are Discover-local view states, not
 * router tabs - the root bottom navigation is untouched.
 */
export type DiscoverTabKey = 'home' | 'new' | 'rankings';

/**
 * Badges rendered on Discover poster cards. Both are DERIVED from data the
 * mobile app already receives; neither is a backend flag:
 *
 * - `Hot`: the series is in the top `HOT_BADGE_LIMIT` of the catalog by total
 *   like count (`likeCount` on `/videos/feed`, plus the local optimistic like
 *   from `useVideoInteractions`) AND leads the catalog median by at least
 *   `HOT_BADGE_MEDIAN_MULTIPLIER`. See `buildDiscoverCards`.
 * - `Premium`: the series contains at least one premium episode, per the
 *   existing `FREE_EPISODE_LIMIT` access rule in `series-service.ts`.
 *   "Premium" - not "VIP" - is the app's own existing user-facing word for
 *   that tier (`premium-preview-modal.tsx`), so Discover reuses it rather than
 *   introducing a second name for the same thing.
 *
 * There is deliberately no `New` badge: the mobile-visible video contract
 * (`BackendVideoDto`) carries no `createdAt`/`publishedAt`, so no truthful
 * recency claim can be made. See docs/discover-content-hub.md.
 */
export type DiscoverBadge = 'Hot' | 'Premium';

/**
 * One Discover catalog entry, projected from the authoritative `CatalogSeries`
 * the backend returns from `GET /series`. Every field maps to a real
 * backend-owned value - no placeholder view counts, ratings, or release dates,
 * and nothing derived from a representative episode.
 */
export type DiscoverSeriesCard = {
  readonly seriesId: string;
  /** Canonical backend title, rendered verbatim. */
  readonly title: string;
  /** Backend artwork, or `null` when none is uploaded - then the branded fallback. */
  readonly posterUrl: string | null;
  /**
   * `null` when the backend reports no shared category for the series. Never
   * guessed: a null-category series simply matches no category chip.
   */
  readonly category: VideoCategory | null;
  /** Backend-owned count of published drama episodes. */
  readonly episodeCount: number;
  /**
   * The backend's own `totalLikes` aggregate - a total across the series'
   * episodes, not a per-episode figure. Always labelled "total suka" in the UI.
   */
  readonly likeCount: number;
  readonly hasPremiumEpisodes: boolean;
  readonly badges: readonly DiscoverBadge[];
};
