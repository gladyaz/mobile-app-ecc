import { render, fireEvent, act, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { AppState, Platform, StyleSheet } from 'react-native';

import { DramaFeedItem, touchDistance } from '@/components/drama-feed-item';
import { FeedBottomGap } from '@/constants/theme';
import { ApiError } from '@/services/api/client';
import { resetPlaybackInvariantForTests } from '@/services/debug/playback-invariant';
import { __resetPlaybackSpeedForTests } from '@/stores/playback-speed';
import type { Episode } from '@/types/series';
import type {
  HlsPlaybackAuthorization,
  Mp4PlaybackAuthorization,
  PlaybackAuthorization,
  PlaybackRendition,
} from '@/types/playback';
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
// this component does with the resolved authorization without needing to
// know it goes over HTTP at all. `resolvePlaybackSource` is deliberately
// left as the REAL implementation (via `requireActual`) rather than also
// mocked - it is the single testable decision point this component now
// delegates to (Slice 11R), so these component tests exercise it for real
// rather than re-stubbing its branching.
const mockGetPlaybackAuthorization = jest.fn();

jest.mock('@/services/videos/video-service', () => {
  const actual = jest.requireActual('@/services/videos/video-service');

  return {
    ...actual,
    getPlaybackAuthorization: (videoId: string) => mockGetPlaybackAuthorization(videoId),
  };
});

// Slice 11R: the prefer-MP4 rollback flag. Defaults to enabled (HLS
// preferred) so every pre-existing test in this file - none of which know
// about this flag - keeps its original behavior; the "prefer-MP4" describe
// block below overrides the return value for its own cases.
const mockIsHlsPlaybackEnabled = jest.fn(() => true);

jest.mock('@/services/videos/hls-playback-flag', () => ({
  isHlsPlaybackEnabled: () => mockIsHlsPlaybackEnabled(),
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
  nativeControls?: boolean;
} = {};
const mockExitFullscreen = jest.fn(() => Promise.resolve());
// Issue 3 (11R physical-QA remediation): module-level, like
// `mockExitFullscreen` above, so a test can assert the rail's Fullscreen
// button actually reaches `videoViewRef.current.enterFullscreen()` rather
// than merely asserting the button exists.
const mockEnterFullscreen = jest.fn(() => Promise.resolve());

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
          enterFullscreen: mockEnterFullscreen,
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
): Mp4PlaybackAuthorization {
  return {
    kind: 'mp4',
    playbackUrl: 'https://media.example.com/video-1.mp4',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    requiresAuthHeader: true,
    ...overrides,
  };
}

// Slice 11R: mirrors `buildPlaybackAuthorization` above, for the HLS-shaped
// half of the union. `renditions` defaults to a small, valid, non-empty
// list - individual tests override it only when the rendition content
// itself is what's under test.
function buildHlsPlaybackAuthorization(
  overrides: Partial<{
    masterUrl: string;
    expiresAt: string;
    renditions: readonly PlaybackRendition[];
  }> = {}
): HlsPlaybackAuthorization {
  return {
    kind: 'hls',
    masterUrl: 'https://gateway.example.com/videos/video-1/master.m3u8?token=abc',
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    renditions: [
      { quality: '720p', width: 1280, height: 720, url: 'https://gateway.example.com/videos/video-1/720p.m3u8' },
      { quality: '480p', width: 854, height: 480, url: 'https://gateway.example.com/videos/video-1/480p.m3u8' },
    ],
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

// 11R remediation ADDENDUM (2026-08-12, control workspace DECISIONS.md):
// mirrors drama-feed-item.tsx's own `PLAYBACK_AUTH_SETTLE_MS`. Not imported
// directly (the component does not export it) so it is redeclared here, the
// same way this file already mirrors the component's other internal timing
// constants as raw literals (e.g. the 30s refresh margin, the 2s/4s/8s retry
// backoff below).
const TEST_PLAYBACK_AUTH_SETTLE_MS = 400;

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
    // The session speed store is module-level too - a test that selects
    // 1.5x/2x would otherwise leak that speed into every test after it.
    __resetPlaybackSpeedForTests();
    // react-native's Jest preset returns undefined from
    // AppState.addEventListener, which breaks useAppForeground's cleanup on
    // unmount - give every test a real subscription shape by default. Tests
    // that need to drive app-state transitions install their own spy on top.
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((() => ({ remove: jest.fn() })) as never);
    mockUseEntitlement.mockReturnValue({ isPremium: false, refresh: jest.fn() });
    // Slice 11R: defaults to HLS preferred/enabled; the "prefer-MP4
    // rollback flag" describe block below overrides this per test.
    mockIsHlsPlaybackEnabled.mockReturnValue(true);
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

    // Assert: all three rates are offered, 1x is the resting default, and a
    // tap moves the selection...
    expect(getByLabelText('Kecepatan 1x').props.accessibilityState.selected).toBe(true);
    fireEvent.press(getByLabelText('Kecepatan 1.5x'));
    expect((await findByLabelText('Kecepatan 1.5x')).props.accessibilityState.selected).toBe(true);
    expect(getByLabelText('Kecepatan 1x').props.accessibilityState.selected).toBe(false);
    expect(getByLabelText('Kecepatan 2x').props.accessibilityState.selected).toBe(false);

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

  it('shows the Fullscreen control in the action rail for a horizontal video', async () => {
    // Issue 3 (11R physical-QA remediation): fullscreen moved from an
    // ad-hoc absolute pill into the same action rail as Mute/Like/Save/Share.
    const video = buildVideo({ width: 1280, height: 720 });
    const { getByLabelText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    expect(getByLabelText('Fullscreen')).toBeTruthy();
  });

  it('does not show the Fullscreen control for a vertical video', async () => {
    const video = buildVideo({ width: 720, height: 1280 });
    const { queryByLabelText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    expect(queryByLabelText('Fullscreen')).toBeNull();
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

  describe('autoplay once the player is ready (reported from device QA)', () => {
    it('issues play() when the player reports ready, not only when it became active', async () => {
      // An R2-backed item receives its URL only after an authorization round
      // trip, so the first play() regularly lands while the source is still
      // resolving and does not take. Without re-evaluating on `status`, the
      // item then sits showing its play icon until the viewer taps it.
      const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
      (useEvent as jest.Mock).mockImplementation(
        (_player: unknown, eventName: string, defaultValue: unknown) =>
          eventName === 'statusChange' ? { status: 'loading', error: undefined } : defaultValue
      );

      const video = buildVideo();
      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );

      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      const player = (useVideoPlayer as jest.Mock).mock.results.at(-1)?.value as {
        play: jest.Mock;
      };

      player.play.mockClear();

      // The player finishes loading.
      (useEvent as jest.Mock).mockImplementation(
        (_player: unknown, eventName: string, defaultValue: unknown) =>
          eventName === 'statusChange' ? { status: 'readyToPlay', error: undefined } : defaultValue
      );

      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
      });

      expect(player.play).toHaveBeenCalled();
    });

    it('does not start an inactive item when its player becomes ready', async () => {
      const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
      (useEvent as jest.Mock).mockImplementation(
        (_player: unknown, eventName: string, defaultValue: unknown) =>
          eventName === 'statusChange' ? { status: 'readyToPlay', error: undefined } : defaultValue
      );

      const video = buildVideo();

      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} isActive={false} />);

      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      const player = (useVideoPlayer as jest.Mock).mock.results.at(-1)?.value as {
        play: jest.Mock;
      };

      expect(player.play).not.toHaveBeenCalled();
    });
  });

  describe('fullscreen affordances (reported from device QA)', () => {
    // Issue 3 (11R physical-QA remediation): the fullscreen control used to
    // be an ad-hoc absolute pill, independent of the action rail's own
    // bottom anchor and z-order, which a physical-device QA pass reported as
    // hidden behind the Share button. It now lives IN the rail (same
    // container as Mute/Like/Save/Share, so it is bottom-anchored and
    // z-ordered identically to every other action).
    it('places Fullscreen inside the same action rail as Share, as an independent sibling', async () => {
      const video = buildVideo({ width: 1280, height: 720 });
      const { getByTestId, getByLabelText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      const overlay = getByTestId('feed-item-bottom-overlay');
      const fullscreenButton = within(overlay).getByLabelText('Fullscreen');
      const shareButton = within(overlay).getByLabelText('Share');

      // Both controls resolve inside the one bottom-anchored overlay - not a
      // second, independently-positioned element competing for the same
      // screen space.
      expect(fullscreenButton).toBeTruthy();
      expect(shareButton).toBeTruthy();
      // Distinct pressables, not the same control wearing two labels.
      expect(fullscreenButton).not.toBe(shareButton);
      expect(getByLabelText('Fullscreen')).toBe(fullscreenButton);
    });

    it('orders the rail Fullscreen, Mute, Like, Save, Share', async () => {
      const video = buildVideo({ width: 1280, height: 720 });
      const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      const rail = getByTestId('feed-item-actions-rail');
      const labels = within(rail)
        .getAllByRole('button')
        .map((button) => button.props.accessibilityLabel);

      expect(labels).toEqual(['Fullscreen', 'Mute', 'Like', 'Save', 'Share']);
    });

    it('omits Fullscreen from the rail for a vertical video, leaving the rest of the order unchanged', async () => {
      const video = buildVideo({ width: 720, height: 1280 });
      const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      const rail = getByTestId('feed-item-actions-rail');
      const labels = within(rail)
        .getAllByRole('button')
        .map((button) => button.props.accessibilityLabel);

      expect(labels).toEqual(['Mute', 'Like', 'Save', 'Share']);
    });

    it('keeps every action-rail control independently tappable - Fullscreen does not swallow Share, Like, Save, or Mute', async () => {
      const video = buildVideo({ width: 1280, height: 720 });
      const onToggleLike = jest.fn();
      const onToggleSave = jest.fn();
      const onToggleMute = jest.fn();
      const onShare = jest.fn();
      const { getByLabelText } = await renderFeedItem(
        <DramaFeedItem
          video={video}
          {...baseProps}
          onToggleLike={onToggleLike}
          onToggleSave={onToggleSave}
          onToggleMute={onToggleMute}
          onShare={onShare}
        />
      );

      await fireEvent.press(getByLabelText('Fullscreen'));
      await fireEvent.press(getByLabelText('Mute'));
      await fireEvent.press(getByLabelText('Like'));
      await fireEvent.press(getByLabelText('Save'));
      await fireEvent.press(getByLabelText('Share'));

      expect(mockEnterFullscreen).toHaveBeenCalledTimes(1);
      expect(onToggleMute).toHaveBeenCalledTimes(1);
      expect(onToggleLike).toHaveBeenCalledTimes(1);
      expect(onToggleSave).toHaveBeenCalledTimes(1);
      expect(onShare).toHaveBeenCalledTimes(1);
    });

    it('enters native fullscreen when the rail\'s Fullscreen control is pressed', async () => {
      const video = buildVideo({ width: 1280, height: 720 });
      const { getByLabelText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      await fireEvent.press(getByLabelText('Fullscreen'));

      expect(mockEnterFullscreen).toHaveBeenCalledTimes(1);
    });

    it('hands control to the platform while fullscreen, so there is a visible way out', async () => {
      // With nativeControls permanently false, fullscreen had no chrome at
      // all and no exit button - a viewer had to guess that rotating the
      // device was the only way back.
      const video = buildVideo({ width: 1280, height: 720 });

      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} isActive />);

      expect(mockLatestVideoViewProps.nativeControls).toBe(false);

      await act(async () => {
        mockLatestVideoViewProps.onFullscreenEnter?.();
      });
      expect(mockLatestVideoViewProps.nativeControls).toBe(true);

      await act(async () => {
        mockLatestVideoViewProps.onFullscreenExit?.();
      });
      expect(mockLatestVideoViewProps.nativeControls).toBe(false);
    });
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
        fireEvent.press(getByLabelText('Kecepatan 2x'));
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
      // 11R remediation ADDENDUM: B and C were both mounted INACTIVE
      // alongside A (a windowed FlatList's pre-mounted neighbours), so their
      // later activation is a genuine landing, debounced by the settle
      // window - only A's own mount-time activation above is exempt.
      jest.useFakeTimers();
      try {
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
        // B's own landing settles - long enough for its authorization to
        // actually fire and resolve - before C takes over.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });
        await act(async () => {
          rerender(feedWithActive(2));
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
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
      } finally {
        jest.useRealTimers();
      }
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
        fireEvent.press(getByLabelText('Kecepatan 2x'));
      });

      const player = allPlayers().at(-1)!;

      expect(player.rateWrites).toEqual([]);
      expect(player.play).not.toHaveBeenCalled();
    });

    it('applies a rate chosen while inactive once the item becomes the active one', async () => {
      // 11R remediation ADDENDUM: this item was mounted INACTIVE, so its
      // later activation is a genuine landing - not the cold-mount-already-
      // active exemption - and goes through the settle-window debounce
      // before it authorizes and can start playing at all.
      jest.useFakeTimers();
      try {
        // Arrange: the viewer picks 2x on an item that is not playing.
        const video = buildVideo();
        const { getByLabelText, rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive={false} isClearDisplay />
        );

        await act(async () => {
          fireEvent.press(getByLabelText('Kecepatan 2x'));
        });

        expect(allPlayers().at(-1)!.rateWrites).toEqual([]);

        // Act: it becomes the active item.
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive isClearDisplay />);
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        // Assert: the choice was remembered and applied exactly once, now that
        // a rate write can no longer start something meant to stay silent.
        expect(allPlayers().at(-1)!.rateWrites).toEqual([2]);
      } finally {
        jest.useRealTimers();
      }
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
      // 11R remediation ADDENDUM: video A's own mount-time fetch is exempt
      // from the settle-window debounce (it is already the active item on
      // first render), but swapping in video B on the SAME still-active
      // instance is a later landing, which is debounced - the fake timers
      // below stand in for that wait.
      jest.useFakeTimers();
      try {
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
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
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
      } finally {
        jest.useRealTimers();
      }
    });

    it('requests a fresh authorization once the previous grant has expired, for an item that is active again', async () => {
      // 11R remediation ADDENDUM: the REACTIVATION (after having left the
      // active slot) is a landing like any other and is debounced - only
      // the very first, mount-time activation above is exempt.
      jest.useFakeTimers();
      try {
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
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);
        expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
          uri: 'https://media.example.com/second-grant.mp4',
          headers: { Authorization: 'Bearer test-access-token' },
        });
      } finally {
        jest.useRealTimers();
      }
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
      // 11R remediation ADDENDUM: video B's fetch is a SECOND landing on an
      // already-mounted instance (the mount-time exemption was already
      // consumed by video A), so it goes through the settle-window
      // debounce.
      jest.useFakeTimers();
      try {
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
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        // The player must never be handed video A's still-valid grant under
        // video B's identity - a fresh request for B is required, and B's own
        // resolved URL is what actually gets wired up.
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledWith('video-b');
        expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
          uri: 'https://media.example.com/video-b.mp4',
          headers: { Authorization: 'Bearer test-access-token' },
        });
      } finally {
        jest.useRealTimers();
      }
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
      // 11R remediation ADDENDUM: only a 429 or a genuine network error
      // (`ApiError`, per `isRetryablePlaybackAuthError`) is auto-retried -
      // a bare `Error` (as this test used to reject with) is no longer
      // treated as transient, since a real backend never throws one for
      // this endpoint. The retry schedule is also now backoff (2s/4s/8s),
      // not a flat 5s.
      jest.useFakeTimers();
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      mockGetPlaybackAuthorization.mockRejectedValueOnce(
        new ApiError(0, 'NETWORK_ERROR', 'network blip')
      );
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/recovered.mp4' })
      );

      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive />);

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

      // First automatic retry fires 2s in (the first entry of the 2s/4s/8s
      // backoff table).
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000);
      });

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
        uri: 'https://media.example.com/recovered.mp4',
        headers: { Authorization: 'Bearer test-access-token' },
      });
    });

    it('MEDIUM-6: bounds automatic retries rather than hammering a permanently-failing endpoint forever', async () => {
      // A sustained 429 (the backend's own throttle - the exact real-world
      // shape the 2026-08-12 field report describes) is retryable, but
      // still bounded rather than hammered forever.
      jest.useFakeTimers();
      mockGetPlaybackAuthorization.mockRejectedValue(
        new ApiError(429, 'RATE_LIMITED', 'too many requests')
      );

      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive />);

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

      // Advanced one step at a time (rather than one large jump) so React
      // gets to actually flush the state update each retry's failure
      // produces before the next scheduled timer is due. 5 x 5000ms = 25s
      // is comfortably past the full 2s+4s+8s = 14s backoff budget.
      for (let step = 0; step < 5; step += 1) {
        await act(async () => {
          await jest.advanceTimersByTimeAsync(5000);
        });
      }

      // 1 initial attempt + at most 3 bounded automatic retries.
      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(4);
    });

    it('11R remediation ADDENDUM: never retries a 403 ENTITLEMENT_REQUIRED - it is a legitimate unavailable state', async () => {
      jest.useFakeTimers();
      mockGetPlaybackAuthorization.mockRejectedValue(
        new ApiError(403, 'ENTITLEMENT_REQUIRED', 'no entitlement')
      );

      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive />);

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

      // Well past the entire 2s/4s/8s backoff budget a retryable failure
      // would have used.
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20000);
      });

      expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);
    });
  });

  // 2026-08-12 remediation ADDENDUM (control workspace DECISIONS.md, "11R
  // remediation ADDENDUM approved: mobile playback-auth debounce + 429
  // retry"): a fast, ±1-per-gesture scroll landed the active slot on every
  // intermediate item, each firing its own playback-authorization request on
  // arrival - ~78 requests in ~2 minutes of real device browsing, tripping
  // the backend's 60/min-per-user throttle on `GET /videos/:id/playback`
  // and leaving the active video stuck black. These tests exercise the
  // settle-window debounce and the bounded 429/network retry directly (the
  // tests above, updated for the same change, exercise it indirectly
  // through their own existing scenarios).
  describe('11R remediation ADDENDUM: playback-auth settle-window debounce + 429 retry', () => {
    it('a transient landing (active for less than the settle window) fires zero authorization requests', async () => {
      jest.useFakeTimers();
      try {
        const video = buildVideo();
        const { rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive={false} />
        );

        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
        });
        // Still short of the settle window - a mid-swipe transit, not a
        // deliberate stop.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS - 100);
        });
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
        });
        // Even advancing well past the original window must not fire it -
        // deactivating already cancelled the pending timer.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS * 3);
        });

        expect(mockGetPlaybackAuthorization).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('a landing that remains active past the settle window fires exactly one authorization request', async () => {
      jest.useFakeTimers();
      try {
        const video = buildVideo();
        const { rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive={false} />
        );

        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
        });

        // Not yet - the settle window has not elapsed. Pre-addendum code
        // fires synchronously on activation with no debounce at all, so
        // this assertion alone already fails against it; without it, this
        // test would only ever check the post-window count, which the
        // pre-addendum code also satisfies (it fired earlier, but still
        // exactly once), making the "exactly one" assertion below pass on
        // both old and new code and prove nothing about the debounce.
        expect(mockGetPlaybackAuthorization).not.toHaveBeenCalled();

        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledWith(video.id);
      } finally {
        jest.useRealTimers();
      }
    });

    it('a 429 retries with backoff while the item stays active, and plays once a later attempt succeeds', async () => {
      jest.useFakeTimers();
      try {
        mockGetPlaybackAuthorization.mockRejectedValueOnce(
          new ApiError(429, 'RATE_LIMITED', 'too many requests')
        );
        mockGetPlaybackAuthorization.mockRejectedValueOnce(
          new ApiError(429, 'RATE_LIMITED', 'too many requests')
        );
        mockGetPlaybackAuthorization.mockResolvedValueOnce(
          buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/recovered-429.mp4' })
        );

        // Mounted already active - exempt from the settle-window debounce,
        // so the initial fetch (and its 429) fire immediately.
        await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive />);

        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

        // First automatic retry: 2s.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(2000);
        });
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);

        // Second automatic retry: 4s more.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(4000);
        });
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(3);

        const player = findPlayerByUri('https://media.example.com/recovered-429.mp4');

        expect(player?.play).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('deactivating the item cancels a pending settle-window debounce - no request fires later', async () => {
      jest.useFakeTimers();
      try {
        const video = buildVideo();
        const { rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive={false} />
        );

        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
        });
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS * 3);
        });

        expect(mockGetPlaybackAuthorization).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('deactivating the item cancels a pending automatic 429/network retry - no request fires later', async () => {
      jest.useFakeTimers();
      try {
        mockGetPlaybackAuthorization.mockRejectedValue(
          new ApiError(429, 'RATE_LIMITED', 'too many requests')
        );

        const video = buildVideo();
        const { rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );

        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

        // The first automatic retry lands at the NEW 2s backoff step, not
        // the pre-addendum flat 5s delay - advancing only 2s (not yet 5s)
        // already fails against pre-addendum code, which would still read
        // 1 call here. Without this assertion, the test only ever proved a
        // pending timer gets cancelled on deactivation - true of the
        // pre-addendum flat-5s retry as well, so it proved nothing
        // addendum-specific.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(2000);
        });
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);

        // Leaves the active slot before the SECOND scheduled retry (4s
        // further, per the new backoff schedule) fires.
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(20000);
        });

        // No third call - the pending timer was cancelled the moment the
        // item left the active slot, not merely delayed.
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it('play-press re-auth: pressing play with a failed authorization fires exactly one fresh request, with no duplicate while it is in flight', async () => {
      jest.useFakeTimers();
      try {
        const deferred = createDeferred<PlaybackAuthorization>();

        mockGetPlaybackAuthorization.mockRejectedValueOnce(
          new ApiError(429, 'RATE_LIMITED', 'too many requests')
        );
        mockGetPlaybackAuthorization.mockReturnValueOnce(deferred.promise);

        const video = buildVideo();
        const { getByTestId } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );

        // The initial (mount-time-exempt) fetch already failed with a 429 -
        // the button shown now is the error-state one, not the normal
        // play/pause target.
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

        // Pressing it fires a fresh request instead of doing nothing.
        await act(async () => {
          fireEvent.press(getByTestId('feed-item-play-pause'));
        });
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);

        // A second press while that fresh request is still in flight must
        // not stack a second one.
        await act(async () => {
          fireEvent.press(getByTestId('feed-item-play-pause'));
        });
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);

        await act(async () => {
          deferred.resolve(
            buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/after-retry.mp4' })
          );
        });

        const player = findPlayerByUri('https://media.example.com/after-retry.mp4');

        expect(player?.play).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('play-press re-auth: pressing play with an expired (but not yet failed) authorization fires a fresh request', async () => {
      jest.useFakeTimers();
      try {
        mockGetPlaybackAuthorization.mockResolvedValueOnce(
          buildPlaybackAuthorization({
            playbackUrl: 'https://media.example.com/already-expired.mp4',
            // Already past its own expiry by the time it resolves - HIGH-1's
            // proactive refresh margin (30s) exists to keep this rare in
            // practice, but a long background stint (or a device clock
            // skew) can still reach it.
            expiresAt: new Date(Date.now() - 1000).toISOString(),
          })
        );
        mockGetPlaybackAuthorization.mockResolvedValueOnce(
          buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/fresh-after-expiry.mp4' })
        );

        const video = buildVideo();
        const { getByTestId } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );

        // The already-expired grant still resolved as a "success" (no
        // `hasPlaybackAuthError`), so the normal play/pause button - not the
        // error-state one - is what's on screen.
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

        await act(async () => {
          fireEvent.press(getByTestId('feed-item-play-pause'));
        });

        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);

        const player = findPlayerByUri('https://media.example.com/fresh-after-expiry.mp4');

        expect(player?.play).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    // Fix cycle 2 (Finding 1): the settle-debounce effect's and the
    // refresh/retry effect's scheduled `setTimeout` callbacks call
    // `requestAuthorization` directly, without checking whether a request
    // is already in flight - and even if they read the component's
    // `isPlaybackAuthRequestInFlight` STATE, a closure created when the
    // effect ran would still see whatever that state was back then, not
    // whatever it is by the time the timer actually fires. The two tests
    // below land a play-press (or a tap on the error state) INSIDE one of
    // those windows and assert the scheduled callback that fires afterward
    // does not stack a second, concurrent request on top of it.
    it('Finding 1 regression: a play-press during a pending settle-window debounce leaves the debounce a no-op once it elapses', async () => {
      jest.useFakeTimers();
      try {
        const deferred = createDeferred<PlaybackAuthorization>();

        mockGetPlaybackAuthorization.mockReturnValueOnce(deferred.promise);

        const video = buildVideo();
        const { rerender, getByTestId } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive={false} />
        );

        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
        });

        // Still inside the settle window - nothing has fired yet.
        expect(mockGetPlaybackAuthorization).not.toHaveBeenCalled();

        // A tap lands before the debounce timer elapses. `playbackAuth` is
        // still null, so this goes through `handlePlayPause`'s
        // re-authorization branch and fires the request itself - left
        // deliberately unresolved so it is still in flight when the
        // originally-scheduled timer elapses below.
        await act(async () => {
          fireEvent.press(getByTestId('feed-item-play-pause'));
        });
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        // No second, concurrent request - the debounce callback must see
        // the press's request is still outstanding and skip firing its own.
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    // Non-vacuity note (verified by instrumenting the pre-fix component and
    // re-running this exact test against it): unlike the debounce case
    // above, this specific "tap during the backoff window" scenario turns
    // out to ALREADY be a no-op duplicate on pre-fix code too, for a
    // reason unrelated to this fix - `requestAuthorization` sets
    // `hasPlaybackAuthError` back to `false` as its very first synchronous
    // action, and that flag is itself a dependency of this refresh/retry
    // effect, so the tap's OWN request causes the effect to re-run and its
    // cleanup to `clearTimeout` the pending backoff timer before it ever
    // fires - confirmed by instrumenting the effect: the retry timer is
    // cancelled, never fires, on both the pre-fix and post-fix component.
    // The ref-check added to this scheduled callback in `requestAuthorization`
    // (fix cycle 2, Finding 1) is therefore defense-in-depth for this
    // particular call site, not something this test can demonstrate as
    // load-bearing via a same-tick "genuinely concurrent" race, which is not
    // constructible through `act()` (it deliberately flushes all pending
    // state/effects before returning). Kept as a regression/coverage test
    // for the invariant itself ("no duplicate outstanding request"), and to
    // catch a FUTURE change that removes the `hasPlaybackAuthError`
    // dependency protection without knowing this fallback exists.
    it('Finding 1 regression: a tap on the error state during a scheduled 429/network backoff window leaves exactly one outstanding request', async () => {
      jest.useFakeTimers();
      try {
        const deferred = createDeferred<PlaybackAuthorization>();

        mockGetPlaybackAuthorization.mockRejectedValueOnce(
          new ApiError(429, 'RATE_LIMITED', 'too many requests')
        );
        mockGetPlaybackAuthorization.mockReturnValueOnce(deferred.promise);

        const video = buildVideo();
        // Mounted already active - exempt from the settle-window debounce,
        // so the initial fetch (and its 429) fire immediately, scheduling
        // an automatic retry 2s out.
        const { getByTestId } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );

        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);

        // A tap on the "Video unavailable" pressable lands before the
        // scheduled retry fires - left deliberately unresolved so it is
        // still in flight when that retry's timer elapses below.
        await act(async () => {
          fireEvent.press(getByTestId('feed-item-play-pause'));
        });
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);

        await act(async () => {
          await jest.advanceTimersByTimeAsync(2000);
        });

        // No third, concurrent request - the scheduled retry must see the
        // tap's request is still outstanding and skip firing its own.
        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);

        await act(async () => {
          deferred.resolve(
            buildPlaybackAuthorization({
              playbackUrl: 'https://media.example.com/after-tap-race.mp4',
            })
          );
        });

        const player = findPlayerByUri('https://media.example.com/after-tap-race.mp4');

        expect(player?.play).toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('playback speed selector (session speed: 1x / 1.5x / 2x)', () => {
    type MockPlayer = {
      playing: boolean;
      play: jest.Mock;
      pause: jest.Mock;
      rateWrites: number[];
    };

    function latestPlayer(): MockPlayer {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');

      return (useVideoPlayer as jest.Mock).mock.results.at(-1)?.value as MockPlayer;
    }

    function allDistinctPlayers(): MockPlayer[] {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');

      return Array.from(
        new Set(
          (useVideoPlayer as jest.Mock).mock.results.map(
            (mockResult) => mockResult.value as MockPlayer
          )
        )
      );
    }

    it('defaults to 1x, expressed by writing nothing to the player', async () => {
      const { getByLabelText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive isClearDisplay />
      );

      expect(getByLabelText('Kecepatan 1x').props.accessibilityState.selected).toBe(true);
      expect(getByLabelText('Kecepatan 1.5x').props.accessibilityState.selected).toBe(false);
      expect(getByLabelText('Kecepatan 2x').props.accessibilityState.selected).toBe(false);
      // Writing the default 1 would still be a play command on iOS, so the
      // default must live purely in state - zero writes, even while active.
      expect(latestPlayer().rateWrites).toEqual([]);
    });

    it.each([[1.5], [2]])(
      'selecting %sx writes that rate to the active player exactly once',
      async (chosenSpeed) => {
        const { getByLabelText } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive isClearDisplay />
        );

        await act(async () => {
          fireEvent.press(getByLabelText(`Kecepatan ${chosenSpeed}x`));
        });

        expect(latestPlayer().rateWrites).toEqual([chosenSpeed]);
        expect(
          getByLabelText(`Kecepatan ${chosenSpeed}x`).props.accessibilityState.selected
        ).toBe(true);
      }
    );

    it('re-selecting the already-chosen speed issues no additional write', async () => {
      const { getByLabelText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive isClearDisplay />
      );

      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 1.5x'));
      });
      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 1.5x'));
      });

      // Even an unchanged value restarts a paused AVPlayer - one deliberate
      // write is the only acceptable total.
      expect(latestPlayer().rateWrites).toEqual([1.5]);
    });

    it('a speed change touches only the active player even though every mounted item re-renders', async () => {
      // The speed now lives in a store shared by all mounted items, so a
      // change re-renders the inactive copies too - this is the test that
      // their `shouldPlay` gates still keep every one of their players
      // untouched.
      const { getAllByLabelText } = await renderFeedItem(
        <>
          {[1, 2, 3].map((itemNumber) => (
            <DramaFeedItem
              key={itemNumber}
              video={buildVideo({ id: `video-${itemNumber}` })}
              {...baseProps}
              isActive={itemNumber === 1}
              isClearDisplay
            />
          ))}
        </>
      );

      await act(async () => {
        fireEvent.press(getAllByLabelText('Kecepatan 1.5x')[0]);
      });

      const activePlayer = findPlayerByUri('https://media.example.com/video-1.mp4');

      expect(activePlayer?.rateWrites).toEqual([1.5]);
      expect(
        allDistinctPlayers().filter((player) => player.rateWrites.length > 0)
      ).toEqual([activePlayer]);
    });

    it('choosing a speed while manually paused does not start playback; it applies on resume', async () => {
      const video = buildVideo();
      const { getByLabelText, rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive isClearDisplay />
      );
      const player = latestPlayer();

      // The mocked useEvent reads player.playing at render time, so the flag
      // has to be set and re-rendered before the tap sees something to pause.
      player.playing = true;
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive isClearDisplay />);
      });
      await act(async () => {
        fireEvent.press(getByLabelText('Pause'));
      });

      expect(player.pause).toHaveBeenCalled();

      player.playing = false;
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive isClearDisplay />);
      });
      player.play.mockClear();

      // The choice while paused is remembered, but the player stays silent -
      // a rate write here IS the start-while-paused bug on iOS.
      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 2x'));
      });

      expect(player.rateWrites).toEqual([]);
      expect(player.play).not.toHaveBeenCalled();

      // Resuming re-opens the intended-playback window, and only then does
      // the remembered choice reach the player.
      await act(async () => {
        fireEvent.press(getByLabelText('Play'));
      });

      expect(player.play).toHaveBeenCalled();
      expect(player.rateWrites).toEqual([2]);
    });

    it('rapid A -> B -> C at 2x leaves only C playing, at the session speed', async () => {
      // 11R remediation ADDENDUM: see the equivalent MP4 test in the
      // "single-player ownership invariant" describe block above - B and C
      // were both mounted inactive, so their activation is debounced.
      jest.useFakeTimers();
      try {
        const videos = [1, 2, 3].map((itemNumber) => buildVideo({ id: `video-${itemNumber}` }));
        const feedWithActive = (activeIndex: number) => (
          <>
            {videos.map((video, index) => (
              <DramaFeedItem
                key={video.id}
                video={video}
                {...baseProps}
                isActive={index === activeIndex}
                isClearDisplay
              />
            ))}
          </>
        );

        const { getAllByLabelText, rerender } = await renderFeedItem(feedWithActive(0));

        // The viewer picks 2x while A holds the active slot.
        await act(async () => {
          fireEvent.press(getAllByLabelText('Kecepatan 2x')[0]);
        });

        const playerA = findPlayerByUri('https://media.example.com/video-1.mp4');

        expect(playerA?.rateWrites).toEqual([2]);

        await act(async () => {
          rerender(feedWithActive(1));
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });
        await act(async () => {
          rerender(feedWithActive(2));
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        const playerB = findPlayerByUri('https://media.example.com/video-2.mp4');
        const playerC = findPlayerByUri('https://media.example.com/video-3.mp4');

        // Every item that lost the active slot was paused; only the final one
        // is playing, and it inherited the session speed.
        expect(playerA?.pause).toHaveBeenCalled();
        expect(playerB?.pause).toHaveBeenCalled();
        expect(playerC?.play).toHaveBeenCalled();
        expect(playerC?.pause).not.toHaveBeenCalled();
        expect(playerC?.rateWrites).toEqual([2]);
        // No player ever received a rate write beyond the single one its own
        // active stint justified, and never any value but the chosen 2.
        [playerA, playerB, playerC].forEach((player) => {
          expect(player!.rateWrites.length).toBeLessThanOrEqual(1);
          player!.rateWrites.forEach((writtenRate) => expect(writtenRate).toBe(2));
        });
      } finally {
        jest.useRealTimers();
      }
    });

    it('the next active video inherits the session speed chosen on a previous one', async () => {
      // 11R remediation ADDENDUM: video B was mounted inactive alongside A,
      // so its activation is debounced.
      jest.useFakeTimers();
      try {
        const videoA = buildVideo({ id: 'video-a' });
        const videoB = buildVideo({ id: 'video-b' });
        const feed = (activeIndex: number) => (
          <>
            <DramaFeedItem
              video={videoA}
              {...baseProps}
              isActive={activeIndex === 0}
              isClearDisplay
            />
            <DramaFeedItem
              video={videoB}
              {...baseProps}
              isActive={activeIndex === 1}
              isClearDisplay
            />
          </>
        );
        const { getAllByLabelText, rerender } = await renderFeedItem(feed(0));

        await act(async () => {
          fireEvent.press(getAllByLabelText('Kecepatan 2x')[0]);
        });

        await act(async () => {
          rerender(feed(1));
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        const playerB = findPlayerByUri('https://media.example.com/video-b.mp4');

        expect(playerB?.play).toHaveBeenCalled();
        expect(playerB?.rateWrites).toEqual([2]);
      } finally {
        jest.useRealTimers();
      }
    });

    it('keeps the session speed across background/foreground without a duplicate rate write', async () => {
      const appStateListeners: ((state: string) => void)[] = [];
      const addListenerSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
        _event: string,
        listener: (state: string) => void
      ) => {
        appStateListeners.push(listener);

        return { remove: jest.fn() };
      }) as never);

      try {
        const { getByLabelText } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive isClearDisplay />
        );

        await act(async () => {
          fireEvent.press(getByLabelText('Kecepatan 1.5x'));
        });

        expect(latestPlayer().rateWrites).toEqual([1.5]);

        await act(async () => {
          appStateListeners.forEach((listener) => listener('background'));
        });

        expect(latestPlayer().pause).toHaveBeenCalled();

        await act(async () => {
          appStateListeners.forEach((listener) => listener('active'));
        });

        // Playback resumes, and the player kept its rate across the pause -
        // re-issuing the same 1.5 would restart a player that was meant to
        // stay paused in other interleavings, so the total stays at one.
        expect(latestPlayer().play).toHaveBeenCalled();
        expect(latestPlayer().rateWrites).toEqual([1.5]);
      } finally {
        addListenerSpy.mockRestore();
      }
    });

    it('tab navigation away pauses playback and defers a speed change until the feed regains focus', async () => {
      const video = buildVideo();
      const { getByLabelText, rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive isClearDisplay />
      );

      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 1.5x'));
      });

      expect(latestPlayer().rateWrites).toEqual([1.5]);

      // The viewer opens another tab: the feed screen loses focus.
      await act(async () => {
        rerender(
          <DramaFeedItem
            video={video}
            {...baseProps}
            isActive
            isScreenFocused={false}
            isClearDisplay
          />
        );
      });

      expect(latestPlayer().pause).toHaveBeenCalled();

      // A speed change while the feed is not the focused screen must not
      // touch the player - that write is exactly the ghost-audio bug.
      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 2x'));
      });

      expect(latestPlayer().rateWrites).toEqual([1.5]);

      // Back on the feed tab, the remembered choice applies exactly once.
      await act(async () => {
        rerender(
          <DramaFeedItem video={video} {...baseProps} isActive isScreenFocused isClearDisplay />
        );
      });

      expect(latestPlayer().rateWrites).toEqual([1.5, 2]);
    });
  });

  describe('Slice 11R: AUTO adaptive HLS playback', () => {
    it('uses the backend-provided masterUrl as the player source for an HLS playback authorization', async () => {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      const masterUrl = 'https://gateway.example.com/videos/video-1/master.m3u8?token=abc';
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildHlsPlaybackAuthorization({ masterUrl })
      );

      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} />);

      // No headers either: attaching Authorization to a gateway-token
      // manifest URL would break it, the same hazard the presigned-R2 MP4
      // path already documents.
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({ uri: masterUrl });
    });

    it('keeps playing the legacy MP4 path unchanged when the authorization is not HLS-shaped (fallback preserved)', async () => {
      // The pre-existing Slice 11M tests above ('attaches the current
      // access token...', 'does not attach an Authorization header when
      // requiresAuthHeader is false') already cover both header cases in
      // depth; this test documents, specifically for the Slice 11R
      // union-type refactor, that a plain kind: 'mp4' authorization still
      // plays via its own playbackUrl, untouched.
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildPlaybackAuthorization({
          playbackUrl: 'https://media.example.com/video-1.mp4',
          requiresAuthHeader: true,
        })
      );

      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} />);

      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
        uri: 'https://media.example.com/video-1.mp4',
        headers: { Authorization: 'Bearer test-access-token' },
      });
    });

    it('does not start an inactive item even when its authorization would resolve to HLS', async () => {
      // Deliberately does NOT queue a `mockResolvedValueOnce` here: the
      // assertion below is that `getPlaybackAuthorization` is never called
      // at all for an inactive item, so a queued-but-unconsumed response
      // would otherwise leak into (and corrupt) whichever test runs next.

      await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive={false} />);

      // Mirrors the existing Slice 11M "logged out" test: the active-only
      // gate must skip the request entirely, HLS or not.
      expect(mockGetPlaybackAuthorization).not.toHaveBeenCalled();
      expect(latestMockPlayer()?.play).not.toHaveBeenCalled();
    });

    it('ignores an HLS authorization response that arrives after the item is no longer active', async () => {
      const deferred = createDeferred<PlaybackAuthorization>();
      mockGetPlaybackAuthorization.mockReturnValueOnce(deferred.promise);
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');

      const video = buildVideo();
      const { rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );

      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
      });

      await act(async () => {
        deferred.resolve(buildHlsPlaybackAuthorization());
      });

      // The same playbackRequestIdRef/isActiveRef generation guard that
      // protects the MP4 path (see the Slice 11M describe block above)
      // applies identically here - there is no separate HLS request path
      // for a stale response to slip past.
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toBeNull();
      expect(latestMockPlayer()?.play).not.toHaveBeenCalled();
    });

    it('rapid A -> B -> C transitions leave only C playing when the incoming authorization is HLS', async () => {
      // 11R remediation ADDENDUM: see the equivalent MP4 test in the
      // "single-player ownership invariant" describe block - B and C were
      // both mounted inactive, so their activation is debounced.
      jest.useFakeTimers();
      try {
        const videos = [1, 2, 3].map((n) => buildVideo({ id: `video-${n}` }));
        mockGetPlaybackAuthorization.mockImplementation((videoId: string) =>
          Promise.resolve(
            buildHlsPlaybackAuthorization({
              masterUrl: `https://gateway.example.com/videos/${videoId}/master.m3u8`,
            })
          )
        );
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

        const playerA = findPlayerByUri('https://gateway.example.com/videos/video-1/master.m3u8');

        playerA?.play.mockClear();
        playerA?.pause.mockClear();

        await act(async () => {
          rerender(feedWithActive(1));
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });
        await act(async () => {
          rerender(feedWithActive(2));
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        const playerB = findPlayerByUri('https://gateway.example.com/videos/video-2/master.m3u8');
        const playerC = findPlayerByUri('https://gateway.example.com/videos/video-3/master.m3u8');

        expect(playerA?.pause).toHaveBeenCalled();
        expect(playerA?.play).not.toHaveBeenCalled();
        expect(playerB?.pause).toHaveBeenCalled();
        expect(playerC?.play).toHaveBeenCalled();
        expect(playerC?.pause).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('pauses the outgoing MP4 player and plays only the incoming HLS player when the source kind switches mid-session, with no invariant violation', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        jest.useFakeTimers();
        // A refresh (HIGH-1's proactive-refresh effect - see the "Slice 11M
        // review remediation" describe block above) can legitimately hand
        // an active item a DIFFERENT authorization kind than it started
        // with, e.g. a backend rollout that switches a title over to HLS
        // mid-session. This must go through the exact same
        // release/pause-outgoing-player cleanup as an MP4-to-MP4 URL
        // refresh already does - no second, parallel player.
        mockGetPlaybackAuthorization.mockResolvedValueOnce(
          buildPlaybackAuthorization({
            playbackUrl: 'https://media.example.com/first-grant.mp4',
            expiresAt: new Date(Date.now() + 40000).toISOString(),
          })
        );
        mockGetPlaybackAuthorization.mockResolvedValueOnce(
          buildHlsPlaybackAuthorization({
            masterUrl: 'https://gateway.example.com/videos/video-1/master.m3u8',
          })
        );

        await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} isActive />);

        const mp4Player = findPlayerByUri('https://media.example.com/first-grant.mp4');

        expect(mp4Player?.play).toHaveBeenCalled();

        // 40s grant, 30s refresh margin -> the refresh fires 10s in.
        await act(async () => {
          await jest.advanceTimersByTimeAsync(10000);
        });

        const hlsPlayer = findPlayerByUri(
          'https://gateway.example.com/videos/video-1/master.m3u8'
        );

        expect(mp4Player?.pause).toHaveBeenCalled();
        expect(hlsPlayer?.play).toHaveBeenCalled();
        expect(consoleErrorSpy).not.toHaveBeenCalledWith(
          '[PlaybackInvariantViolation]',
          expect.anything()
        );
      } finally {
        consoleErrorSpy.mockRestore();
        jest.useRealTimers();
      }
    });

    describe('HLS playback disabled (kill switch)', () => {
      it('shows the existing "Video unavailable" state instead of playing when the authorization is HLS and the flag is disabled', async () => {
        mockIsHlsPlaybackEnabled.mockReturnValue(false);
        mockGetPlaybackAuthorization.mockResolvedValueOnce(buildHlsPlaybackAuthorization());

        const { getByText } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} />
        );

        // There is no MP4 URL embedded inside an HLS response to fall back
        // to, so this - correctly - lands on the same failure UI a genuine
        // authorization failure does, rather than a stuck spinner.
        expect(getByText('Video unavailable')).toBeTruthy();
        expect(latestMockPlayer()?.play).not.toHaveBeenCalled();
      });

      it('still plays a legacy MP4 authorization exactly as before when the flag is disabled', async () => {
        mockIsHlsPlaybackEnabled.mockReturnValue(false);
        const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
        mockGetPlaybackAuthorization.mockResolvedValueOnce(
          buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/video-1.mp4' })
        );

        await renderFeedItem(<DramaFeedItem video={buildVideo()} {...baseProps} />);

        expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toEqual({
          uri: 'https://media.example.com/video-1.mp4',
          headers: { Authorization: 'Bearer test-access-token' },
        });
      });
    });
  });
});
