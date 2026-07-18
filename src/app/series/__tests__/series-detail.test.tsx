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
});
