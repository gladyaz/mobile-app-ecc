import type { TranslationKey } from '@/services/i18n/translations';
import type { Translate } from '@/stores/language';
import { groupVideosIntoSeries } from '@/services/videos/series-service';
import type { VideoCategoryFilter } from '@/services/videos/video-service';
import type { DiscoverBadge, DiscoverSeriesCard } from '@/types/discover';
import type { Video } from '@/types/video';

/**
 * How many top-ranked series can earn the `Hot` badge. Kept small so the
 * badge stays a signal instead of decoration.
 */
export const HOT_BADGE_LIMIT = 3;

/**
 * A `Hot` series must also lead the catalog by a clear margin: at least this
 * multiple of the catalog's median like count. Without it, a top-3 rule alone
 * badges 3 of 5 series on a small catalog, which is decoration, not signal.
 */
export const HOT_BADGE_MEDIAN_MULTIPLIER = 2;

/**
 * Absolute floor for the `Hot` threshold. Without it, a catalog where half the
 * series have no likes yet (i.e. a fresh backend) has a median of 0, the
 * multiplier gate evaluates to 0, and a single like from the viewer would be
 * enough to badge a series as Hot.
 */
export const HOT_BADGE_MIN_LIKE_TOTAL = 100;

/** Matches `useVideoInteractions().getLikeCount`. */
export type LikeCountResolver = (video: Video) => number;

type DiscoverSeriesCardDraft = Omit<DiscoverSeriesCard, 'badges'>;

function sumLikeCountsBySeriesId(
  videos: readonly Video[],
  resolveLikeCount: LikeCountResolver
): ReadonlyMap<string, number> {
  const likeCountsBySeriesId = new Map<string, number>();

  for (const video of videos) {
    const runningTotal = likeCountsBySeriesId.get(video.seriesId) ?? 0;

    likeCountsBySeriesId.set(video.seriesId, runningTotal + resolveLikeCount(video));
  }

  return likeCountsBySeriesId;
}

/**
 * Sorts by the documented ranking metric (like count) with fully
 * deterministic tie-breakers, so two renders of the same catalog can never
 * produce two different orders. Returns a new array; the input is untouched.
 */
function sortByLikeCountDesc<T extends DiscoverSeriesCardDraft>(cards: readonly T[]): readonly T[] {
  return [...cards].sort((left, right) => {
    if (left.likeCount !== right.likeCount) {
      return right.likeCount - left.likeCount;
    }

    if (left.episodeCount !== right.episodeCount) {
      return right.episodeCount - left.episodeCount;
    }

    const titleComparison = left.title.localeCompare(right.title);

    return titleComparison !== 0 ? titleComparison : left.seriesId.localeCompare(right.seriesId);
  });
}

/**
 * Lower median: for an even-sized catalog this takes the lower of the two
 * middle values rather than averaging them. Averaging makes the gate
 * unreachable on a two-series catalog - the mean of both values is their
 * midpoint, so no leader can ever be twice it, and a 24x lead would go
 * unbadged.
 */
function medianLikeCount(cards: readonly DiscoverSeriesCardDraft[]): number {
  if (cards.length === 0) {
    return 0;
  }

  const sortedLikeCounts = cards.map((card) => card.likeCount).sort((left, right) => left - right);

  return sortedLikeCounts[Math.floor((sortedLikeCounts.length - 1) / 2)];
}

/**
 * Deliberately conservative. On a catalog whose like counts slope gently
 * (say 6k/5k/4k/3k/2k) nothing is badged, because no series stands out - a
 * missing badge there is the intended answer, not a bug to be fixed by
 * removing this gate.
 */
function resolveHotSeriesIds(cards: readonly DiscoverSeriesCardDraft[]): ReadonlySet<string> {
  const threshold = Math.max(
    medianLikeCount(cards) * HOT_BADGE_MEDIAN_MULTIPLIER,
    HOT_BADGE_MIN_LIKE_TOTAL
  );

  return new Set(
    sortByLikeCountDesc(cards)
      .slice(0, HOT_BADGE_LIMIT)
      .filter((card) => card.likeCount > 0 && card.likeCount >= threshold)
      .map((card) => card.seriesId)
  );
}

function buildBadges(
  card: DiscoverSeriesCardDraft,
  hotSeriesIds: ReadonlySet<string>
): readonly DiscoverBadge[] {
  // Premium first: it is the access status, so it takes the prime corner of
  // the poster and is read out first. Hot follows as the editorial signal.
  const badges: DiscoverBadge[] = [];

  if (card.hasPremiumEpisodes) {
    badges.push('Premium');
  }

  if (hotSeriesIds.has(card.seriesId)) {
    badges.push('Hot');
  }

  return badges;
}

/**
 * Projects the already-fetched `/videos/feed` catalog into Discover series
 * cards.
 *
 * Order is the backend's own catalog order: `groupVideosIntoSeries` keeps
 * first-seen `seriesId` order, and nothing here re-sorts. That matters
 * because the New tab presents this order as-is - see
 * docs/discover-content-hub.md for why no truthful publication-date sort is
 * possible today.
 *
 * `Hot` is computed once over the whole catalog (never over a filtered or
 * searched subset) so the badge means the same thing on every screen.
 *
 * `likeCount` here is the SUM of the series' episode like counts in the
 * fetched catalog page, which is what the Rankings tab labels as
 * "total suka". It is therefore sensitive to how many episodes of a series
 * that page happens to contain - see docs/discover-content-hub.md.
 */
export function buildDiscoverCards(
  videos: readonly Video[],
  resolveLikeCount: LikeCountResolver
): readonly DiscoverSeriesCard[] {
  const likeCountsBySeriesId = sumLikeCountsBySeriesId(videos, resolveLikeCount);
  const drafts: readonly DiscoverSeriesCardDraft[] = groupVideosIntoSeries(videos).map(
    (series) => ({
      seriesId: series.id,
      title: series.title,
      posterUrl: series.coverUrl,
      category: series.category,
      channelName: series.channelName,
      episodeCount: series.episodeCount,
      likeCount: likeCountsBySeriesId.get(series.id) ?? 0,
      hasPremiumEpisodes: series.episodes.some((episode) => episode.accessType === 'premium'),
    })
  );

  const hotSeriesIds = resolveHotSeriesIds(drafts);

  return drafts.map((draft) => ({ ...draft, badges: buildBadges(draft, hotSeriesIds) }));
}

/**
 * Ranking for the Rankings tab. Metric: total like count (`likeCount` from
 * `/videos/feed`, summed across the series' episodes in the fetched catalog,
 * including the local optimistic +1 the rest of the app already displays).
 * The UI labels it "total suka" precisely because it is a sum, not a
 * per-episode figure like the one the Home feed shows. No view counts, watch
 * time, or trending score exist in the mobile-visible contract, and none are
 * invented here.
 */
export function rankDiscoverCards(
  cards: readonly DiscoverSeriesCard[]
): readonly DiscoverSeriesCard[] {
  return sortByLikeCountDesc(cards);
}

export function filterDiscoverCardsByCategory(
  cards: readonly DiscoverSeriesCard[],
  category: VideoCategoryFilter
): readonly DiscoverSeriesCard[] {
  if (category === 'All') {
    return cards;
  }

  return cards.filter((card) => card.category === category);
}

/**
 * Category values are DATA: they are the filter keys, they come from
 * `getCategories()`, and `searchVideos` still matches on them. Only the
 * DISPLAY of a category is localized, through this map - nothing downstream
 * ever compares translated text.
 */
const CATEGORY_LABEL_KEY: Record<VideoCategoryFilter, TranslationKey> = {
  All: 'discover.categoryAll',
  Romance: 'discover.categoryRomance',
  Revenge: 'discover.categoryRevenge',
  Family: 'discover.categoryFamily',
  CEO: 'discover.categoryCEO',
  Historical: 'discover.categoryHistorical',
  Action: 'discover.categoryAction',
  Comedy: 'discover.categoryComedy',
  Drama: 'discover.categoryDrama',
};

export function translateCategory(t: Translate, category: VideoCategoryFilter): string {
  return t(CATEGORY_LABEL_KEY[category]);
}

const THOUSAND = 1000;
const MILLION = 1_000_000;

/**
 * The one phrasing used everywhere the ranking metric is shown. "total" is
 * part of the string on purpose: the number is a sum across the series'
 * episodes, not the per-episode count the Home feed displays.
 */
export function formatLikeTotal(t: Translate, likeCount: number): string {
  return t('discover.likeTotal', { count: formatCompactCount(likeCount) });
}

/**
 * Compact count formatting. It follows the Home feed's existing `12.8K` shape
 * (`formatLikeCount` in drama-feed-item.tsx) but is not imported from it: that
 * module pulls in `expo-video`, and Discover must never load a video player.
 * It additionally has an `M` branch the feed's helper lacks, because Discover
 * shows per-series totals that can exceed a million where the feed shows
 * per-episode counts.
 */
export function formatCompactCount(value: number): string {
  if (value >= MILLION) {
    return `${(value / MILLION).toFixed(1)}M`;
  }

  if (value >= THOUSAND) {
    return `${(value / THOUSAND).toFixed(1)}K`;
  }

  return `${value}`;
}
