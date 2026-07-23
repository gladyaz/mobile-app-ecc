import { render, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import SeriesDetailScreen from '@/app/series/[id]';
import type { Video } from '@/types/video';

const mockUseLocalSearchParams = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

const mockUseVideoCatalog = jest.fn();

jest.mock('@/features/videos/video-catalog-provider', () => ({
  useVideoCatalog: () => mockUseVideoCatalog(),
}));

const mockGetProgress = jest.fn();

jest.mock('@/stores/series-progress', () => ({
  useSeriesProgress: () => ({ getProgress: mockGetProgress, recordProgress: jest.fn() }),
}));

const mockUseEntitlement = jest.fn();

jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => mockUseEntitlement(),
}));

// Phase 11 (11-M3/11-M4): the screen now emits analytics events; the real
// queue schedules flush timers and hits the network, so it is mocked.
const mockTrackEvent = jest.fn();

jest.mock('@/services/analytics/analytics-queue', () => ({
  trackEvent: (...args: unknown[]) => mockTrackEvent(...args),
}));

function buildEpisode(episodeNumber: number): Video {
  return {
    id: `series-x-ep-${episodeNumber}`,
    seriesId: 'series-x',
    storageKey: `key-${episodeNumber}`,
    playbackUrl: `https://media.example.com/ep-${episodeNumber}.mp4`,
    thumbnailUrl: `https://cdn.example.com/ep-${episodeNumber}.jpg`,
    title: 'Kontrak Cinta CEO Dingin',
    episodeNumber,
    channelName: 'Mandarin Drama ID',
    category: 'CEO',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    processingStatus: 'completed',
    caption: `Episode ${episodeNumber} caption.`,
    likeCount: 100,
    isSaved: false,
  };
}

const seriesXVideos: readonly Video[] = [1, 2, 3, 4, 5, 6].map(buildEpisode);

beforeEach(() => {
  mockUseLocalSearchParams.mockReturnValue({ id: 'series-x' });
  mockUseVideoCatalog.mockReturnValue({
    videos: seriesXVideos,
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  });
  mockGetProgress.mockReturnValue(undefined);
  mockUseEntitlement.mockReturnValue({ isPremium: false, refresh: jest.fn() });
});

describe('SeriesDetailScreen', () => {
  it('navigates to Home with the videoId when a free episode is selected', async () => {
    const { getByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 1'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/',
      params: { videoId: 'series-x-ep-1' },
    });
  });

  it('blocks playback and shows the premium modal when a premium episode is selected', async () => {
    const { getByText, queryByText } = await render(<SeriesDetailScreen />);

    expect(queryByText('Episode ini termasuk konten premium.')).toBeNull();

    await fireEvent.press(getByText('Episode 6'));

    expect(router.push).not.toHaveBeenCalled();
    expect(getByText('Episode ini termasuk konten premium.')).toBeTruthy();
  });

  it('emits an episode_navigate analytics event when a free episode is selected (Phase 11)', async () => {
    const { getByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 1'));

    expect(mockTrackEvent).toHaveBeenCalledWith('episode_navigate', {
      videoId: 'series-x-ep-1',
      seriesId: 'series-x',
      episodeNumber: 1,
      source: 'series-detail',
    });
  });

  it('emits a premium_gate_hit analytics event when a premium episode is blocked (Phase 11)', async () => {
    const { getByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 6'));

    expect(mockTrackEvent).toHaveBeenCalledWith('premium_gate_hit', {
      videoId: 'series-x-ep-6',
      seriesId: 'series-x',
      episodeNumber: 6,
      source: 'series-detail',
    });
  });

  it('plays a premium episode directly, without the modal, for an entitled user (Phase 10)', async () => {
    mockUseEntitlement.mockReturnValue({ isPremium: true, refresh: jest.fn() });

    const { getByText, queryByText } = await render(<SeriesDetailScreen />);

    await fireEvent.press(getByText('Episode 6'));

    expect(queryByText('Episode ini termasuk konten premium.')).toBeNull();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/',
      params: { videoId: 'series-x-ep-6' },
    });
  });

  it('shows Continue Watching and the currently-playing indicator when progress exists', async () => {
    mockGetProgress.mockReturnValue({
      lastWatchedVideoId: 'series-x-ep-2',
      lastWatchedEpisodeNumber: 2,
    });

    const { getByText } = await render(<SeriesDetailScreen />);

    expect(getByText('Lanjutkan Menonton')).toBeTruthy();
    expect(getByText('Sedang diputar')).toBeTruthy();
  });
});
