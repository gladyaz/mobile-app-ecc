import { Image } from 'expo-image';
import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { formatLikeTotal } from '@/features/discover/discover-catalog';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation, type Translate } from '@/stores/language';
import {
  DISCOVER_GRID_GAP,
  POSTER_ASPECT_RATIO,
  type DiscoverGrid,
} from '@/features/discover/use-discover-grid';
import type { DiscoverBadge, DiscoverSeriesCard } from '@/types/discover';

/** Poster thumbnail width for the compact list rows (New + Rankings). */
const LIST_ROW_POSTER_WIDTH = 62;

/**
 * The poster overlays (rank, badges, episode-count pill) still scale with the
 * user's text size - they are the only visible carrier of the episode count on
 * a poster card - but are capped so they cannot outgrow the poster they sit on.
 * The row they live in is bounded on both sides and wraps, so a capped overlay
 * can never be clipped.
 */
const POSTER_OVERLAY_MAX_FONT_SCALE = 1.4;

type CardLabelExtras = {
  readonly rank?: number;
  /** Announced verbatim, e.g. the ranking metric printed on the card. */
  readonly metric?: string;
  readonly channelName?: string;
};

/**
 * `Pressable` is accessible by default, so this label replaces the card's
 * child text entirely - every visible fact has to be in here, including the
 * episode-count pill and the ranking metric.
 */
function buildCardAccessibilityLabel(
  t: Translate,
  card: DiscoverSeriesCard,
  { rank, metric, channelName }: CardLabelExtras = {}
): string {
  const parts = [
    rank ? t('discover.rankA11y', { rank }) : undefined,
    card.title,
    card.category,
    channelName,
    t('discover.episodeCount', { count: card.episodeCount }),
    metric,
    ...card.badges.map((badge) => t(BADGE_LABEL_KEY[badge])),
  ];

  return parts.filter(Boolean).join(', ');
}

/**
 * Badge values are DATA (a `DiscoverBadge` union produced by the catalog), so
 * they are mapped to copy here rather than being translated at the source -
 * the ranking rules keep comparing stable identifiers, not display text.
 */
const BADGE_LABEL_KEY: Record<DiscoverBadge, TranslationKey> = {
  Hot: 'discover.badgeHot',
  Premium: 'discover.badgePremium',
};

type BadgeRowProps = {
  readonly badges: readonly DiscoverBadge[];
  readonly rank?: number;
};

function BadgeRow({ badges, rank }: BadgeRowProps) {
  const { t } = useTranslation();

  if (!rank && badges.length === 0) {
    return null;
  }

  return (
    <View style={styles.badgeRow}>
      {rank ? (
        <Text
          maxFontSizeMultiplier={POSTER_OVERLAY_MAX_FONT_SCALE}
          style={[styles.badge, styles.rankBadge]}>
          #{rank}
        </Text>
      ) : null}
      {badges.map((badge) => (
        <Text
          maxFontSizeMultiplier={POSTER_OVERLAY_MAX_FONT_SCALE}
          key={badge}
          style={[styles.badge, badge === 'Premium' ? styles.premiumBadge : styles.hotBadge]}>
          {t(BADGE_LABEL_KEY[badge])}
        </Text>
      ))}
    </View>
  );
}

type DiscoverPosterCardProps = {
  readonly card: DiscoverSeriesCard;
  readonly width: number;
  readonly onPress: (seriesId: string) => void;
  /** Renders a rank pill on the poster; used by the Rankings featured rail. */
  readonly rank?: number;
  /** Optional second line under the title (e.g. the ranking metric). */
  readonly subtitle?: string;
};

/**
 * A poster-first catalog card. It renders an image and text only - no video
 * player is ever mounted from Discover.
 */
export const DiscoverPosterCard = memo(function DiscoverPosterCard({
  card,
  width,
  onPress,
  rank,
  subtitle,
}: DiscoverPosterCardProps) {
  const { t } = useTranslation();

  const cardStyle = useMemo(() => ({ width }), [width]);
  const handlePress = useCallback(() => onPress(card.seriesId), [card.seriesId, onPress]);

  return (
    <Pressable
      accessibilityLabel={buildCardAccessibilityLabel(t, card, { rank, metric: subtitle })}
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [cardStyle, pressed && styles.pressed]}>
      <View style={styles.poster}>
        <Image
          accessible={false}
          cachePolicy="memory-disk"
          contentFit="cover"
          recyclingKey={card.seriesId}
          source={{ uri: card.posterUrl }}
          style={styles.posterImage}
          transition={160}
        />
        <BadgeRow badges={card.badges} rank={rank} />
        <Text allowFontScaling={false} style={styles.episodePill}>
          {t('discover.episodePill', { count: card.episodeCount })}
        </Text>
      </View>
      <Text numberOfLines={2} style={styles.posterTitle}>
        {card.title}
      </Text>
      <Text numberOfLines={1} style={styles.posterMeta}>
        {subtitle ?? card.category}
      </Text>
    </Pressable>
  );
});

type DiscoverListRowProps = {
  readonly card: DiscoverSeriesCard;
  readonly onPress: (seriesId: string) => void;
  readonly rank?: number;
  /** Shows the ranking metric (likes) explicitly, so it is never implied. */
  readonly showLikeCount?: boolean;
};

export const DiscoverListRow = memo(function DiscoverListRow({
  card,
  onPress,
  rank,
  showLikeCount = false,
}: DiscoverListRowProps) {
  const { t } = useTranslation();

  const handlePress = useCallback(() => onPress(card.seriesId), [card.seriesId, onPress]);

  return (
    <Pressable
      accessibilityLabel={buildCardAccessibilityLabel(t, card, {
        rank,
        channelName: card.channelName,
        metric: showLikeCount ? formatLikeTotal(t, card.likeCount) : undefined,
      })}
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
      {rank ? <Text style={styles.listRank}>{rank}</Text> : null}
      <View style={styles.listPoster}>
        <Image
          accessible={false}
          cachePolicy="memory-disk"
          contentFit="cover"
          recyclingKey={card.seriesId}
          source={{ uri: card.posterUrl }}
          style={styles.posterImage}
          transition={160}
        />
      </View>
      <View style={styles.listBody}>
        <Text numberOfLines={2} style={styles.listTitle}>
          {card.title}
        </Text>
        <Text numberOfLines={1} style={styles.listMeta}>
          {card.category} · {t('discover.episodeCount', { count: card.episodeCount })}
        </Text>
        <Text numberOfLines={1} style={styles.listChannel}>
          {card.channelName}
        </Text>
        {showLikeCount ? (
          <Text style={styles.listMetric}>{formatLikeTotal(t, card.likeCount)}</Text>
        ) : null}
        <BadgeRow badges={card.badges} />
      </View>
    </Pressable>
  );
});

type DiscoverPosterGridProps = {
  readonly cards: readonly DiscoverSeriesCard[];
  readonly grid: DiscoverGrid;
  readonly onSelect: (seriesId: string) => void;
  readonly header?: ReactElement | null;
  readonly empty?: ReactElement | null;
};

/**
 * Virtualized poster grid. `key` is tied to the column count because
 * FlatList cannot change `numColumns` in place (e.g. on rotation).
 */
export function DiscoverPosterGrid({
  cards,
  grid,
  onSelect,
  header,
  empty,
}: DiscoverPosterGridProps) {
  const renderItem = useCallback(
    ({ item }: { item: DiscoverSeriesCard }) => (
      <DiscoverPosterCard card={item} onPress={onSelect} width={grid.posterWidth} />
    ),
    [grid.posterWidth, onSelect]
  );

  return (
    <FlatList
      ListEmptyComponent={empty}
      ListHeaderComponent={header}
      columnWrapperStyle={styles.gridRow}
      contentContainerStyle={styles.gridContent}
      data={cards}
      initialNumToRender={12}
      key={`discover-grid-${grid.columns}`}
      keyExtractor={(item) => item.seriesId}
      keyboardShouldPersistTaps="handled"
      numColumns={grid.columns}
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      windowSize={5}
    />
  );
}

const styles = StyleSheet.create({
  poster: {
    width: '100%',
    aspectRatio: POSTER_ASPECT_RATIO,
    borderRadius: Radius.md,
    backgroundColor: Palette.backgroundElevated,
    overflow: 'hidden',
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  posterTitle: {
    marginTop: 7,
    // Reserves both lines so a 1-line title does not lift the meta line of its
    // grid-row neighbours out of alignment.
    minHeight: 32,
    fontSize: 12.5,
    lineHeight: 16,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  posterMeta: {
    marginTop: 2,
    fontSize: 10.5,
    fontFamily: FontFamily.medium,
    color: Palette.textMuted,
  },
  // Bounded on both sides and allowed to wrap so overlay pills can never be
  // clipped by the poster's `overflow: hidden`. The pills opt out of font
  // scaling because they are decorative duplicates of the accessibility label.
  badgeRow: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  badge: {
    fontSize: 9,
    lineHeight: 12,
    fontFamily: FontFamily.extraBold,
    letterSpacing: 0.2,
    color: Palette.text,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  hotBadge: {
    backgroundColor: Palette.brandRed,
  },
  premiumBadge: {
    backgroundColor: Palette.primary,
  },
  rankBadge: {
    backgroundColor: 'rgba(13, 13, 15, 0.82)',
  },
  episodePill: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    fontSize: 9,
    lineHeight: 12,
    fontFamily: FontFamily.bold,
    color: Palette.text,
    backgroundColor: 'rgba(13, 13, 15, 0.78)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  gridContent: {
    gap: DISCOVER_GRID_GAP + 6,
    paddingBottom: 130,
  },
  gridRow: {
    gap: DISCOVER_GRID_GAP,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.lg,
    backgroundColor: Palette.surface,
  },
  listRank: {
    minWidth: 22,
    textAlign: 'center',
    fontSize: 15,
    fontFamily: FontFamily.extraBold,
    color: Palette.primaryHover,
  },
  listPoster: {
    width: LIST_ROW_POSTER_WIDTH,
    aspectRatio: POSTER_ASPECT_RATIO,
    borderRadius: Radius.sm,
    backgroundColor: Palette.backgroundElevated,
    overflow: 'hidden',
    flexShrink: 0,
  },
  listBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  listTitle: {
    fontSize: 14,
    lineHeight: 18,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  listMeta: {
    fontSize: 11.5,
    fontFamily: FontFamily.medium,
    color: Palette.textMuted,
  },
  listChannel: {
    fontSize: 11,
    fontFamily: FontFamily.regular,
    color: Palette.textDisabled,
  },
  listMetric: {
    fontSize: 11.5,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  pressed: {
    opacity: 0.72,
  },
});
