import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { POSTER_ASPECT_RATIO } from '@/features/discover/use-discover-grid';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import type { DiscoverBadge, DiscoverSeriesCard } from '@/types/discover';

/**
 * Overlays scale with the user's text size but are capped so they cannot
 * outgrow the poster they sit on. The row they live in is bounded on both
 * sides and wraps, so a capped overlay can never be clipped.
 */
export const OVERLAY_MAX_FONT_SCALE = 1.4;

/**
 * The compact row poster is narrower than a grid poster, so its overlay is
 * capped harder - at 1.4 a localized "Premium" would break mid-word inside
 * its own chip.
 */
const ROW_OVERLAY_MAX_FONT_SCALE = 1.15;

/**
 * Badge values are DATA (a `DiscoverBadge` union produced by the catalog), so
 * they are mapped to copy here rather than being translated at the source -
 * the ranking rules keep comparing stable identifiers, not display text.
 */
export const BADGE_LABEL_KEY: Record<DiscoverBadge, TranslationKey> = {
  Hot: 'discover.badgeHot',
  Premium: 'discover.badgePremium',
};

/**
 * Editorial badges yield when space or a stronger signal takes over. Access
 * status never does.
 */
const EDITORIAL_BADGES: readonly DiscoverBadge[] = ['Hot'];

/**
 * Badge budget for a media surface. `Premium` is access status and always
 * survives. `Hot` is dropped where a ranked card already says "popular" with
 * its rank, or where a compact row poster has no width for a second chip
 * without wrapping it over the artwork.
 *
 * The card's accessibility label is built from this same function, so a
 * screen reader is never told about a badge the card does not draw.
 */
export function resolveVisibleBadges(
  badges: readonly DiscoverBadge[],
  { isGrid, rank }: { readonly isGrid: boolean; readonly rank?: number }
): readonly DiscoverBadge[] {
  const hasRoomForEditorial = isGrid && !rank;

  return badges.filter(
    (badge) => hasRoomForEditorial || !EDITORIAL_BADGES.includes(badge)
  );
}

function resolvePosterInitial(title: string): string {
  // Array.from, not [0]: a Chinese or emoji-leading title is one code point
  // wide but two UTF-16 units, and slicing by index would split it.
  const [firstCharacter] = Array.from(title.trim());

  return firstCharacter ? firstCharacter.toUpperCase() : '•';
}

type DiscoverPosterProps = {
  readonly card: DiscoverSeriesCard;
  /**
   * `grid` is a full poster card; `row` is the compact thumbnail in the New
   * and Rankings lists. Both carry the badges - Premium belongs to the media
   * surface in every variant - but only `grid` carries the episode pill,
   * because a row already prints the episode count in its metadata line.
   */
  readonly variant: 'grid' | 'row';
  /** Rank pill, rendered inside the overlay row for the Top Hits rail. */
  readonly rank?: number;
  readonly style?: StyleProp<ViewStyle>;
};

/**
 * The media surface of a Discover card: artwork (or a branded fallback) plus
 * every overlay that belongs to the artwork.
 *
 * All badges live HERE, inside the poster's own bounds. They are absolutely
 * positioned relative to this frame and nothing else, which is what makes it
 * structurally impossible for Premium to land on a title: the title is not in
 * this component, and this component's overlays never escape the frame.
 */
export function DiscoverPoster({ card, variant, rank, style }: DiscoverPosterProps) {
  const { t } = useTranslation();
  /**
   * A load failure is remembered against the ARTWORK URL that failed, so new
   * artwork for a series retries while a URL that just failed does not.
   *
   * It is deliberately NOT keyed on the card object, even though that would
   * self-clear and look like free recovery. `cards` is rebuilt on a catalog
   * refetch AND on every like or save anywhere in the app - and since Discover
   * has no pull-to-refresh, the like/save path is the one that actually fires
   * (see docs/discover-content-hub.md). Object-identity keying would therefore
   * re-issue a request for every failed poster in the render window on every
   * unrelated tap, against a URL that just failed, from a screen the user is
   * not looking at. A stale fallback is the cheaper failure.
   *
   * KNOWN LIMIT: a transient failure therefore holds the fallback until that
   * cell remounts (tab switch, or scrolling out of the render window). The
   * failure direction stays safe - a branded tile, never a black rectangle.
   * Clean recovery needs a catalog-generation token threaded from the screen;
   * that is recorded as a follow-up rather than bolted on here.
   */
  const [failedPosterUrl, setFailedPosterUrl] = useState<string | null>(null);

  const isGrid = variant === 'grid';
  const hasPosterUrl = card.posterUrl.trim().length > 0;
  const hasFailedToLoad = failedPosterUrl === card.posterUrl;
  const showFallback = !hasPosterUrl || hasFailedToLoad;

  const visibleBadges = resolveVisibleBadges(card.badges, { isGrid, rank });

  return (
    <View
      style={[styles.frame, isGrid ? styles.frameGrid : styles.frameRow, style]}
      // Lets tests assert the structural guarantee this component exists for:
      // badges are inside this subtree, titles are not.
      testID={`discover-poster-${card.seriesId}`}>
      {showFallback ? (
        <PosterFallback initial={resolvePosterInitial(card.title)} isCompact={!isGrid} />
      ) : (
        <Image
          accessible={false}
          cachePolicy="memory-disk"
          contentFit="cover"
          onError={() => setFailedPosterUrl(card.posterUrl)}
          recyclingKey={card.seriesId}
          source={{ uri: card.posterUrl }}
          style={styles.image}
          testID={`discover-poster-image-${card.seriesId}`}
          transition={160}
        />
      )}

      {rank || visibleBadges.length > 0 ? (
        <View style={styles.overlayTop}>
          {rank ? (
            <Text maxFontSizeMultiplier={OVERLAY_MAX_FONT_SCALE} style={styles.rankPill}>
              {t('discover.rankPill', { rank })}
            </Text>
          ) : null}
          {visibleBadges.map((badge) => (
            <Text
              key={badge}
              maxFontSizeMultiplier={isGrid ? OVERLAY_MAX_FONT_SCALE : ROW_OVERLAY_MAX_FONT_SCALE}
              style={[
                styles.badge,
                !isGrid && styles.badgeCompact,
                badge === 'Premium' ? styles.premiumBadge : styles.hotBadge,
              ]}>
              {t(BADGE_LABEL_KEY[badge])}
            </Text>
          ))}
        </View>
      ) : null}

      {isGrid ? (
        <Text maxFontSizeMultiplier={OVERLAY_MAX_FONT_SCALE} style={styles.episodePill}>
          {t('discover.episodePill', { count: card.episodeCount })}
        </Text>
      ) : null}
    </View>
  );
}

type PosterFallbackProps = {
  readonly initial: string;
  readonly isCompact: boolean;
};

/**
 * Shown when the catalog has no artwork for a series, or when the artwork
 * fails to load. Deliberately branded rather than blank: the app's own accent
 * on its own elevated surface, carrying the series initial. It invents no
 * remote URL and pulls in no image provider.
 */
function PosterFallback({ initial, isCompact }: PosterFallbackProps) {
  return (
    // `accessible={false}` alone does not hide descendants on Android, and the
    // initial is decoration - the card's own label already carries the title.
    <View importantForAccessibility="no-hide-descendants" style={styles.fallback}>
      <Text
        allowFontScaling={false}
        style={[styles.fallbackInitial, isCompact && styles.fallbackInitialCompact]}>
        {initial}
      </Text>
      <View style={styles.fallbackAccent} />
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * `surface`, not `backgroundElevated`: the latter is 3/255 away from the
   * screen background, so while artwork was still loading a card was an
   * invisible hole rather than a card. This matches the loading skeleton.
   */
  frame: {
    aspectRatio: POSTER_ASPECT_RATIO,
    backgroundColor: Palette.surface,
    overflow: 'hidden',
  },
  /**
   * The grid poster sits directly on the screen background, so it carries the
   * hairline itself. A row thumbnail does NOT: its row is already a bordered
   * card, and a second hairline 10pt inside the first reads as a box in a box.
   */
  frameGrid: {
    width: '100%',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  frameRow: {
    borderRadius: Radius.sm,
    flexShrink: 0,
  },
  image: {
    width: '100%',
    height: '100%',
  },
  fallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.surface,
  },
  /**
   * Full-strength accent, not a faded one: at 55% opacity the initial landed
   * at 2.83:1 against the surface and read as a failed image rather than as a
   * deliberate placeholder.
   */
  fallbackInitial: {
    fontSize: 34,
    lineHeight: 40,
    fontFamily: FontFamily.extraBold,
    color: Palette.primaryHover,
  },
  fallbackInitialCompact: {
    fontSize: 22,
    lineHeight: 26,
  },
  fallbackAccent: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: Palette.primary,
  },
  // Bounded on both sides and allowed to wrap, so an overlay can never be
  // clipped by the frame's `overflow: hidden` at large text sizes.
  overlayTop: {
    position: 'absolute',
    top: 5,
    left: 5,
    right: 5,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  badge: {
    fontSize: 9,
    lineHeight: 12,
    letterSpacing: 0.2,
    fontFamily: FontFamily.extraBold,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  /** Tighter padding so the chip still fits a compact row poster. */
  badgeCompact: {
    letterSpacing: 0,
    paddingHorizontal: 4,
  },
  /**
   * Access status - the loudest overlay. Dark-on-accent rather than the
   * white-on-accent it replaces, which only reached ~2.6:1 contrast.
   */
  premiumBadge: {
    backgroundColor: Palette.primary,
    color: Palette.background,
  },
  /** Editorial signal - quieter than Premium, still readable over any artwork. */
  hotBadge: {
    backgroundColor: 'rgba(13, 13, 15, 0.82)',
    color: Palette.text,
  },
  /** Rankings hierarchy - the largest overlay, since rank is that tab's point. */
  rankPill: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
    backgroundColor: 'rgba(13, 13, 15, 0.88)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  /**
   * Informational metadata - quietest of the overlays, but quiet through
   * weight and corner, NOT through contrast: it is the only visible carrier
   * of the episode count on a grid card and has to stay legible over bright
   * artwork.
   */
  episodePill: {
    position: 'absolute',
    right: 5,
    bottom: 5,
    fontSize: 9,
    lineHeight: 12,
    fontFamily: FontFamily.bold,
    color: Palette.text,
    backgroundColor: 'rgba(13, 13, 15, 0.88)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: 'hidden',
  },
});
