import { useCallback, useMemo, type ReactElement } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useTranslation } from '@/stores/language';
import {
  DiscoverListRow,
  DiscoverPosterCard,
  DiscoverPosterGrid,
} from '@/features/discover/discover-cards';
import { formatLikeTotal } from '@/features/discover/discover-catalog';
import { DiscoverEmptyState } from '@/features/discover/discover-states';
import { DISCOVER_GRID_GAP, type DiscoverGrid } from '@/features/discover/use-discover-grid';
import { getCategories, type VideoCategoryFilter } from '@/services/videos/video-service';
import type { DiscoverSeriesCard } from '@/types/discover';

const categoryFilters = getCategories();

/** How many series appear in the Rankings "Top Hits" featured rail. */
export const TOP_HITS_COUNT = 3;

type SectionIntroProps = {
  readonly title: string;
  readonly description: string;
};

function SectionIntro({ title, description }: SectionIntroProps) {
  return (
    <View style={styles.sectionIntro}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionDescription}>{description}</Text>
    </View>
  );
}

type DiscoverHomeViewProps = {
  readonly cards: readonly DiscoverSeriesCard[];
  readonly grid: DiscoverGrid;
  readonly selectedCategory: VideoCategoryFilter;
  readonly onSelectCategory: (category: VideoCategoryFilter) => void;
  readonly onSelectSeries: (seriesId: string) => void;
  readonly onResetCategory: () => void;
};

/** Default Discover surface: a category-filterable portrait poster grid. */
export function DiscoverHomeView({
  cards,
  grid,
  selectedCategory,
  onSelectCategory,
  onSelectSeries,
  onResetCategory,
}: DiscoverHomeViewProps) {
  const { t } = useTranslation();

  return (
    <DiscoverPosterGrid
      cards={cards}
      empty={
        <DiscoverEmptyState
          actionLabel={t('discover.showAll')}
          description={t('discover.categoryEmptyDesc', { category: selectedCategory })}
          onAction={onResetCategory}
          symbol={{ ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' }}
          title={t('discover.categoryEmptyTitle')}
        />
      }
      grid={grid}
      header={
        <CategoryFilterRow
          onSelectCategory={onSelectCategory}
          selectedCategory={selectedCategory}
        />
      }
      onSelect={onSelectSeries}
    />
  );
}

type CategoryFilterRowProps = {
  readonly selectedCategory: VideoCategoryFilter;
  readonly onSelectCategory: (category: VideoCategoryFilter) => void;
};

function CategoryFilterRow({ selectedCategory, onSelectCategory }: CategoryFilterRowProps) {
  return (
    <ScrollView
      contentContainerStyle={styles.categoryRow}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.categoryScroller}>
      {categoryFilters.map((category) => {
        const isSelected = category === selectedCategory;

        return (
          <Pressable
            accessibilityLabel={`Kategori ${category}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            hitSlop={{ bottom: 8, left: 4, right: 4, top: 8 }}
            key={category}
            onPress={() => onSelectCategory(category)}
            style={({ pressed }) => [
              styles.categoryChip,
              isSelected && styles.categoryChipSelected,
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.categoryText, isSelected && styles.categoryTextSelected]}>
              {category}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

type DiscoverListViewProps = {
  readonly cards: readonly DiscoverSeriesCard[];
  readonly onSelectSeries: (seriesId: string) => void;
};

/**
 * "New" tab. It shows the catalog in the exact order the backend returned it
 * and says so, because the mobile-visible contract has no publication
 * timestamp to sort by - see docs/discover-content-hub.md.
 */
export function DiscoverNewView({ cards, onSelectSeries }: DiscoverListViewProps) {
  const { t } = useTranslation();

  const renderItem = useCallback(
    ({ item }: { item: DiscoverSeriesCard }) => (
      <DiscoverListRow card={item} onPress={onSelectSeries} />
    ),
    [onSelectSeries]
  );

  return (
    <FlatList
      ListHeaderComponent={
        <SectionIntro
          description={t('discover.newDesc')}
          title={t('discover.newTitle')}
        />
      }
      contentContainerStyle={styles.listContent}
      data={cards}
      initialNumToRender={8}
      keyExtractor={(item) => item.seriesId}
      keyboardShouldPersistTaps="handled"
      renderItem={renderItem}
      showsVerticalScrollIndicator={false}
      windowSize={5}
    />
  );
}

type DiscoverRankingsViewProps = DiscoverListViewProps & {
  readonly grid: DiscoverGrid;
};

/**
 * "Rankings" tab. Ranked by the one real popularity metric the mobile app
 * has: like count. The metric is stated in the UI and printed on every row so
 * the number can never read as an invented view count.
 */
export function DiscoverRankingsView({ cards, grid, onSelectSeries }: DiscoverRankingsViewProps) {
  const { t } = useTranslation();

  const topHits = useMemo(() => cards.slice(0, TOP_HITS_COUNT), [cards]);
  const remaining = useMemo(() => cards.slice(TOP_HITS_COUNT), [cards]);

  const renderRow = useCallback(
    ({ item, index }: { item: DiscoverSeriesCard; index: number }) => (
      <DiscoverListRow
        card={item}
        onPress={onSelectSeries}
        rank={index + TOP_HITS_COUNT + 1}
        showLikeCount
      />
    ),
    [onSelectSeries]
  );

  return (
    <FlatList
      ListHeaderComponent={
        <View>
          <SectionIntro
            description={t('discover.rankingsDesc')}
            title={t('discover.topHits')}
          />
          {/* A bounded 3-item rail, so a plain scroll row beats registering a
              nested VirtualizedList inside this list's header. */}
          <ScrollView
            contentContainerStyle={styles.featuredRow}
            horizontal
            showsHorizontalScrollIndicator={false}>
            {topHits.map((card, index) => (
              <DiscoverPosterCard
                card={card}
                key={card.seriesId}
                onPress={onSelectSeries}
                rank={index + 1}
                subtitle={formatLikeTotal(t, card.likeCount)}
                width={grid.featuredPosterWidth}
              />
            ))}
          </ScrollView>
          {remaining.length > 0 ? (
            <Text style={styles.subsectionTitle}>{t('discover.otherRankings')}</Text>
          ) : null}
        </View>
      }
      contentContainerStyle={styles.listContent}
      data={remaining}
      initialNumToRender={8}
      keyExtractor={(item) => item.seriesId}
      keyboardShouldPersistTaps="handled"
      renderItem={renderRow}
      showsVerticalScrollIndicator={false}
      windowSize={5}
    />
  );
}

type DiscoverSearchResultsViewProps = {
  readonly cards: readonly DiscoverSeriesCard[];
  readonly grid: DiscoverGrid;
  readonly searchQuery: string;
  readonly selectedCategory: VideoCategoryFilter;
  readonly onSelectCategory: (category: VideoCategoryFilter) => void;
  readonly onSelectSeries: (seriesId: string) => void;
  readonly onClearSearch: () => void;
};

/**
 * Search results. The category chips stay mounted here because the query is
 * still filtered by the selected category (unchanged from the previous
 * Discover screen) - hiding them would leave that filter silently applied.
 */
export function DiscoverSearchResultsView({
  cards,
  grid,
  searchQuery,
  selectedCategory,
  onSelectCategory,
  onSelectSeries,
  onClearSearch,
}: DiscoverSearchResultsViewProps) {
  const { t } = useTranslation();

  const header: ReactElement = (
    <View>
      <CategoryFilterRow
        onSelectCategory={onSelectCategory}
        selectedCategory={selectedCategory}
      />
      <Text accessibilityLiveRegion="polite" style={styles.resultCount}>
        {t('discover.resultCount', { count: cards.length, query: searchQuery.trim() })}
      </Text>
      <Text style={styles.resultHint}>{t('discover.searchHint')}</Text>
    </View>
  );

  return (
    <DiscoverPosterGrid
      cards={cards}
      empty={
        <DiscoverEmptyState
          actionLabel={t('discover.clearSearch')}
          description={
            selectedCategory === 'All'
              ? t('discover.noResultsDescAll')
              : t('discover.noResultsDescCategory', { category: selectedCategory })
          }
          onAction={onClearSearch}
          symbol={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          title={t('discover.noResults')}
        />
      }
      grid={grid}
      header={header}
      onSelect={onSelectSeries}
    />
  );
}

const styles = StyleSheet.create({
  sectionIntro: {
    gap: 4,
    paddingBottom: 12,
  },
  sectionTitle: {
    fontSize: 19,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  sectionDescription: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
  },
  subsectionTitle: {
    marginTop: 20,
    marginBottom: 4,
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  featuredRow: {
    gap: DISCOVER_GRID_GAP,
    paddingBottom: 4,
  },
  categoryScroller: {
    flexGrow: 0,
    marginBottom: 4,
  },
  categoryRow: {
    alignItems: 'center',
    gap: 8,
    paddingRight: 24,
    paddingBottom: 10,
  },
  categoryChip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: 14,
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
  listContent: {
    gap: 10,
    paddingBottom: 130,
  },
  resultCount: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  resultHint: {
    paddingBottom: 12,
    paddingTop: 2,
    fontSize: 11.5,
    lineHeight: 16,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
  },
  pressed: {
    opacity: 0.72,
  },
});
