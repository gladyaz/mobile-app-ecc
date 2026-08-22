import { resolveRequestedAlignment } from '@/utils/feed-alignment';

const VIDEO_IDS = ['video-1', 'video-2', 'video-3', 'video-4', 'video-5', 'video-6'];
const PAGE_EXTENT = 1204;

describe('resolveRequestedAlignment', () => {
  it('reports nothing to do when no episode was requested', () => {
    // Arrange / Act
    const alignment = resolveRequestedAlignment({
      requestedVideoId: undefined,
      videoIds: VIDEO_IDS,
      pageExtent: PAGE_EXTENT,
    });

    // Assert
    expect(alignment).toEqual({ status: 'none' });
  });

  it('resolves the target from the video identity, never from the episode number', () => {
    // The catalog is deliberately NOT ordered by episode number here: the
    // requested id sits at index 1 while its episode number is 3. Anything
    // that derived a position from the number would land on index 2.
    const shuffled = ['video-9', 'video-ep3', 'video-4'];

    const alignment = resolveRequestedAlignment({
      requestedVideoId: 'video-ep3',
      videoIds: shuffled,
      pageExtent: PAGE_EXTENT,
    });

    expect(alignment).toEqual({
      status: 'ready',
      videoId: 'video-ep3',
      index: 1,
      offset: 1 * PAGE_EXTENT,
    });
  });

  it('computes the offset from the measured page extent, not from any other height', () => {
    // Arrange: episode 6 is index 5.
    const alignment = resolveRequestedAlignment({
      requestedVideoId: 'video-6',
      videoIds: VIDEO_IDS,
      pageExtent: PAGE_EXTENT,
    });

    // Assert: exactly index x extent, so the item's top edge meets the
    // viewport's top edge and the feed can never rest between two videos.
    expect(alignment).toEqual({
      status: 'ready',
      videoId: 'video-6',
      index: 5,
      offset: 6020,
    });
  });

  it('waits while the catalog has not arrived yet', () => {
    const alignment = resolveRequestedAlignment({
      requestedVideoId: 'video-6',
      videoIds: [],
      pageExtent: PAGE_EXTENT,
    });

    expect(alignment).toEqual({ status: 'pending', reason: 'catalog', videoId: 'video-6' });
  });

  it('waits while the feed viewport has not been measured yet', () => {
    // The whole defect this module exists to prevent: an unmeasured viewport
    // must produce NO target at all, rather than a target derived from a
    // stand-in height.
    const alignment = resolveRequestedAlignment({
      requestedVideoId: 'video-6',
      videoIds: VIDEO_IDS,
      pageExtent: null,
    });

    expect(alignment).toEqual({ status: 'pending', reason: 'viewport', videoId: 'video-6' });
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'treats a degenerate page extent (%p) as not yet measured',
    (pageExtent) => {
      const alignment = resolveRequestedAlignment({
        requestedVideoId: 'video-6',
        videoIds: VIDEO_IDS,
        pageExtent,
      });

      expect(alignment).toEqual({ status: 'pending', reason: 'viewport', videoId: 'video-6' });
    }
  );

  it('reports an episode that is absent from a loaded catalog as unavailable', () => {
    // Bounded: a request that can never be satisfied must not stay pending
    // forever, or it would block every later re-alignment.
    const alignment = resolveRequestedAlignment({
      requestedVideoId: 'video-404',
      videoIds: VIDEO_IDS,
      pageExtent: PAGE_EXTENT,
    });

    expect(alignment).toEqual({ status: 'unavailable', videoId: 'video-404' });
  });

  it('aligns the first item to offset 0', () => {
    const alignment = resolveRequestedAlignment({
      requestedVideoId: 'video-1',
      videoIds: VIDEO_IDS,
      pageExtent: PAGE_EXTENT,
    });

    expect(alignment).toEqual({ status: 'ready', videoId: 'video-1', index: 0, offset: 0 });
  });
});
