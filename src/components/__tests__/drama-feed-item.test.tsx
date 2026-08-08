import { render, fireEvent, act, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { AppState, Platform, StyleSheet } from 'react-native';

import { DramaFeedItem, touchDistance } from '@/components/drama-feed-item';
import { FeedBottomGap } from '@/constants/theme';
import { resetPlaybackInvariantForTests } from '@/services/debug/playback-invariant';
import type { Episode } from '@/types/series';
import type { PlaybackAuthorization } from '@/types/playback';
import type { Video } from '@/types/video';

// `render()` in this testing-library version is itself async (it returns a
// thenable that flushes pending work, including microtask-queued effects,
// when awaited) - every call site already does `await renderFeedItem(...)`.
// The active item's mount effect kicks off an async playback-authorization
// fetch (mocked below); awaiting `render()` is what flushes that fetch's
// resolution and the resulting setState before control returns to the test.
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

// Slice 11M: the active item authorizes playback through this call instead
// of playing `video.playbackUrl` directly. Mocked here (rather than mocking
// `@/services/api/client`'s `request`) so tests can assert on exactly what
// this component does with the resolved `{ playbackUrl, requiresAuthHeader,
// expiresAt }` shape without needing to know it goes over HTTP at all.
const mockGetPlaybackAuthorization = jest.fn();

jest.mock('@/services/videos/video-service', () => ({
  getPlaybackAuthorization: (videoId: string) => mockGetPlaybackAuthorization(videoId),
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
    // Mirrors expo-video's real contract (it is built on
    // useReleasingSharedObject): useVideoPlayer returns the SAME player
    // instance across re-renders that carry an UNCHANGED source, but hands
    // back a NEW instance the moment the source actually changes (e.g. a
    // token refresh, or - Slice 11M - the active item's playback URL
    // arriving asynchronously / being refreshed). Comparing by value
    // (`JSON.stringify`), not by reference, matters both ways: every
    // render builds a fresh `{ uri, headers }` object literal even when
    // nothing meaningful changed, so reference equality would replace the
    // player on every render (hiding the bug class where an effect
    // legitimately does NOT re-run because its dependency values did not
    // change); only a real value change may replace it.
    useVideoPlayer: jest.fn((source: unknown, configure?: (player: unknown) => void) => {
      const playerRef = ReactModule.useRef(null);
      const sourceKeyRef = ReactModule.useRef(undefined);
      const nextSourceKey = JSON.stringify(source ?? null);

      if (!playerRef.current || sourceKeyRef.current !== nextSourceKey) {
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
        playerRef.current = player;
        sourceKeyRef.current = nextSourceKey;
      }

      return playerRef.current;
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

function buildPlaybackAuthorization(
  overrides: Partial<{
    playbackUrl: string;
    expiresAt: string;
    requiresAuthHeader: boolean;
  }> = {}
) {
  return {
    playbackUrl: 'https://media.example.com/video-1.mp4',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    requiresAuthHeader: true,
    ...overrides,
  };
}

/**
 * A promise whose resolution is controlled by the test, so a race between
 * two in-flight `getPlaybackAuthorization` calls can be driven to a
 * specific, deterministic order instead of relying on incidental timing.
 */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

/**
 * Grabs the most recently created mock player instance. Module-scoped
 * (unlike the `allPlayers()`/`latestPlayer()` helpers defined inside their
 * own `describe` blocks below) so the Slice 11M describe block can use it
 * too without duplicating it.
 */
function latestMockPlayer() {
  const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');

  return (useVideoPlayer as jest.Mock).mock.results.at(-1)?.value as {
    play: jest.Mock;
    pause: jest.Mock;
  };
}

/**
 * Finds the player instance currently wired to a given source URI - the
 * LATEST `useVideoPlayer` call whose source had that exact `uri`. Needed
 * (rather than positionally destructuring `allPlayers()`) now that the
 * mock replaces a component's player when its source changes: an item that
 * starts `null` and resolves to a real URL produces TWO distinct instances
 * (an early, discarded one and the real one), so "the Nth distinct player
 * ever created" no longer reliably means "the Nth component's current
 * player."
 */
function findPlayerByUri(expectedUri: string) {
  const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
  const mock = (useVideoPlayer as jest.Mock).mock;

  for (let index = mock.calls.length - 1; index >= 0; index -= 1) {
    const source = mock.calls[index][0] as { uri?: string } | null;

    if (source?.uri === expectedUri) {
      return mock.results[index]?.value as {
        play: jest.Mock;
        pause: jest.Mock;
        rateWrites: number[];
      };
    }
  }

  return undefined;
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
    // The invariant registry is module-level state; without this a test that
    // ever drives a player to playing=true would leak into the next one.
    resetPlaybackInvariantForTests();
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
    // Default: authorize whichever video id was requested, matching this
    // file's `https://media.example.com/${id}.mp4` convention. Individual
    // tests override with mockResolvedValueOnce/mockRejectedValueOnce for
    // specific scenarios (a given URL, an error, an expired grant, ...).
    mockGetPlaybackAuthorization.mockImplementation((videoId: string) =>
      Promise.resolve(
        buildPlaybackAuthorization({ playbackUrl: `https://media.example.com/${videoId}.mp4` })
      )
    );
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
    // A persistent `mockReturnValue` (not `...Once`) matters here: without
    // a token, the component's authorization effect sets an error state,
    // which causes a re-render - and that re-render reads `getTokens()`
    // again. A one-shot `Once` mock would answer that second read with the
    // logged-in default from `beforeEach`, "fixing" the logged-out state
    // mid-test and hiding the very case this test exists to cover.
    (getTokens as jest.Mock).mockReturnValue(null);

    const video = buildVideo();
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    expect(getByText('Video unavailable')).toBeTruthy();
    // Slice 11M: no token means the real `/videos/:id/playback` endpoint
    // would just 401 - the component must skip that wasted round trip
    // entirely rather than firing it and discarding the result.
    expect(mockGetPlaybackAuthorization).not.toHaveBeenCalled();
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
    // A demo build's own playback-authorization path (the mock-data branch
    // of `getPlaybackAuthorization`, see video-service.ts) resolves the
    // bundled clip's own URL with no Authorization header - simulated here
    // directly, since this file mocks `getPlaybackAuthorization` wholesale.
    mockGetPlaybackAuthorization.mockResolvedValueOnce(
      buildPlaybackAuthorization({ playbackUrl: video.playbackUrl, requiresAuthHeader: false })
    );

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

    // useVideoPlayer is called once per render and returns the SAME instance
    // each time, so the raw results list has one entry per render. Collapsing
    // to distinct instances gives one entry per feed item, in mount order.
    function allPlayers(): MockPlayer[] {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');

      return Array.from(
        new Set(
          (useVideoPlayer as jest.Mock).mock.results.map(
            (mockResult) => mockResult.value as MockPlayer
          )
        )
      );
    }

    it('ten mounted items: exactly one player gets play(), the other nine never get a source or play()', async () => {
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

      // Assert: mounted != playing. One play, zero rate writes anywhere.
      const players = allPlayers();

      // Not asserted as an exact count: the active item's own source starts
      // `null` and is replaced once its authorization resolves (see the
      // `useVideoPlayer` mock above), which legitimately produces one extra,
      // never-played, already-discarded instance beyond the 10 mounted
      // component slots. What matters is relative, not absolute - exactly
      // one instance ever played, and every other instance never did.
      expect(players.filter((player) => player.play.mock.calls.length > 0)).toHaveLength(1);
      expect(players.filter((player) => player.play.mock.calls.length === 0)).toHaveLength(
        players.length - 1
      );
      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);
      expect(mockGetPlaybackAuthorization).toHaveBeenCalledWith('video-1');
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

      // A is legitimately playing at this point, so the transitions are what
      // this test is about - measure from here, not from mount. Looked up
      // by URI, not positionally: A's own activation already replaced its
      // initial null-sourced instance with its real one (see the
      // `useVideoPlayer` mock above), so "the Nth distinct player" no
      // longer reliably lines up with "the Nth item."
      const playerA = findPlayerByUri('https://media.example.com/video-1.mp4');

      playerA?.play.mockClear();
      playerA?.pause.mockClear();

      await act(async () => {
        rerender(feedWithActive(1));
      });
      await act(async () => {
        rerender(feedWithActive(2));
      });

      const playerB = findPlayerByUri('https://media.example.com/video-2.mp4');
      const playerC = findPlayerByUri('https://media.example.com/video-3.mp4');

      // Every item that lost the active slot was paused, and only the final
      // one was ever asked to play.
      expect(playerA?.pause).toHaveBeenCalled();
      expect(playerA?.play).not.toHaveBeenCalled();
      expect(playerB?.pause).toHaveBeenCalled();
      expect(playerC?.play).toHaveBeenCalled();
      expect(playerC?.pause).not.toHaveBeenCalled();
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

        // Slice 11M: this item never became active, so it never requested
        // playback authorization and never received a player source -
        // there is nothing for the foreground transition's reconciler pass
        // to pause. "Never played" is what proves foregrounding didn't
        // start it.
        expect(allPlayers().at(-1)!.play).not.toHaveBeenCalled();
        expect(mockGetPlaybackAuthorization).not.toHaveBeenCalled();
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

      // The active item is already playing before fullscreen is entered, so
      // ownership has to be measured from this point forward rather than from
      // the whole call history.
      const player = allPlayers().at(-1)!;

      player.play.mockClear();
      player.pause.mockClear();

      await act(async () => {
        mockLatestVideoViewProps.onFullscreenEnter?.();
      });

      // While native fullscreen owns playback, the reconciler abstains: it
      // must neither pause the fullscreen playback nor issue competing plays.
      expect(player.play).not.toHaveBeenCalled();
      expect(player.pause).not.toHaveBeenCalled();

       
      player.playing = false;

      await act(async () => {
        mockLatestVideoViewProps.onFullscreenExit?.();
      });

      expect(player.play).toHaveBeenCalled();
    });

    it('the 2x speed control never writes a rate to an inactive player', async () => {
      // On iOS a rate write IS a play command (AVPlayer.rate = 2), so for an
      // item that is not meant to be playing the only safe number of writes
      // is zero - asserting "it wrote 2 but did not call play()" would be
      // asserting the hazard itself.
      const { getByLabelText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive={false} isClearDisplay />
      );

      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 1x'));
      });

      const player = allPlayers().at(-1)!;

      expect(player.rateWrites).toEqual([]);
      expect(player.play).not.toHaveBeenCalled();
    });

    it('applies a rate chosen while inactive once the item becomes the active one', async () => {
      // Arrange: the viewer picks 2x on an item that is not playing.
      const video = buildVideo();
      const { getByLabelText, rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive={false} isClearDisplay />
      );

      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 1x'));
      });

      expect(allPlayers().at(-1)!.rateWrites).toEqual([]);

      // Act: it becomes the active item.
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive isClearDisplay />);
      });

      // Assert: the choice was remembered and applied exactly once, now that
      // a rate write can no longer start something meant to stay silent.
      expect(allPlayers().at(-1)!.rateWrites).toEqual([2]);
    });

    it('does not re-issue an identical rate write on a re-render', async () => {
      // Guards the equality check: even an unchanged value restarts a paused
      // player on iOS, so a re-render must not re-write the same rate.
      const video = buildVideo();
      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );

      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive isLiked />);
      });

      expect(allPlayers().at(-1)!.rateWrites).toEqual([]);
    });

    it('forgets a manual pause once the item stops being the active one', async () => {
      // Arrange: the viewer pauses the active item.
      const video = buildVideo();
      const { getByTestId, rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );
      const player = allPlayers().at(-1)!;

      // isPlaying reaches the component through the mocked useEvent, which
      // reads player.playing at render time - so the flag has to be set and
      // then re-rendered before the tap sees a playing video to pause.
       
      player.playing = true;
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
      });
      await act(async () => {
        fireEvent.press(getByTestId('feed-item-play-pause'));
      });
      expect(player.pause).toHaveBeenCalled();

      // Act: swipe away, then back.
       
      player.playing = false;
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
      });
      player.play.mockClear();
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
      });

      // Assert: a pause is a choice about the episode in front of you, not a
      // property the episode keeps forever.
      expect(player.play).toHaveBeenCalled();
    });

    it('pauses a player it is about to hand back, so a replaced instance cannot stay audible', async () => {
      // A token refresh changes the source object and expo-video builds a new
      // player; the outgoing one is only released, never paused.
      const video = buildVideo();
      const { unmount } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );
      const player = allPlayers().at(-1)!;

      player.pause.mockClear();
      // Wrapped in act because React flushes passive-effect cleanups
      // asynchronously; asserting straight after unmount() reads the state
      // before the cleanup has run.
      await act(async () => {
        unmount();
      });

      expect(player.pause).toHaveBeenCalled();
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

  describe('Slice 11M: playback authorization', () => {
    it('does not attach an Authorization header when the backend says requiresAuthHeader is false (a presigned R2 URL)', async () => {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({
          playbackUrl: 'https://r2.example.com/bucket/video-1.mp4?X-Amz-Signature=abc',
          requiresAuthHeader: false,
        })
      );

      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} />);

      // Attaching a Bearer header to a presigned R2 URL is what breaks it
      // for real (the storage provider rejects a request carrying two auth
      // mechanisms) - this is the regression test for that.
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
        uri: 'https://r2.example.com/bucket/video-1.mp4?X-Amz-Signature=abc',
        headers: undefined,
      });
    });

    it('shows the existing "Video unavailable" state, not a crash, when playback authorization fails (e.g. 403 ENTITLEMENT_REQUIRED)', async () => {
      mockGetPlaybackAuthorization.mockRejectedValueOnce(new Error('403 ENTITLEMENT_REQUIRED'));

      const { getByText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} />
      );

      expect(getByText('Video unavailable')).toBeTruthy();
      expect(latestMockPlayer()?.play).not.toHaveBeenCalled();
    });

    it('ignores an authorization response that arrives after the item is no longer active', async () => {
      const deferred = createDeferred<PlaybackAuthorization>();
      mockGetPlaybackAuthorization.mockReturnValueOnce(deferred.promise);
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');

      const video = buildVideo();
      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );

      // The item stops being active while its request is still in flight -
      // exactly the shape of a rapid scroll away from an item before its
      // authorization has come back.
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
      });

      // The stale response now lands.
      await act(async () => {
        deferred.resolve(buildPlaybackAuthorization());
      });

      // Must never reach the player - a swiped-away item must not start
      // buffering a URL nobody is watching, let alone play it.
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toBeNull();
      expect(latestMockPlayer()?.play).not.toHaveBeenCalled();
    });

    it('ignores a superseded authorization response once a newer request has been issued for the same item', async () => {
      const deferredFirst = createDeferred<PlaybackAuthorization>();
      const deferredSecond = createDeferred<PlaybackAuthorization>();
      mockGetPlaybackAuthorization.mockReturnValueOnce(deferredFirst.promise);
      mockGetPlaybackAuthorization.mockReturnValueOnce(deferredSecond.promise);
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');

      const videoA = buildVideo({ id: 'video-a' });
      const videoB = buildVideo({ id: 'video-b' });
      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={videoA} {...baseProps} isActive />
      );

      // A second, still-active item takes over the same mounted position
      // before the first request resolves - the newer request (for
      // video-b) is now the only one whose response should ever count.
      await act(async () => {
        rerender(<DramaFeedItem video={videoB} {...baseProps} isActive />);
      });

      await act(async () => {
        deferredFirst.resolve(
          buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/video-a.mp4' })
        );
      });

      // The superseded response must not have been wired up.
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toBeNull();

      await act(async () => {
        deferredSecond.resolve(
          buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/video-b.mp4' })
        );
      });

      // The latest request's own response is applied normally.
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
        uri: 'https://media.example.com/video-b.mp4',
        headers: { Authorization: 'Bearer test-access-token' },
      });
    });

    it('requests a fresh authorization once the previous grant has expired, for an item that is active again', async () => {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({
          playbackUrl: 'https://media.example.com/first-grant.mp4',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        })
      );
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/second-grant.mp4' })
      );

      const video = buildVideo();
      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );

      // Deactivate and reactivate: an expired grant must never be reused.
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
      });
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
      });

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
        uri: 'https://media.example.com/second-grant.mp4',
        headers: { Authorization: 'Bearer test-access-token' },
      });
    });

    it('requests playback authorization only for the active item among several mounted ones', async () => {
      await renderFeedItem(
        <>
          <DramaFeedItem video={buildVideo({ id: 'video-1' })} {...baseProps} isActive />
          <DramaFeedItem video={buildVideo({ id: 'video-2' })} {...baseProps} isActive={false} />
          <DramaFeedItem video={buildVideo({ id: 'video-3' })} {...baseProps} isActive={false} />
        </>
      );

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);
      expect(mockGetPlaybackAuthorization).toHaveBeenCalledWith('video-1');
    });
  });

  describe('Slice 11M review remediation (HIGH-1/HIGH-2/MEDIUM-3/4/5/6)', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('HIGH-1: proactively refreshes a grant while the item stays continuously active, before it actually expires', async () => {
      jest.useFakeTimers();
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({
          playbackUrl: 'https://media.example.com/first-grant.mp4',
          expiresAt: new Date(Date.now() + 40000).toISOString(),
        })
      );
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/second-grant.mp4' })
      );

      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive />);

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

      // The grant is valid for 40s; the refresh margin is 30s, so a fresh
      // one is requested 10s in - well before the old one dies, and without
      // the item ever leaving the active slot or a re-render forcing it.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000);
      });

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
        uri: 'https://media.example.com/second-grant.mp4',
        headers: { Authorization: 'Bearer test-access-token' },
      });
    });

    it('HIGH-1: does not schedule (or fire) a refresh once the item has left the active slot', async () => {
      jest.useFakeTimers();
      const video = buildVideo();
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({
          playbackUrl: 'https://media.example.com/first-grant.mp4',
          expiresAt: new Date(Date.now() + 40000).toISOString(),
        })
      );

      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
      });

      // Well past both the refresh margin and the grant's real expiry.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(60000);
      });

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);
    });

    it('HIGH-2: pauses the outgoing player and plays only the incoming one when the source is replaced mid-playback, with no invariant violation', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      jest.useFakeTimers();
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({
          playbackUrl: 'https://media.example.com/first-grant.mp4',
          expiresAt: new Date(Date.now() + 40000).toISOString(),
        })
      );
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/second-grant.mp4' })
      );

      const video = buildVideo();
      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );

      const outgoingPlayer = findPlayerByUri('https://media.example.com/first-grant.mp4');

      expect(outgoingPlayer?.play).toHaveBeenCalled();

      // Simulate the native player actually reporting itself as playing, so
      // the invariant registry has something to observe - mirrors this
      // file's existing `player.playing` convention (`useEvent` is mocked
      // to read it fresh at each render's call site).
      if (outgoingPlayer) {
        (outgoingPlayer as unknown as { playing: boolean }).playing = true;
      }
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
      });

      // The scheduled proactive refresh fires (40s grant - 30s margin =
      // 10s in), replacing the player while it is still "playing".
      await act(async () => {
        await jest.advanceTimersByTimeAsync(10000);
      });

      const incomingPlayer = findPlayerByUri('https://media.example.com/second-grant.mp4');

      expect(outgoingPlayer).not.toBe(incomingPlayer);
      expect(outgoingPlayer?.pause).toHaveBeenCalled();
      expect(incomingPlayer?.play).toHaveBeenCalled();
      expect(
        consoleErrorSpy.mock.calls.some((call) => call[0] === '[PlaybackInvariantViolation]')
      ).toBe(false);

      consoleErrorSpy.mockRestore();
    });

    it('MEDIUM-3: never logs the playback URL on a playback error - only the video id and a sanitized reason', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      mockGetPlaybackAuthorization.mockRejectedValueOnce(
        new Error(
          'failed for https://r2.example.com/bucket/video-secret.mp4?X-Amz-Signature=super-secret'
        )
      );

      const video = buildVideo({ id: 'video-secret-id' });

      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      const dramaFeedItemLogs = warnSpy.mock.calls
        .map((call) => call.join(' '))
        .filter((message) => message.includes('[DramaFeedItem]'));

      expect(dramaFeedItemLogs.length).toBeGreaterThan(0);
      dramaFeedItemLogs.forEach((message) => {
        expect(message).not.toMatch(/https?:\/\//);
        expect(message).not.toContain('X-Amz-Signature');
      });
      expect(dramaFeedItemLogs.some((message) => message.includes('video-secret-id'))).toBe(true);

      warnSpy.mockRestore();
    });

    it('MEDIUM-4: does not reuse a previous video\'s cached grant when the video prop changes on the same instance', async () => {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      const videoA = buildVideo({ id: 'video-a' });
      const videoB = buildVideo({ id: 'video-b' });
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/video-a.mp4' })
      );

      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={videoA} {...baseProps} isActive />
      );

      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
        uri: 'https://media.example.com/video-a.mp4',
        headers: { Authorization: 'Bearer test-access-token' },
      });

      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/video-b.mp4' })
      );

      await act(async () => {
        rerender(<DramaFeedItem video={videoB} {...baseProps} isActive />);
      });

      // The player must never be handed video A's still-valid grant under
      // video B's identity - a fresh request for B is required, and B's own
      // resolved URL is what actually gets wired up.
      expect(mockGetPlaybackAuthorization).toHaveBeenCalledWith('video-b');
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
        uri: 'https://media.example.com/video-b.mp4',
        headers: { Authorization: 'Bearer test-access-token' },
      });
    });

    it('MEDIUM-5: treats a resolved authorization with an empty playbackUrl as a failure, not a silent black screen', async () => {
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({ playbackUrl: '' })
      );

      const { getByText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} />
      );

      expect(getByText('Video unavailable')).toBeTruthy();
    });

    it('MEDIUM-6: automatically retries a transient authorization failure while the item stays continuously active', async () => {
      jest.useFakeTimers();
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      mockGetPlaybackAuthorization.mockRejectedValueOnce(new Error('network blip'));
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/recovered.mp4' })
      );

      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive />);

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

      await act(async () => {
        await jest.advanceTimersByTimeAsync(5000);
      });

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
        uri: 'https://media.example.com/recovered.mp4',
        headers: { Authorization: 'Bearer test-access-token' },
      });
    });

    it('MEDIUM-6: bounds automatic retries rather than hammering a permanently-failing endpoint forever', async () => {
      jest.useFakeTimers();
      mockGetPlaybackAuthorization.mockRejectedValue(new Error('permanent failure'));

      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive />);

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

      // Advanced one retry interval at a time (rather than one large jump)
      // so React gets to actually flush the state update each retry's
      // failure produces before the next scheduled timer is due - five
      // steps is comfortably past every retry the bound allows (3 x 5s).
      for (let step = 0; step < 5; step += 1) {
        await act(async () => {
          await jest.advanceTimersByTimeAsync(5000);
        });
      }

      // 1 initial attempt + at most 3 bounded automatic retries.
      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(4);
    });
  });
});
