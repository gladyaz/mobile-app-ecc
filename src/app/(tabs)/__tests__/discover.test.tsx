import { render, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import DiscoverScreen, {
  calculateGridCardWidth,
  DiscoverSeriesCard,
} from '@/app/(tabs)/discover';
import { groupVideosIntoSeries } from '@/services/videos/series-service';
import type { Video } from '@/types/video';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}));

// The screen reads the catalog through this hook; each screen-level test
// below sets the return value it needs (videos, loading, error).
const mockUseVideoCatalog = jest.fn();

jest.mock('@/features/videos/video-catalog-provider', () => ({
  useVideoCatalog: () => mockUseVideoCatalog(),
}));

function buildVideo(overrides: Partial<Video> = {}): Video {
  return {
    id: 'video-1',
    seriesId: 'series-ceo-dingin',
    storageKey: 'key',
    playbackUrl: 'https://media.example.com/video-1.mp4',
    thumbnailUrl: 'https://cdn.example.com/video-1.jpg',
    title: 'Kontrak Cinta CEO Dingin',
    episodeNumber: 1,
    channelName: 'Mandarin Drama ID',
    category: 'CEO',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    processingStatus: 'completed',
    caption: 'Pertemuan pertama yang mengubah hidup Lin Yue.',
    likeCount: 12800,
    isSaved: false,
    ...overrides,
  };
}

function buildCatalogValue(
  overrides: Partial<{
    videos: readonly Video[];
    isLoading: boolean;
    error: Error | null;
    refresh: () => void;
  }> = {}
) {
  return {
    videos: [] as readonly Video[],
    isLoading: false,
    error: null,
    refresh: jest.fn(),
    ...overrides,
  };
}

describe('calculateGridCardWidth', () => {
  it('splits the usable width evenly so a lone last-row card cannot stretch', () => {
    // 390pt phone, 2 columns: (390 - 2*16 edge - 1*12 gap) / 2 = 173.
    expect(calculateGridCardWidth(390, 2)).toBe(173);
    // 768pt tablet, 3 columns: (768 - 32 - 24) / 3 = 237 (floored).
    expect(calculateGridCardWidth(768, 3)).toBe(237);
  });
});

describe('DiscoverSeriesCard', () => {
  const series = groupVideosIntoSeries([
    buildVideo({ id: 'video-1', episodeNumber: 1 }),
    buildVideo({ id: 'video-2', episodeNumber: 2 }),
  ])[0];

  it('navigates to the series detail screen when pressed', async () => {
    const { getByText } = await render(<DiscoverSeriesCard series={series} />);

    fireEvent.press(getByText(series.title));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/series/[id]',
      params: { id: 'series-ceo-dingin' },
    });
  });

  it('shows the series title with category and episode-count metadata', async () => {
    const { getByText } = await render(<DiscoverSeriesCard series={series} />);

    expect(getByText('Kontrak Cinta CEO Dingin')).toBeTruthy();
    // Category and count both already exist on the client-side Series
    // record - no invented backend fields.
    expect(getByText('CEO · 2 episode')).toBeTruthy();
  });
});

describe('DiscoverScreen', () => {
  it('renders one poster card per series (a grid of series, not per-episode list rows)', async () => {
    // Arrange: 5 episodes across 2 series - the old list showed 5 rows; the
    // grid must show exactly 2 series cards.
    mockUseVideoCatalog.mockReturnValue(
      buildCatalogValue({
        videos: [
          buildVideo({ id: 'a-1', seriesId: 'series-a', episodeNumber: 1 }),
          buildVideo({ id: 'a-2', seriesId: 'series-a', episodeNumber: 2 }),
          buildVideo({ id: 'a-3', seriesId: 'series-a', episodeNumber: 3 }),
          buildVideo({
            id: 'b-1',
            seriesId: 'series-b',
            episodeNumber: 1,
            title: 'Pernikahan Kilat Nona Shen',
            category: 'Romance',
          }),
          buildVideo({
            id: 'b-2',
            seriesId: 'series-b',
            episodeNumber: 2,
            title: 'Pernikahan Kilat Nona Shen',
            category: 'Romance',
          }),
        ],
      })
    );

    // Act
    const { getByTestId, getAllByText, getByText } = await render(<DiscoverScreen />);

    // Assert
    expect(getByTestId('discover-grid')).toBeTruthy();
    expect(getByTestId('discover-series-card-series-a')).toBeTruthy();
    expect(getByTestId('discover-series-card-series-b')).toBeTruthy();
    // One card per series: the shared series title renders once, not once
    // per episode.
    expect(getAllByText('Kontrak Cinta CEO Dingin')).toHaveLength(1);
    expect(getByText('CEO · 3 episode')).toBeTruthy();
  });

  it('opens the tapped series through the existing navigation path', async () => {
    mockUseVideoCatalog.mockReturnValue(
      buildCatalogValue({ videos: [buildVideo({ seriesId: 'series-tap' })] })
    );

    const { getByTestId } = await render(<DiscoverScreen />);

    fireEvent.press(getByTestId('discover-series-card-series-tap'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/series/[id]',
      params: { id: 'series-tap' },
    });
  });

  it('shows a poster skeleton while the catalog is loading', async () => {
    mockUseVideoCatalog.mockReturnValue(buildCatalogValue({ isLoading: true }));

    const { getByTestId } = await render(<DiscoverScreen />);

    expect(getByTestId('discover-loading-skeleton')).toBeTruthy();
  });

  it('offers a retry that re-fetches when the catalog failed to load', async () => {
    const refresh = jest.fn();

    mockUseVideoCatalog.mockReturnValue(
      buildCatalogValue({ error: new Error('boom'), refresh })
    );

    const { getByText } = await render(<DiscoverScreen />);

    fireEvent.press(getByText('Retry'));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows the no-results empty state with a reset action', async () => {
    mockUseVideoCatalog.mockReturnValue(buildCatalogValue({ videos: [] }));

    const { getByText } = await render(<DiscoverScreen />);

    expect(getByText('Tidak ada hasil')).toBeTruthy();
    expect(getByText('Reset pencarian')).toBeTruthy();
  });
});
