import { render, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import { DiscoverResultCard } from '@/app/(tabs)/discover';
import type { Video } from '@/types/video';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
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

describe('DiscoverResultCard', () => {
  it('navigates to the video series detail screen when pressed', async () => {
    const video = buildVideo();
    const { getByText } = await render(<DiscoverResultCard video={video} likeCount={12800} />);

    fireEvent.press(getByText(video.title));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/series/[id]',
      params: { id: 'series-ceo-dingin' },
    });
  });
});
