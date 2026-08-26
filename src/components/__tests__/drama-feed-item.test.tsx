import { render, fireEvent, act, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactElement } from 'react';
import { AccessibilityInfo, AppState, Platform, StyleSheet } from 'react-native';

import { DramaFeedItem, touchDistance } from '@/components/drama-feed-item';
import { AUTO_CLEAR_DISPLAY_DELAY_MS } from '@/constants/clear-display';
import { FeedBottomGap, Typography } from '@/constants/theme';
import { useClearDisplayState } from '@/hooks/use-clear-display-state';
import { ApiError } from '@/services/api/client';
import { resetPlaybackInvariantForTests } from '@/services/debug/playback-invariant';
import { resetPlaybackOwnershipForTests } from '@/services/playback/playback-ownership';
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
const mockBottomTabBarHeight = jest.fn(() => 56);

jest.mock('expo-router/js-tabs', () => ({
  useBottomTabBarHeight: () => mockBottomTabBarHeight(),
}));

jest.mock('expo-screen-orientation', () => ({
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP', LANDSCAPE: 'LANDSCAPE' },
  lockAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}));

// 11R PLAYBACK-STABILITY REMEDIATION: the poster overlay's `expo-image`
// import needs its own explicit stub here - the real module's
// `ImageModule.ts` pulls `requireNativeModule` from the 'expo' package,
// which this file's own `jest.mock('expo', ...)` above already replaces
// wholesale (with an object carrying only `useEvent`), breaking the real
// import. A bare host-component-tag string (matching the `SymbolView` stub
// immediately above) is enough for React Testing Library to render and
// query it.
jest.mock('expo-image', () => ({
  Image: 'Image',
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
          // 11R PLAYBACK-STABILITY REMEDIATION: `currentTime`/`duration` are
          // plain, test-settable fields (not tracked like `playbackRate`
          // above - nothing in the component treats a `currentTime`/
          // `duration` write as a play/pause command) so a test can arrange
          // "this player has been playing for N seconds." `seekBy` is a
          // spy so a test can assert exactly what position a
          // generation-swap reseek requested.
          currentTime: 0,
          duration: 0,
          status: 'idle',
          play: jest.fn(),
          pause: jest.fn(),
          seekBy: jest.fn(),
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
        ReactModule.createElement(RNText, { onPress: onDismiss }, 'Tutup'),
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
    // Real content by default; a case that needs a fixture says so.
    contentKind: 'drama',
    accessTier: 'free',
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
        // The rate the mock player currently reports. Distinct from
        // `rateWrites`: that records every write, this is the resulting
        // state - so a test can assert "this item is AT 1.5x" separately
        // from "this item was WRITTEN 1.5x", which is what makes the
        // no-redundant-write assertions meaningful.
        playbackRate: number;
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

/**
 * Opens the Playback Settings sheet on every mounted item. Speed lives there
 * now - behind the vertical kebab - rather than in the clear-display control
 * strip the previous design used, so any case that drives speed has to open
 * it first.
 */
async function openPlaybackSettingsFor(
  getAllByLabelText: (label: string) => unknown[]
): Promise<void> {
  for (const kebab of getAllByLabelText('Pengaturan pemutaran')) {
    await act(async () => {
      fireEvent.press(kebab as never);
    });
  }
}

/**
 * V1 IS FREE + ADS, so the DEFAULT for every case in this file is the premium
 * experience OFF. The blocks that turn it on are pinning PRESERVED V1.1/V2
 * architecture - the episode lock, the modal, the "activate Premium" gate and
 * its Rewards CTA - none of which a V1 viewer can reach.
 * See services/config/v1-scope.ts.
 */
const ORIGINAL_PREMIUM_FLAG = process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED;

function enablePremiumExperience() {
  process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = 'true';
}

afterEach(() => {
  process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = ORIGINAL_PREMIUM_FLAG;
});

describe('DramaFeedItem', () => {
  beforeEach(() => {
    // The invariant registry is module-level state; without this a test that
    // ever drives a player to playing=true would leak into the next one.
    resetPlaybackInvariantForTests();
    resetPlaybackOwnershipForTests();
    // No speed reset is needed here: the playback rate is per-item useState,
    // so it dies with the unmount at the end of each test. There is no
    // module-level speed left to leak into the next one.
    // react-native's Jest preset returns undefined from
    // AppState.addEventListener, which breaks useAppForeground's cleanup on
    // unmount - give every test a real subscription shape by default. Tests
    // that need to drive app-state transitions install their own spy on top.
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((() => ({ remove: jest.fn() })) as never);
    mockUseEntitlement.mockReturnValue({ isPremium: false, refresh: jest.fn() });
    // `clearMocks` clears calls, not return values, so a case that drives the
    // tab bar to a different height would otherwise leak it into every case
    // after it. 56 is the default shape: a visible bar, no extra inset.
    mockBottomTabBarHeight.mockReturnValue(56);
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

  it('clamps the title to 2 lines and no longer renders the caption in the feed overlay', async () => {
    // Mobile UI revision (2026-08-12): the description/caption left the feed
    // overlay entirely (the data itself is untouched - Share and Discover
    // search still read it).
    const video = buildVideo();
    const { getByText, queryByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    expect(getByText(video.title).props.numberOfLines).toBe(2);
    expect(queryByText(video.caption)).toBeNull();
  });

  it('renders the title alone in the upper-left overlay - no channel text, no meta line', async () => {
    // Product feedback (2026-08-12): the channel name ("Short Drama
    // Mandarin" in production data) must not render in the feed at all.
    const video = buildVideo();
    const { getByTestId, queryByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    const titleOverlay = getByTestId('feed-item-title-overlay');

    expect(within(titleOverlay).getByText(video.title)).toBeTruthy();
    expect(queryByText(video.channelName)).toBeNull();
    expect(queryByText(`EP 1 · ${video.channelName}`)).toBeNull();
  });

  // ===== FEED OVERLAY TYPOGRAPHY HIERARCHY ============================
  // These pin the RELATIVE hierarchy and the token each overlay reads from,
  // never a rendered pixel box: the point is that the title stays the
  // strongest text in the feed and that the video keeps the screen. A layout
  // assertion here would fail on any device-metrics change while still
  // passing if someone quietly doubled a font size.

  it('renders the feed title from the shared title token, not a local literal', async () => {
    // UI polish (2026-08-22): the size is deliberately UNCHANGED (18) - what
    // is pinned is that it comes from `Typography.title`, so the feed title
    // and the brand mark above it can only move together through the scale.
    const video = buildVideo();
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    const titleStyle = StyleSheet.flatten(getByText(video.title).props.style);

    expect(titleStyle.fontSize).toBe(Typography.title.fontSize);
    expect(titleStyle.fontFamily).toBe(Typography.title.fontFamily);
  });

  it('keeps the feed title heavier and larger than body-sized overlay text', async () => {
    // The hierarchy itself, expressed against the token scale rather than
    // against two numbers copied into two StyleSheets. `Typography.body` is
    // what the Home brand mark directly above the title renders at, so this
    // is the cross-component contract "title outranks the line above it".
    const video = buildVideo();
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    const titleStyle = StyleSheet.flatten(getByText(video.title).props.style);

    expect(titleStyle.fontSize).toBeGreaterThan(Typography.body.fontSize);
    expect(titleStyle.fontFamily).not.toBe(Typography.body.fontFamily);
  });

  it('bounds the feed title text scaling and keeps it to two truncated lines', async () => {
    // An unbounded OS text size is the one input that can push the two-line
    // title down into the lower-left episode cluster; `numberOfLines` is what
    // makes a long title truncate instead of growing the block.
    const video = buildVideo({
      title: 'A deliberately very long drama title that has to wrap and then truncate cleanly',
    });
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    const title = getByText(video.title);

    expect(title.props.numberOfLines).toBe(2);
    expect(title.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.3);
  });

  it('bounds every feed overlay text to the same scale cap', async () => {
    // Title, EP indicator and Next Episode all share one cap - a regression
    // that bounds only some of them still lets the row clip at 200% text.
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'free', videoId: 'video-2' });
    const { getByText, getByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    const caps = [
      getByText(video.title).props.maxFontSizeMultiplier,
      getByTestId('feed-item-episode-indicator').props.maxFontSizeMultiplier,
      within(getByTestId('feed-item-next-episode')).getByText('Episode Berikutnya').props
        .maxFontSizeMultiplier,
    ];

    expect(caps).toEqual([1.3, 1.3, 1.3]);
  });

  it('shows the EP indicator beneath the next-episode control on the right', async () => {
    // Product feedback (2026-08-12): "EP n" lives directly under the
    // next-episode button - not in the title block, never in a bottom
    // corner.
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'free', videoId: 'video-2' });
    const { getByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    const cluster = getByTestId('feed-item-episode-cluster');

    expect(within(cluster).getByText('Episode Berikutnya')).toBeTruthy();
    expect(within(cluster).getByText('EP 1')).toBeTruthy();
  });

  it('keeps the EP indicator on the last episode, when there is no next-episode control', async () => {
    const video = buildVideo({ episodeNumber: 5 });
    const { getByTestId, queryByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    const cluster = getByTestId('feed-item-episode-cluster');

    expect(queryByText('Episode Berikutnya')).toBeNull();
    expect(within(cluster).getByText('EP 5')).toBeTruthy();
  });

  it('navigates to the series detail when the title overlay is pressed', async () => {
    const video = buildVideo();
    const { getByText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    await fireEvent.press(getByText(video.title));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/series/[id]',
      params: { id: video.seriesId },
    });
  });

  it('anchors the episode cluster to the lower-left control band, on the same tab-bar anchor as the action rail', async () => {
    // Product feedback (2026-08-22): "EP n" and the next-episode control
    // moved out of the upper-right corner into the lower control band,
    // directly above the bottom tab bar. The vertical anchor is the SAME
    // `useFeedBottomAnchor` value the action rail already uses - not a
    // device-specific number - which is what keeps it clear of the tab bar,
    // the iOS home indicator and the Android gesture area everywhere.
    // `useBottomTabBarHeight` is mocked to 56 and insets to 0, so the bar is
    // present and `overlayBottom` is `FeedBottomGap`.
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'free', videoId: 'video-2' });
    const { getByTestId, getByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    const clusterStyle = StyleSheet.flatten(getByTestId('feed-item-episode-cluster').props.style);
    const overlayStyle = StyleSheet.flatten(getByTestId('feed-item-bottom-overlay').props.style);
    const pillStyle = StyleSheet.flatten(getByTestId('feed-item-next-episode').props.style);

    // Bottom-anchored, never top-anchored - a `top` here would re-float it
    // over the middle of the video.
    expect(clusterStyle.top).toBeUndefined();
    expect(clusterStyle.bottom).toBe(FeedBottomGap);
    // One band with the action rail: same anchor, from the same hook.
    expect(clusterStyle.bottom).toBe(overlayStyle.bottom);
    // Left-aligned on the same 18px rail as the title overlay, and bounded
    // on the right so it can never slide under the action rail's buttons.
    expect(clusterStyle.left).toBe(18);
    expect(clusterStyle.right).toBe(84);
    expect(clusterStyle.flexDirection).toBe('row');
    // A long localized label still ellipsizes inside a capped pill instead
    // of growing the row across the frame.
    expect(getByText('Episode Berikutnya').props.numberOfLines).toBe(1);
    expect(pillStyle.maxWidth).toBe(180);
    // Small-screen backstop: the pill wraps onto its own line rather than
    // being clipped.
    expect(clusterStyle.flexWrap).toBe('wrap');
    // The bottom overlay is declared after this view and spans the full
    // width, so paint order alone would put it on top of the next-episode
    // control's tap target. Lifting the cluster above it is what keeps that
    // control reachable without depending on `box-none` hit-testing.
    expect(clusterStyle.zIndex).toBe(2);
  });

  it('clears the gesture/home-indicator area when no tab bar is there to consume the inset', async () => {
    // A hidden navbar reports height 0, so the item's box now extends to the
    // physical bottom edge - under the iOS home indicator and the Android
    // gesture bar. The cluster follows `useFeedBottomAnchor` into that case
    // automatically, which is the whole point of not hardcoding an offset.
    // (`useFeedBottomAnchor`'s own suite covers the arithmetic across device
    // shapes; this pins that the MOVED control actually consumes it.)
    mockBottomTabBarHeight.mockReturnValue(0);

    const video = buildVideo();
    const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    const clusterStyle = StyleSheet.flatten(getByTestId('feed-item-episode-cluster').props.style);
    const overlayStyle = StyleSheet.flatten(getByTestId('feed-item-bottom-overlay').props.style);

    // Still one band with the action rail, and still whatever the anchor
    // says - never a device-specific constant of its own.
    expect(clusterStyle.bottom).toBe(overlayStyle.bottom);
    expect(clusterStyle.bottom).toBeGreaterThanOrEqual(FeedBottomGap);
  });

  it('caps OS text scaling in the lower band, the way the tab bar labels already do', async () => {
    // The row now shares the bottom band with the tab bar's own labels. An
    // uncapped 200% OS text size on a small Android screen is what turns it
    // into a clipped one.
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'free', videoId: 'video-2' });
    const { getByTestId, getByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    expect(getByTestId('feed-item-episode-indicator').props.maxFontSizeMultiplier).toBe(1.3);
    expect(getByText('Episode Berikutnya').props.maxFontSizeMultiplier).toBe(1.3);
  });

  it('reads left to right as "EP n" then the next-episode control', async () => {
    // The approved lower-band order. Asserted on the rendered child order,
    // not on coordinates, so it stays true under Appium/Playwright too.
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'free', videoId: 'video-2' });
    const { getByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    const cluster = getByTestId('feed-item-episode-cluster');
    const childTestIds = cluster.children.map((child) =>
      typeof child === 'string' ? child : child.props.testID
    );

    expect(childTestIds).toEqual(['feed-item-episode-indicator', 'feed-item-next-episode']);
  });

  it('renders the EP indicator on the ACTIVE item, under its own stable testID for automation', async () => {
    // `baseProps` is the active item. The ID is semantic, not positional,
    // so an Appium/Playwright locator survives the move from the upper-right
    // corner to the lower band - and any later move too.
    const video = buildVideo({ episodeNumber: 3 });
    const { getByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} isActive />
    );

    expect(getByTestId('feed-item-episode-indicator').props.children).toBe('EP 3');
    expect(
      within(getByTestId('feed-item-episode-cluster')).getByTestId('feed-item-episode-indicator')
    ).toBeTruthy();
  });

  it('renders no episode badge or category chip in the title overlay or bottom overlay', async () => {
    const video = buildVideo();
    const { getByTestId, queryByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    // The old orange "EP 1" badge and the "CEO" category chip are gone from
    // the feed presentation - the only "EP n" is the plain-text indicator
    // inside the right-side episode cluster.
    expect(queryByText(video.category)).toBeNull();
    expect(within(getByTestId('feed-item-title-overlay')).queryByText('EP 1')).toBeNull();
    expect(within(getByTestId('feed-item-bottom-overlay')).queryByText('EP 1')).toBeNull();
    expect(within(getByTestId('feed-item-episode-cluster')).getByText('EP 1')).toBeTruthy();
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

    // Assert: the metadata and action rail are invisible, untappable, AND
    // absent from the accessibility tree (clear-display-idle-v2 review fix:
    // opacity 0 alone left invisible-but-focusable ghost controls for
    // VoiceOver/TalkBack), while the progress bar survives - that pairing
    // is the whole feature. The hidden containers are therefore excluded
    // from default queries and need includeHiddenElements to inspect.
    const overlay = getByTestId('feed-item-bottom-overlay', { includeHiddenElements: true });
    const titleOverlay = getByTestId('feed-item-title-overlay', { includeHiddenElements: true });

    expect(StyleSheet.flatten(overlay.props.style).opacity).toBe(0);
    expect(overlay.props.pointerEvents).toBe('none');
    expect(overlay.props.accessibilityElementsHidden).toBe(true);
    expect(overlay.props.importantForAccessibility).toBe('no-hide-descendants');
    // The upper-left title block and the episode cluster step aside the
    // same way.
    expect(StyleSheet.flatten(titleOverlay.props.style).opacity).toBe(0);
    expect(titleOverlay.props.pointerEvents).toBe('none');
    expect(titleOverlay.props.accessibilityElementsHidden).toBe(true);
    const episodeCluster = getByTestId('feed-item-episode-cluster', {
      includeHiddenElements: true,
    });

    expect(StyleSheet.flatten(episodeCluster.props.style).opacity).toBe(0);
    expect(episodeCluster.props.pointerEvents).toBe('none');
    expect(episodeCluster.props.accessibilityElementsHidden).toBe(true);
    expect(getByTestId('feed-item-progress-track')).toBeTruthy();
  });

  it('brings the lower-band episode controls back when clear display is switched off', async () => {
    // Clear Display semantics are UNCHANGED by the move: the cluster hides
    // and returns with the rest of the chrome, and never becomes the one
    // thing left visible over a cleared frame.
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'free', videoId: 'video-2' });

    const cleared = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} isClearDisplay />
    );
    const clearedCluster = cleared.getByTestId('feed-item-episode-cluster', {
      includeHiddenElements: true,
    });

    expect(StyleSheet.flatten(clearedCluster.props.style).opacity).toBe(0);

    const shown = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );
    const shownCluster = shown.getByTestId('feed-item-episode-cluster');

    expect(StyleSheet.flatten(shownCluster.props.style).opacity).toBeUndefined();
    expect(shownCluster.props.pointerEvents).toBe('box-none');
    expect(shownCluster.props.accessibilityElementsHidden).toBe(false);
    expect(within(shownCluster).getByTestId('feed-item-episode-indicator')).toBeTruthy();
    expect(within(shownCluster).getByTestId('feed-item-next-episode')).toBeTruthy();
  });

  it('opens clear display from a single tap on the open video surface', async () => {
    // The long-press quick-actions menu is gone: nothing advertised it, so
    // the feature was effectively undiscoverable. A plain tap is the entry
    // point now, and the kebab below is its discoverable twin.
    const video = buildVideo();
    const onToggleClearDisplay = jest.fn();

    const { getByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} onToggleClearDisplay={onToggleClearDisplay} />
    );

    fireEvent.press(getByTestId('feed-item-clear-display-surface'));

    expect(onToggleClearDisplay).toHaveBeenCalledWith(true);
  });

  it('opens clear display from the Playback Settings sheet', async () => {
    const video = buildVideo();
    const onToggleClearDisplay = jest.fn();

    const { getByLabelText, getByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} onToggleClearDisplay={onToggleClearDisplay} />
    );

    await act(async () => {
      fireEvent.press(getByLabelText('Pengaturan pemutaran'));
    });
    await act(async () => {
      fireEvent.press(getByTestId('playback-settings-clear-display-row'));
    });

    // Same lifted state as the tap - one implementation, three entry points
    // (tap, sheet switch, pinch).
    expect(onToggleClearDisplay).toHaveBeenCalledWith(true);
  });

  it('renders the overflow affordance as a VERTICAL kebab, never a horizontal ellipsis', async () => {
    const { getByTestId } = await renderFeedItem(
      <DramaFeedItem video={buildVideo()} {...baseProps} />
    );

    // Drawn as three stacked child views rather than a glyph name, so no
    // platform can substitute a horizontal "..." for it.
    expect(getByTestId('feed-item-kebab-vertical').props.children).toHaveLength(3);
  });

  it('gives clear display a way out: a tap anywhere restores the chrome', async () => {
    // The old design answered this with an on-screen control strip, which
    // meant "clean display" still carried an exit button, a play/pause and a
    // speed selector. The surface itself is the exit now, so clear display
    // is genuinely clear - and the affordance is the same tap that got the
    // viewer here.
    const video = buildVideo();
    const onToggleClearDisplay = jest.fn();

    const { getByTestId, queryByLabelText } = await renderFeedItem(
      <DramaFeedItem
        video={video}
        {...baseProps}
        isClearDisplay
        onToggleClearDisplay={onToggleClearDisplay}
      />
    );

    // Nothing but the video is left. The rail steps aside the way it always
    // has - opacity 0 and pointerEvents none, not unmounted (and, since the
    // clear-display-idle-v2 review fix, also hidden from the accessibility
    // tree, which is why inspecting it needs includeHiddenElements) - while
    // the two controls the old design kept ON SCREEN during clear display
    // (the exit pill and the speed strip) are gone outright.
    expect(queryByLabelText('Kecepatan 1x')).toBeNull();
    expect(queryByLabelText('Keluar dari tampilan bersih')).toBeNull();
    expect(queryByLabelText('Pengaturan pemutaran')).toBeNull();

    const overlay = getByTestId('feed-item-bottom-overlay', { includeHiddenElements: true });

    expect(StyleSheet.flatten(overlay.props.style).opacity).toBe(0);
    expect(overlay.props.pointerEvents).toBe('none');

    fireEvent.press(getByTestId('feed-item-clear-display-surface'));

    expect(onToggleClearDisplay).toHaveBeenCalledWith(false);
  });

  it('puts the clear-display surface in the screen-reader order only while the chrome is hidden', async () => {
    // Full-bleed and always mounted, so it must stay OUT of the reader order
    // while the real controls are up - otherwise it would be the first stop
    // on every feed item, ahead of Like/Save/Share.
    const { getByTestId, rerender } = await renderFeedItem(
      <DramaFeedItem video={buildVideo()} {...baseProps} />
    );

    expect(getByTestId('feed-item-clear-display-surface').props.accessible).toBe(false);

    await act(async () => {
      rerender(<DramaFeedItem video={buildVideo()} {...baseProps} isClearDisplay />);
    });

    expect(getByTestId('feed-item-clear-display-surface').props.accessible).toBe(true);
  });

  it('keeps every action-rail control inside the bottom anchor, in a stable order', async () => {
    // Arrange: a horizontal video so the rail carries its full set,
    // fullscreen included.
    const video = buildVideo({ width: 1280, height: 720 });

    // Act
    const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);
    const overlay = getByTestId('feed-item-bottom-overlay');
    const rail = within(overlay).getByTestId('feed-item-actions-rail');

    // Assert: all five controls exist inside the single anchored rail, in
    // distinct positions and the established top-to-bottom order.
    const railButtonLabels = within(rail)
      .getAllByRole('button')
      .map((button) => button.props.accessibilityLabel);

    expect(railButtonLabels).toEqual(['Mute', 'Like', 'Save', 'Share']);
  });

  it('keeps 48px hit targets on the transparent action rail (no heavy opaque pill)', async () => {
    // Mobile UI revision (2026-08-12): the rail's visible treatment got
    // lighter, but the pressable area must not shrink with it.
    const video = buildVideo({ width: 1280, height: 720 });
    const { getByLabelText } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    for (const label of ['Mute', 'Save', 'Share']) {
      const buttonStyle = StyleSheet.flatten(getByLabelText(label).props.style);

      expect(buttonStyle.width).toBe(48);
      expect(buttonStyle.height).toBe(48);
      // Product feedback (2026-08-12): FULLY transparent - no background,
      // no scrim, no border ("no black element").
      expect(buttonStyle.backgroundColor).toBeUndefined();
      expect(buttonStyle.borderWidth).toBeUndefined();
    }
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

  // ANONYMOUS FREE-EPISODE PLAYBACK (2026-08-22). Before this work unit the
  // component short-circuited on `requiresAccessToken && !accessToken`: a
  // signed-out viewer was refused BEFORE the backend was ever asked, which
  // made the mobile app the access authority and, once the backend began
  // serving FREE episodes to guests, made it wrong. These cases pin the
  // replacement contract: the client ASKS for every viewer and CONSUMES the
  // backend's answer, and the only thing it decides for itself is which
  // truthful copy to render over a refusal the backend already made.
  describe('guest playback (signed out, no access token)', () => {
    // Signs the viewer out for every case in this block. A persistent
    // `mockReturnValue` (not `...Once`) matters: the authorization effect's
    // resolution re-renders, and that re-render reads `getTokens()` again -
    // a one-shot mock would answer the second read with the logged-in
    // default from `beforeEach`, silently "signing in" the viewer mid-test
    // and hiding the very case each test exists to cover.
    function signOut() {
      const { getTokens } = jest.requireMock<typeof import('@/services/auth/token-store')>(
        '@/services/auth/token-store'
      );
      (getTokens as jest.Mock).mockReturnValue(null);
    }

    it('A: asks the backend for playback authorization instead of refusing on its own', async () => {
      signOut();

      const video = buildVideo();
      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      // THE regression test for the removed short-circuit. Reinstating any
      // "no token -> do not ask" branch fails here: a guest must reach the
      // backend, because the backend is the only thing that knows whether
      // this episode is FREE.
      expect(mockGetPlaybackAuthorization).toHaveBeenCalledWith(video.id);
    });

    it('B: plays the authorized source when the backend allows a free episode', async () => {
      signOut();
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      // What the backend answers for a FREE row: authorized, and (since
      // `/stream` serves free content to anyone) no header required.
      mockGetPlaybackAuthorization.mockResolvedValue(
        buildPlaybackAuthorization({
          playbackUrl: 'https://media.example.com/free-episode.mp4',
          requiresAuthHeader: false,
        })
      );

      const video = buildVideo({ accessTier: 'free', episodeNumber: 1 });
      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      const lastSource = (useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0] as {
        uri: string;
        headers?: Record<string, string>;
      } | null;

      // A successful guest authorization must actually reach the player. A
      // regression that authorized and then dropped the result on the floor
      // (a null source, a stuck poster) fails here rather than looking like
      // a pass because no error was shown.
      expect(lastSource).toEqual({
        uri: 'https://media.example.com/free-episode.mp4',
        headers: undefined,
      });
    });

    it('C: shows no sign-in CTA at all for a free episode', async () => {
      signOut();
      mockGetPlaybackAuthorization.mockResolvedValue(
        buildPlaybackAuthorization({
          playbackUrl: 'https://media.example.com/free-episode.mp4',
          requiresAuthHeader: false,
        })
      );

      const video = buildVideo({ accessTier: 'free', episodeNumber: 1 });
      const { queryByTestId, queryByText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      // The whole point of the product change: a guest who can watch is
      // never asked to sign in, and never shown a failure either.
      expect(queryByTestId('feed-item-signin-gate')).toBeNull();
      expect(queryByTestId('feed-item-signin-button')).toBeNull();
      expect(queryByText('Video tidak tersedia')).toBeNull();
    });

    it('I: attaches no Authorization header when the contract says requiresAuthHeader is false', async () => {
      signOut();
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      mockGetPlaybackAuthorization.mockResolvedValue(
        buildPlaybackAuthorization({
          playbackUrl: 'https://media.example.com/free-episode.mp4',
          requiresAuthHeader: false,
        })
      );

      const video = buildVideo();
      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      const lastSource = (useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0] as {
        headers?: Record<string, string>;
      } | null;

      // `Bearer undefined` is the specific failure this pins: a guest has no
      // token, so inventing a header from one would send a malformed
      // credential to an endpoint that answers 401 for exactly that - turning
      // a playable free episode into a dead one. The flag is the backend's to
      // set and the client's to obey.
      expect(lastSource?.headers).toBeUndefined();
      expect(JSON.stringify(lastSource)).not.toContain('Bearer');
    });

    it('D: shows the sign-in gate when the backend answers 403 ENTITLEMENT_REQUIRED', async () => {
      signOut();
      // The backend's guest+PREMIUM answer. Byte-identical to a signed-in
      // non-entitled caller's - which is exactly why the client pairs it
      // with "this viewer holds no token" before calling it a sign-in
      // problem.
      mockGetPlaybackAuthorization.mockRejectedValue(
        new ApiError(403, 'ENTITLEMENT_REQUIRED', 'Entitlement required.')
      );

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId, queryByText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(getByTestId('feed-item-signin-gate')).toBeTruthy();
      // Not the generic media-server error, which blamed the wrong thing.
      expect(queryByText('Periksa koneksi internetmu, lalu coba lagi.')).toBeNull();
    });

    it('E: never plays a premium episode it was refused', async () => {
      signOut();
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      mockGetPlaybackAuthorization.mockRejectedValue(
        new ApiError(403, 'ENTITLEMENT_REQUIRED', 'Entitlement required.')
      );

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      // The gate is DISPLAY only. It must never be reachable via a state
      // that also handed the player a source: no source, and nothing
      // resembling a playable URL, may exist for a refused episode.
      const lastSource = (useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0] as unknown;

      expect(lastSource).toBeNull();
    });

    it('routes the sign-in gate to the existing /login screen, and creates no account on the way', async () => {
      signOut();
      mockGetPlaybackAuthorization.mockRejectedValue(
        new ApiError(403, 'ENTITLEMENT_REQUIRED', 'Entitlement required.')
      );

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      fireEvent.press(getByTestId('feed-item-signin-button'));

      // PUSHED, not replaced: the feed stays underneath, so declining the
      // gate returns to browsing rather than trapping the viewer on /login.
      expect(router.push).toHaveBeenCalledWith('/login');
    });

    it('J: keeps the lower-left episode controls exactly where d48fef6 put them', async () => {
      signOut();
      mockGetPlaybackAuthorization.mockResolvedValue(
        buildPlaybackAuthorization({
          playbackUrl: 'https://media.example.com/free-episode.mp4',
          requiresAuthHeader: false,
        })
      );

      const video = buildVideo({ episodeNumber: 3 });
      const { getByTestId } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} nextEpisode={buildEpisode()} />
      );

      const cluster = getByTestId('feed-item-episode-cluster');
      const childTestIds = cluster.children.map((child) =>
        typeof child === 'string' ? child : child.props.testID
      );

      // Guest playback must not have disturbed the lower-left band: the
      // indicator still leads, the next-episode control still follows, and
      // both still share the action rail's own bottom anchor.
      expect(childTestIds).toEqual(['feed-item-episode-indicator', 'feed-item-next-episode']);
      expect(within(cluster).getByTestId('feed-item-episode-indicator').props.children).toBe(
        'EP 3'
      );
      expect(StyleSheet.flatten(cluster.props.style).bottom).toBe(
        StyleSheet.flatten(getByTestId('feed-item-bottom-overlay').props.style).bottom
      );
    });

    it('K: still hides the episode controls in Clear Display for a guest', async () => {
      signOut();
      mockGetPlaybackAuthorization.mockResolvedValue(
        buildPlaybackAuthorization({
          playbackUrl: 'https://media.example.com/free-episode.mp4',
          requiresAuthHeader: false,
        })
      );

      const video = buildVideo({ episodeNumber: 3 });
      const { getByTestId } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isClearDisplay={true} />
      );

      // `includeHiddenElements` because the cluster is (correctly) out of the
      // accessibility tree in Clear Display - the same query this file's
      // existing Clear Display cases use.
      const cluster = getByTestId('feed-item-episode-cluster', {
        includeHiddenElements: true,
      });

      // Clear Display's contract is unchanged by guest playback: the cluster
      // stays mounted but is hidden, non-interactive, and out of the
      // accessibility tree.
      expect(cluster.props.pointerEvents).toBe('none');
      expect(cluster.props.accessibilityElementsHidden).toBe(true);
      expect(cluster.props.importantForAccessibility).toBe('no-hide-descendants');
    });
  });

  // PREMIUM ENTITLEMENT ERROR UX (2026-08-22). The backend answers a
  // SIGNED-IN non-entitled viewer with the same `403 ENTITLEMENT_REQUIRED`
  // it answers a guest with - deliberately byte-identical, so the response
  // leaks nothing about who asked. Before this work unit the client, having
  // correctly refused to call that a LOGIN problem, dropped it into the
  // generic "Video unavailable / Check the local media server connection."
  // copy instead - which blamed a perfectly healthy media server for a
  // missing entitlement. These cases pin the third truthful state: already
  // signed in, media fine, entitlement missing.
  /**
   * V1 (FREE + ADS): what a viewer meets when the backend refuses on
   * entitlement grounds in a build that sells no entitlement.
   *
   * With `CONTENT_ACCESS_MODE=free` this refusal should not arrive at all, so
   * reaching it means a server-side misconfiguration. The one thing that must
   * NOT happen then is telling the viewer to activate Premium and sending them
   * to Rewards to redeem a tier this build does not have - a dead end dressed
   * as a next step. The V1 state says what is true and offers nothing.
   */
  describe('V1 entitlement refusal (free + ads: no premium to sell)', () => {
    const ENTITLEMENT_REFUSAL = new ApiError(
      403,
      'ENTITLEMENT_REQUIRED',
      'Entitlement required.'
    );

    it('shows the plain unavailable gate, never the premium one', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId, queryByTestId, getByText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(getByTestId('feed-item-episode-unavailable-gate')).toBeTruthy();
      expect(queryByTestId('feed-item-premium-required-gate')).toBeNull();
      expect(getByText('Episode ini belum bisa diputar')).toBeTruthy();
    });

    it('names no premium tier and offers no Rewards route out', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { queryByTestId, queryByText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(queryByText('Episode Premium')).toBeNull();
      expect(queryByText(/Aktifkan Premium/)).toBeNull();
      expect(queryByTestId('feed-item-premium-required-action')).toBeNull();
      expect(queryByText('Buka Rewards')).toBeNull();
      expect(router.push).not.toHaveBeenCalledWith('/rewards');
    });

    it('does not blame the network for a refusal the server actually answered', async () => {
      // "Check your internet connection" would be its own lie here: the
      // request completed and the server said no.
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { queryByText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(queryByText('Periksa koneksi internetmu, lalu coba lagi.')).toBeNull();
    });

    it('announces the state as a header, with no control to press', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      expect(getByTestId('feed-item-episode-unavailable-title').props.accessibilityRole).toBe(
        'header'
      );
    });

    it('still refuses to play the episode it was refused', async () => {
      // Dropping the premium UPSELL must not be mistaken for dropping the
      // refusal. No source is ever handed to the player.
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toBeNull();
    });

    it('still sends a GUEST to sign in, which is a real and free next step', async () => {
      // Signing in costs nothing and is not a paywall, so V1 keeps it. The
      // guest branch is unchanged.
      const { getTokens } = jest.requireMock<typeof import('@/services/auth/token-store')>(
        '@/services/auth/token-store'
      );

      (getTokens as jest.Mock).mockReturnValue(null);
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId, queryByTestId } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(getByTestId('feed-item-signin-gate')).toBeTruthy();
      expect(queryByTestId('feed-item-episode-unavailable-gate')).toBeNull();
    });
  });

  describe('premium entitlement gate (signed in, no entitlement)', () => {
    // `beforeEach` leaves a valid token in place, so every case in this block
    // is the SIGNED-IN viewer unless it says otherwise.
    //
    // THE WHOLE BLOCK RUNS WITH THE PREMIUM EXPERIENCE ON. It pins the
    // preserved V1.1/V2 gate: the classifier's three-way reading of a backend
    // refusal, the Rewards CTA, the Clear Display layering, and the rule that
    // the gate follows the BACKEND's answer rather than the client's
    // entitlement flag. None of that is deleted by V1 - only kept off screen.
    // What a V1 viewer meets instead is pinned by the sibling block below.
    beforeEach(() => {
      enablePremiumExperience();
    });

    const ENTITLEMENT_REFUSAL = new ApiError(
      403,
      'ENTITLEMENT_REQUIRED',
      'Entitlement required.'
    );

    it('C: shows the premium gate when the backend answers 403 ENTITLEMENT_REQUIRED to a signed-in viewer', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId, getByText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(getByTestId('feed-item-premium-required-gate')).toBeTruthy();
      expect(getByText('Episode Premium')).toBeTruthy();
      expect(getByTestId('feed-item-premium-required-title').props.children).toBe(
        'Episode Premium'
      );
    });

    it('D: never tells a signed-in viewer to sign in', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { queryByTestId, queryByText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      // They already are signed in, and /login cannot fix a missing
      // entitlement - so neither the guest gate nor its copy may appear.
      expect(queryByTestId('feed-item-signin-gate')).toBeNull();
      expect(queryByTestId('feed-item-signin-button')).toBeNull();
      expect(queryByText('Masuk untuk menonton episode ini')).toBeNull();
      expect(queryByText('Masuk')).toBeNull();
    });

    it('E: never blames the media server for a missing entitlement', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { queryByText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      // THE regression this work unit exists for: the media server is
      // healthy and reachable; the entitlement is what is missing.
      expect(queryByText('Video tidak tersedia')).toBeNull();
      expect(queryByText('Periksa koneksi internetmu, lalu coba lagi.')).toBeNull();
    });

    it('F/K: routes the premium CTA to the Rewards route by identity, never by tab position', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      fireEvent.press(getByTestId('feed-item-premium-required-action'));

      // Route IDENTITY. Rewards may be moved to any slot in the tab bar -
      // including the centre - without touching this CTA, which is exactly
      // why an index/position-based navigation must never appear here.
      //
      // The other half of the guarantee (that `/rewards` resolves to a real
      // route file) is the repo's established one: `(tabs)/rewards.test.tsx`
      // imports `@/app/(tabs)/rewards` by path, so a missing or renamed
      // route file fails there - see the note in `tabs-navigation.test.tsx`.
      expect(router.push).toHaveBeenCalledWith('/rewards');

      const pushedTargets = (router.push as jest.Mock).mock.calls.map(([target]) =>
        JSON.stringify(target)
      );

      expect(pushedTargets.some((target) => /\bindex\b|tabIndex|\/\(tabs\)\//.test(target))).toBe(
        false
      );
    });

    it('redeems nothing on the way: the CTA only opens Rewards', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);
      const refresh = jest.fn();
      mockUseEntitlement.mockReturnValue({ isPremium: false, refresh });

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      fireEvent.press(getByTestId('feed-item-premium-required-action'));

      // No entitlement is granted, refreshed, or spent from here: the viewer
      // decides what to do with their points once Rewards is open.
      expect(refresh).not.toHaveBeenCalled();
      expect(router.push).toHaveBeenCalledTimes(1);
    });

    it('reads the backend refusal, not the client entitlement flag', async () => {
      // The client store claiming premium must NOT override a backend
      // refusal - the playback authorization contract is the authority, and
      // a stale/optimistic local flag turning a refusal into "it should have
      // played" would be exactly the wrong failure mode.
      mockUseEntitlement.mockReturnValue({ isPremium: true, refresh: jest.fn() });
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      expect(getByTestId('feed-item-premium-required-gate')).toBeTruthy();
    });

    it('never plays a premium episode it was refused', async () => {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      // The gate is DISPLAY only: it never coincides with a playable source.
      expect((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0]).toBeNull();
    });

    it('does not reinterpret a 403 that is NOT the canonical entitlement code', async () => {
      // Only the backend's canonical `ENTITLEMENT_REQUIRED` means "you need
      // Premium." Any other 403 is an unclassified refusal and keeps the
      // generic unavailable copy rather than being turned into an upsell.
      mockGetPlaybackAuthorization.mockRejectedValue(
        new ApiError(403, 'REGION_BLOCKED', 'Forbidden.')
      );

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByText, queryByTestId } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(queryByTestId('feed-item-premium-required-gate')).toBeNull();
      expect(queryByTestId('feed-item-signin-gate')).toBeNull();
      expect(getByText('Video tidak tersedia')).toBeTruthy();
    });

    it('H: keeps a real network failure on the generic unavailable state', async () => {
      // A transport failure is not an entitlement problem. Turning every
      // error into a Premium upsell would be its own lie - and would send a
      // viewer to Rewards to fix their wifi.
      mockGetPlaybackAuthorization.mockRejectedValue(
        new ApiError(0, 'NETWORK_ERROR', 'Network request failed.')
      );

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByText, queryByTestId } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(queryByTestId('feed-item-premium-required-gate')).toBeNull();
      expect(getByText('Video tidak tersedia')).toBeTruthy();
      expect(getByText('Periksa koneksi internetmu, lalu coba lagi.')).toBeTruthy();
    });

    it('keeps a 409 with no usable media on the generic unavailable state', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(
        new ApiError(409, 'MEDIA_PLAYBACK_SOURCE_UNAVAILABLE', 'No source.')
      );

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByText, queryByTestId } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(queryByTestId('feed-item-premium-required-gate')).toBeNull();
      expect(getByText('Video tidak tersedia')).toBeTruthy();
    });

    it('I: keeps a dead session on the sign-in gate, never the premium gate', async () => {
      // A 401 that survived the client's own refresh-and-retry is an
      // auth/session problem for a viewer who HOLDS a token. Sending them to
      // Rewards would be useless - Rewards needs a live session too.
      mockGetPlaybackAuthorization.mockRejectedValue(
        new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Unauthenticated.')
      );

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId, queryByTestId } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(getByTestId('feed-item-signin-gate')).toBeTruthy();
      expect(queryByTestId('feed-item-premium-required-gate')).toBeNull();
    });

    it('Clear Display can neither hide nor cover the premium gate', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId, toJSON } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isClearDisplay={true} />
      );

      // Visible and in the accessibility tree without `includeHiddenElements`
      // - unlike the chrome overlays, which Clear Display legitimately hides.
      const gate = getByTestId('feed-item-premium-required-gate');
      const action = getByTestId('feed-item-premium-required-action');

      expect(gate).toBeTruthy();
      expect(getByTestId('feed-item-premium-required-title')).toBeTruthy();

      // ...and it is NOT underneath the full-bleed clear-display surface,
      // which would swallow every tap on the only actionable control. RN
      // paints and hit-tests LATER siblings on top, so the gate must appear
      // after that surface in tree order - the regression this pins is the
      // gate being moved back inside the video layer, which renders first.
      // The rendered tree serializes in render order, and both testIDs are
      // unique, so their positions in it ARE their sibling order.
      const tree = JSON.stringify(toJSON());
      const surfacePosition = tree.indexOf('feed-item-clear-display-surface');
      const gatePosition = tree.indexOf('feed-item-premium-required-gate');

      expect(surfacePosition).toBeGreaterThan(-1);
      expect(gatePosition).toBeGreaterThan(surfacePosition);

      // Reviewer B (LOW): and the ordering is not left to declaration order
      // alone. `episodeCluster`/`overflowButton` carry an explicit `zIndex: 2`
      // and would otherwise paint over the gate wherever the boxes met, so
      // the gate layer outranks them explicitly.
      const gateLayerZIndex = StyleSheet.flatten(gate.parent?.props.style).zIndex;
      const clusterZIndex = StyleSheet.flatten(
        getByTestId('feed-item-episode-cluster', { includeHiddenElements: true }).props.style
      ).zIndex;

      expect(gateLayerZIndex).toBeGreaterThan(clusterZIndex);

      // And the CTA still works from inside Clear Display, in one press.
      fireEvent.press(action);

      expect(router.push).toHaveBeenCalledWith('/rewards');
    });

    it('L: announces the requirement and the destination to a screen reader', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(ENTITLEMENT_REFUSAL);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      const title = getByTestId('feed-item-premium-required-title');
      const action = getByTestId('feed-item-premium-required-action');

      expect(title.props.accessibilityRole).toBe('header');
      expect(action.props.accessibilityRole).toBe('button');
      expect(action.props.accessibilityLabel).toBe('Buka Rewards');
      // Names where the button goes, and that pressing it spends nothing.
      expect(action.props.accessibilityHint).toBe(
        'Membuka halaman Rewards. Poin kamu tidak langsung terpakai.'
      );
    });

    it('G: no premium gate flashes while authorization is still in flight', async () => {
      // A gate rendered optimistically - before the backend has answered -
      // would flash in front of an ENTITLED viewer on every premium episode.
      // The gate is reachable only from an actual refusal.
      const deferred = createDeferred<PlaybackAuthorization>();
      mockUseEntitlement.mockReturnValue({ isPremium: true, refresh: jest.fn() });
      mockGetPlaybackAuthorization.mockReturnValue(deferred.promise);

      const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
      const { queryByTestId, queryByText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      expect(queryByTestId('feed-item-premium-required-gate')).toBeNull();
      expect(queryByTestId('feed-item-signin-gate')).toBeNull();
      expect(queryByText('Video tidak tersedia')).toBeNull();

      await act(async () => {
        deferred.resolve(
          buildPlaybackAuthorization({
            playbackUrl: 'https://media.example.com/premium-episode.mp4',
          })
        );
      });

      // ...and it never appears after a SUCCESSFUL authorization either.
      expect(queryByTestId('feed-item-premium-required-gate')).toBeNull();
    });

    it('clears the premium gate once a later authorization succeeds', async () => {
      // A redemption in Rewards makes the very next request succeed. The
      // requirement must not outlive the refusal that produced it, or a
      // viewer who just bought Premium would keep being told to buy it.
      jest.useFakeTimers();

      try {
        mockGetPlaybackAuthorization.mockRejectedValueOnce(ENTITLEMENT_REFUSAL);

        const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
        const { getByTestId, queryByTestId, rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} />
        );

        expect(getByTestId('feed-item-premium-required-gate')).toBeTruthy();

        mockGetPlaybackAuthorization.mockResolvedValue(
          buildPlaybackAuthorization({
            playbackUrl: 'https://media.example.com/premium-episode.mp4',
          })
        );

        // The ordinary scroll-away-and-back refetch - no bespoke retry path.
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
        });
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        expect(queryByTestId('feed-item-premium-required-gate')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it('G: still plays a premium episode for a signed-in entitled viewer', async () => {
    const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
    mockUseEntitlement.mockReturnValue({ isPremium: true, refresh: jest.fn() });
    // The backend authorizes: an entitled caller clears `enforceEntitlementGate`.
    mockGetPlaybackAuthorization.mockResolvedValue(
      buildPlaybackAuthorization({
        playbackUrl: 'https://media.example.com/premium-episode.mp4',
        requiresAuthHeader: true,
      })
    );

    const video = buildVideo({ accessTier: 'premium', episodeNumber: 6 });
    const { queryByTestId, queryByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    const lastSource = (useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0] as {
      uri: string;
      headers?: Record<string, string>;
    } | null;

    // No regression from the guest work: the paying case still plays, and
    // still carries its Authorization header for the token-gated source.
    expect(lastSource).toEqual({
      uri: 'https://media.example.com/premium-episode.mp4',
      headers: { Authorization: 'Bearer test-access-token' },
    });
    expect(queryByTestId('feed-item-signin-gate')).toBeNull();
    expect(queryByText('Video tidak tersedia')).toBeNull();
  });

  it('H: does not downgrade a supplied-but-invalid token to an anonymous request', async () => {
    // The backend's `OptionalJwtAuthGuard` never treats a SUPPLIED but
    // invalid/expired credential as a guest - it answers 401
    // INVALID_ACCESS_TOKEN. The client must mirror that: invalid credentials
    // stay invalid credentials. Retrying the same episode WITHOUT the token
    // to "see if it is free" would be a real authentication bypass attempt,
    // and would also contradict the refresh-and-retry-once flow that already
    // ran inside `services/api/client.ts` before this rejection surfaced.
    mockGetPlaybackAuthorization.mockRejectedValue(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Unauthenticated.')
    );

    const video = buildVideo({ accessTier: 'free', episodeNumber: 1 });
    const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

    // A dead session is still a session problem, so the actionable copy is
    // correct here - even for a FREE episode, which a true guest could have
    // played. What must NOT happen is a second, token-less attempt.
    expect(getByTestId('feed-item-signin-gate')).toBeTruthy();
    expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(1);
  });

  it('plays a bundled clip before login in a demo build, where nothing is token-protected', async () => {
    // Arrange: signed out, with `getPlaybackAuthorization` answering the way
    // a DEMO build's own mock-data branch would (see `video-service.ts`,
    // which still owns that branching entirely).
    //
    // ANONYMOUS FREE-EPISODE PLAYBACK (2026-08-22): this case no longer
    // proves the COMPONENT branches on demo mode - it deliberately does not
    // any more, since the `isDemoMode`/`requiresAccessToken` short-circuit
    // was removed. What it still proves, and what matters, is the outcome:
    // a signed-out viewer whose authorization resolves with
    // `requiresAuthHeader: false` gets a real playable source and no
    // invented `Bearer undefined` header. The demo path is simply the
    // longest-standing real-world producer of that response shape.
    const { getTokens } = jest.requireMock<typeof import('@/services/auth/token-store')>(
      '@/services/auth/token-store'
    );
    const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
    (getTokens as jest.Mock).mockReturnValue(null);

    const video = buildVideo();
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

    expect(queryByText('Video tidak tersedia')).toBeNull();
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

  it('performs exactly one navigation per tap on the next-episode control', async () => {
    // Moving the control into the lower band must not turn one gesture into
    // two transitions.
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'free', videoId: 'video-2' });
    const { getByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    await fireEvent.press(getByTestId('feed-item-next-episode'));

    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('never navigates from a mounted-but-INACTIVE item, so a mid-swipe tap cannot jump the feed', async () => {
    // The control now sits in the lower band, where a thumb already is, and
    // a paged FlatList keeps neighbours mounted. A tap that lands on one of
    // them must do nothing rather than navigate using the NEIGHBOUR's
    // series - the same rule `handlePlayPause` has always enforced.
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'free', videoId: 'video-2' });
    const { getByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} isActive={false} nextEpisode={nextEpisode} />
    );

    await fireEvent.press(getByTestId('feed-item-next-episode'));

    expect(router.push).not.toHaveBeenCalled();
  });

  it('carries the item\'s OWN episode number and series into the lower band', async () => {
    // Per-item, never a screen-level overlay: the indicator and the control
    // both belong to the video this instance renders, so the active item can
    // never display or navigate a neighbour's episode.
    const video = buildVideo({ id: 'video-9', seriesId: 'series-nona-shen', episodeNumber: 4 });
    const nextEpisode = buildEpisode({
      accessType: 'free',
      videoId: 'video-10',
      seriesId: 'series-nona-shen',
      episodeNumber: 5,
    });
    const { getByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    expect(getByTestId('feed-item-episode-indicator').props.children).toBe('EP 4');

    await fireEvent.press(getByTestId('feed-item-next-episode'));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/series/[id]',
      params: { id: 'series-nona-shen' },
    });
  });

  it('renders no next-episode control on the last episode, and nothing there can navigate', async () => {
    // Last-episode behavior is unchanged by the move: the indicator stays
    // (every episode of a series shares one title, so it is the only thing
    // identifying which one this is), the control does not appear.
    const video = buildVideo({ episodeNumber: 5 });
    const { getByTestId, queryByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    expect(queryByTestId('feed-item-next-episode')).toBeNull();
    expect(getByTestId('feed-item-episode-indicator').props.children).toBe('EP 5');
    expect(router.push).not.toHaveBeenCalled();
  });

  it('V1: opens the series page for a premium next episode, with no modal', async () => {
    // V1 IS FREE + ADS. The client-side lock could only produce a dialog about
    // a tier the viewer cannot obtain, so the control behaves the same way it
    // does for a free episode. Nothing is granted by letting the tap through -
    // playback authorization is still the backend's.
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'premium', videoId: 'video-6' });
    const { getByText, queryByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    await fireEvent.press(getByText('Episode Berikutnya'));

    expect(queryByText('Episode ini termasuk konten premium.')).toBeNull();
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/series/[id]',
      params: { id: video.seriesId },
    });
  });

  it('V1: emits no premium_gate_hit for a premium next episode', async () => {
    const { trackEvent } = jest.requireMock<
      typeof import('@/services/analytics/analytics-queue')
    >('@/services/analytics/analytics-queue');
    const video = buildVideo();
    const nextEpisode = buildEpisode({ accessType: 'premium', videoId: 'video-6' });
    const { getByText } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} nextEpisode={nextEpisode} />
    );

    await fireEvent.press(getByText('Episode Berikutnya'));

    expect(trackEvent).not.toHaveBeenCalledWith('premium_gate_hit', expect.anything());
    expect(trackEvent).toHaveBeenCalledWith('episode_navigate', {
      videoId: 'video-6',
      seriesId: nextEpisode.seriesId,
      episodeNumber: nextEpisode.episodeNumber,
      source: 'feed-next-episode',
    });
  });

  it('opens the premium modal instead of navigating for a premium next episode', async () => {
    // PRESERVED V1.1/V2 BEHAVIOUR - see services/config/v1-scope.ts.
    enablePremiumExperience();

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
    enablePremiumExperience();

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

  it('offers Fullscreen in Playback Settings for a horizontal video, not in the rail', async () => {
    // Fullscreen's ENTRY POINT moved again (product decision 2026-08-13):
    // out of the action rail, into the settings sheet, so the rail carries
    // only the four social actions and fullscreen is not duplicated across
    // two surfaces. The implementation and lifecycle are unchanged.
    const video = buildVideo({ width: 1280, height: 720 });
    const { getByLabelText, getByTestId, queryByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    const rail = getByTestId('feed-item-actions-rail');

    expect(within(rail).queryByLabelText('Fullscreen')).toBeNull();
    expect(queryByTestId('playback-settings-fullscreen')).toBeNull();

    await act(async () => {
      fireEvent.press(getByLabelText('Pengaturan pemutaran'));
    });

    expect(getByTestId('playback-settings-fullscreen')).toBeTruthy();
  });

  it('does not offer Fullscreen at all for a vertical video', async () => {
    const video = buildVideo({ width: 720, height: 1280 });
    const { getByLabelText, queryByLabelText, queryByTestId } = await renderFeedItem(
      <DramaFeedItem video={video} {...baseProps} />
    );

    expect(queryByLabelText('Fullscreen')).toBeNull();

    // Still absent once the sheet is open - a vertical clip has no
    // fullscreen affordance to offer anywhere.
    await act(async () => {
      fireEvent.press(getByLabelText('Pengaturan pemutaran'));
    });

    expect(queryByTestId('playback-settings-fullscreen')).toBeNull();
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
    it('keeps Fullscreen out of the action rail entirely, leaving Share untouched', async () => {
      const video = buildVideo({ width: 1280, height: 720 });
      const { getByTestId, getByLabelText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} />
      );

      const overlay = getByTestId('feed-item-bottom-overlay');

      // Share keeps its place; fullscreen simply is not here any more, so it
      // cannot overlap or swallow anything in the rail - the device-QA issue
      // this describe was created for is answered by removal rather than by
      // careful placement.
      expect(within(overlay).getByLabelText('Share')).toBeTruthy();
      expect(within(overlay).queryByLabelText('Fullscreen')).toBeNull();
      expect(getByLabelText('Pengaturan pemutaran')).toBeTruthy();
    });

    it('orders the rail Fullscreen, Mute, Like, Save, Share', async () => {
      const video = buildVideo({ width: 1280, height: 720 });
      const { getByTestId } = await renderFeedItem(<DramaFeedItem video={video} {...baseProps} />);

      const rail = getByTestId('feed-item-actions-rail');
      const labels = within(rail)
        .getAllByRole('button')
        .map((button) => button.props.accessibilityLabel);

      expect(labels).toEqual(['Mute', 'Like', 'Save', 'Share']);
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

      await fireEvent.press(getByLabelText('Mute'));
      await fireEvent.press(getByLabelText('Like'));
      await fireEvent.press(getByLabelText('Save'));
      await fireEvent.press(getByLabelText('Share'));

      expect(onToggleMute).toHaveBeenCalledTimes(1);
      expect(onToggleLike).toHaveBeenCalledTimes(1);
      expect(onToggleSave).toHaveBeenCalledTimes(1);
      expect(onShare).toHaveBeenCalledTimes(1);
    });

    it('enters native fullscreen from the Playback Settings sheet', async () => {
      // Android (and web) enter immediately - there is no presentation stack
      // to contend with.
      const originalOS = Platform.OS;

      Platform.OS = 'android';

      try {
        const video = buildVideo({ width: 1280, height: 720 });
        const { getByLabelText, getByTestId } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} />
        );

        await act(async () => {
          fireEvent.press(getByLabelText('Pengaturan pemutaran'));
        });
        await act(async () => {
          fireEvent.press(getByTestId('playback-settings-fullscreen'));
        });

        // Reaches the SAME videoViewRef.enterFullscreen() the rail control
        // used to call - only the entry point moved.
        expect(mockEnterFullscreen).toHaveBeenCalledTimes(1);
      } finally {
        Platform.OS = originalOS;
      }
    });

    it('defers fullscreen entry on iOS until the sheet has finished dismissing', async () => {
      // Presenting the native fullscreen view controller while the sheet
      // Modal is still animating out is a UIKit presentation conflict
      // ("presentation in progress"), so the press must NOT enter directly.
      // The actual call is made from the Modal's onDismiss, which only fires
      // after the transition completes and only exists on iOS.
      const originalOS = Platform.OS;

      Platform.OS = 'ios';

      try {
        const video = buildVideo({ width: 1280, height: 720 });
        const { getByLabelText, getByTestId, queryByTestId } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} />
        );

        await act(async () => {
          fireEvent.press(getByLabelText('Pengaturan pemutaran'));
        });
        await act(async () => {
          fireEvent.press(getByTestId('playback-settings-fullscreen'));
        });

        expect(mockEnterFullscreen).not.toHaveBeenCalled();
        // The sheet did close - the entry is pending, not dropped.
        expect(queryByTestId('playback-settings-fullscreen')).toBeNull();
      } finally {
        Platform.OS = originalOS;
      }
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
      const { getByLabelText, getAllByLabelText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );

      await openPlaybackSettingsFor(getAllByLabelText);

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
      const { getByLabelText, getAllByLabelText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive={false} />
      );

      await openPlaybackSettingsFor(getAllByLabelText);

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
        const { getByLabelText, getAllByLabelText, rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive={false} />
        );

        await openPlaybackSettingsFor(getAllByLabelText);

        await act(async () => {
          fireEvent.press(getByLabelText('Kecepatan 2x'));
        });

        expect(allPlayers().at(-1)!.rateWrites).toEqual([]);

        // Act: it becomes the active item.
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
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

      expect(getByText('Video tidak tersedia')).toBeTruthy();
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

      expect(getByText('Video tidak tersedia')).toBeTruthy();
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

  describe('clear-display surface vs. the error-state retry target', () => {
    // REGRESSION GUARD. The clear-display surface is a full-bleed, absolutely
    // positioned LATER root sibling with no zIndex, so it is topmost in both
    // platforms' hit tests. The error view is its own Pressable carrying the
    // 11R ADDENDUM tap-to-retry re-authorization path. If both render at
    // once, every retry tap is swallowed and the viewer is back to "pressed
    // play repeatedly, nothing happened".
    //
    // fireEvent bypasses hit testing, so no press-based test can catch this -
    // the assertion has to be about what is MOUNTED.
    it('does not mount the clear-display surface over the error state', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(new Error('boom'));

      const { queryByTestId, getByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );

      await act(async () => {});

      expect(getByTestId('feed-item-play-pause')).toBeTruthy();
      expect(queryByTestId('feed-item-clear-display-surface')).toBeNull();
    });

    it('still offers the surface when an error coincides with clear display', async () => {
      mockGetPlaybackAuthorization.mockRejectedValue(new Error('boom'));

      const { getByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive isClearDisplay />
      );

      await act(async () => {});

      // Hidden chrome must always have a way back, even on a failed video.
      expect(getByTestId('feed-item-clear-display-surface')).toBeTruthy();
    });
  });

  describe('playback settings sheet (vertical kebab)', () => {
    it('opening the sheet never touches the player', async () => {
      const { getByLabelText, getByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );

      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');
      const playerBefore = (useVideoPlayer as jest.Mock).mock.results.at(-1)?.value;
      const authCallsBefore = mockGetPlaybackAuthorization.mock.calls.length;

      await act(async () => {
        fireEvent.press(getByLabelText('Pengaturan pemutaran'));
      });

      expect(getByTestId('playback-settings-sheet')).toBeTruthy();
      // Same player object, no pause, no re-authorization: the sheet is a
      // Modal over the feed, not a playback event.
      expect((useVideoPlayer as jest.Mock).mock.results.at(-1)?.value).toBe(playerBefore);
      expect(playerBefore.pause).not.toHaveBeenCalled();
      expect(playerBefore.rateWrites).toEqual([]);
      expect(mockGetPlaybackAuthorization.mock.calls).toHaveLength(authCallsBefore);
    });

    it('closes from the scrim without changing anything', async () => {
      const { getByLabelText, getByTestId, queryByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );

      await act(async () => {
        fireEvent.press(getByLabelText('Pengaturan pemutaran'));
      });
      await act(async () => {
        fireEvent.press(getByTestId('playback-settings-scrim'));
      });

      expect(queryByTestId('playback-settings-sheet')).toBeNull();
    });

    it('offers Speed, Clear Display and Fullscreen - and, for an MP4-backed video, no quality control', async () => {
      // The default authorization in `beforeEach` is MP4-shaped: one fixed
      // stream with no rendition ladder behind it. The sheet must therefore
      // show no quality control at all rather than a menu that cannot change
      // anything - the same rule that keeps it from ever implying a control
      // the player does not offer.
      const { getByLabelText, getByTestId, queryByLabelText, queryByTestId } =
        await renderFeedItem(
          <DramaFeedItem video={buildVideo({ width: 1280, height: 720 })} {...baseProps} isActive />
        );

      await act(async () => {
        fireEvent.press(getByLabelText('Pengaturan pemutaran'));
      });

      expect(getByLabelText('Kecepatan 1x')).toBeTruthy();
      expect(getByLabelText('Kecepatan 1.5x')).toBeTruthy();
      expect(getByLabelText('Kecepatan 2x')).toBeTruthy();
      expect(getByTestId('playback-settings-clear-display-row')).toBeTruthy();
      expect(getByTestId('playback-settings-fullscreen')).toBeTruthy();
      expect(queryByTestId('playback-settings-quality-auto')).toBeNull();
      for (const absent of ['Kualitas', 'Otomatis', 'HLS', 'Download', 'Unduh']) {
        expect(queryByLabelText(absent)).toBeNull();
      }
    });
  });

  // Manual rendition selection is REAL here, not cosmetic: expo-video 57
  // exposes `videoTrack`/`availableVideoTracks` as read-only (no setter), so
  // a manual choice is made by playing that rendition's OWN variant playlist
  // - a playlist that advertises exactly one rendition. Every case below
  // therefore asserts on the SOURCE the player was actually given, never on
  // the button that was pressed.
  describe('video quality selector (Auto + real HLS rendition selection)', () => {
    const MASTER_URL = 'https://gateway.example.com/t/tok/master.m3u8';

    function variantUrl(quality: string) {
      return `https://gateway.example.com/t/tok/${quality}/index.m3u8`;
    }

    // The backend's real portrait ladder: named by SHORT side, so the "1080p"
    // rung of a 1080x1920 source is 1080 WIDE and 1920 TALL.
    function portraitLadder(...qualities: readonly number[]) {
      return qualities.map((shortSide) => ({
        quality: `${shortSide}p`,
        width: shortSide,
        height: Math.round((shortSide * 16) / 9),
        url: variantUrl(`${shortSide}p`),
      }));
    }

    function authorizeHls(...qualities: readonly number[]) {
      mockGetPlaybackAuthorization.mockResolvedValue(
        buildHlsPlaybackAuthorization({
          masterUrl: MASTER_URL,
          renditions: portraitLadder(...qualities),
        })
      );
    }

    // The SAME ladder, but tokened. A re-authorization returns the same
    // rendition NAMES behind entirely new URLs (the gateway token is
    // path-embedded and dies at `expiresAt`), which is the shape every
    // refresh case below turns on.
    function tokenedMaster(token: string) {
      return `https://gateway.example.com/t/${token}/master.m3u8`;
    }

    function tokenedVariant(token: string, quality: string) {
      return `https://gateway.example.com/t/${token}/${quality}/index.m3u8`;
    }

    function tokenedLadder(token: string, ...qualities: readonly number[]) {
      return qualities.map((shortSide) => ({
        quality: `${shortSide}p`,
        width: shortSide,
        height: Math.round((shortSide * 16) / 9),
        url: tokenedVariant(token, `${shortSide}p`),
      }));
    }

    /**
     * Queues two grants: the first expires in 40s, so the component's own 30s
     * refresh margin fires the second exactly 10s in - the same timing every
     * other proactive-refresh case in this file uses.
     */
    function authorizeHlsThenRefreshWith(
      firstQualities: readonly number[],
      secondQualities: readonly number[]
    ) {
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildHlsPlaybackAuthorization({
          masterUrl: tokenedMaster('first'),
          renditions: tokenedLadder('first', ...firstQualities),
          expiresAt: new Date(Date.now() + 40000).toISOString(),
        })
      );
      mockGetPlaybackAuthorization.mockResolvedValueOnce(
        buildHlsPlaybackAuthorization({
          masterUrl: tokenedMaster('second'),
          renditions: tokenedLadder('second', ...secondQualities),
        })
      );
    }

    async function openSheet(getByLabelText: (label: string) => unknown) {
      await act(async () => {
        fireEvent.press(getByLabelText('Pengaturan pemutaran') as never);
      });
    }

    function latestSourceUri() {
      const { useVideoPlayer } = jest.requireMock<typeof import('expo-video')>('expo-video');

      return ((useVideoPlayer as jest.Mock).mock.calls.at(-1)?.[0] as { uri?: string } | null)?.uri;
    }

    it('defaults to Auto: the adaptive master playlist is what the player is given', async () => {
      authorizeHls(360, 540, 720, 1080);

      const { getByLabelText, getByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );
      await act(async () => {});

      // The player really is on the master (ABR unrestricted)...
      expect(latestSourceUri()).toBe(MASTER_URL);

      await openSheet(getByLabelText);

      // ...and the menu says so.
      expect(getByTestId('playback-settings-quality-auto').props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true })
      );
    });

    it('lists exactly the renditions the backend produced, highest first, with 1080p marked HD', async () => {
      authorizeHls(360, 540, 720, 1080);

      const { getByLabelText, getByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );
      await act(async () => {});
      await openSheet(getByLabelText);

      expect(getByTestId('playback-settings-quality-auto')).toBeTruthy();
      for (const quality of ['360p', '540p', '720p', '1080p']) {
        expect(getByTestId(`playback-settings-quality-${quality}`)).toBeTruthy();
      }
      // The top rung reads "1080p HD"; nothing below it does.
      expect(getByLabelText('Kualitas 1080p HD')).toBeTruthy();
      expect(getByLabelText('Kualitas 720p')).toBeTruthy();
    });

    it('never shows a rendition this video does not have', async () => {
      // A source whose short side is 540 cannot produce the upper rungs, so
      // the backend never sends them - and the menu must not invent them.
      authorizeHls(360, 540);

      const { getByLabelText, getByTestId, queryByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );
      await act(async () => {});
      await openSheet(getByLabelText);

      expect(getByTestId('playback-settings-quality-360p')).toBeTruthy();
      expect(getByTestId('playback-settings-quality-540p')).toBeTruthy();
      expect(queryByTestId('playback-settings-quality-720p')).toBeNull();
      expect(queryByTestId('playback-settings-quality-1080p')).toBeNull();
    });

    it('selecting 360p really constrains the player to that rendition, not just the label', async () => {
      authorizeHls(360, 540, 720, 1080);

      const { getByLabelText, getByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );
      await act(async () => {});

      const masterPlayer = findPlayerByUri(MASTER_URL);

      await openSheet(getByLabelText);
      await act(async () => {
        fireEvent.press(getByTestId('playback-settings-quality-360p'));
      });

      // THE assertion: the player is handed the 360p VARIANT playlist. That
      // playlist advertises one rendition, so ABR cannot climb off it.
      expect(latestSourceUri()).toBe(variantUrl('360p'));
      expect(findPlayerByUri(variantUrl('360p'))).not.toBe(masterPlayer);
      expect(getByTestId('playback-settings-quality-360p').props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true })
      );
    });

    it('returning to Auto restores adaptive playback on the master playlist', async () => {
      authorizeHls(360, 720);

      const { getByLabelText, getByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );
      await act(async () => {});
      await openSheet(getByLabelText);

      await act(async () => {
        fireEvent.press(getByTestId('playback-settings-quality-720p'));
      });
      expect(latestSourceUri()).toBe(variantUrl('720p'));

      await act(async () => {
        fireEvent.press(getByTestId('playback-settings-quality-auto'));
      });

      expect(latestSourceUri()).toBe(MASTER_URL);
      expect(getByTestId('playback-settings-quality-auto').props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true })
      );
    });

    it('keeps a manual pause manual across a quality change', async () => {
      authorizeHls(360, 720);

      const video = buildVideo();
      const { getByLabelText, getByTestId, rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );
      await act(async () => {});

      // The tap target only PAUSES a player that reports playing - otherwise
      // it is a play press. The mock's `play()` is a spy and never flips
      // `playing`, so drive it here to reach the real pause branch.
      const masterPlayer = findPlayerByUri(MASTER_URL) as unknown as { playing: boolean };

      masterPlayer.playing = true;
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
      });

      // The viewer pauses on purpose.
      await act(async () => {
        fireEvent.press(getByTestId('feed-item-play-pause'));
      });

      await openSheet(getByLabelText);
      await act(async () => {
        fireEvent.press(getByTestId('playback-settings-quality-720p'));
      });

      const incomingPlayer = findPlayerByUri(variantUrl('720p'));

      expect(incomingPlayer).toBeTruthy();
      // A quality change must not silently resume a video the viewer stopped.
      expect(incomingPlayer?.play).not.toHaveBeenCalled();
    });

    it('carries the playback position across a quality change via the existing generation-swap reseek', async () => {
      authorizeHls(360, 720);

      const video = buildVideo();
      const { getByLabelText, getByTestId, rerender } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );
      await act(async () => {});

      // The item has been playing for 42s on the master, and its player is
      // confirmed ready.
      const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
      (useEvent as jest.Mock).mockImplementation(
        (_player: unknown, eventName: string, defaultValue: unknown) => {
          if (eventName === 'statusChange') {
            return { status: 'readyToPlay', error: undefined };
          }
          if (eventName === 'timeUpdate') {
            return {
              currentTime: 42,
              currentLiveTimestamp: null,
              currentOffsetFromLive: null,
              bufferedPosition: 0,
            };
          }
          return defaultValue;
        }
      );
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
      });

      await openSheet(getByLabelText);
      await act(async () => {
        fireEvent.press(getByTestId('playback-settings-quality-720p'));
      });

      const incomingPlayer = findPlayerByUri(variantUrl('720p')) as
        | { seekBy: jest.Mock; currentTime: number; status: string }
        | undefined;

      // Same contract as every other generation swap: nothing is seeked
      // until the INCOMING player itself reports readyToPlay.
      expect(incomingPlayer?.seekBy).not.toHaveBeenCalled();

      incomingPlayer!.status = 'readyToPlay';
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
      });

      // No second, competing restore mechanism: the existing DETECT/APPLY
      // pair does this, and does it exactly once.
      expect(incomingPlayer?.seekBy).toHaveBeenCalledTimes(1);
      expect(incomingPlayer?.seekBy).toHaveBeenCalledWith(42 - (incomingPlayer?.currentTime ?? 0));
    });

    it('pauses the outgoing player on a quality swap, so only one player is ever live', async () => {
      authorizeHls(360, 720);

      const { getByLabelText, getByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );
      await act(async () => {});

      const masterPlayer = findPlayerByUri(MASTER_URL);

      await openSheet(getByLabelText);
      await act(async () => {
        fireEvent.press(getByTestId('playback-settings-quality-720p'));
      });

      // The superseded generation is stopped by the existing
      // outgoing-player cleanup - a quality change introduces no second
      // simultaneous player.
      expect(masterPlayer?.pause).toHaveBeenCalled();
      expect(findPlayerByUri(variantUrl('720p'))).not.toBe(masterPlayer);
    });

    it('scopes the choice to its own video: a new video starts back on Auto', async () => {
      jest.useFakeTimers();
      try {
        authorizeHls(360, 720);

        const { getByLabelText, getByTestId, rerender } = await renderFeedItem(
          <DramaFeedItem video={buildVideo({ id: 'video-1' })} {...baseProps} isActive />
        );
        await act(async () => {});
        await openSheet(getByLabelText);
        await act(async () => {
          fireEvent.press(getByTestId('playback-settings-quality-720p'));
        });
        expect(latestSourceUri()).toBe(variantUrl('720p'));

        // The same mounted instance receives a DIFFERENT video. Its own
        // authorization fetch goes through the activation settle-window
        // debounce, so let that land before reading the source.
        await act(async () => {
          rerender(<DramaFeedItem video={buildVideo({ id: 'video-2' })} {...baseProps} isActive />);
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        // A rendition pinned on the previous clip must not follow the viewer
        // here - this video's ladder may not even contain it.
        expect(latestSourceUri()).toBe(MASTER_URL);
      } finally {
        jest.useRealTimers();
      }
    });

    it('leaves speed, clear display and fullscreen working alongside the new section', async () => {
      authorizeHls(360, 720, 1080);

      const { getByLabelText, getByTestId } = await renderFeedItem(
        <DramaFeedItem
          video={buildVideo({ width: 1280, height: 720 })}
          {...baseProps}
          isActive
        />
      );
      await act(async () => {});
      await openSheet(getByLabelText);

      expect(getByLabelText('Kecepatan 1x')).toBeTruthy();
      expect(getByLabelText('Kecepatan 1.5x')).toBeTruthy();
      expect(getByLabelText('Kecepatan 2x')).toBeTruthy();
      expect(getByTestId('playback-settings-clear-display-row')).toBeTruthy();
      expect(getByTestId('playback-settings-fullscreen')).toBeTruthy();
      expect(getByTestId('playback-settings-quality-auto')).toBeTruthy();
    });

    it('re-resolves a manual pick against a REFRESHED authorization, never pinning the dead URL', async () => {
      // THE invariant that makes storing a rendition NAME (rather than its
      // tokened URL) load-bearing rather than stylistic: the variant URL the
      // viewer picked at 0s is dead by `expiresAt`. Holding the name means
      // the pre-expiry refresh re-resolves 720p against the FRESH grant, and
      // the existing generation swap carries the position across.
      jest.useFakeTimers();
      try {
        authorizeHlsThenRefreshWith([360, 720], [360, 720]);

        const { getByLabelText, getByTestId } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
        );
        await openSheet(getByLabelText);
        await act(async () => {
          fireEvent.press(getByTestId('playback-settings-quality-720p'));
        });

        expect(latestSourceUri()).toBe(tokenedVariant('first', '720p'));

        await act(async () => {
          await jest.advanceTimersByTimeAsync(10000);
        });

        expect(mockGetPlaybackAuthorization).toHaveBeenCalledTimes(2);
        // Still 720p, and now on the LIVE token - not the one about to die.
        expect(latestSourceUri()).toBe(tokenedVariant('second', '720p'));
        expect(latestSourceUri()).not.toBe(tokenedVariant('first', '720p'));
        expect(getByTestId('playback-settings-quality-720p').props.accessibilityState).toEqual(
          expect.objectContaining({ selected: true })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('falls back to Auto - in the menu AND in the source - when a refresh drops the pinned rung', async () => {
      // A re-transcode can return a shorter ladder. The player degrades to
      // the adaptive master rather than a black frame; the menu must agree,
      // or the checkmark would sit on a rendition nothing is playing.
      jest.useFakeTimers();
      try {
        authorizeHlsThenRefreshWith([360, 720, 1080], [360, 720]);

        const { getByLabelText, getByTestId, queryByTestId } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
        );
        await openSheet(getByLabelText);
        await act(async () => {
          fireEvent.press(getByTestId('playback-settings-quality-1080p'));
        });

        expect(latestSourceUri()).toBe(tokenedVariant('first', '1080p'));

        await act(async () => {
          await jest.advanceTimersByTimeAsync(10000);
        });

        expect(latestSourceUri()).toBe(tokenedMaster('second'));
        expect(queryByTestId('playback-settings-quality-1080p')).toBeNull();
        expect(getByTestId('playback-settings-quality-auto').props.accessibilityState).toEqual(
          expect.objectContaining({ selected: true })
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it('withdraws the whole section when a refreshed ladder no longer offers a real choice', async () => {
      // One rung is not a choice - "Auto" and that rung are the same stream
      // under two names. The section disappears rather than becoming a
      // one-entry menu, and playback continues on the fresh grant.
      jest.useFakeTimers();
      try {
        authorizeHlsThenRefreshWith([360, 720], [720]);

        const { getByLabelText, getByTestId, queryByTestId, queryByText } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
        );
        await openSheet(getByLabelText);
        await act(async () => {
          fireEvent.press(getByTestId('playback-settings-quality-720p'));
        });

        await act(async () => {
          await jest.advanceTimersByTimeAsync(10000);
        });

        expect(queryByText('Kualitas')).toBeNull();
        expect(queryByTestId('playback-settings-quality-auto')).toBeNull();
        expect(queryByTestId('playback-settings-quality-720p')).toBeNull();
        // The rest of the sheet is untouched, and the source moved to the
        // live token rather than staying on the expiring one.
        expect(getByTestId('playback-settings-clear-display-row')).toBeTruthy();
        expect(latestSourceUri()).toContain('/t/second/');
      } finally {
        jest.useRealTimers();
      }
    });

    it('leaves no stale quality UI behind when a later authorization fails outright', async () => {
      jest.useFakeTimers();
      try {
        mockGetPlaybackAuthorization.mockResolvedValueOnce(
          buildHlsPlaybackAuthorization({
            masterUrl: tokenedMaster('first'),
            renditions: tokenedLadder('first', 360, 720),
            expiresAt: new Date(Date.now() + 40000).toISOString(),
          })
        );
        mockGetPlaybackAuthorization.mockRejectedValue(new Error('gateway unreachable'));

        const { getByLabelText, getByTestId, queryByTestId } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
        );
        await openSheet(getByLabelText);
        await act(async () => {
          fireEvent.press(getByTestId('playback-settings-quality-720p'));
        });

        expect(getByTestId('playback-settings-quality-720p')).toBeTruthy();

        await act(async () => {
          await jest.advanceTimersByTimeAsync(10000);
        });

        // The failure takes the entire settings surface with it (the sheet is
        // rendered under `hasPlaybackError ? null : ...`), so there is no menu
        // left claiming a rendition nothing is playing - and no crash.
        expect(queryByTestId('playback-settings-sheet')).toBeNull();
        expect(queryByTestId('playback-settings-quality-720p')).toBeNull();
        expect(queryByTestId('playback-settings-quality-auto')).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });

    it('carries the chosen playback speed onto the rendition-swapped player', async () => {
      // A quality change replaces the player, so the rate has to be
      // re-applied to the incoming generation - the same way it already
      // survives a token refresh. Losing it would silently drop a viewer
      // watching at 1.5x back to 1x for picking a different rung.
      authorizeHls(360, 720);

      const { getByLabelText, getByTestId } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );
      await act(async () => {});
      await openSheet(getByLabelText);

      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 1.5x'));
      });
      await act(async () => {
        fireEvent.press(getByTestId('playback-settings-quality-720p'));
      });

      const incomingPlayer = findPlayerByUri(variantUrl('720p'));

      expect(incomingPlayer?.playbackRate).toBe(1.5);
      expect(incomingPlayer?.rateWrites).toEqual([1.5]);
      expect(getByLabelText('Kecepatan 1.5x').props.accessibilityState).toEqual(
        expect.objectContaining({ selected: true })
      );
    });

    it('rapid 360p -> 540p -> 720p leaves only the newest generation live', async () => {
      // Every swap hands back a new player. An older generation reclaiming
      // ownership would resume the rung the viewer already moved off, and
      // two live players would be audible at once.
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        authorizeHls(360, 540, 720);

        const video = buildVideo();
        const { getByLabelText, getByTestId, rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );
        await act(async () => {});

        const masterPlayer = findPlayerByUri(MASTER_URL);

        // Give the invariant registry something to observe: the outgoing
        // generation genuinely reports itself playing at each swap.
        if (masterPlayer) {
          (masterPlayer as unknown as { playing: boolean }).playing = true;
        }
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
        });

        await openSheet(getByLabelText);

        for (const rung of ['360p', '540p', '720p']) {
          await act(async () => {
            fireEvent.press(getByTestId(`playback-settings-quality-${rung}`));
          });

          const justCreated = findPlayerByUri(variantUrl(rung));

          if (justCreated) {
            (justCreated as unknown as { playing: boolean }).playing = true;
          }
          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });
        }

        const player360 = findPlayerByUri(variantUrl('360p'));
        const player540 = findPlayerByUri(variantUrl('540p'));
        const player720 = findPlayerByUri(variantUrl('720p'));

        expect(latestSourceUri()).toBe(variantUrl('720p'));
        // Every superseded generation was stopped by the existing
        // outgoing-player cleanup, in order.
        expect(masterPlayer?.pause).toHaveBeenCalled();
        expect(player360?.pause).toHaveBeenCalled();
        expect(player540?.pause).toHaveBeenCalled();
        expect(player720?.play).toHaveBeenCalled();
        expect(getByTestId('playback-settings-quality-720p').props.accessibilityState).toEqual(
          expect.objectContaining({ selected: true })
        );
        expect(
          consoleErrorSpy.mock.calls.some((call) => call[0] === '[PlaybackInvariantViolation]')
        ).toBe(false);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });

    it('a video change while a rendition is pinned resolves the NEW video adaptively, not the old rung', async () => {
      // The second video's grant is deliberately left in flight across the
      // swap, so the assertion is about what lands when it finally resolves -
      // not about a value that happened to already be there.
      jest.useFakeTimers();
      try {
        const secondGrant = createDeferred<HlsPlaybackAuthorization>();

        mockGetPlaybackAuthorization.mockResolvedValueOnce(
          buildHlsPlaybackAuthorization({
            masterUrl: tokenedMaster('first'),
            renditions: tokenedLadder('first', 360, 720),
          })
        );
        mockGetPlaybackAuthorization.mockReturnValueOnce(secondGrant.promise);

        const { getByLabelText, getByTestId, rerender } = await renderFeedItem(
          <DramaFeedItem video={buildVideo({ id: 'video-1' })} {...baseProps} isActive />
        );
        await openSheet(getByLabelText);
        await act(async () => {
          fireEvent.press(getByTestId('playback-settings-quality-720p'));
        });
        expect(latestSourceUri()).toBe(tokenedVariant('first', '720p'));

        await act(async () => {
          rerender(<DramaFeedItem video={buildVideo({ id: 'video-2' })} {...baseProps} isActive />);
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        await act(async () => {
          secondGrant.resolve(
            buildHlsPlaybackAuthorization({
              masterUrl: tokenedMaster('second'),
              renditions: tokenedLadder('second', 360, 720),
            })
          );
          await secondGrant.promise;
        });

        // Auto, on the new video's own master - the previous clip's pinned
        // rung did not follow the viewer here.
        expect(latestSourceUri()).toBe(tokenedMaster('second'));
        expect(getByTestId('playback-settings-quality-auto').props.accessibilityState).toEqual(
          expect.objectContaining({ selected: true })
        );
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('playback speed selector (per-video speed: 1x / 1.5x / 2x)', () => {
    // Speed now lives in the Playback Settings sheet behind the vertical
    // kebab, not in a clear-display control strip, so every case here opens
    // the sheet first. Pressing EVERY kebab keeps the multi-item cases
    // index-aligned: `getAllByLabelText('Kecepatan 1.5x')[n]` still
    // addresses item n's own control.
    const openAllPlaybackSettings = openPlaybackSettingsFor;

    type MockPlayer = {
      playing: boolean;
      play: jest.Mock;
      pause: jest.Mock;
      rateWrites: number[];
      playbackRate: number;
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
      const { getByLabelText, getAllByLabelText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );
      await openAllPlaybackSettings(getAllByLabelText);

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
        const { getByLabelText, getAllByLabelText } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
        );
        await openAllPlaybackSettings(getAllByLabelText);

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
      const { getByLabelText, getAllByLabelText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );
      await openAllPlaybackSettings(getAllByLabelText);

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

    it('a speed change touches only the active player, leaving every other mounted player alone', async () => {
      // Under the previous session-scoped store this test existed because a
      // change re-rendered every mounted item and only their `shouldPlay`
      // gates kept the inactive players untouched. Per-item state removes
      // that pressure at the source - siblings no longer re-render at all -
      // but the guarantee is what the product depends on, so it stays pinned
      // here regardless of which mechanism is currently providing it.
      const { getAllByLabelText } = await renderFeedItem(
        <>
          {[1, 2, 3].map((itemNumber) => (
            <DramaFeedItem
              key={itemNumber}
              video={buildVideo({ id: `video-${itemNumber}` })}
              {...baseProps}
              isActive={itemNumber === 1}
            />
          ))}
        </>
      );
      await openAllPlaybackSettings(getAllByLabelText);

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
      const { getByLabelText, rerender, getAllByLabelText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );
      await openAllPlaybackSettings(getAllByLabelText);
      const player = latestPlayer();

      // The mocked useEvent reads player.playing at render time, so the flag
      // has to be set and re-rendered before the tap sees something to pause.
      player.playing = true;
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
      });
      await act(async () => {
        fireEvent.press(getByLabelText('Pause'));
      });

      expect(player.pause).toHaveBeenCalled();

      player.playing = false;
      await act(async () => {
        rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
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

    it('rapid A -> B -> C after choosing 2x on A leaves only C playing, at 1x', async () => {
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
              />
            ))}
          </>
        );

        const { getAllByLabelText, rerender } = await renderFeedItem(feedWithActive(0));
        await openAllPlaybackSettings(getAllByLabelText);

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
        // The 2x belonged to A alone. C starts at its own default 1x, and
        // because its fresh player already reports 1 the mirror effect's
        // equality check elides the write entirely - so C is not merely "at
        // 1x", it never received a rate write at all. On iOS that absence is
        // the point: a rate write there IS a play command.
        expect(playerC?.rateWrites).toEqual([]);
        expect(playerB?.rateWrites).toEqual([]);
        // A keeps the single write its own active stint justified.
        expect(playerA?.rateWrites).toEqual([2]);
      } finally {
        jest.useRealTimers();
      }
    });

    // Two videos mounted side by side, one active at a time - the smallest
    // arrangement that can tell "per video" apart from "per session". Both
    // render their own speed selector (isClearDisplay), so index 0 addresses
    // A's controls and index 1 addresses B's.
    //
    // 11R remediation ADDENDUM: the inactive item's later activation is
    // debounced, hence the fake timers and the settle advance.
    const videoA = buildVideo({ id: 'video-a' });
    const videoB = buildVideo({ id: 'video-b' });
    const URI_A = 'https://media.example.com/video-a.mp4';
    const URI_B = 'https://media.example.com/video-b.mp4';
    const twoVideoFeed = (activeIndex: number) => (
      <>
        <DramaFeedItem video={videoA} {...baseProps} isActive={activeIndex === 0} />
        <DramaFeedItem video={videoB} {...baseProps} isActive={activeIndex === 1} />
      </>
    );
    const isSelected = (element: { props: { accessibilityState?: { selected?: boolean } } }) =>
      element.props.accessibilityState?.selected === true;

    it('starts a newly-active video at 1x instead of inheriting the previous video’s speed', async () => {
      jest.useFakeTimers();
      try {
        const { getAllByLabelText, rerender } = await renderFeedItem(twoVideoFeed(0));
        await openAllPlaybackSettings(getAllByLabelText);

        await act(async () => {
          fireEvent.press(getAllByLabelText('Kecepatan 1.5x')[0]);
        });

        await act(async () => {
          rerender(twoVideoFeed(1));
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        const playerB = findPlayerByUri(URI_B);

        // B plays, and it plays at 1x. No rate write reaches it at all: its
        // own default is 1 and its fresh player already reports 1, so the
        // mirror effect's equality check suppresses the write.
        expect(playerB?.play).toHaveBeenCalled();
        expect(playerB?.rateWrites).toEqual([]);
        expect(playerB?.playbackRate).toBe(1);
        // B's own selector reflects 1x, not A's 1.5x.
        expect(isSelected(getAllByLabelText('Kecepatan 1x')[1])).toBe(true);
        expect(isSelected(getAllByLabelText('Kecepatan 1.5x')[1])).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('a speed chosen on B leaves A’s speed and player untouched', async () => {
      jest.useFakeTimers();
      try {
        const { getAllByLabelText, rerender } = await renderFeedItem(twoVideoFeed(0));
        await openAllPlaybackSettings(getAllByLabelText);

        await act(async () => {
          fireEvent.press(getAllByLabelText('Kecepatan 1.5x')[0]);
        });

        const playerA = findPlayerByUri(URI_A);

        expect(playerA?.rateWrites).toEqual([1.5]);

        await act(async () => {
          rerender(twoVideoFeed(1));
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });
        await act(async () => {
          fireEvent.press(getAllByLabelText('Kecepatan 2x')[1]);
        });

        const playerB = findPlayerByUri(URI_B);

        // B took the 2x...
        expect(playerB?.rateWrites).toEqual([2]);
        expect(isSelected(getAllByLabelText('Kecepatan 2x')[1])).toBe(true);
        // ...and none of it reached A, whose stored choice is still 1.5x and
        // whose player received no further write.
        expect(playerA?.rateWrites).toEqual([1.5]);
        expect(playerA?.playbackRate).toBe(1.5);
        expect(isSelected(getAllByLabelText('Kecepatan 1.5x')[0])).toBe(true);
        expect(isSelected(getAllByLabelText('Kecepatan 2x')[0])).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it('restores the speed a still-mounted video was left at when it becomes active again', async () => {
      jest.useFakeTimers();
      try {
        const { getAllByLabelText, rerender } = await renderFeedItem(twoVideoFeed(0));
        await openAllPlaybackSettings(getAllByLabelText);

        await act(async () => {
          fireEvent.press(getAllByLabelText('Kecepatan 1.5x')[0]);
        });

        // Away to B...
        await act(async () => {
          rerender(twoVideoFeed(1));
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });
        // ...and back to A, which never unmounted.
        await act(async () => {
          rerender(twoVideoFeed(0));
        });
        await act(async () => {
          await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
        });

        const playerA = findPlayerByUri(URI_A);

        // A resumes at the 1.5x it was left at. The rate is restored without
        // a SECOND write: the player never lost the rate, so the equality
        // check correctly declines to re-issue it.
        expect(playerA?.playbackRate).toBe(1.5);
        expect(playerA?.rateWrites).toEqual([1.5]);
        expect(playerA?.play).toHaveBeenCalled();
        expect(isSelected(getAllByLabelText('Kecepatan 1.5x')[0])).toBe(true);
      } finally {
        jest.useRealTimers();
      }
    });

    it('keeps the item’s speed across background/foreground without a duplicate rate write', async () => {
      const appStateListeners: ((state: string) => void)[] = [];
      const addListenerSpy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((
        _event: string,
        listener: (state: string) => void
      ) => {
        appStateListeners.push(listener);

        return { remove: jest.fn() };
      }) as never);

      try {
        const { getByLabelText, getAllByLabelText } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
        );
        await openAllPlaybackSettings(getAllByLabelText);

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
      const { getByLabelText, rerender, getAllByLabelText } = await renderFeedItem(
        <DramaFeedItem video={video} {...baseProps} isActive />
      );
      await openAllPlaybackSettings(getAllByLabelText);

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
          <DramaFeedItem video={video} {...baseProps} isActive isScreenFocused />
        );
      });

      expect(latestPlayer().rateWrites).toEqual([1.5, 2]);
    });

    it('changing rate never rebuilds the player, reloads the source, re-authorizes, or pauses', async () => {
      const { getByLabelText, getAllByLabelText } = await renderFeedItem(
        <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
      );
      await openAllPlaybackSettings(getAllByLabelText);

      const playerBefore = latestPlayer();
      const authCallsBefore = mockGetPlaybackAuthorization.mock.calls.length;
      const playCallsBefore = playerBefore.play.mock.calls.length;
      // Baselined, not asserted as 1: cold open legitimately builds a second
      // player when the authorized source replaces the unauthorized one. That
      // swap happens before this point; what must not grow is the count from
      // here on.
      const distinctPlayersBefore = allDistinctPlayers().length;

      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 1.5x'));
      });
      await act(async () => {
        fireEvent.press(getByLabelText('Kecepatan 2x'));
      });

      // The rate really did change twice - this is not a no-op test.
      expect(playerBefore.rateWrites).toEqual([1.5, 2]);
      expect(playerBefore.playbackRate).toBe(2);

      // Same player OBJECT, not merely an equivalent one. The expo-video mock
      // constructs a new player only when the resolved source key changes, so
      // identity here is simultaneously the proof that nothing rebuilt the
      // player and that nothing replaced/reloaded its source.
      expect(latestPlayer()).toBe(playerBefore);
      expect(allDistinctPlayers()).toHaveLength(distinctPlayersBefore);

      // No re-authorization: a rate is a local player property, never a
      // reason to re-fetch a playback URL or rotate an Authorization header.
      expect(mockGetPlaybackAuthorization.mock.calls).toHaveLength(authCallsBefore);

      // And playback was never interrupted to apply it.
      expect(playerBefore.pause).not.toHaveBeenCalled();
      expect(playerBefore.play.mock.calls).toHaveLength(playCallsBefore);
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
        expect(getByText('Video tidak tersedia')).toBeTruthy();
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

  // 11R PLAYBACK-STABILITY REMEDIATION: physical-iPhone field report - open
  // Home -> black screen -> delayed first frame -> visibly PAUSED ->
  // delayed autoplay -> and, while playing calmly, an unexplained
  // self-pause. Every describe block below is anchored to one of the root
  // causes this remediation found and fixed.
  describe('11R PLAYBACK-STABILITY REMEDIATION', () => {
    beforeEach(() => {
      // Isolates this describe block from any lingering `useEvent`
      // mockImplementation override left by an earlier test elsewhere in
      // this file. This file's jest config sets `clearMocks: true`, which
      // clears call history before every test but does NOT reset a
      // `mockImplementation` override already installed on a shared mock -
      // without this reset, a test above that permanently overrode e.g.
      // 'statusChange' would leak into every test below it.
      const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
      (useEvent as jest.Mock).mockImplementation(
        (_player: unknown, _eventName: string, defaultValue: unknown) => defaultValue
      );
    });

    // `latestMockPlayer()` is typed narrowly (`play`/`pause` only, matching
    // its original callers); this describe block's tests also need to
    // arrange `playing`/`seekBy` on the same mock instance, so this widens
    // the type rather than redeclaring the whole lookup.
    function latestPlayer() {
      return latestMockPlayer() as unknown as {
        playing: boolean;
        play: jest.Mock;
        pause: jest.Mock;
        seekBy: jest.Mock;
      };
    }

    describe('poster/thumbnail UX (fixes the cold-open black screen)', () => {
      it('shows the video\'s own poster instead of a black frame before playback has ever started', async () => {
        const video = buildVideo({ thumbnailUrl: 'https://cdn.example.com/poster-1.jpg' });
        const { getByTestId } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );

        // isPlaying defaults to false in this file's mocked useEvent (a
        // static default, never a real event) - exactly the cold-open gap
        // between "play() was issued" and "a real frame is confirmed."
        expect(getByTestId('feed-item-poster').props.source).toEqual({
          uri: 'https://cdn.example.com/poster-1.jpg',
        });
      });

      it('renders the poster for a mounted-but-inactive item too, instead of a black frame', async () => {
        const video = buildVideo({ thumbnailUrl: 'https://cdn.example.com/poster-1.jpg' });
        const { getByTestId } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive={false} />
        );

        expect(getByTestId('feed-item-poster')).toBeTruthy();
      });

      it('hides the poster once a real playingChange event confirms playback has started, and never brings it back for the same video (no poster/video flicker)', async () => {
        const video = buildVideo();
        const { getByTestId, queryByTestId, rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );

        expect(getByTestId('feed-item-poster')).toBeTruthy();

        const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
        (useEvent as jest.Mock).mockImplementation(
          (_player: unknown, eventName: string, defaultValue: unknown) =>
            eventName === 'playingChange' ? { isPlaying: true } : defaultValue
        );

        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
        });

        expect(queryByTestId('feed-item-poster')).toBeNull();

        // A later buffering blip (a real native player reporting
        // isPlaying: false again mid-stream) must NOT bring the poster
        // back over the last real frame.
        (useEvent as jest.Mock).mockImplementation(
          (_player: unknown, eventName: string, defaultValue: unknown) =>
            eventName === 'playingChange' ? { isPlaying: false } : defaultValue
        );

        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
        });

        expect(queryByTestId('feed-item-poster')).toBeNull();

        // Nor does an explicit user pause.
        await act(async () => {
          fireEvent.press(getByTestId('feed-item-play-pause'));
        });

        expect(queryByTestId('feed-item-poster')).toBeNull();
      });

      it('shows a fresh poster for a newly assigned video, even if the previous video had already started playing', async () => {
        const videoA = buildVideo({ id: 'video-a', thumbnailUrl: 'https://cdn.example.com/a.jpg' });
        const videoB = buildVideo({ id: 'video-b', thumbnailUrl: 'https://cdn.example.com/b.jpg' });

        const { getByTestId, queryByTestId, rerender } = await renderFeedItem(
          <DramaFeedItem video={videoA} {...baseProps} isActive />
        );

        expect(getByTestId('feed-item-poster').props.source).toEqual({
          uri: 'https://cdn.example.com/a.jpg',
        });

        // Video A starts playing - its poster is dismissed.
        const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
        (useEvent as jest.Mock).mockImplementation(
          (_player: unknown, eventName: string, defaultValue: unknown) =>
            eventName === 'playingChange' ? { isPlaying: true } : defaultValue
        );

        await act(async () => {
          rerender(<DramaFeedItem video={videoA} {...baseProps} isActive />);
        });

        expect(queryByTestId('feed-item-poster')).toBeNull();

        // Video B is a BRAND NEW player that has genuinely not started
        // playing yet - restore the default (isPlaying: false) before
        // assigning it, the same as any freshly created player's real
        // starting state.
        (useEvent as jest.Mock).mockImplementation(
          (_player: unknown, _eventName: string, defaultValue: unknown) => defaultValue
        );

        await act(async () => {
          rerender(<DramaFeedItem video={videoB} {...baseProps} isActive />);
        });

        expect(getByTestId('feed-item-poster').props.source).toEqual({
          uri: 'https://cdn.example.com/b.jpg',
        });
      });

      it('never shows the poster over the "Video unavailable" error state', async () => {
        mockGetPlaybackAuthorization.mockRejectedValueOnce(new Error('boom'));

        const { queryByTestId, getByText } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
        );

        expect(getByText('Video tidak tersedia')).toBeTruthy();
        expect(queryByTestId('feed-item-poster')).toBeNull();
      });
    });

    describe('buffering is not shown as "paused" (fixes the visibly-paused / delayed-autoplay gap)', () => {
      it('does not show the tap-to-resume affordance while autoplay is starting - the system already committed to playing', async () => {
        const { queryByTestId } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive />
        );

        // play() has already been issued (see "plays when it is the
        // active, focused item"), but isPlaying's static mock default
        // stays false - the exact buffering/starting gap that used to
        // render a misleading "paused, tap to resume" glyph.
        expect(queryByTestId('feed-item-play-pause-indicator')).toBeNull();
      });

      it('shows the tap-to-resume affordance when genuinely inactive', async () => {
        const { getByTestId } = await renderFeedItem(
          <DramaFeedItem video={buildVideo()} {...baseProps} isActive={false} />
        );

        expect(getByTestId('feed-item-play-pause-indicator')).toBeTruthy();
      });

      it('shows the tap-to-resume affordance after an explicit user pause', async () => {
        const video = buildVideo();
        const { getByTestId, rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );

        const player = latestPlayer();

        player.playing = true;
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
        });

        await act(async () => {
          fireEvent.press(getByTestId('feed-item-play-pause'));
        });

        expect(getByTestId('feed-item-play-pause-indicator')).toBeTruthy();
      });

      it('briefly confirms playback with the pause glyph once real playback starts, then auto-hides (unchanged confirmation behaviour)', async () => {
        jest.useFakeTimers();
        try {
          const video = buildVideo();
          const { getByTestId, queryByTestId, rerender } = await renderFeedItem(
            <DramaFeedItem video={video} {...baseProps} isActive />
          );

          expect(queryByTestId('feed-item-play-pause-indicator')).toBeNull();

          const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
          (useEvent as jest.Mock).mockImplementation(
            (_player: unknown, eventName: string, defaultValue: unknown) =>
              eventName === 'playingChange' ? { isPlaying: true } : defaultValue
          );

          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });

          expect(getByTestId('feed-item-play-pause-indicator')).toBeTruthy();

          await act(async () => {
            jest.advanceTimersByTime(900);
          });

          expect(queryByTestId('feed-item-play-pause-indicator')).toBeNull();
        } finally {
          jest.useRealTimers();
        }
      });
    });

    describe('generation-safe reseek across a mid-playback source replace (fixes the calm-viewing self-pause)', () => {
      it('preserves the current playback position when the source is replaced mid-playback for the same video, instead of restarting from 0', async () => {
        jest.useFakeTimers();
        try {
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

          const outgoingPlayer = findPlayerByUri('https://media.example.com/first-grant.mp4') as
            | { seekBy: jest.Mock }
            | undefined;

          expect(outgoingPlayer).toBeTruthy();

          // The item has been playing for 123.4s, with its player already
          // confirmed readyToPlay, by the time the proactive refresh fires.
          const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
          (useEvent as jest.Mock).mockImplementation(
            (_player: unknown, eventName: string, defaultValue: unknown) => {
              if (eventName === 'statusChange') {
                return { status: 'readyToPlay', error: undefined };
              }
              if (eventName === 'timeUpdate') {
                return {
                  currentTime: 123.4,
                  currentLiveTimestamp: null,
                  currentOffsetFromLive: null,
                  bufferedPosition: 0,
                };
              }
              return defaultValue;
            }
          );

          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });

          // The scheduled proactive refresh fires (40s grant - 30s margin =
          // 10s in), replacing the player mid-playback.
          await act(async () => {
            await jest.advanceTimersByTimeAsync(10000);
          });

          const incomingPlayer = findPlayerByUri('https://media.example.com/second-grant.mp4') as
            | { seekBy: jest.Mock; currentTime: number; status: string }
            | undefined;

          expect(incomingPlayer).not.toBe(outgoingPlayer);

          // Reconciliation fix (Reviewer A, HIGH 1): the restore waits for
          // the INCOMING player itself to report readyToPlay. The mocked
          // useEvent still (stalely) says 'readyToPlay' - that belongs to
          // the OUTGOING generation and must not count.
          expect(incomingPlayer?.seekBy).not.toHaveBeenCalled();

          incomingPlayer!.status = 'readyToPlay';
          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });

          // seekBy is relative: seeking forward by (last known position -
          // the new player's own currentTime, which starts at 0) lands the
          // new player at 123.4s instead of restarting from the beginning.
          expect(incomingPlayer?.seekBy).toHaveBeenCalledWith(
            123.4 - (incomingPlayer?.currentTime ?? 0)
          );
          // The OUTGOING player is only paused (see the existing HIGH-2
          // test) - it is never the one seeked.
          expect(outgoingPlayer?.seekBy).not.toHaveBeenCalled();
        } finally {
          jest.useRealTimers();
        }
      });

      it('never fires the restore against a source-replaced player that is still loading - a stale readyToPlay from the outgoing generation must not count', async () => {
        // Final-reconciliation regression (Reviewer A, HIGH 1): `useEvent`
        // keeps its last value across a player swap (it only re-subscribes;
        // it never resets state), so at the swap commit `status` still reads
        // the OUTGOING player's 'readyToPlay'. Seeking then targets a player
        // whose async source load has only just started - on iOS, `seekBy`
        // bypasses expo-video's while-replacing deferral entirely (it goes
        // straight to AVPlayer.seek, and there is no currentItem yet), so
        // the restore was silently lost and the clip restarted at 0:00.
        jest.useFakeTimers();
        try {
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

          const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
          (useEvent as jest.Mock).mockImplementation(
            (_player: unknown, eventName: string, defaultValue: unknown) => {
              if (eventName === 'statusChange') {
                // The stale snapshot: the OLD generation's last event.
                return { status: 'readyToPlay', error: undefined };
              }
              if (eventName === 'timeUpdate') {
                return {
                  currentTime: 123.4,
                  currentLiveTimestamp: null,
                  currentOffsetFromLive: null,
                  bufferedPosition: 0,
                };
              }
              return defaultValue;
            }
          );

          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });

          await act(async () => {
            await jest.advanceTimersByTimeAsync(10000);
          });

          const incomingPlayer = findPlayerByUri('https://media.example.com/second-grant.mp4') as
            | { seekBy: jest.Mock; currentTime: number; status: string }
            | undefined;

          expect(incomingPlayer).toBeTruthy();
          // The incoming mock player is still 'idle' (the load has not
          // finished) - no seek may have been issued against it, however
          // stale the useEvent snapshot is, and however many renders pass.
          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });
          expect(incomingPlayer?.seekBy).not.toHaveBeenCalled();

          // The moment the INCOMING player itself reports readyToPlay, the
          // pending restore applies - exactly once, at the captured position.
          incomingPlayer!.status = 'readyToPlay';
          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });

          expect(incomingPlayer?.seekBy).toHaveBeenCalledTimes(1);
          expect(incomingPlayer?.seekBy).toHaveBeenCalledWith(
            123.4 - (incomingPlayer?.currentTime ?? 0)
          );

          // And never re-applies on later renders - the pending restore is
          // consumed, not latched.
          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });
          expect(incomingPlayer?.seekBy).toHaveBeenCalledTimes(1);
        } finally {
          jest.useRealTimers();
        }
      });

      it('does not seed a brand-new video\'s freshly-started player with the previous video\'s position', async () => {
        jest.useFakeTimers();
        try {
          const videoA = buildVideo({ id: 'video-a' });
          const videoB = buildVideo({ id: 'video-b' });

          mockGetPlaybackAuthorization.mockResolvedValueOnce(
            buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/video-a.mp4' })
          );

          const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
          (useEvent as jest.Mock).mockImplementation(
            (_player: unknown, eventName: string, defaultValue: unknown) => {
              if (eventName === 'statusChange') {
                return { status: 'readyToPlay', error: undefined };
              }
              if (eventName === 'timeUpdate') {
                return {
                  currentTime: 88,
                  currentLiveTimestamp: null,
                  currentOffsetFromLive: null,
                  bufferedPosition: 0,
                };
              }
              return defaultValue;
            }
          );

          const { rerender } = await renderFeedItem(
            <DramaFeedItem video={videoA} {...baseProps} isActive />
          );

          mockGetPlaybackAuthorization.mockResolvedValueOnce(
            buildPlaybackAuthorization({ playbackUrl: 'https://media.example.com/video-b.mp4' })
          );

          await act(async () => {
            rerender(<DramaFeedItem video={videoB} {...baseProps} isActive />);
          });
          await act(async () => {
            await jest.advanceTimersByTimeAsync(TEST_PLAYBACK_AUTH_SETTLE_MS);
          });

          const videoBPlayer = findPlayerByUri('https://media.example.com/video-b.mp4') as
            | { seekBy: jest.Mock }
            | undefined;

          expect(videoBPlayer).toBeTruthy();
          expect(videoBPlayer?.seekBy).not.toHaveBeenCalled();
        } finally {
          jest.useRealTimers();
        }
      });

      it('does not seek when the player identity is unchanged (status re-confirming readyToPlay is not a swap)', async () => {
        const video = buildVideo();
        const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
        (useEvent as jest.Mock).mockImplementation(
          (_player: unknown, eventName: string, defaultValue: unknown) => {
            if (eventName === 'statusChange') {
              return { status: 'readyToPlay', error: undefined };
            }
            if (eventName === 'timeUpdate') {
              return {
                currentTime: 42,
                currentLiveTimestamp: null,
                currentOffsetFromLive: null,
                bufferedPosition: 0,
              };
            }
            return defaultValue;
          }
        );

        const { rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );

        const player = latestMockPlayer() as unknown as { seekBy: jest.Mock };

        // An unrelated re-render (e.g. a like-count change) with status
        // re-reporting readyToPlay for the SAME player must never re-seek.
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive isLiked />);
        });

        expect(player.seekBy).not.toHaveBeenCalled();
      });
    });

    describe('stress sequences (self-heals to playing, never leaves the settled item stuck paused)', () => {
      it('A: cold open with async auth - poster is visible immediately, no permanent paused gap once ready', async () => {
        jest.useFakeTimers();
        try {
          const { useEvent } = jest.requireMock<typeof import('expo')>('expo');
          (useEvent as jest.Mock).mockImplementation(
            (_player: unknown, eventName: string, defaultValue: unknown) =>
              eventName === 'statusChange'
                ? { status: 'loading', error: undefined }
                : defaultValue
          );

          const video = buildVideo();
          const { getByTestId, queryByTestId, rerender } = await renderFeedItem(
            <DramaFeedItem video={video} {...baseProps} isActive />
          );

          // Black-screen fix: a real poster, not a black frame, from the
          // very first render.
          expect(getByTestId('feed-item-poster')).toBeTruthy();
          // Visibly-paused fix: no false "tap to resume" affordance while
          // starting.
          expect(queryByTestId('feed-item-play-pause-indicator')).toBeNull();

          const player = latestPlayer();

          player.play.mockClear();

          (useEvent as jest.Mock).mockImplementation(
            (_player: unknown, eventName: string, defaultValue: unknown) =>
              eventName === 'statusChange'
                ? { status: 'readyToPlay', error: undefined }
                : defaultValue
          );

          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });

          expect(player.play).toHaveBeenCalled();
        } finally {
          jest.useRealTimers();
        }
      });

      it('C: an unrelated feed rerender (e.g. a like-count change) while playing does not pause the active player', async () => {
        const video = buildVideo();
        const { rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );

        const player = latestPlayer();

        player.playing = true;
        player.pause.mockClear();

        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive likeCount={99999} />);
        });
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive isMuted />);
        });

        expect(player.pause).not.toHaveBeenCalled();
      });

      it('D: a transient active flip (paging momentum) never leaves the settled item stuck paused, and never plays two players at once', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
          const video = buildVideo();
          const { rerender } = await renderFeedItem(
            <DramaFeedItem video={video} {...baseProps} isActive />
          );

          const player = latestPlayer();

          expect(player.play).toHaveBeenCalled();
          player.playing = true;
          player.play.mockClear();

          // A corrective scrollToOffset transiently flips this item out of
          // (and back into) the active slot.
          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive={false} />);
          });

          expect(player.pause).toHaveBeenCalled();
          player.playing = false;

          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });

          // Self-heals: the settled state is playing again, not stuck.
          expect(player.play).toHaveBeenCalled();
          expect(
            consoleErrorSpy.mock.calls.some((call) => call[0] === '[PlaybackInvariantViolation]')
          ).toBe(false);
        } finally {
          consoleErrorSpy.mockRestore();
        }
      });

      it('E: backgrounding while manually paused does not resume on foreground - user intent survives the app lifecycle', async () => {
        const appStateListeners: ((state: string) => void)[] = [];
        const addListenerSpy = jest
          .spyOn(AppState, 'addEventListener')
          .mockImplementation(((_event: string, listener: (state: string) => void) => {
            appStateListeners.push(listener);
            return { remove: jest.fn() };
          }) as never);

        try {
          const video = buildVideo();
          const { getByTestId, rerender } = await renderFeedItem(
            <DramaFeedItem video={video} {...baseProps} isActive />
          );

          const player = latestPlayer();

          player.playing = true;
          await act(async () => {
            rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
          });

          await act(async () => {
            fireEvent.press(getByTestId('feed-item-play-pause'));
          });

          expect(player.pause).toHaveBeenCalled();
          player.play.mockClear();

          await act(async () => {
            appStateListeners.forEach((listener) => listener('background'));
          });
          await act(async () => {
            appStateListeners.forEach((listener) => listener('active'));
          });

          // Foregrounding alone must not override the explicit user pause.
          expect(player.play).not.toHaveBeenCalled();
        } finally {
          addListenerSpy.mockRestore();
        }
      });

      it('F: an unrelated update while manually paused leaves it paused through reconciliation', async () => {
        const video = buildVideo();
        const { getByTestId, rerender } = await renderFeedItem(
          <DramaFeedItem video={video} {...baseProps} isActive />
        );

        const player = latestPlayer();

        player.playing = true;
        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive />);
        });
        await act(async () => {
          fireEvent.press(getByTestId('feed-item-play-pause'));
        });

        player.playing = false;
        player.play.mockClear();

        await act(async () => {
          rerender(<DramaFeedItem video={video} {...baseProps} isActive isSaved />);
        });

        expect(player.play).not.toHaveBeenCalled();
      });
    });
  });
});

/**
 * AUTO CLEAR DISPLAY ON IDLE (feat/clear-display-idle-v2).
 *
 * These are integration tests through the real ownership shape: the harness
 * below owns clear-display state exactly the way Home does (via
 * `useClearDisplayState`), so tap -> hide -> restore -> countdown cycles and
 * swipe generations run against the production wiring, not a re-mock of it.
 * Timer mechanics in isolation live in use-auto-clear-display-idle.test.tsx.
 */
function AutoClearHarness({
  videos,
  activeVideoId,
  isScreenFocused = true,
}: {
  readonly videos: readonly Video[];
  readonly activeVideoId: string;
  readonly isScreenFocused?: boolean;
}) {
  const { isClearDisplay, setClearDisplay } = useClearDisplayState(activeVideoId);

  return (
    <>
      {videos.map((video) => (
        <DramaFeedItem
          key={video.id}
          video={video}
          {...baseProps}
          isActive={video.id === activeVideoId}
          isScreenFocused={isScreenFocused}
          isClearDisplay={isClearDisplay}
          onToggleClearDisplay={setClearDisplay}
        />
      ))}
    </>
  );
}

describe('auto clear display on idle', () => {
  const KEBAB_TEST_ID = 'feed-item-playback-settings';
  const SURFACE_TEST_ID = 'feed-item-clear-display-surface';

  beforeEach(() => {
    // This is a TOP-LEVEL describe - the `DramaFeedItem` describe's own
    // beforeEach does not apply here, so every cross-cutting default it
    // arms has to be re-armed explicitly (relying on sticky return values
    // from earlier tests would make this block order-dependent and break
    // `-t` filtered runs).
    jest.useFakeTimers();
    resetPlaybackInvariantForTests();
    resetPlaybackOwnershipForTests();
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((() => ({ remove: jest.fn() })) as never);
    // Sticky across tests unless re-armed (clearMocks clears calls, not
    // implementations): the screen-reader case below flips this to true,
    // and every test after it would silently run with the passive
    // countdown disabled - the chrome would just never hide.
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'isAccessibilityServiceEnabled').mockResolvedValue(false);
    mockUseEntitlement.mockReturnValue({ isPremium: false, refresh: jest.fn() });
    mockIsHlsPlaybackEnabled.mockReturnValue(true);
    (
      jest.requireMock<typeof import('@/services/demo/demo-mode')>('@/services/demo/demo-mode')
        .isDemoMode as jest.Mock
    ).mockReturnValue(false);
    (
      jest.requireMock<typeof import('@/services/auth/token-store')>('@/services/auth/token-store')
        .getTokens as jest.Mock
    ).mockReturnValue({ accessToken: 'test-access-token', refreshToken: 'test-refresh' });
    mockGetPlaybackAuthorization.mockImplementation((videoId: string) =>
      Promise.resolve(
        buildPlaybackAuthorization({ playbackUrl: `https://media.example.com/${videoId}.mp4` })
      )
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function mediaUriFor(videoId: string) {
    return `https://media.example.com/${videoId}.mp4`;
  }

  /**
   * Renders the harness with one video, resolves its (cold-mount, exempt
   * from the settle debounce) playback authorization, and confirms real
   * frames are advancing - the state the idle countdown requires.
   */
  async function renderPlayingItem(videoOverrides: Partial<Video> = {}) {
    const video = buildVideo(videoOverrides);
    const view = await renderFeedItem(
      <AutoClearHarness videos={[video]} activeVideoId={video.id} />
    );
    const player = findPlayerByUri(mediaUriFor(video.id))! as unknown as {
      play: jest.Mock;
      pause: jest.Mock;
      seekBy: jest.Mock;
      playing: boolean;
      currentTime: number;
      rateWrites: number[];
    };

    player.playing = true;
    await act(async () => {
      view.rerender(<AutoClearHarness videos={[video]} activeVideoId={video.id} />);
    });

    return { video, view, player };
  }

  async function advanceIdleTime(ms: number) {
    await act(async () => {
      await jest.advanceTimersByTimeAsync(ms);
    });
  }

  describe('basic countdown', () => {
    it('keeps chrome visible before the threshold and hides it exactly at the threshold', async () => {
      const { view } = await renderPlayingItem();

      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });

    it('is purely presentational: player identity, commands, position, speed and authorization are untouched', async () => {
      const { view, player } = await renderPlayingItem();
      const authCallsBeforeHide = mockGetPlaybackAuthorization.mock.calls.length;

      player.play.mockClear();
      player.pause.mockClear();
      player.seekBy.mockClear();
      const positionBeforeHide = player.currentTime;

      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();

      // Same player instance for the same source - never a new generation.
      expect(findPlayerByUri(mediaUriFor('video-1'))).toBe(player);
      // No playback commands of any kind from the auto-hide.
      expect(player.play).not.toHaveBeenCalled();
      expect(player.pause).not.toHaveBeenCalled();
      expect(player.seekBy).not.toHaveBeenCalled();
      expect(player.currentTime).toBe(positionBeforeHide);
      expect(player.rateWrites).toEqual([]);
      // ZERO additional authorization requests - UI visibility is not an
      // authorization event.
      expect(mockGetPlaybackAuthorization.mock.calls.length).toBe(authCallsBeforeHide);
    });

    it('hides exactly once - hidden chrome stays hidden without further toggle churn', async () => {
      // Controlled variant so the number of toggle calls is observable.
      const video = buildVideo();
      const onToggleClearDisplay = jest.fn();
      const { rerender } = await renderFeedItem(
        <DramaFeedItem
          video={video}
          {...baseProps}
          isClearDisplay={false}
          onToggleClearDisplay={onToggleClearDisplay}
        />
      );
      const player = findPlayerByUri(mediaUriFor(video.id))! as unknown as { playing: boolean };

      player.playing = true;
      await act(async () => {
        rerender(
          <DramaFeedItem
            video={video}
            {...baseProps}
            isClearDisplay={false}
            onToggleClearDisplay={onToggleClearDisplay}
          />
        );
      });

      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS);
      expect(onToggleClearDisplay).toHaveBeenCalledTimes(1);
      expect(onToggleClearDisplay).toHaveBeenCalledWith(true, 'auto');

      // Parent applies the hide; from here the item is ineligible and the
      // timer must never re-arm.
      await act(async () => {
        rerender(
          <DramaFeedItem
            video={video}
            {...baseProps}
            isClearDisplay
            onToggleClearDisplay={onToggleClearDisplay}
          />
        );
      });
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);

      expect(onToggleClearDisplay).toHaveBeenCalledTimes(1);
    });

    it('never starts a countdown while the video is only buffering (not yet watchable)', async () => {
      const video = buildVideo();
      const view = await renderFeedItem(
        <AutoClearHarness videos={[video]} activeVideoId={video.id} />
      );

      // Authorized and intending to play, but the player has never reported
      // real frames (playing stays false - cold start/buffering).
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);

      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();
    });

    it('suspends the countdown on a mid-stream player error, independent of event ordering', async () => {
      // Review fix cycle 1 (Reviewer A, MEDIUM 1): a player-level error on
      // an already-playing source must stop the countdown even if the
      // native `playingChange: false` event were delayed or lost - the
      // predicate states `status !== 'error'` directly rather than
      // assuming the two events arrive in lockstep.
      const { view, player } = await renderPlayingItem();

      await advanceIdleTime(1500);

      // The stream dies mid-playback; simulate the worst ordering, where
      // status flips to error while `playing` still (staleley) reads true.
      (player as unknown as { status: string }).status = 'error';
      const video = buildVideo();
      await act(async () => {
        view.rerender(<AutoClearHarness videos={[video]} activeVideoId={video.id} />);
      });

      // The kebab is gone for the ERROR reason (hasPlaybackError unmounts
      // it) - what must NOT happen is clear display engaging on top of the
      // error UI. The title is chrome that still renders during an error,
      // so it is the observable: it stays present (i.e. not accessibility-
      // hidden by clear display) far past the threshold.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);
      expect(view.queryByText(video.title)).not.toBeNull();
    });

    it('never lets the chrome vanish under a held, uncommitted two-finger pinch', async () => {
      // Review fix cycle 1 (Reviewer A MEDIUM 2 / Reviewer B M1): two
      // fingers resting on the glass are the opposite of idle.
      const { view } = await renderPlayingItem();
      const container = view.root!;
      const twoTouches = [
        { pageX: 100, pageY: 300 },
        { pageX: 160, pageY: 360 },
      ];

      await advanceIdleTime(1500);

      // Two fingers land and HOLD - the spread never crosses the
      // activation ratio, so the pinch never commits.
      await act(async () => {
        container.props.onStartShouldSetResponderCapture({
          nativeEvent: { touches: twoTouches },
        });
      });

      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      // Fingers lift without committing: a fresh, full countdown begins.
      await act(async () => {
        container.props.onResponderRelease();
      });

      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });

    it('a denied two-finger responder grant can never permanently disable the idle countdown', async () => {
      // Final-reconciliation regression (Reviewer A, MEDIUM 2): two fingers
      // land while the enclosing FlatList is mid-drag. The capture handler
      // runs (this view is on the touch path) and latches the pinch flag,
      // but the ScrollView - as current responder that has observed
      // scrolling - refuses the termination request, so the grant is
      // DENIED: React Native delivers onResponderReject, and neither
      // onResponderRelease nor onResponderTerminate ever fires on this
      // view. Without a reject handler the latch stayed true for the rest
      // of the item's mounted life, silently disabling auto clear-display.
      const { view } = await renderPlayingItem();
      const container = view.root!;
      const twoTouches = [
        { pageX: 100, pageY: 300 },
        { pageX: 160, pageY: 360 },
      ];

      await act(async () => {
        container.props.onStartShouldSetResponderCapture({
          nativeEvent: { touches: twoTouches },
        });
      });

      await act(async () => {
        container.props.onResponderReject?.();
      });

      // The rejected negotiation over, the countdown must arm again: the
      // chrome hides after one full idle delay, exactly as if the denied
      // gesture had never happened.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });
  });

  describe('manual tap interplay', () => {
    it('visible + tap hides immediately; hidden + tap restores and starts a FRESH full countdown', async () => {
      const { view } = await renderPlayingItem();

      await act(async () => {
        fireEvent.press(view.getByTestId(SURFACE_TEST_ID));
      });
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();

      await act(async () => {
        fireEvent.press(view.getByTestId(SURFACE_TEST_ID));
      });
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });

    it('a stale pre-tap timer can never fire early after the chrome is restored', async () => {
      const { view } = await renderPlayingItem();

      // 1.5s into the original countdown, hide manually and restore.
      await advanceIdleTime(1500);
      await act(async () => {
        fireEvent.press(view.getByTestId(SURFACE_TEST_ID));
      });
      await act(async () => {
        fireEvent.press(view.getByTestId(SURFACE_TEST_ID));
      });

      // The ORIGINAL timer would have fired 1.5s from now. If it leaked,
      // the chrome would vanish here - it must not.
      await advanceIdleTime(1500);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      // The fresh countdown completes a full delay after the restore.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1500);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });

    it('a rail interaction (Like) restarts the countdown from zero', async () => {
      const { view } = await renderPlayingItem();

      await advanceIdleTime(2000);
      await act(async () => {
        fireEvent.press(view.getByLabelText('Like'));
      });

      // 2s already elapsed before the tap; without the reset the chrome
      // would hide 1s from now.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });
  });

  describe('pause', () => {
    it('a paused video keeps its controls up indefinitely; resume restarts the countdown from zero', async () => {
      const { view, player } = await renderPlayingItem();

      await advanceIdleTime(1500);

      // The viewer taps pause. (The mock player's `playing` does not flip
      // itself - mirror what the native player would report.)
      await act(async () => {
        fireEvent.press(view.getAllByTestId('feed-item-play-pause')[0]);
      });
      expect(player.pause).toHaveBeenCalled();
      player.playing = false;
      const { video } = { video: buildVideo() };
      await act(async () => {
        view.rerender(<AutoClearHarness videos={[video]} activeVideoId={video.id} />);
      });

      // Far beyond the threshold: paused controls must remain visible.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      // Resume.
      await act(async () => {
        fireEvent.press(view.getAllByTestId('feed-item-play-pause')[0]);
      });
      expect(player.play).toHaveBeenCalled();
      player.playing = true;
      await act(async () => {
        view.rerender(<AutoClearHarness videos={[video]} activeVideoId={video.id} />);
      });

      // Fresh, full countdown - never the pre-pause remainder.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });
  });

  describe('playback settings sheet', () => {
    it('an open sheet suspends auto-hide entirely; closing it starts a fresh countdown', async () => {
      const { view } = await renderPlayingItem();

      await advanceIdleTime(1500);
      await act(async () => {
        fireEvent.press(view.getByTestId(KEBAB_TEST_ID));
      });

      // The menu must never disappear from under the viewer's finger.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);
      expect(view.queryByTestId('playback-settings-sheet')).not.toBeNull();
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await act(async () => {
        fireEvent.press(view.getByTestId('playback-settings-scrim'));
      });

      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });

    it('selecting a speed keeps the sheet up, writes only the rate, and never triggers a surprise hide', async () => {
      const { view, player } = await renderPlayingItem();

      await act(async () => {
        fireEvent.press(view.getByTestId(KEBAB_TEST_ID));
      });
      await act(async () => {
        fireEvent.press(view.getByLabelText('Kecepatan 1.5x'));
      });

      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);
      expect(view.queryByTestId('playback-settings-sheet')).not.toBeNull();
      expect(player.rateWrites).toEqual([1.5]);
      expect(player.pause).not.toHaveBeenCalled();

      await act(async () => {
        fireEvent.press(view.getByTestId('playback-settings-scrim'));
      });
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });
  });

  describe('swipe / active-item generations', () => {
    const videoA = () => buildVideo();
    const videoB = () => buildVideo({ id: 'video-2', title: 'Episode 2' });

    it("A's timer dies on swipe; B starts visible with its OWN fresh countdown", async () => {
      const videos = [videoA(), videoB()];
      const view = await renderFeedItem(
        <AutoClearHarness videos={videos} activeVideoId="video-1" />
      );
      const playerA = findPlayerByUri(mediaUriFor('video-1'))! as unknown as { playing: boolean };

      playerA.playing = true;
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-1" />);
      });

      // 1.5s into A's countdown, swipe to B.
      await advanceIdleTime(1500);
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-2" />);
      });

      // B lands, waits out the settle debounce, authorizes, and starts
      // playing.
      await advanceIdleTime(TEST_PLAYBACK_AUTH_SETTLE_MS);
      const playerB = findPlayerByUri(mediaUriFor('video-2'))! as unknown as { playing: boolean };

      playerB.playing = true;
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-2" />);
      });

      // A's original timer would fire at t=3000 total - 1100ms from now.
      // If it leaked, the shared clear-display state would hide B's chrome.
      await advanceIdleTime(1100);
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(2);

      // B's own countdown started when B became watchable (1100ms ago), so
      // it completes 1900ms from now.
      await advanceIdleTime(1900);
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(0);
    });

    it('an auto-hidden display un-clears on swipe, and A -> B -> A gives A a fresh generation', async () => {
      const videos = [videoA(), videoB()];
      const view = await renderFeedItem(
        <AutoClearHarness videos={videos} activeVideoId="video-1" />
      );
      const playerA = findPlayerByUri(mediaUriFor('video-1'))! as unknown as { playing: boolean };

      playerA.playing = true;
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-1" />);
      });

      // A idles out.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS);
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(0);

      // Swipe to B: an AUTO clear is not an expressed intent, so the next
      // video starts with visible chrome.
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-2" />);
      });
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(2);

      await advanceIdleTime(TEST_PLAYBACK_AUTH_SETTLE_MS);
      const playerB = findPlayerByUri(mediaUriFor('video-2'))! as unknown as { playing: boolean };

      playerB.playing = true;
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-2" />);
      });

      // 1s into B's countdown, swipe back to A.
      await advanceIdleTime(1000);
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-1" />);
      });
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(2);

      // Neither B's cancelled timer (2s remaining) nor any older A-era
      // timer may fire; only A's OWN fresh countdown - a full delay from
      // the swipe-back - hides the chrome.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(2);

      await advanceIdleTime(1);
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(0);
    });

    it('a fast A -> B -> C transit never authorizes, times, or hides on behalf of the pass-through item', async () => {
      const videos = [videoA(), videoB(), buildVideo({ id: 'video-3', title: 'Episode 3' })];
      const view = await renderFeedItem(
        <AutoClearHarness videos={videos} activeVideoId="video-1" />
      );
      const playerA = findPlayerByUri(mediaUriFor('video-1'))! as unknown as { playing: boolean };

      playerA.playing = true;
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-1" />);
      });

      await advanceIdleTime(1000);
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-2" />);
      });
      // B is only in transit: 100ms < the settle window.
      await advanceIdleTime(100);
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-3" />);
      });
      await advanceIdleTime(TEST_PLAYBACK_AUTH_SETTLE_MS);

      // The transit item never authorized at all.
      expect(mockGetPlaybackAuthorization).not.toHaveBeenCalledWith('video-2');

      const playerC = findPlayerByUri(mediaUriFor('video-3'))! as unknown as { playing: boolean };

      playerC.playing = true;
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-3" />);
      });

      // Advance past every A/B-era ghost threshold: nothing may hide.
      await advanceIdleTime(1500);
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(3);

      // C's own countdown (1500ms already elapsed) completes and hides.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1500);
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(0);
    });
  });

  describe('app lifecycle', () => {
    it('backgrounding cancels the countdown; foregrounding starts a fresh one', async () => {
      const appStateListeners: ((state: string) => void)[] = [];

      jest.spyOn(AppState, 'addEventListener').mockImplementation(((
        _event: string,
        listener: (state: string) => void
      ) => {
        appStateListeners.push(listener);
        return { remove: jest.fn() };
      }) as never);

      const { view } = await renderPlayingItem();

      await advanceIdleTime(1500);
      await act(async () => {
        appStateListeners.forEach((listener) => listener('background'));
      });

      // A timer expiring in the background must not mutate the UI.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await act(async () => {
        appStateListeners.forEach((listener) => listener('active'));
      });

      // Fresh countdown, never "remaining time while backgrounded".
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });

    it('unmount cancels the countdown - no late callback, no state update after unmount', async () => {
      const video = buildVideo();
      const onToggleClearDisplay = jest.fn();
      const { rerender, unmount } = await renderFeedItem(
        <DramaFeedItem
          video={video}
          {...baseProps}
          isClearDisplay={false}
          onToggleClearDisplay={onToggleClearDisplay}
        />
      );
      const player = findPlayerByUri(mediaUriFor(video.id))! as unknown as { playing: boolean };

      player.playing = true;
      await act(async () => {
        rerender(
          <DramaFeedItem
            video={video}
            {...baseProps}
            isClearDisplay={false}
            onToggleClearDisplay={onToggleClearDisplay}
          />
        );
      });

      await advanceIdleTime(1500);
      await act(async () => {
        unmount();
      });
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);

      expect(onToggleClearDisplay).not.toHaveBeenCalled();
    });
  });

  describe('fullscreen', () => {
    it('fullscreen suspends the countdown; returning to the feed restarts it fresh', async () => {
      const { view, player } = await renderPlayingItem({ width: 1280, height: 720 });

      await advanceIdleTime(1500);
      await act(async () => {
        mockLatestVideoViewProps.onFullscreenEnter?.();
      });

      // No stale idle action during the whole fullscreen stay.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();
      expect(player.pause).not.toHaveBeenCalled();

      await act(async () => {
        mockLatestVideoViewProps.onFullscreenExit?.();
      });

      // Deterministic on return: chrome visible, fresh full countdown.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      await advanceIdleTime(1);
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });
  });

  describe('accessibility', () => {
    it('a running screen reader disables the passive countdown without touching manual clear display', async () => {
      jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);

      const { view } = await renderPlayingItem();

      // The passive timer never removes UI from under assistive focus.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS * 10);
      expect(view.queryByTestId(KEBAB_TEST_ID)).not.toBeNull();

      // Manual clear display remains fully available.
      await act(async () => {
        fireEvent.press(view.getByTestId(SURFACE_TEST_ID));
      });
      expect(view.queryByTestId(KEBAB_TEST_ID)).toBeNull();
    });

    it('the chrome keeps its existing accessibility labels', async () => {
      const { view } = await renderPlayingItem();

      expect(view.getByLabelText('Mute')).toBeTruthy();
      expect(view.getByLabelText('Like')).toBeTruthy();
      expect(view.getByLabelText('Save')).toBeTruthy();
      expect(view.getByLabelText('Share')).toBeTruthy();
      expect(view.getByLabelText('Pengaturan pemutaran')).toBeTruthy();
      expect(view.getByLabelText('Sembunyikan kontrol')).toBeTruthy();
    });

    it('auto-hidden chrome leaves NO ghost controls in the accessibility tree', async () => {
      // Review fix cycle 1 (Reviewer B, C1): opacity-0 chrome previously
      // stayed focusable for VoiceOver/TalkBack - invisible controls a
      // screen-reader user could land on and activate. RNTL queries respect
      // accessibility hiding, so absence here is absence from the a11y tree.
      const { video, view } = await renderPlayingItem();

      expect(view.queryByLabelText('Like')).not.toBeNull();
      expect(view.queryByText(video.title)).not.toBeNull();

      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS);

      expect(view.queryByLabelText('Like')).toBeNull();
      expect(view.queryByLabelText('Share')).toBeNull();
      expect(view.queryByLabelText('Mute')).toBeNull();
      expect(view.queryByText(video.title)).toBeNull();
    });
  });

  describe('stress sequence', () => {
    it('interaction -> menu -> close -> swipe: only the CURRENT generation ever changes state', async () => {
      const videos = [buildVideo(), buildVideo({ id: 'video-2', title: 'Episode 2' })];
      const view = await renderFeedItem(
        <AutoClearHarness videos={videos} activeVideoId="video-1" />
      );
      const playerA = findPlayerByUri(mediaUriFor('video-1'))! as unknown as {
        playing: boolean;
        pause: jest.Mock;
      };

      playerA.playing = true;
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-1" />);
      });

      // t+1.5s: a rail interaction resets the countdown.
      await advanceIdleTime(1500);
      await act(async () => {
        fireEvent.press(view.getAllByLabelText('Like')[0]);
      });

      // t+2.5s: the viewer opens the Playback Settings sheet...
      await advanceIdleTime(1000);
      await act(async () => {
        fireEvent.press(view.getAllByTestId(KEBAB_TEST_ID)[0]);
      });

      // ...and reads it for 5s. Nothing may hide, under any earlier timer.
      await advanceIdleTime(5000);
      expect(view.queryByTestId('playback-settings-sheet')).not.toBeNull();
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(2);

      // Close the sheet; 1s of the fresh countdown elapses.
      await act(async () => {
        fireEvent.press(view.getByTestId('playback-settings-scrim'));
      });
      await advanceIdleTime(1000);
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(2);

      // Swipe to B; B settles, authorizes, and starts playing.
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-2" />);
      });
      await advanceIdleTime(TEST_PLAYBACK_AUTH_SETTLE_MS);
      const playerB = findPlayerByUri(mediaUriFor('video-2'))! as unknown as { playing: boolean };

      playerB.playing = true;
      await act(async () => {
        view.rerender(<AutoClearHarness videos={videos} activeVideoId="video-2" />);
      });

      // Every ghost threshold from the A era (post-like, post-close) falls
      // inside this window; none may act.
      await advanceIdleTime(AUTO_CLEAR_DISPLAY_DELAY_MS - 1);
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(2);

      // Only B's CURRENT countdown hides the chrome.
      await advanceIdleTime(1);
      expect(view.queryAllByTestId(KEBAB_TEST_ID)).toHaveLength(0);

      // And the whole sequence issued exactly the two legitimate
      // authorization requests - one per genuinely-landed video.
      const authorizedIds = mockGetPlaybackAuthorization.mock.calls.map(
        ([videoId]: [string]) => videoId
      );

      expect(authorizedIds).toEqual(['video-1', 'video-2']);
    });
  });
});
