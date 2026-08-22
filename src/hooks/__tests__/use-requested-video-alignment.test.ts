import { renderHook } from '@testing-library/react-native';
import type { FlatList } from 'react-native';

import { useRequestedVideoAlignment } from '@/hooks/use-requested-video-alignment';

const VIDEO_IDS = ['video-1', 'video-2', 'video-3', 'video-4', 'video-5', 'video-6', 'video-7'];
const PAGE_EXTENT = 1204;

type Params = {
  readonly requestKey?: string;
  readonly requestedVideoId?: string;
  readonly videoIds?: readonly string[];
  readonly pageExtent?: number | null;
};

// `renderHook()` in this testing-library version is itself async (see the
// analogous note in use-feed-paging-guard.test.ts), so every call site awaits
// it before touching `result.current`.
async function setup(initial: Params = {}) {
  const scrollToOffset = jest.fn();
  const onAligned = jest.fn();
  const flatListRef = {
    current: { scrollToOffset } as unknown as FlatList<unknown>,
  };

  const { result, rerender } = await renderHook(
    (params: Params) =>
      useRequestedVideoAlignment({
        flatListRef,
        requestKey: params.requestKey,
        requestedVideoId: params.requestedVideoId,
        videoIds: params.videoIds ?? VIDEO_IDS,
        pageExtent: params.pageExtent === undefined ? PAGE_EXTENT : params.pageExtent,
        onAligned,
      }),
    { initialProps: initial }
  );

  return { result, rerender, scrollToOffset, onAligned };
}

describe('useRequestedVideoAlignment', () => {
  it('does nothing when no episode was requested', async () => {
    // Arrange / Act
    const { result, scrollToOffset, onAligned } = await setup();

    // Assert
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(onAligned).not.toHaveBeenCalled();
    expect(result.current.pendingVideoId).toBeUndefined();
  });

  it('aligns a requested episode with exactly one non-animated scroll to index x extent', async () => {
    // Arrange / Act: episode 6 is index 5.
    const { scrollToOffset, onAligned } = await setup({
      requestKey: 'req-1',
      requestedVideoId: 'video-6',
    });

    // Assert: non-animated, because an animated programmatic scroll travels
    // through every intervening item - firing the platform's momentum events
    // (which the manual-paging guard would then try to correct) and marking
    // each passed episode as watched on the way.
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 5 * PAGE_EXTENT, animated: false });
    expect(onAligned).toHaveBeenCalledTimes(1);
    expect(onAligned).toHaveBeenCalledWith('video-6');
  });

  it('does not scroll again while the same request stays on the route', async () => {
    // Arrange
    const { rerender, scrollToOffset } = await setup({
      requestKey: 'req-1',
      requestedVideoId: 'video-6',
    });

    // Act: the params survive re-renders (a like, a progress tick, a tab
    // switch back to Home) long after the request was satisfied.
    await rerender({ requestKey: 'req-1', requestedVideoId: 'video-6' });
    await rerender({ requestKey: 'req-1', requestedVideoId: 'video-6' });

    // Assert: one selection, one alignment - a stale param can never yank
    // the viewer back to the episode they already left.
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
  });

  it('waits for the catalog, then aligns exactly once', async () => {
    // Arrange: the route arrives before the feed data does.
    const { result, rerender, scrollToOffset } = await setup({
      requestKey: 'req-1',
      requestedVideoId: 'video-6',
      videoIds: [],
    });

    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(result.current.pendingVideoId).toBe('video-6');

    // Act
    await rerender({ requestKey: 'req-1', requestedVideoId: 'video-6', videoIds: VIDEO_IDS });

    // Assert
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 5 * PAGE_EXTENT, animated: false });
    expect(result.current.pendingVideoId).toBeUndefined();
  });

  it('waits for a measured viewport, then aligns once with the measured extent', async () => {
    // Arrange: layout has not been measured yet.
    const { result, rerender, scrollToOffset } = await setup({
      requestKey: 'req-1',
      requestedVideoId: 'video-6',
      pageExtent: null,
    });

    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(result.current.pendingVideoId).toBe('video-6');

    // Act
    await rerender({ requestKey: 'req-1', requestedVideoId: 'video-6', pageExtent: 900 });

    // Assert: the offset uses the height that was actually measured.
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 5 * 900, animated: false });
  });

  it('treats a new request for a different episode as a new alignment', async () => {
    // Arrange
    const { rerender, scrollToOffset, onAligned } = await setup({
      requestKey: 'req-1',
      requestedVideoId: 'video-2',
    });

    // Act: back to Series Detail, then episode 7.
    await rerender({ requestKey: 'req-2', requestedVideoId: 'video-7' });

    // Assert
    expect(scrollToOffset).toHaveBeenNthCalledWith(1, { offset: 1 * PAGE_EXTENT, animated: false });
    expect(scrollToOffset).toHaveBeenNthCalledWith(2, { offset: 6 * PAGE_EXTENT, animated: false });
    expect(onAligned).toHaveBeenNthCalledWith(1, 'video-2');
    expect(onAligned).toHaveBeenNthCalledWith(2, 'video-7');
  });

  it('treats re-selecting the SAME episode as a new alignment', async () => {
    // Arrange: episode 2 selected, then the viewer swipes away from it.
    const { rerender, scrollToOffset } = await setup({
      requestKey: 'req-1',
      requestedVideoId: 'video-2',
    });

    // Act: back to Series Detail and episode 2 again. The video id is
    // identical, so only the per-selection request key can tell this apart
    // from the stale param of the FIRST selection.
    await rerender({ requestKey: 'req-2', requestedVideoId: 'video-2' });

    // Assert
    expect(scrollToOffset).toHaveBeenCalledTimes(2);
    expect(scrollToOffset).toHaveBeenLastCalledWith({ offset: 1 * PAGE_EXTENT, animated: false });
  });

  it('settles a request for an episode that is not in the catalog, without scrolling', async () => {
    // Arrange / Act
    const { result, rerender, scrollToOffset } = await setup({
      requestKey: 'req-1',
      requestedVideoId: 'video-404',
    });

    // Assert: no scroll, and nothing left pending that could block a later
    // re-alignment (a rotation, say).
    expect(scrollToOffset).not.toHaveBeenCalled();
    expect(result.current.pendingVideoId).toBeUndefined();

    await rerender({ requestKey: 'req-1', requestedVideoId: 'video-404' });

    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('reports the pending episode so no other scroll competes with it', async () => {
    // The one consumer of this: the re-snap that follows a viewport change
    // must stand down while an alignment still owes the feed a scroll, or
    // both would fire in the same commit and the last one would win.
    const { result } = await setup({
      requestKey: 'req-1',
      requestedVideoId: 'video-6',
      pageExtent: null,
    });

    expect(result.current.pendingVideoId).toBe('video-6');
  });
});
