import { render, fireEvent, act } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { Platform } from 'react-native';

import { DramaFeedItem } from '@/components/drama-feed-item';
import type { Episode } from '@/types/series';
import type { Video } from '@/types/video';

function renderFeedItem(ui: ReactElement) {
  return render(ui);
}

jest.mock('expo', () => ({
  useEvent: jest.fn((_player: unknown, _eventName: string, defaultValue: unknown) => defaultValue),
}));

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

// expo-router/js-tabs pulls in expo-router's full Tabs implementation
// (native-tabs, splash, router-store, ...) which needs native modules
// unavailable under Jest. DramaFeedItem only needs the one hook it
// exports, so stub that directly with a fixed value.
jest.mock('expo-router/js-tabs', () => ({
  useBottomTabBarHeight: jest.fn(() => 56),
}));

jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP', LANDSCAPE: 'LANDSCAPE' },
  lockAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}));

// Captured by the VideoView mock below so tests can trigger
// onFullscreenEnter/onFullscreenExit directly, and assert on the imperative
// exitFullscreen() call the component's unmount cleanup makes.
let mockLatestVideoViewProps: {
  onFullscreenEnter?: () => void;
  onFullscreenExit?: () => void;
} = {};
const mockExitFullscreen = jest.fn(() => Promise.resolve());

jest.mock('expo-video', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');

  return {
    useVideoPlayer: jest.fn((_source: unknown, configure?: (player: unknown) => void) => {
      const player = { loop: false, muted: false, playing: false, play: jest.fn(), pause: jest.fn() };
      configure?.(player);
      return player;
    }),
    VideoView: ReactModule.forwardRef(
      (
        props: { onFullscreenEnter?: () => void; onFullscreenExit?: () => void },
        ref: unknown
      ) => {
        mockLatestVideoViewProps = props;
        ReactModule.useImperativeHandle(ref, () => ({
          enterFullscreen: jest.fn(() => Promise.resolve()),
          exitFullscreen: mockExitFullscreen,
        }));
        return null;
      }
    ),
  };
});

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
  isMuted: false,
  likeCount: 12800,
  onShare: jest.fn(),
  onToggleLike: jest.fn(),
  onToggleSave: jest.fn(),
  onToggleMute: jest.fn(),
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

  it('labels the sound control "Mute" when audible and calls onToggleMute when pressed', async () => {
    const video = buildVideo();
    const onToggleMute = jest.fn();
    const { getByLabelText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} isMuted={false} onToggleMute={onToggleMute} />
    );

    const muteButton = getByLabelText('Mute');

    await fireEvent.press(muteButton);

    expect(onToggleMute).toHaveBeenCalledTimes(1);
  });

  it('labels the sound control "Unmute" when muted', async () => {
    const video = buildVideo();
    const { getByLabelText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} isMuted={true} />
    );

    expect(getByLabelText('Unmute')).toBeTruthy();
  });

  it('syncs the player mute state to the isMuted prop', async () => {
    const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
    const video = buildVideo();

    await renderFeedItem(<DramaFeedItem video={video} {...baseProps} isMuted={true} />);

    const createdPlayer = (useVideoPlayer as jest.Mock).mock.results.at(-1)?.value as {
      muted: boolean;
    };

    expect(createdPlayer.muted).toBe(true);
  });

  it('pressing the sound control does not trigger Like, Save, or navigation', async () => {
    const video = buildVideo();
    const onToggleLike = jest.fn();
    const onToggleSave = jest.fn();
    const { getByLabelText } = await renderFeedItem(
      <DramaFeedItem
        video={video}
        {...baseProps}
        onToggleLike={onToggleLike}
        onToggleSave={onToggleSave}
      />
    );

    await fireEvent.press(getByLabelText('Mute'));

    expect(onToggleLike).not.toHaveBeenCalled();
    expect(onToggleSave).not.toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();
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

  it('locks landscape orientation when entering native fullscreen', async () => {
    const { lockAsync, OrientationLock } =
      jest.requireMock<typeof import('expo-screen-orientation')>('expo-screen-orientation');
    const video = buildVideo({ width: 1280, height: 720 });
    await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    mockLatestVideoViewProps.onFullscreenEnter?.();

    expect(lockAsync).toHaveBeenCalledWith(OrientationLock.LANDSCAPE);
  });

  it('restores portrait orientation when exiting native fullscreen', async () => {
    const { lockAsync, OrientationLock } =
      jest.requireMock<typeof import('expo-screen-orientation')>('expo-screen-orientation');
    const video = buildVideo({ width: 1280, height: 720 });
    await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    mockLatestVideoViewProps.onFullscreenEnter?.();
    mockLatestVideoViewProps.onFullscreenExit?.();

    expect(lockAsync).toHaveBeenLastCalledWith(OrientationLock.PORTRAIT_UP);
  });

  it('exits fullscreen and restores portrait orientation on unmount while still fullscreen', async () => {
    const { lockAsync, OrientationLock } =
      jest.requireMock<typeof import('expo-screen-orientation')>('expo-screen-orientation');
    const video = buildVideo({ width: 1280, height: 720 });
    const { unmount } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    await act(async () => {
      mockLatestVideoViewProps.onFullscreenEnter?.();
    });
    await act(async () => {
      unmount();
    });

    expect(mockExitFullscreen).toHaveBeenCalledTimes(1);
    expect(lockAsync).toHaveBeenLastCalledWith(OrientationLock.PORTRAIT_UP);
  });

  it('does not touch fullscreen or orientation on unmount when never entered fullscreen', async () => {
    const video = buildVideo({ width: 1280, height: 720 });
    const { unmount } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    unmount();

    expect(mockExitFullscreen).not.toHaveBeenCalled();
  });

  it('skips the orientation lock call on web without an unhandled rejection', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'web';

    const { lockAsync } =
      jest.requireMock<typeof import('expo-screen-orientation')>('expo-screen-orientation');
    (lockAsync as jest.Mock).mockClear();

    const unhandledRejectionSpy = jest.fn();
    process.on('unhandledRejection', unhandledRejectionSpy);

    try {
      const video = buildVideo({ width: 1280, height: 720 });
      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      mockLatestVideoViewProps.onFullscreenEnter?.();
      mockLatestVideoViewProps.onFullscreenExit?.();

      // Give any (incorrectly) unhandled promise rejection a microtask/tick
      // to surface before asserting.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(lockAsync).not.toHaveBeenCalled();
      expect(unhandledRejectionSpy).not.toHaveBeenCalled();
    } finally {
      process.removeListener('unhandledRejection', unhandledRejectionSpy);
      Platform.OS = originalOS;
    }
  });

  it('logs (without throwing) when the native orientation lock rejects for a real reason', async () => {
    const { lockAsync, OrientationLock } =
      jest.requireMock<typeof import('expo-screen-orientation')>('expo-screen-orientation');
    (lockAsync as jest.Mock).mockImplementationOnce(() =>
      Promise.reject(new Error('hardware unavailable'))
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    const video = buildVideo({ width: 1280, height: 720 });
    await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    await act(async () => {
      mockLatestVideoViewProps.onFullscreenEnter?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(lockAsync).toHaveBeenCalledWith(OrientationLock.LANDSCAPE);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
