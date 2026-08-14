import { router } from 'expo-router';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { Palette } from '@/constants/theme';
import {
  buildDiscoverCards,
  filterDiscoverCardsByCategory,
  rankDiscoverCards,
  translateCategory,
} from '@/features/discover/discover-catalog';
import { DiscoverHeader } from '@/features/discover/discover-header';
import {
  DiscoverEmptyState,
  DiscoverErrorState,
  DiscoverGridSkeleton,
} from '@/features/discover/discover-states';
import {
  DiscoverHomeView,
  DiscoverNewView,
  DiscoverRankingsView,
  DiscoverSearchResultsView,
} from '@/features/discover/discover-views';
import { DISCOVER_SCREEN_PADDING, useDiscoverGrid } from '@/features/discover/use-discover-grid';
import { useVideoCatalog } from '@/features/videos/video-catalog-provider';
import { searchVideos, type VideoCategoryFilter } from '@/services/videos/video-service';
import { useTranslation, type Translate } from '@/stores/language';
import { useVideoInteractions } from '@/stores/video-interactions';
import type { DiscoverSeriesCard, DiscoverTabKey } from '@/types/discover';

/**
 * Discover: a poster-first catalog over the already-fetched `/videos/feed`
 * response, with Discover-local Home / New / Rankings sub-navigation and
 * search. No screen here mounts a video player, and no field is invented -
 * see docs/discover-content-hub.md for the data sources behind each tab.
 */
export default function DiscoverScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<DiscoverTabKey>('home');
  const [selectedCategory, setSelectedCategory] = useState<VideoCategoryFilter>('All');
  const { videos, isLoading, error, refresh } = useVideoCatalog();
  const { getLikeCount } = useVideoInteractions();
  const grid = useDiscoverGrid();
  const { t } = useTranslation();

  const cards = useMemo(() => buildDiscoverCards(videos, getLikeCount), [videos, getLikeCount]);
  const isSearching = searchQuery.trim().length > 0;

  // Reuses the existing in-memory search unchanged - same matcher, same
  // category argument the previous Discover screen passed - and maps the
  // matching episodes onto their series cards, so badges and ordering stay
  // identical to the rest of Discover.
  //
  // It then also matches the LOCALIZED category label. `searchVideos` compares
  // the raw English category value, so once the chips render "Romantis" the
  // search hint's promise to match "kategori" would otherwise be false in
  // every language but English. The selected category is still applied on the
  // raw value, so this can only surface cards that filter already allows.
  const searchResults = useMemo(() => {
    if (!isSearching) {
      return [];
    }

    const matchedSeriesIds = new Set(
      searchVideos(videos, searchQuery, selectedCategory).map((video) => video.seriesId)
    );
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return cards.filter((card) => {
      if (selectedCategory !== 'All' && card.category !== selectedCategory) {
        return false;
      }

      return (
        matchedSeriesIds.has(card.seriesId) ||
        translateCategory(t, card.category).toLowerCase().includes(normalizedQuery)
      );
    });
  }, [cards, isSearching, searchQuery, selectedCategory, t, videos]);

  const homeCards = useMemo(
    () => filterDiscoverCardsByCategory(cards, selectedCategory),
    [cards, selectedCategory]
  );
  const rankedCards = useMemo(() => rankDiscoverCards(cards), [cards]);

  const handleSelectSeries = useCallback((seriesId: string) => {
    router.push({ pathname: '/series/[id]', params: { id: seriesId } });
  }, []);
  const handleClearSearch = useCallback(() => setSearchQuery(''), []);
  const handleResetCategory = useCallback(() => setSelectedCategory('All'), []);
  // Search results replace the active tab's content, so selecting a tab has to
  // leave search - otherwise the tab strip would show a selected tab whose
  // content is not on screen.
  const handleSelectTab = useCallback((tab: DiscoverTabKey) => {
    setActiveTab(tab);
    setSearchQuery('');
  }, []);

  return (
    <View style={styles.container}>
      <DiscoverHeader
        activeTab={activeTab}
        isSearching={isSearching}
        onChangeSearchQuery={setSearchQuery}
        onSelectTab={handleSelectTab}
        searchQuery={searchQuery}
      />
      <View style={styles.content}>
        {renderDiscoverContent({
          t,
          activeTab,
          cards,
          error,
          grid,
          homeCards,
          isLoading,
          isSearching,
          onClearSearch: handleClearSearch,
          onResetCategory: handleResetCategory,
          onRetry: refresh,
          onSelectCategory: setSelectedCategory,
          onSelectSeries: handleSelectSeries,
          rankedCards,
          searchQuery,
          searchResults,
          selectedCategory,
        })}
      </View>
    </View>
  );
}

type DiscoverContentProps = {
  readonly t: Translate;
  readonly activeTab: DiscoverTabKey;
  readonly cards: readonly DiscoverSeriesCard[];
  readonly error: Error | null;
  readonly grid: ReturnType<typeof useDiscoverGrid>;
  readonly homeCards: readonly DiscoverSeriesCard[];
  readonly isLoading: boolean;
  readonly isSearching: boolean;
  readonly onClearSearch: () => void;
  readonly onResetCategory: () => void;
  readonly onRetry: () => void;
  readonly onSelectCategory: (category: VideoCategoryFilter) => void;
  readonly onSelectSeries: (seriesId: string) => void;
  readonly rankedCards: readonly DiscoverSeriesCard[];
  readonly searchQuery: string;
  readonly searchResults: readonly DiscoverSeriesCard[];
  readonly selectedCategory: VideoCategoryFilter;
};

/**
 * Resolves the one state the user should see. A stale-but-populated catalog
 * keeps rendering when a refresh fails, so a transient network error never
 * blanks a screen the user was already browsing.
 */
function renderDiscoverContent({
  t,
  activeTab,
  cards,
  error,
  grid,
  homeCards,
  isLoading,
  isSearching,
  onClearSearch,
  onResetCategory,
  onRetry,
  onSelectCategory,
  onSelectSeries,
  rankedCards,
  searchQuery,
  searchResults,
  selectedCategory,
}: DiscoverContentProps): ReactElement {
  if (cards.length === 0) {
    if (isLoading) {
      return <DiscoverGridSkeleton grid={grid} />;
    }

    if (error) {
      return <DiscoverErrorState onRetry={onRetry} />;
    }

    return (
      <DiscoverEmptyState
        actionLabel={t('discover.reload')}
        description={t('discover.catalogEmptyDesc')}
        onAction={onRetry}
        symbol={{ ios: 'film.stack', android: 'movie', web: 'movie' }}
        title={t('discover.catalogEmptyTitle')}
      />
    );
  }

  if (isSearching) {
    return (
      <DiscoverSearchResultsView
        cards={searchResults}
        grid={grid}
        onClearSearch={onClearSearch}
        onSelectCategory={onSelectCategory}
        onSelectSeries={onSelectSeries}
        searchQuery={searchQuery}
        selectedCategory={selectedCategory}
      />
    );
  }

  if (activeTab === 'new') {
    return <DiscoverNewView cards={cards} onSelectSeries={onSelectSeries} />;
  }

  if (activeTab === 'rankings') {
    return <DiscoverRankingsView cards={rankedCards} grid={grid} onSelectSeries={onSelectSeries} />;
  }

  return (
    <DiscoverHomeView
      cards={homeCards}
      grid={grid}
      onResetCategory={onResetCategory}
      onSelectCategory={onSelectCategory}
      onSelectSeries={onSelectSeries}
      selectedCategory={selectedCategory}
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 70,
    paddingHorizontal: DISCOVER_SCREEN_PADDING,
    backgroundColor: Palette.background,
  },
  content: {
    flex: 1,
    marginTop: 14,
  },
});
