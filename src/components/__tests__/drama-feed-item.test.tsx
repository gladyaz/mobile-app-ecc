import { render, fireEvent, act, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { AppState, Platform, StyleSheet } from 'react-native';

import { DramaFeedItem, touchDistance } from '@/components/drama-feed-item';
import { FeedBottomGap } from '@/constants/theme';
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

// Phase 10, work unit 10-M2: the player now attaches an access token to the
// video source's headers (see drama-feed-item.tsx), and the "next episode"
// premium gate now also consults `useEntitlement()`. Both are mocked here
// rather than exercised for real, matching how this file already mocks
// every other cross-cutting dependency (auth/store wiring is not this
// component's own concern to re-test).
jest.mock('@/services/demo/demo-mode', () => ({
  isDemoMode: jest.fn(() => false),
}));

jest.mock('@/services/auth/token-store', () => ({
  getTokens: jest.fn(() => ({ accessToken: 'test-access-token', refreshToken: 'test-refresh' })),
}));

// Phase 11 (11-M3/11-M4): the component now emits analytics events; the
// real queue schedules flush timers and hits the network, so it is mocked
// like every other cross-cutting dependency in this file.
jest.mock('@/services/analytics/analytics-queue', () => ({
  trackEvent: jest.fn(),
}));

const mockUseEntitlement = jest.fn();

jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => mockUseEntitlement(),
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
      // playbackRate is a tracked property, not a plain field: on iOS the
      // native setter assigns AVPlayer.rate on EVERY write and a non-zero
      // rate STARTS playback, so tests must be able to assert that mounting
      // never writes it at all.
      const rateWrites: number[] = [];
      let playbackRate = 1;
      const player = {
        loop: false,
        muted: false,
        playing: false,
        play: jest.fn(),
        pause: jest.fn(),
        rateWrites,
      };

      Object.defineProperty(player, 'playbackRate', {
        get: () => playbackRate,
        set: (nextRate: number) => {
          rateWrites.push(nextRate);
          playbackRate = nextRate;
        },
      });
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

describe('touchDistance', () => {
  it('measures the spread between two fingers', () => {
    // 3-4-5 triangle, so the distance is exactly 5.
    expect(
      touchDistance([
        { pageX: 0, pageY: 0 },
        { pageX: 3, pageY: 4 },
      ])
    ).toBe(5);
  });

  it('reports nothing for a gesture that is not two fingers', () => {
    // Callers read 0 as "not a pinch", which is what keeps single-touch taps,
    // swipes and scrub drags from ever toggling clear display.
    expect(touchDistance([])).toBe(0);
    expect(touchDistance([{ pageX: 10, pageY: 10 }])).toBe(0);
  });
});

describe('DramaFeedItem', () => {
  beforeEach(() => {
    // The component's dev-only [PlaybackDebug] instrumentation logs on every
    // play/pause decision (Jest runs with __DEV__ true); silence it so test
    // output stays readable.
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    // react-native's Jest preset returns undefined from
    // AppState.addEventListener, which breaks useAppForeground's cleanup on
    // unmount - give every test a real subscription shape by default. Tests
    // that need to drive app-state transitions install their own spy on top.
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((() => ({ remove: jest.fn() })) as never);
    mockUseEntitlement.mockReturnValue({ isPremium: false, refresh: jest.fn() });
    // clearMocks only clears calls, not return values, so a case that turns
    // demo mode on (or signs the user out) would otherwise leak into every
    // test after it.
    (
      jest.requireMock<typeof import('@/services/demo/demo-mode')>('@/services/demo/demo-mode')
        .isDemoMode as jest.Mock
    ).mockReturnValue(false);
    (
      jest.requireMock<typeof import('@/services/auth/token-store')>('@/services/auth/token-store')
        .getTokens as jest.Mock
    ).mockReturnValue({ accessToken: 'test-access-token', refreshToken: 'test-refresh' });
  });

  it('clamps title to 2 lines and caption to 1 line by default', async () => {
    const video = buildVideo();
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    expect(getByText(video.title).props.numberOfLines).toBe(2);
    expect(getByText(video.caption).props.numberOfLines).toBe(1);
  });

  it('anchors the bottom overlay one gap above the navbar without re-adding the tab bar height', async () => {
    // Arrange: useBottomTabBarHeight is mocked to 56 above. The tabs navigator
    // lays that bar out in flow, so this item's box already ends at its top
    // edge - adding 56 again here is what floated the overlay mid-video.
    const video = buildVideo();

    // Act
    const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    // Assert
    const overlay = StyleSheet.flatten(getByTestId('feed-item-bottom-overlay').props.style);
    const progress = StyleSheet.flatten(getByTestId('feed-item-progress-track').props.style);

    expect(overlay.bottom).toBe(FeedBottomGap);
    expect(progress.bottom).toBe(0);
  });

  it('leaves only the video and the progress bar on screen in clear display', async () => {
    // Arrange
    const video = buildVideo();

    // Act
    const { getByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} isClearDisplay />
    );

    // Assert: the metadata and action rail are both invisible and untappable,
    // while the progress bar survives - that pairing is the whole feature.
    const overlay = getByTestId('feed-item-bottom-overlay');

    expect(StyleSheet.flatten(overlay.props.style).opacity).toBe(0);
    expect(overlay.props.pointerEvents).toBe('none');
    expect(getByTestId('feed-item-progress-track')).toBeTruthy();
  });

  it('opens clear display from a long press in the middle of the video', async () => {
    // Arrange
    const video = buildVideo();
    const onToggleClearDisplay = jest.fn();

    const { getByTestId, queryByLabelText, findByLabelText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} onToggleClearDisplay={onToggleClearDisplay} />
    );

    // Nothing is offered until the viewer asks for it - a normal tap still
    // just plays and pauses.
    expect(queryByLabelText('Tampilan bersih')).toBeNull();

    // Act
    fireEvent(getByTestId('feed-item-play-pause'), 'longPress');
    fireEvent.press(await findByLabelText('Tampilan bersih'));

    // Assert
    expect(onToggleClearDisplay).toHaveBeenCalledWith(true);
  });

  it('gives clear display a visible way out, plus play and speed controls', async () => {
    // Arrange: without an on-screen exit, the only way back would be a gesture
    // the viewer has to already know about.
    const video = buildVideo();
    const onToggleClearDisplay = jest.fn();

    // Act
    const { getByLabelText, findByLabelText } = await renderFeedItem(
      <DramaFeedItem
        video={video}
        {...baseProps}
        isClearDisplay
        onToggleClearDisplay={onToggleClearDisplay}
      />
    );

    // Assert: speed toggles between the two supported rates...
    fireEvent.press(getByLabelText('Kecepatan 1x'));
    expect(await findByLabelText('Kecepatan 2x')).toBeTruthy();

    // ...and the exit hands control back to the feed that owns the state.
    fireEvent.press(getByLabelText('Keluar dari tampilan bersih'));
    expect(onToggleClearDisplay).toHaveBeenCalledWith(false);
  });

  it('keeps the metadata and the action rail on one shared bottom anchor', async () => {
    // Arrange
    const video = buildVideo();

    // Act
    const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);
    const overlay = getByTestId('feed-item-bottom-overlay');

    // Assert: both the metadata text and every action-rail button live inside
    // the single element that carries the anchor, so they cannot drift apart.
    expect(within(overlay).getByText(video.title)).toBeTruthy();
    expect(within(overlay).getByLabelText('Like')).toBeTruthy();
    expect(within(overlay).getByLabelText('Save')).toBeTruthy();
    expect(within(overlay).getByLabelText('Share')).toBeTruthy();
  });

  it('expands a long caption when "more" is pressed, and offers "less" to close it', async () => {
    const longCaption =
      'Sebuah rahasia besar terungkap ketika keluarga itu kembali ke kampung halaman setelah bertahun-tahun pergi.';
    const video = buildVideo({ caption: longCaption });
    const { getByText, queryByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    // The toggle has to sit beside the caption rather than inside it: a child
    // at the end of a `numberOfLines={1}` text is clipped away with the
    // overflow, which is what used to hide it completely.
    expect(getByText('more')).toBeTruthy();

    await fireEvent.press(getByText('more'));

    expect(queryByText('more')).toBeNull();
    expect(getByText('less')).toBeTruthy();

    await fireEvent.press(getByText('less'));

    expect(getByText('more')).toBeTruthy();
  });

  it('leaves a caption that fits on one line without a "more" affordance', async () => {
    const video = buildVideo({ caption: 'Pendek saja.' });
    const { queryByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    expect(queryByText('more')).toBeNull();
  });

  it('caps an expanded caption to a maximum number of lines', async () => {
    const longCaption =
      'Sebuah rahasia besar terungkap ketika keluarga itu kembali ke kampung halaman setelah bertahun-tahun pergi.';
    const video = buildVideo({ caption: longCaption });
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    await fireEvent.press(getByText('more'));

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

  it('attaches the current access token as an Authorization header on the video source (Phase 10, work unit 10-M2)', async () => {
    const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
    const video = buildVideo({ playbackUrl: 'https://media.example.com/video-1.mp4' });

    await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    const lastSource = (useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0] as {
      uri: string;
      headers: Record<string, string>;
    };

    // Reverting drama-feed-item.tsx to pass a bare `video.playbackUrl`
    // string here (dropping the auth header) would fail this assertion —
    // the backend now requires Authorization on every stream request, so
    // this is the regression test for "all playback silently breaks."
    expect(lastSource).toEqual({
      uri: 'https://media.example.com/video-1.mp4',
      headers: { Authorization: 'Bearer test-access-token' },
    });
  });

  it('shows the existing "Video unavailable" error state (not a crash or stuck player) when logged out with no access token', async () => {
    const { getTokens } = jest.requireMock<typeof import('@/services/auth/token-store')>(
      '@/services/auth/token-store'
    );
    (getTokens as jest.Mock).mockReturnValueOnce(null);

    const video = buildVideo();
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    expect(getByText('Video unavailable')).toBeTruthy();
  });

  it('plays a bundled clip before login in a demo build, where nothing is token-protected', async () => {
    // Arrange: signed out, demo build. The clips ship inside the binary, so
    // there is no stream endpoint to authorise against and no reason to make
    // someone log in before they can see the product.
    const { getTokens } = jest.requireMock<typeof import('@/services/auth/token-store')>(
      '@/services/auth/token-store'
    );
    const { isDemoMode } = jest.requireMock<typeof import('@/services/demo/demo-mode')>(
      '@/services/demo/demo-mode'
    );
    const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
    (getTokens as jest.Mock).mockReturnValue(null);
    (isDemoMode as jest.Mock).mockReturnValue(true);

    const video = buildVideo();

    // Act
    const { queryByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    // Assert: a real source is built, and no Authorization header is invented
    // for a local file.
    const lastSource = (useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0] as {
      uri: string;
      headers?: Record<string, string>;
    };

    expect(queryByText('Video unavailable')).toBeNull();
    expect(lastSource.uri).toBe(video.playbackUrl);
    expect(lastSource.headers).toBeUndefined();
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

    // The button opens the series page rather than jumping straight into the
    // clip, so the viewer lands on the episode list.
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/series/[id]',
      params: { id: 'series-ceo-dingin' },
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

  it('emits a premium_gate_hit analytics event when the premium modal blocks navigation (Phase 11)', async () => {
    const { trackEvent } = jest.requireMock<
      typeof import('@/services/analytics/analytics-queue')
    >('@/services/analytics/analytics-queue');
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'premium', videoId: 'video-6' });
    const { getByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    await fireEvent.press(getByText('Episode Berikutnya'));

    expect(trackEvent).toHaveBeenCalledWith('premium_gate_hit', {
      videoId: 'video-6',
      seriesId: nextEpisode.seriesId,
      episodeNumber: nextEpisode.episodeNumber,
      source: 'feed-next-episode',
    });
  });

  it('emits an episode_navigate analytics event when navigating to a free next episode (Phase 11)', async () => {
    const { trackEvent } = jest.requireMock<
      typeof import('@/services/analytics/analytics-queue')
    >('@/services/analytics/analytics-queue');
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'free', videoId: 'video-2' });
    const { getByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    await fireEvent.press(getByText('Episode Berikutnya'));

    expect(trackEvent).toHaveBeenCalledWith('episode_navigate', {
      videoId: 'video-2',
      seriesId: nextEpisode.seriesId,
      episodeNumber: nextEpisode.episodeNumber,
      source: 'feed-next-episode',
    });
  });

  it('navigates directly to a premium next episode for an entitled user, without the modal (Phase 10)', async () => {
    mockUseEntitlement.mockReturnValue({ isPremium: true, refresh: jest.fn() });
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'premium', videoId: 'video-6' });
    const { getByText, queryByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    await fireEvent.press(getByText('Episode Berikutnya'));

    expect(queryByText('Episode ini termasuk konten premium.')).toBeNull();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/series/[id]',
      params: { id: 'series-ceo-dingin' },
    });
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

  describe('activation play/pause lifecycle', () => {
    function latestPlayer() {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');

      return (useVideoPlayer as jest.Mock).mock.results.at(-1)?.value as {
        playing: boolean;
        play: jest.Mock;
        pause: jest.Mock;
        rateWrites: number[];
      };
    }

    it('does not write playbackRate at mount - on iOS that write starts every mounted player', async () => {
      // Arrange & Act: an inactive mounted item, exactly like the ~10 items
      // FlatList mounts around the active one at launch.
      await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive={false} />
      );

      // Assert: no rate write means no AVPlayer.rate assignment, so nothing
      // starts playing off-screen.
      expect(latestPlayer().rateWrites).toEqual([]);
    });

    it('writes playbackRate only when the viewer changes the speed', async () => {
      // Arrange
      const { getByLabelText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isClearDisplay />
      );

      // Act
      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 1x'));
      });

      // Assert: exactly the one deliberate write, no mount-time write of 1.
      expect(latestPlayer().rateWrites).toEqual([2]);
    });

    it('plays when it is the active, focused item', async () => {
      // Arrange & Act
      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive />);

      // Assert
      expect(latestPlayer().play).toHaveBeenCalled();
    });

    it('pauses on deactivation even while player.playing still reads false (double-audio regression)', async () => {
      // Arrange: the item is active, so a play() has been issued. The mock
      // player's `playing` stays false - exactly like a real native player
      // that is still buffering (iOS `waitingToPlayAtSpecifiedRate`, Android
      // ExoPlayer STATE_BUFFERING), where the pending play() will start
      // audio only after the item has already been swiped away.
      const video = buildVideo();
      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );

      expect(latestPlayer().play).toHaveBeenCalled();

      // Act: the item stops being active while `playing` still reads false.
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
      });

      // Assert: the pause must be issued anyway - guarding it behind
      // `player.playing` is what let a buffering player keep its pending
      // play() and speak over the next active item.
      expect(latestPlayer().pause).toHaveBeenCalled();
    });
  });

  describe('single-player ownership invariant', () => {
    type MockPlayer = {
      playing: boolean;
      play: jest.Mock;
      pause: jest.Mock;
      rateWrites: number[];
    };

    function allPlayers(): MockPlayer[] {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');

      return (useVideoPlayer as jest.Mock).mock.results.map(
        (mockResult) => mockResult.value as MockPlayer
      );
    }

    it('ten mounted items: exactly one player gets play(), the other nine get pause()', async () => {
      // Arrange & Act: the shape FlatList produces at cold launch - several
      // mounted items, exactly one active.
      await renderFeedItem(
        <>
          {Array.from({ length: 10 }, (_, index) => (
            <DramaFeedItem
              key={index}
              video={buildVideo({ id: `video-${index + 1}` })}
              {...baseProps}
              isActive={index === 0}
            />
          ))}
        </>
      );

      // Assert: mounted != playing. One play, nine pauses, zero rate writes.
      const players = allPlayers();

      expect(players).toHaveLength(10);
      expect(players.filter((player) => player.play.mock.calls.length > 0)).toHaveLength(1);
      expect(players.filter((player) => player.pause.mock.calls.length > 0)).toHaveLength(9);
      expect(players.every((player) => player.rateWrites.length === 0)).toBe(true);
    });

    it('rapid A -> B -> C transitions leave only C playing', async () => {
      const videos = [1, 2, 3].map((n) => buildVideo({ id: `video-${n}` }));
      const feedWithActive = (activeIndex: number) => (
        <>
          {videos.map((video, index) => (
            <DramaFeedItem
              key={video.id}
              video={video}
              {...baseProps}
              isActive={index === activeIndex}
            />
          ))}
        </>
      );

      const { rerender } = await renderFeedItem(feedWithActive(0));

      await act(async () => {
        rerender(feedWithActive(1));
      });
      await act(async () => {
        rerender(feedWithActive(2));
      });

      // The last render pass produced one player per item, in item order.
      const [playerA, playerB, playerC] = allPlayers().slice(-3);

      expect(playerA.play).not.toHaveBeenCalled();
      expect(playerA.pause).toHaveBeenCalled();
      expect(playerB.play).not.toHaveBeenCalled();
      expect(playerB.pause).toHaveBeenCalled();
      expect(playerC.play).toHaveBeenCalled();
      expect(playerC.pause).not.toHaveBeenCalled();
    });

    it('backgrounding pauses the active item and foregrounding resumes it', async () => {
      const appStateListeners: ((state: string) => void)[] = [];
      const addListenerSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
        _event: string,
        listener: (state: string) => void
      ) => {
        appStateListeners.push(listener);

        return { remove: jest.fn() };
      }) as never);

      try {
        await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive />);

        expect(allPlayers().at(-1)!.play).toHaveBeenCalled();

        await act(async () => {
          appStateListeners.forEach((listener) => listener('background'));
        });

        expect(allPlayers().at(-1)!.pause).toHaveBeenCalled();

        await act(async () => {
          appStateListeners.forEach((listener) => listener('active'));
        });

        expect(allPlayers().at(-1)!.play).toHaveBeenCalled();
      } finally {
        addListenerSpy.mockRestore();
      }
    });

    it('foregrounding never starts an inactive item', async () => {
      const appStateListeners: ((state: string) => void)[] = [];
      const addListenerSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
        _event: string,
        listener: (state: string) => void
      ) => {
        appStateListeners.push(listener);

        return { remove: jest.fn() };
      }) as never);

      try {
        await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive={false} />
        );

        await act(async () => {
          appStateListeners.forEach((listener) => listener('background'));
        });
        await act(async () => {
          appStateListeners.forEach((listener) => listener('active'));
        });

        expect(allPlayers().at(-1)!.play).not.toHaveBeenCalled();
        expect(allPlayers().at(-1)!.pause).toHaveBeenCalled();
      } finally {
        addListenerSpy.mockRestore();
      }
    });

    it('losing screen focus pauses; regaining focus resumes only the active item', async () => {
      const video = buildVideo();
      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );

      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive isScreenFocused={false} />);
      });

      expect(allPlayers().at(-1)!.pause).toHaveBeenCalled();

      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive isScreenFocused />);
      });

      expect(allPlayers().at(-1)!.play).toHaveBeenCalled();
    });

    it('fullscreen transition keeps ownership with the fullscreen player', async () => {
      const video = buildVideo({ width: 1280, height: 720 });

      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} isActive />);

      await act(async () => {
        mockLatestVideoViewProps.onFullscreenEnter?.();
      });

      // While native fullscreen owns playback, the reconciler abstains: it
      // must neither pause the fullscreen playback nor issue competing plays.
      const playerInFullscreen = allPlayers().at(-1)!;

      expect(playerInFullscreen.play).not.toHaveBeenCalled();
      expect(playerInFullscreen.pause).not.toHaveBeenCalled();

      await act(async () => {
        mockLatestVideoViewProps.onFullscreenExit?.();
      });

      expect(allPlayers().at(-1)!.play).toHaveBeenCalled();
    });

    it('the 2x speed control cannot start an inactive player', async () => {
      const { getByLabelText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive={false} isClearDisplay />
      );

      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 1x'));
      });

      const player = allPlayers().at(-1)!;

      expect(player.rateWrites).toEqual([2]);
      expect(player.play).not.toHaveBeenCalled();
    });

    it('a tap on an inactive item play/pause target does not start playback', async () => {
      const { getByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive={false} />
      );

      await act(async () => {
        fireEvent.press(getByTestId('feed-item-play-pause'));
      });

      expect(allPlayers().at(-1)!.play).not.toHaveBeenCalled();
    });
  });
});
