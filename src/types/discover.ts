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
 * One Discover catalog entry: a series, derived entirely from the already
 * fetched `/videos/feed` response. Every field maps to a real value - no
 * placeholder view counts, ratings, or release dates.
 */
export type DiscoverSeriesCard = {
  readonly seriesId: string;
  readonly title: string;
  readonly posterUrl: string;
  readonly category: VideoCategory;
  readonly channelName: string;
  /** Episodes for this series present in the fetched catalog page. */
  readonly episodeCount: number;
  /**
   * Sum of the app's displayed like count across those episodes - a total, not
   * a per-episode figure. Always labelled "total suka" in the UI.
   */
  readonly likeCount: number;
  readonly hasPremiumEpisodes: boolean;
  readonly badges: readonly DiscoverBadge[];
};
