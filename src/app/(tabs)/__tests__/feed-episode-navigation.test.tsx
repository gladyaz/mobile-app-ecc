import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Dimensions, FlatList } from 'react-native';

import HomeScreen from '@/app/(tabs)/index';
import { VideoCatalogProvider } from '@/features/videos/video-catalog-provider';
import { getVideoFeed } from '@/services/videos/video-service';
import { AuthProvider } from '@/stores/auth';
import { EntitlementProvider } from '@/stores/entitlement';
import { LanguageProvider } from '@/stores/language';
import { SeriesProgressProvider } from '@/stores/series-progress';
import { ToastProvider } from '@/stores/toast';
import { VideoInteractionsProvider } from '@/stores/video-interactions';
import type { Video } from '@/types/video';

/**
 * SERIES DETAIL -> FEED EPISODE NAVIGATION (2026-08-22 physical-QA
 * remediation).
 *
 * The defect these cases lock down: selecting an episode on Series Detail
 * returned to the feed and scrolled by `index x <window height>`, while the
 * feed's real page is `index x <viewport height>` - the window MINUS the
 * in-flow tab bar. On the reported device that is 1600 vs 1470, so episode 6
 * was asked for at 8000px when its page starts at 7350px: the list came to
 * rest 650px into the wrong region, showing part of two episodes with
 * neither passing the 80% viewability threshold, so the active item stayed
 * wherever it had been.
 *
 * Everything below therefore asserts against the MEASURED viewport and
 * against video identity - never a device coordinate and never an episode
 * number.
 */

// The gap between the window and the feed's own box on the reported device:
// the tab bar the tabs navigator lays out in flow beneath this screen. Only
// used to build a viewport that DIFFERS from the window, so a computation
// that reached for the window height would be visible as a wrong offset.
const TAB_BAR_HEIGHT = 130;
const WINDOW_HEIGHT = Dimensions.get('window').height;
const VIEWPORT_HEIGHT = WINDOW_HEIGHT - TAB_BAR_HEIGHT;

let mockParams: { videoId?: string; videoRequestId?: string } = {};

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), navigate: jest.fn(), back: jest.fn() },
  useIsFocused: () => true,
  useLocalSearchParams: () => mockParams,
}));

jest.mock('expo-symbols', () => ({ SymbolView: 'SymbolView' }));

jest.mock('@/services/ads/ad-controller', () => ({
  onVideoTransition: jest.fn(),
  recordVideoWatched: jest.fn(),
}));

jest.mock('@/services/analytics/analytics-queue', () => ({ trackEvent: jest.fn() }));

jest.mock('@/services/videos/video-service', () => ({ getVideoFeed: jest.fn() }));

// The player, its gate and its chrome are covered by
// `components/__tests__/drama-feed-item.test.tsx`. Here it reports the three
// things this screen decides for it: which item is active, how tall a feed
// page is, and which access tier reached it.
jest.mock('@/components/drama-feed-item', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactModule = require('react');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: RNText, View: RNView } = require('react-native');

  return {
    DramaFeedItem: ({
      video,
      isActive,
      height,
    }: {
      video: Video;
      isActive: boolean;
      height: number;
    }) =>
      ReactModule.createElement(
        RNView,
        { testID: `feed-item-${video.id}` },
        ReactModule.createElement(
          RNText,
          { testID: `active-${video.id}` },
          isActive ? 'active' : 'inactive'
        ),
        ReactModule.createElement(RNText, { testID: `height-${video.id}` }, String(height)),
        ReactModule.createElement(RNText, { testID: `tier-${video.id}` }, video.accessTier)
      ),
  };
});

/**
 * Eight episodes of one series. Episode 6 is PREMIUM and episode 2 is FREE -
 * the inverse of the historical episode-number rule - so a case that lands on
 * episode 6 also proves positioning does not quietly re-derive, filter or
 * gate on the tier.
 */
const FEED = Array.from({ length: 8 }, (_unused, index) => ({
  id: `video-${index + 1}`,
  seriesId: 'series-x',
  storageKey: `processed/ep-${index + 1}.mp4`,
  playbackUrl: `https://media.example.com/ep-${index + 1}.mp4`,
  thumbnailUrl: `https://cdn.example.com/ep-${index + 1}.jpg`,
  title: 'Series X',
  episodeNumber: index + 1,
  channelName: 'Channel',
  category: 'CEO',
  sourceLanguage: 'Mandarin',
  hasEmbeddedIndonesianSubtitle: true,
  processingStatus: 'ready',
  caption: 'caption',
  likeCount: 1,
  commentCount: 0,
  shareCount: 0,
  durationSeconds: 60,
  createdAt: '2026-01-01T00:00:00.000Z',
  contentKind: 'drama',
  accessTier: index + 1 === 6 ? 'premium' : 'free',
})) as unknown as readonly Video[];

const mockedGetVideoFeed = getVideoFeed as jest.MockedFunction<typeof getVideoFeed>;

function renderFeed() {
  return render(
    <LanguageProvider>
      <ToastProvider>
        <AuthProvider>
          <EntitlementProvider>
            <VideoCatalogProvider>
              <VideoInteractionsProvider>
                <SeriesProgressProvider>
                  <HomeScreen />
                </SeriesProgressProvider>
              </VideoInteractionsProvider>
            </VideoCatalogProvider>
          </EntitlementProvider>
        </AuthProvider>
      </ToastProvider>
    </LanguageProvider>
  );
}

function buildScrollEvent(offsetY: number) {
  return { nativeEvent: { contentOffset: { x: 0, y: offsetY } } };
}

/**
 * The feed's own box, which is the window MINUS the tab bar below it.
 *
 * `fireEvent()` in this testing-library version is itself a thenable that
 * flushes pending effects (matching `render()` - see the analogous note in
 * guest-first-entry.test.tsx), so every call site awaits it.
 */
async function measureViewport(getByTestId: (id: string) => unknown, height = VIEWPORT_HEIGHT) {
  await fireEvent(getByTestId('feed-viewport') as never, 'layout', {
    nativeEvent: { layout: { width: 390, height, x: 0, y: 0 } },
  });
}

let scrollToOffset: jest.SpyInstance;
let scrollToIndex: jest.SpyInstance;

beforeEach(() => {
  mockParams = {};
  mockedGetVideoFeed.mockResolvedValue(FEED);
  scrollToOffset = jest
    .spyOn(FlatList.prototype, 'scrollToOffset')
    .mockImplementation(() => undefined);
  scrollToIndex = jest
    .spyOn(FlatList.prototype, 'scrollToIndex')
    .mockImplementation(() => undefined);
});

describe('series detail -> feed episode navigation', () => {
  it('lands on the exact requested episode 3, aligned to the measured viewport', async () => {
    // Arrange: the route the Series Detail episode row pushes.
    mockParams = { videoId: 'video-3', videoRequestId: 'req-1' };

    // Act
    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    // Assert: one scroll, to episode 3's own page - index 2 x the viewport
    // that was actually measured.
    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: 2 * VIEWPORT_HEIGHT,
        animated: false,
      });
    });
    expect(getByTestId('active-video-3').props.children).toBe('active');
    expect(getByTestId('active-video-1').props.children).toBe('inactive');
  });

  it('lands on a later PREMIUM episode exactly, without touching its authorization', async () => {
    // Arrange: episode 6 is the premium one in this fixture.
    mockParams = { videoId: 'video-6', videoRequestId: 'req-1' };

    // Act
    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    // Assert: the same alignment a free episode gets - positioning neither
    // gates nor filters - and the backend tier still reaches the item that
    // owns the gate.
    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: 5 * VIEWPORT_HEIGHT,
        animated: false,
      });
    });
    expect(getByTestId('active-video-6').props.children).toBe('active');
    expect(getByTestId('tier-video-6').props.children).toBe('premium');
    expect(getByTestId('tier-video-2').props.children).toBe('free');
  });

  it('never uses the window height for the target offset', async () => {
    // The defect itself: `index x window` instead of `index x viewport` put
    // episode 6 exactly TAB_BAR_HEIGHT x 5 too far down the list.
    mockParams = { videoId: 'video-6', videoRequestId: 'req-1' };

    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalled();
    });

    const offsets = scrollToOffset.mock.calls.map(([params]) => params.offset);

    expect(offsets).not.toContain(5 * WINDOW_HEIGHT);
    expect(offsets).toEqual([5 * VIEWPORT_HEIGHT]);
  });

  it('resolves the target by video identity, not by episode number', async () => {
    // Arrange: a catalog whose ORDER does not follow the episode numbers,
    // which is what any position-from-number shortcut would assume.
    const shuffled = [FEED[4], FEED[0], FEED[2]];

    mockedGetVideoFeed.mockResolvedValue(shuffled);
    mockParams = { videoId: 'video-3', videoRequestId: 'req-1' };

    // Act
    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-3')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    // Assert: video-3 sits at index 2 here even though it is episode 3 of a
    // series - the id decides, so the offset is 2 x extent either way. Its
    // NEIGHBOUR video-1 is episode 1 at index 1, which is what makes this
    // discriminating.
    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: 2 * VIEWPORT_HEIGHT,
        animated: false,
      });
    });
    expect(getByTestId('active-video-3').props.children).toBe('active');
  });

  it('does not scroll before the feed data has arrived', async () => {
    // Arrange: the route reaches Home first - a cold deep link, or a fast
    // tap while the catalog request is still open.
    let resolveFeed: (videos: readonly Video[]) => void = () => undefined;

    mockedGetVideoFeed.mockReturnValue(
      new Promise<readonly Video[]>((resolve) => {
        resolveFeed = resolve;
      })
    );
    mockParams = { videoId: 'video-6', videoRequestId: 'req-1' };

    // Act
    const { getByTestId, queryByTestId } = await renderFeed();

    // Assert: nothing to align to yet.
    expect(queryByTestId('feed-item-video-1')).toBeNull();
    expect(scrollToOffset).not.toHaveBeenCalled();

    // Act: the catalog lands, then layout is measured.
    resolveFeed(FEED);

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    // Assert: exactly one alignment, at the right page.
    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
    });
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 5 * VIEWPORT_HEIGHT,
      animated: false,
    });
  });

  it('does not scroll before the feed viewport has been measured', async () => {
    // The direct guard on the reported root cause: with data present but no
    // measurement yet, the only height available is the window - and using it
    // is precisely the bug.
    mockParams = { videoId: 'video-6', videoRequestId: 'req-1' };

    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(scrollToIndex).not.toHaveBeenCalled();

    await measureViewport(getByTestId);

    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
    });
  });

  it('issues exactly one alignment scroll, with no corrective second one', async () => {
    // Arrange
    mockParams = { videoId: 'video-4', videoRequestId: 'req-1' };

    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    // Act: measurement arrives, then the screen re-renders repeatedly the way
    // it does in life (progress ticks, interaction state, a re-measure that
    // reports the SAME height).
    await measureViewport(getByTestId);

    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
    });

    await measureViewport(getByTestId);
    await measureViewport(getByTestId);

    // Assert: no scroll -> re-render -> scroll bounce.
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 3 * VIEWPORT_HEIGHT,
      animated: false,
    });
  });

  it('leaves the feed on a whole page, never between two videos', async () => {
    // Arrange
    mockParams = { videoId: 'video-7', videoRequestId: 'req-1' };

    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalled();
    });

    // Assert: every requested offset is a whole multiple of the page extent,
    // and each item is exactly one page tall - the two conditions that make a
    // partial two-video resting state impossible.
    for (const [params] of scrollToOffset.mock.calls) {
      expect(params.offset % VIEWPORT_HEIGHT).toBe(0);
    }
    expect(getByTestId('height-video-7').props.children).toBe(String(VIEWPORT_HEIGHT));
    expect(getByTestId('active-video-7').props.children).toBe('active');
  });

  it('re-aligns for a NEW selection and ignores the stale one', async () => {
    // Arrange: episode 2 first.
    mockParams = { videoId: 'video-2', videoRequestId: 'req-1' };

    const { getByTestId, rerender } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
    });
    expect(scrollToOffset).toHaveBeenLastCalledWith({
      offset: 1 * VIEWPORT_HEIGHT,
      animated: false,
    });

    // Act: back to Series Detail, then episode 7.
    mockParams = { videoId: 'video-7', videoRequestId: 'req-2' };

    await rerender(
      <LanguageProvider>
        <ToastProvider>
          <AuthProvider>
            <EntitlementProvider>
              <VideoCatalogProvider>
                <VideoInteractionsProvider>
                  <SeriesProgressProvider>
                    <HomeScreen />
                  </SeriesProgressProvider>
                </VideoInteractionsProvider>
              </VideoCatalogProvider>
            </EntitlementProvider>
          </AuthProvider>
        </ToastProvider>
      </LanguageProvider>
    );

    // Assert: the second selection lands on its own episode, once.
    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledTimes(2);
    });
    expect(scrollToOffset).toHaveBeenLastCalledWith({
      offset: 6 * VIEWPORT_HEIGHT,
      animated: false,
    });
    expect(getByTestId('active-video-7').props.children).toBe('active');
    expect(getByTestId('active-video-2').props.children).toBe('inactive');
  });

  it('does not re-align when the same params merely survive a re-render', async () => {
    // A tab switch back to Home re-renders this screen with the params of
    // whatever episode was selected LAST - which must not yank the viewer
    // back to it.
    mockParams = { videoId: 'video-6', videoRequestId: 'req-1' };

    const { getByTestId, rerender } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
    });

    await rerender(
      <LanguageProvider>
        <ToastProvider>
          <AuthProvider>
            <EntitlementProvider>
              <VideoCatalogProvider>
                <VideoInteractionsProvider>
                  <SeriesProgressProvider>
                    <HomeScreen />
                  </SeriesProgressProvider>
                </VideoInteractionsProvider>
              </VideoCatalogProvider>
            </EntitlementProvider>
          </AuthProvider>
        </ToastProvider>
      </LanguageProvider>
    );

    expect(scrollToOffset).toHaveBeenCalledTimes(1);
  });

  it('starts on the first video when no episode was requested', async () => {
    // Arrange / Act: opening Home from the tab bar.
    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    // Assert
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(getByTestId('active-video-1').props.children).toBe('active');
  });
});

describe('feed re-snap after a viewport change', () => {
  it('re-snaps to the ALIGNED episode, not the one that was active before it', async () => {
    // A viewport change (rotation, or returning from native fullscreen)
    // invalidates the resting offset, because it was computed against the old
    // extent. The correction has to target the episode the viewer actually
    // asked for, not whatever was active before the alignment moved them.
    mockParams = { videoId: 'video-6', videoRequestId: 'req-1' };

    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
    });

    // Act: the viewport gets shorter.
    const SHORTER_VIEWPORT = VIEWPORT_HEIGHT - 200;

    await measureViewport(getByTestId, SHORTER_VIEWPORT);

    // Assert: one corrective scroll, on episode 6's page at the NEW extent.
    expect(scrollToOffset).toHaveBeenCalledTimes(2);
    expect(scrollToOffset).toHaveBeenLastCalledWith({
      offset: 5 * SHORTER_VIEWPORT,
      animated: false,
    });
    expect(getByTestId('height-video-6').props.children).toBe(String(SHORTER_VIEWPORT));
  });

  it('does not re-snap on the first measurement, when the list is already at the top', async () => {
    // Arrange / Act: no episode requested, so the feed opens on item 0 - which
    // is offset 0 for any extent, and needs no correction.
    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    // Assert
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('ignores a degenerate zero-height layout pass', async () => {
    // A transient 0 is a layout state, not a page size. Taking it would hand
    // every offset below a meaningless extent.
    mockParams = { videoId: 'video-3', videoRequestId: 'req-1' };

    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId, 0);

    expect(scrollToOffset).not.toHaveBeenCalled();

    await measureViewport(getByTestId);

    // Assert: the alignment waited for a REAL measurement and then used it.
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 2 * VIEWPORT_HEIGHT,
      animated: false,
    });
  });
});

describe('feed paging after episode alignment', () => {
  it('still moves one item per gesture, measured against the real viewport', async () => {
    // Arrange: aligned onto episode 6.
    mockParams = { videoId: 'video-6', videoRequestId: 'req-1' };

    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    await waitFor(() => {
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
    });

    // Act: one hard flick from episode 6 that the platform lets settle two
    // pages further on.
    const list = getByTestId('feed-list');

    await fireEvent(list, 'scrollBeginDrag', buildScrollEvent(5 * VIEWPORT_HEIGHT));
    await fireEvent(list, 'momentumScrollEnd', buildScrollEvent(7 * VIEWPORT_HEIGHT));

    // Assert: corrected back to exactly one item on - the paging contract is
    // unchanged, and it is now computed on the measured page extent.
    expect(scrollToOffset).toHaveBeenCalledTimes(2);
    expect(scrollToOffset).toHaveBeenLastCalledWith({
      offset: 6 * VIEWPORT_HEIGHT,
      animated: false,
    });
  });

  it('leaves an ordinary one-page swipe alone', async () => {
    // Arrange
    const { getByTestId } = await renderFeed();

    await waitFor(() => {
      expect(getByTestId('feed-item-video-1')).toBeTruthy();
    });

    await measureViewport(getByTestId);

    // Act
    const list = getByTestId('feed-list');

    await fireEvent(list, 'scrollBeginDrag', buildScrollEvent(0));
    await fireEvent(list, 'momentumScrollEnd', buildScrollEvent(1 * VIEWPORT_HEIGHT));

    // Assert: no corrective scroll at all.
    expect(scrollToOffset).not.toHaveBeenCalled();
  });
});
