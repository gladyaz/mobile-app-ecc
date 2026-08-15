import { memo, useCallback, useMemo, type ReactElement } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { formatLikeTotal, translateCategory } from '@/features/discover/discover-catalog';
import {
  BADGE_LABEL_KEY,
  DiscoverPoster,
  OVERLAY_MAX_FONT_SCALE,
  resolveVisibleBadges,
} from '@/features/discover/discover-poster';
import {
  DISCOVER_GRID_GAP,
  POSTER_TITLE_LINE_HEIGHT,
  POSTER_TITLE_MAX_LINES,
  type DiscoverGrid,
} from '@/features/discover/use-discover-grid';
import { useTranslation, type Translate } from '@/stores/language';
import type { DiscoverSeriesCard } from '@/types/discover';

/**
 * Poster thumbnail width for the compact list rows (New + Rankings). Sized to
 * fit the access badge on one line without wrapping over the artwork, while
 * leaving the text column enough width for a long localized metadata line on
 * a 320pt phone.
 */
const LIST_ROW_POSTER_WIDTH = 68;

/** Keeps New/Rankings rows readable instead of full-bleed on a tablet. */
const LIST_ROW_MAX_WIDTH = 620;

type CardLabelExtras = {
  readonly rank?: number;
  /** Same media surface the card renders, so the label matches what is drawn. */
  readonly isGrid: boolean;
  /** Announced verbatim, e.g. the ranking metric printed on the card. */
  readonly metric?: string;
};

/**
 * `Pressable` is accessible by default, so this label replaces the card's
 * child text entirely - every visible fact has to be in here, including the
 * episode count and the ranking metric. One card announces as one unit;
 * nothing inside it is separately focusable.
 *
 * Badges come from the same budget the poster renders with, so the label can
 * never announce a chip the card does not draw.
 */
function buildCardAccessibilityLabel(
  t: Translate,
  card: DiscoverSeriesCard,
  { rank, metric, isGrid }: CardLabelExtras
): string {
  // Order matches how the card reads: identity first, then access status,
  // then size - "Kontrak Cinta CEO Dingin, Premium, 6 episode" - with the
  // softer metadata trailing.
  const parts = [
    rank ? t('discover.rankA11y', { rank }) : undefined,
    card.title,
    ...resolveVisibleBadges(card.badges, { isGrid, rank }).map((badge) =>
      t(BADGE_LABEL_KEY[badge])
    ),
    t('discover.episodeCount', { count: card.episodeCount }),
    card.category ? translateCategory(t, card.category) : undefined,
    metric,
  ];

  return parts.filter(Boolean).join(', ');
}

type DiscoverPosterCardProps = {
  readonly card: DiscoverSeriesCard;
  readonly width: number;
  /** Two title lines reserved at the current text size, so grid rows align. */
  readonly titleMinHeight: number;
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
  titleMinHeight,
  onPress,
  rank,
  subtitle,
}: DiscoverPosterCardProps) {
  const { t } = useTranslation();

  const cardStyle = useMemo(() => ({ width }), [width]);
  const titleStyle = useMemo(() => ({ minHeight: titleMinHeight }), [titleMinHeight]);
  const handlePress = useCallback(() => onPress(card.seriesId), [card.seriesId, onPress]);

  return (
    <Pressable
      accessibilityLabel={buildCardAccessibilityLabel(t, card, { rank, metric: subtitle, isGrid: true })}
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [cardStyle, pressed && styles.pressed]}>
      <DiscoverPoster card={card} rank={rank} variant="grid" />
      <Text
        ellipsizeMode="tail"
        numberOfLines={POSTER_TITLE_MAX_LINES}
        style={[styles.posterTitle, titleStyle]}>
        {card.title}
      </Text>
      <Text ellipsizeMode="tail" numberOfLines={1} style={styles.posterMeta}>
        {subtitle ?? (card.category ? translateCategory(t, card.category) : '')}
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

/**
 * The horizontal card used by New and Rankings. Its three zones are fixed and
 * never overlap: an optional rank column, the media surface (which owns every
 * badge), and the text column (which owns every line of copy).
 */
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
        isGrid: false,
        metric: showLikeCount ? formatLikeTotal(t, card.likeCount) : undefined,
      })}
      accessibilityRole="button"
      onPress={handlePress}
      style={({ pressed }) => [styles.listRow, pressed && styles.pressed]}>
      {rank ? (
        // The rank digit is the point of this row, so it scales with the
        // user's text size - capped, not frozen.
        <Text maxFontSizeMultiplier={OVERLAY_MAX_FONT_SCALE} style={styles.listRank}>
          {rank}
        </Text>
      ) : null}
      <DiscoverPoster card={card} style={styles.listPoster} variant="row" />
      <View style={styles.listBody}>
        <Text ellipsizeMode="tail" numberOfLines={2} style={styles.listTitle}>
          {card.title}
        </Text>
        <Text ellipsizeMode="tail" numberOfLines={1} style={styles.listMeta}>
          {card.category ? `${translateCategory(t, card.category)} · ` : ''}
          {t('discover.episodeCount', { count: card.episodeCount })}
        </Text>
        {showLikeCount ? (
          <Text style={styles.listMetric}>{formatLikeTotal(t, card.likeCount)}</Text>
        ) : null}
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
      <DiscoverPosterCard
        card={item}
        onPress={onSelect}
        titleMinHeight={grid.titleMinHeight}
        width={grid.posterWidth}
      />
    ),
    [grid.posterWidth, grid.titleMinHeight, onSelect]
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
  posterTitle: {
    marginTop: 7,
    fontSize: 12.5,
    lineHeight: POSTER_TITLE_LINE_HEIGHT,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  posterMeta: {
    marginTop: 2,
    fontSize: 10.5,
    fontFamily: FontFamily.medium,
    color: Palette.textMuted,
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
    // Centred and capped so a tablet does not stretch a 68pt thumbnail across
    // 700pt of row with the text stranded on the left. Phones are unaffected:
    // their rows are narrower than the cap.
    width: '100%',
    maxWidth: LIST_ROW_MAX_WIDTH,
    alignSelf: 'center',
    gap: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.lg,
    backgroundColor: Palette.surface,
  },
  listRank: {
    minWidth: 24,
    textAlign: 'center',
    fontSize: 17,
    fontFamily: FontFamily.extraBold,
    color: Palette.primaryHover,
  },
  listPoster: {
    width: LIST_ROW_POSTER_WIDTH,
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
