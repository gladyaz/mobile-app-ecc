import { Image } from 'expo-image';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useVideoCatalog } from '@/features/videos/video-catalog-provider';
import { groupVideosIntoSeries } from '@/services/videos/series-service';
import {
  getCategories,
  searchVideos,
  type VideoCategoryFilter,
} from '@/services/videos/video-service';
import { useTranslation } from '@/stores/language';
import type { Series } from '@/types/series';

const categoryFilters = getCategories();

// Mobile UI revision (2026-08-12): Discover is a poster GRID of series, not a
// vertical list of per-episode cards. The grid is built purely from data the
// catalog already carries (`groupVideosIntoSeries` over the existing feed) -
// no invented backend sections/categories; the category chips filter on the
// same client-side `video.category` field they always did.

// 2 poster columns on phones, 3 on tablet-ish widths - the same breakpoint
// the feed item uses for its wide layout.
const WIDE_LAYOUT_BREAKPOINT = 700;

// Screen-edge padding and the gap between grid cards, shared by the real
// grid and the loading skeleton so they line up exactly.
const GRID_EDGE_PADDING = 16;
const GRID_CARD_GAP = 12;

// How many placeholder cards the loading skeleton shows - enough to fill a
// phone's first viewport.
const SKELETON_CARD_COUNT = 6;

/**
 * Deterministic card width so a lone card in the grid's last row keeps the
 * exact same size as every other card, instead of flex-stretching to fill
 * the row.
 */
export function calculateGridCardWidth(windowWidth: number, columnCount: number): number {
  const usableWidth = windowWidth - GRID_EDGE_PADDING * 2 - GRID_CARD_GAP * (columnCount - 1);

  return Math.floor(usableWidth / columnCount);
}

export default function DiscoverScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<VideoCategoryFilter>('All');
  const { videos, isLoading, error, refresh } = useVideoCatalog();

  const columnCount = windowWidth >= WIDE_LAYOUT_BREAKPOINT ? 3 : 2;
  const cardWidth = calculateGridCardWidth(windowWidth, columnCount);

  // Filter on videos first (search matches title/caption/channel/category,
  // same as before), then collapse the matches into series for the grid -
  // a series is shown when ANY of its episodes matches.
  const filteredSeries = useMemo(() => {
    const filteredVideos = searchVideos(videos, searchQuery, selectedCategory);

    return groupVideosIntoSeries(filteredVideos);
  }, [videos, searchQuery, selectedCategory]);

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>{t('discover.title')}</Text>
      <View style={styles.searchBar}>
        <SymbolView
          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          size={18}
          tintColor={Palette.textMuted}
        />
        <TextInput
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setSearchQuery}
          placeholder={t('discover.searchPlaceholder')}
          placeholderTextColor={Palette.textMuted}
          style={styles.searchInput}
          value={searchQuery}
        />
        {searchQuery.length > 0 ? (
          <Pressable
            accessibilityLabel="Hapus pencarian"
            accessibilityRole="button"
            onPress={() => setSearchQuery('')}
            style={styles.clearButton}>
            <SymbolView
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              size={12}
              tintColor={Palette.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      <ScrollView
        horizontal
        contentContainerStyle={styles.categoryList}
        style={styles.categoryScroller}
        showsHorizontalScrollIndicator={false}>
        {categoryFilters.map((category) => {
          const isSelected = selectedCategory === category;

          return (
            <Pressable
              accessibilityRole="button"
              key={category}
              onPress={() => {
                setSelectedCategory(category);
              }}
              style={({ pressed }) => [
                styles.categoryChip,
                isSelected && styles.categoryChipSelected,
                pressed && styles.buttonPressed,
              ]}>
              <Text style={[styles.categoryText, isSelected && styles.categoryTextSelected]}>
                {category}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        // numColumns cannot change on a mounted FlatList; keying by it
        // remounts the list on the (rare) phone/tablet-width flip.
        key={`discover-grid-${columnCount}`}
        testID="discover-grid"
        data={filteredSeries}
        keyExtractor={(item) => item.id}
        numColumns={columnCount}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.gridContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          isLoading ? (
            <View style={styles.skeletonGrid} testID="discover-loading-skeleton">
              {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
                <View key={index} style={[styles.skeletonCard, { width: cardWidth }]}>
                  <View style={styles.skeletonPoster} />
                  <View style={styles.skeletonLine} />
                  <View style={styles.skeletonLineShort} />
                </View>
              ))}
            </View>
          ) : error ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>{t('home.loadError')}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={refresh}
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
                <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.emptyState}>
              <View style={styles.emptyIconCircle}>
                <SymbolView
                  name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
                  size={26}
                  tintColor={Palette.textMuted}
                />
              </View>
              <Text style={styles.emptyTitle}>{t('discover.noResults')}</Text>
              <Text style={styles.emptyDescription}>
                Coba kata kunci lain atau pilih kategori yang berbeda.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setSearchQuery('');
                  setSelectedCategory('All');
                }}
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
                <Text style={styles.retryButtonText}>{t('discover.resetSearch')}</Text>
              </Pressable>
            </View>
          )
        }
        renderItem={({ item }) => <DiscoverSeriesCard series={item} width={cardWidth} />}
      />
    </View>
  );
}

type DiscoverSeriesCardProps = {
  readonly series: Series;
  /** Fixed width from the grid calculation; unset renders a flexible card. */
  readonly width?: number;
};

export function DiscoverSeriesCard({ series, width }: DiscoverSeriesCardProps) {
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityRole="button"
      testID={`discover-series-card-${series.id}`}
      onPress={() => router.push({ pathname: '/series/[id]', params: { id: series.id } })}
      style={({ pressed }) => [
        styles.card,
        width != null && { width },
        pressed && styles.buttonPressed,
      ]}>
      <View style={styles.posterFrame}>
        <Image contentFit="cover" source={{ uri: series.coverUrl }} style={styles.posterImage} />
      </View>
      <Text numberOfLines={2} style={styles.cardTitle}>
        {series.title}
      </Text>
      <Text numberOfLines={1} style={styles.cardMeta}>
        {`${series.category} · ${t('series.episodeCount', { count: series.episodeCount })}`}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: GRID_EDGE_PADDING,
    backgroundColor: Palette.background,
  },
  title: {
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  searchBar: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    paddingHorizontal: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  searchInput: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: FontFamily.regular,
    color: Palette.text,
  },
  clearButton: {
    width: 28,
    height: 28,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryList: {
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingRight: 40,
  },
  categoryScroller: {
    flexGrow: 0,
    minHeight: 50,
    marginTop: 14,
    marginBottom: 6,
  },
  categoryChip: {
    height: 38,
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
  },
  categoryChipSelected: {
    borderColor: Palette.primary,
    backgroundColor: Palette.primary,
  },
  categoryText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  categoryTextSelected: {
    color: Palette.text,
  },
  gridRow: {
    gap: GRID_CARD_GAP,
  },
  gridContent: {
    gap: 18,
    paddingTop: 4,
    paddingBottom: 120,
  },
  card: {
    // Text under the poster gets its own vertical rhythm from these gaps -
    // no inner padding, so the poster runs edge-to-edge within the card.
    gap: 3,
  },
  posterFrame: {
    // 2:3 portrait poster - the standard drama/streaming cover ratio and
    // close to the 720x1280 thumbnails' own shape, so covers crop minimally.
    aspectRatio: 2 / 3,
    width: '100%',
    borderRadius: Radius.lg,
    backgroundColor: Palette.surface,
    overflow: 'hidden',
    marginBottom: 5,
  },
  posterImage: {
    width: '100%',
    height: '100%',
  },
  cardTitle: {
    fontSize: 13.5,
    lineHeight: 18,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  cardMeta: {
    fontSize: 11.5,
    fontFamily: FontFamily.medium,
    color: Palette.textMuted,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GRID_CARD_GAP,
  },
  skeletonCard: {
    gap: 6,
  },
  skeletonPoster: {
    aspectRatio: 2 / 3,
    width: '100%',
    borderRadius: Radius.lg,
    backgroundColor: Palette.surface,
  },
  skeletonLine: {
    height: 12,
    width: '82%',
    borderRadius: Radius.sm,
    backgroundColor: Palette.surface,
  },
  skeletonLineShort: {
    height: 10,
    width: '52%',
    borderRadius: Radius.sm,
    backgroundColor: Palette.surfaceMuted,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 56,
    paddingHorizontal: 32,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 16,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  emptyDescription: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
    maxWidth: 240,
  },
  retryButton: {
    marginTop: 6,
    height: 44,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  retryButtonText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  buttonPressed: {
    opacity: 0.72,
  },
});
