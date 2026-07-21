import { render, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { DramaFeedItem } from '@/components/drama-feed-item';
import type { Episode } from '@/types/series';
import type { Video } from '@/types/video';

// DramaFeedItem reads useSafeAreaInsets for its bottom-overlay offset, which
// throws without a SafeAreaProvider ancestor. initialMetrics makes the
// provider synchronously ready instead of waiting on a real native
// measurement that never arrives in this test environment.
function renderFeedItem(ui: ReactElement) {
  return render(
    <SafeAreaProvider
      initialMetrics={{
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
        frame: { x: 0, y: 0, width: 390, height: 844 },
      }}>
      {ui}
    </SafeAreaProvider>
  );
}

jest.mock('expo', () => ({
  useEvent: jest.fn((_player: unknown, _eventName: string, defaultValue: unknown) => defaultValue),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP', LANDSCAPE: 'LANDSCAPE' },
  lockAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}));

jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn((_source: unknown, configure?: (player: unknown) => void) => {
    const player = { loop: false, muted: false, playing: false, play: jest.fn(), pause: jest.fn() };
    configure?.(player);
    return player;
  }),
  VideoView: 'VideoView',
}));

// PremiumPreviewModal is already covered by its own unit tests; the real
// react-native Modal it renders is unnecessary noise here.
jest.mock('@/components/premium-preview-modal', () => {
  // require() is necessary here: jest hoists jest.mock() factories above
  // ES imports, so a top-level import would be accessed before initialization.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText } = require('react-native');

  return {
    PremiumPreviewModal: ({
      visible,
      onDismiss,
      onGoToFreeEpisode,
    }: {
      visible: boolean;
      onDismiss: () => void;
      onGoToFreeEpisode?: () => void;
    }) => {
      if (!visible) {
        return null;
      }

      return ReactModule.createElement(
        ReactModule.Fragment,
        null,
        ReactModule.createElement(RNText, null, 'Episode ini termasuk konten premium.'),
        ReactModule.createElement(RNText, { onPress: onDismiss }, 'Segera Hadir'),
        onGoToFreeEpisode
          ? ReactModule.createElement(RNText, { onPress: onGoToFreeEpisode }, 'Kembali ke Episode Gratis')
          : null
      );
    },
  };
});

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

function buildEpisode(overrides: Partial<Episode> = {}): Episode {
  return {
    videoId: 'video-2',
    seriesId: 'series-ceo-dingin',
    episodeNumber: 2,
    title: 'Kontrak Cinta CEO Dingin - Episode 2',
    thumbnailUrl: 'https://cdn.example.com/video-2.jpg',
    playbackUrl: 'https://media.example.com/video-2.mp4',
    accessType: 'free',
    isAvailable: true,
    hasEmbeddedIndonesianSubtitle: true,
    ...overrides,
  };
}

const baseProps = {
  height: 800,
  isActive: true,
  isScreenFocused: true,
  isLiked: false,
  isSaved: false,
  likeCount: 12800,
  onShare: jest.fn(),
  onToggleLike: jest.fn(),
  onToggleSave: jest.fn(),
};

describe('DramaFeedItem', () => {
  it('clamps title to 2 lines and caption to 1 line by default', async () => {
    const video = buildVideo();
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    expect(getByText(video.title).props.numberOfLines).toBe(2);
    expect(getByText(video.caption).props.numberOfLines).toBe(1);
  });

  it('expands a long caption when "Lebih banyak" is pressed', async () => {
    const longCaption =
      'Sebuah rahasia besar terungkap ketika keluarga itu kembali ke kampung halaman setelah bertahun-tahun pergi.';
    const video = buildVideo({ caption: longCaption });
    const { getByText, queryByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    expect(getByText('Lebih banyak')).toBeTruthy();

    await fireEvent.press(getByText('Lebih banyak'));

    expect(queryByText('Lebih banyak')).toBeNull();
    expect(getByText('Lebih sedikit')).toBeTruthy();
  });

  it('caps an expanded caption to a maximum number of lines', async () => {
    const longCaption =
      'Sebuah rahasia besar terungkap ketika keluarga itu kembali ke kampung halaman setelah bertahun-tahun pergi.';
    const video = buildVideo({ caption: longCaption });
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    await fireEvent.press(getByText('Lebih banyak'));

    expect(getByText(longCaption, { exact: false }).props.numberOfLines).toBe(6);
  });

  it('calls the provided handlers when Like, Save, and Share are pressed', async () => {
    const video = buildVideo();
    const onToggleLike = jest.fn();
    const onToggleSave = jest.fn();
    const onShare = jest.fn();
    const { getByLabelText } = await renderFeedItem(
      <DramaFeedItem
        video={video}
        {...baseProps}
        onShare={onShare}
        onToggleLike={onToggleLike}
        onToggleSave={onToggleSave}
      />
    );

    await fireEvent.press(getByLabelText('Like'));
    await fireEvent.press(getByLabelText('Save'));
    await fireEvent.press(getByLabelText('Share'));

    expect(onToggleLike).toHaveBeenCalledTimes(1);
    expect(onToggleSave).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('navigates to the free next episode when Episode Berikutnya is pressed', async () => {
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'free', videoId: 'video-2' });
    const { getByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    await fireEvent.press(getByText('Episode Berikutnya'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/',
      params: { videoId: 'video-2' },
    });
  });

  it('opens the premium modal instead of navigating for a premium next episode', async () => {
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'premium', videoId: 'video-6' });
    const { getByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    await fireEvent.press(getByText('Episode Berikutnya'));

    expect(router.push).not.toHaveBeenCalled();
    expect(getByText('Episode ini termasuk konten premium.')).toBeTruthy();
  });

  it('shows the Fullscreen button for a horizontal video', async () => {
    const video = buildVideo({ width: 1280, height: 720 });
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    expect(getByText('Fullscreen')).toBeTruthy();
  });

  it('does not show the Fullscreen button for a vertical video', async () => {
    const video = buildVideo({ width: 720, height: 1280 });
    const { queryByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    expect(queryByText('Fullscreen')).toBeNull();
  });
});
