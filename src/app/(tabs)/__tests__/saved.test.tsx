import { render, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import { SavedVideoCard } from '@/app/(tabs)/saved';
import type { Video } from '@/types/video';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

// saved.tsx imports formatLikeCount from drama-feed-item.tsx, which imports
// expo-video; expo-video's native module isn't available under Jest, so it
// is stubbed here even though this test never renders DramaFeedItem itself.
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(),
  VideoView: 'VideoView',
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
    isSaved: true,
    ...overrides,
  };
}

describe('SavedVideoCard', () => {
  it('navigates to the video series detail screen when the card content is pressed', async () => {
    const video = buildVideo();
    const { getByText } = await render(
      <SavedVideoCard video={video} likeCount={12800} onUnsave={jest.fn()} />
    );

    fireEvent.press(getByText(video.title));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/series/[id]',
      params: { id: 'series-ceo-dingin' },
    });
  });

  it('does not navigate when the Unsave button is pressed', async () => {
    const video = buildVideo();
    const onUnsave = jest.fn();
    const { getByText } = await render(
      <SavedVideoCard video={video} likeCount={12800} onUnsave={onUnsave} />
    );

    fireEvent.press(getByText('Unsave'));

    expect(onUnsave).toHaveBeenCalledTimes(1);
    expect(router.push).not.toHaveBeenCalled();
  });
});
