import { groupVideosIntoSeries, getSeriesById } from '@/services/videos/series-service';
import { mapBackendVideoToVideo, type BackendVideoDto } from '@/services/videos/video-mapper';
import { selectUserFacingCatalog } from '@/services/videos/video-service';
import type { Video } from '@/types/video';

/**
 * The content-classification contract (backend commit 91bade9).
 *
 * These cases model the REAL dev catalog: 42 feed rows, 40 `drama` across four
 * series, and the two `qa_fixture` rows the backend keeps on purpose. The
 * fixture ids are the real ones, so a reader can line this file up against the
 * backend's own reconciliation statement.
 */

const QA_FIXTURE_IDS = [
  'media-11rqa-8ac6a7f3',
  'media-54d5a084-bd85-4939-ba60-ab6534916a48',
] as const;

const REAL_SERIES = ['series-101', 'series-104', 'series-010', 'series-105'] as const;

function buildDto(overrides: Partial<BackendVideoDto> = {}): BackendVideoDto {
  return {
    id: 'video-101-01',
    seriesId: 'series-101',
    title: 'Drama Episode',
    episodeNumber: 1,
    channelName: 'VideoDracin Originals',
    caption: 'Episode caption.',
    category: 'romance',
    storageKey: 'Series 101/1_subtitled.mp4',
    playbackUrl: 'https://media.example.com/video-101-01/stream',
    sourceLanguage: 'zh',
    hasEmbeddedIndonesianSubtitle: true,
    likeCount: 10,
    contentKind: 'drama',
    ...overrides,
  };
}

/** 4 series x 10 episodes = the 40 real rows, plus the 2 QA fixtures. */
function buildRealFeed(): readonly BackendVideoDto[] {
  const dramas = REAL_SERIES.flatMap((seriesId) =>
    Array.from({ length: 10 }, (_, index) =>
      buildDto({
        id: `${seriesId}-ep-${index + 1}`,
        seriesId,
        episodeNumber: index + 1,
        storageKey: `${seriesId}/${index + 1}.mp4`,
      })
    )
  );
  const fixtures = QA_FIXTURE_IDS.map((id, index) =>
    buildDto({
      id,
      seriesId: index === 0 ? 'series-11rqa' : '7',
      title: index === 0 ? '11R QA HLS Sample' : 'test-disposable',
      channelName: index === 0 ? 'QA' : 'disposable',
      episodeNumber: 1,
      // Both are R2-backed with an EMPTY local storageKey - the exact shape
      // that makes storage-based inference wrong.
      storageKey: '',
      sourceLanguage: 'id',
      contentKind: 'qa_fixture',
    })
  );

  // Interleaved the way the real feed returns them: the fixtures sit at
  // positions 2 and 3, not conveniently at the end.
  return [dramas[0], ...fixtures, ...dramas.slice(1)];
}

const mapped = (): readonly Video[] => buildRealFeed().map(mapBackendVideoToVideo);

describe('mapBackendVideoToVideo - contentKind', () => {
  it('preserves the backend classification verbatim', () => {
    expect(mapBackendVideoToVideo(buildDto()).contentKind).toBe('drama');
    expect(mapBackendVideoToVideo(buildDto({ contentKind: 'qa_fixture' })).contentKind).toBe(
      'qa_fixture'
    );
  });

  it('never infers the classification from any other field', () => {
    // A row that looks exactly like a QA fixture by every rejected heuristic -
    // QA channel, Indonesian source language, empty storage key, numeric
    // seriesId, no dimensions - but DECLARES itself drama. The declaration
    // must win, or the client is inferring again.
    const looksLikeAFixture = mapBackendVideoToVideo(
      buildDto({
        title: 'test-disposable',
        channelName: 'QA',
        sourceLanguage: 'id',
        storageKey: '',
        seriesId: '7',
        width: undefined,
        height: undefined,
        contentKind: 'drama',
      })
    );

    expect(looksLikeAFixture.contentKind).toBe('drama');
  });

  it('treats a missing or unknown contentKind as a contract error in development', () => {
    // __DEV__ is true under Jest, so the boundary fails loudly rather than
    // quietly changing what the catalog contains.
    expect(__DEV__).toBe(true);
    expect(() =>
      mapBackendVideoToVideo({ ...buildDto(), contentKind: undefined as unknown as string })
    ).toThrow(/contentKind/);
    expect(() => mapBackendVideoToVideo(buildDto({ contentKind: 'trailer' }))).toThrow(
      /contentKind/
    );
  });
});

describe('selectUserFacingCatalog', () => {
  it('keeps every drama row', () => {
    const catalog = selectUserFacingCatalog(mapped());

    expect(catalog).toHaveLength(40);
    expect(catalog.every((video) => video.contentKind === 'drama')).toBe(true);
  });

  it('excludes both QA fixtures', () => {
    const ids = new Set(selectUserFacingCatalog(mapped()).map((video) => video.id));

    for (const id of QA_FIXTURE_IDS) {
      expect(ids.has(id)).toBe(false);
    }
  });

  it('introduces no cap, pagination or slice - only the classification decides', () => {
    const feed = mapped();
    const catalog = selectUserFacingCatalog(feed);
    const dramaCount = feed.filter((video) => video.contentKind === 'drama').length;

    // Exactly the drama rows: nothing truncated, nothing sampled.
    expect(catalog).toHaveLength(dramaCount);
    expect(catalog.map((video) => video.id)).toEqual(
      feed.filter((video) => video.contentKind === 'drama').map((video) => video.id)
    );
  });

  it('preserves backend order among the rows it keeps', () => {
    const feed = mapped();
    const catalog = selectUserFacingCatalog(feed);
    const expectedOrder = feed
      .filter((video) => video.contentKind === 'drama')
      .map((video) => video.id);

    expect(catalog.map((video) => video.id)).toEqual(expectedOrder);
  });

  it('is a no-op on a catalog that contains no fixtures', () => {
    const dramaOnly = mapped().filter((video) => video.contentKind === 'drama');

    expect(selectUserFacingCatalog(dramaOnly)).toHaveLength(dramaOnly.length);
  });
});

describe('surfaces derived from the filtered catalog', () => {
  const catalog = () => selectUserFacingCatalog(mapped());

  it('Home receives all 40 drama episodes', () => {
    // Home renders `videos` straight from the provider - no further filtering
    // - so the catalog IS the Home feed.
    expect(catalog()).toHaveLength(40);
  });

  it('Discover receives exactly the four real series', () => {
    const series = groupVideosIntoSeries(catalog());

    expect(series).toHaveLength(4);
    expect(new Set(series.map((entry) => entry.id))).toEqual(new Set(REAL_SERIES));
    // One card per series, not one per episode.
    expect(series.every((entry) => entry.episodeCount === 10)).toBe(true);
  });

  it('Series Detail exposes every episode of a real series', () => {
    const series = getSeriesById(catalog(), 'series-101');

    expect(series?.episodes).toHaveLength(10);
    expect(series?.episodes.map((episode) => episode.episodeNumber)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('Series Detail cannot reach a QA fixture through the normal catalog', () => {
    // The fixtures' own series ids resolve to nothing once the catalog is
    // filtered, so there is no route to them from a user-facing surface.
    for (const seriesId of ['series-11rqa', '7']) {
      expect(getSeriesById(catalog(), seriesId)).toBeUndefined();
    }

    for (const id of QA_FIXTURE_IDS) {
      expect(catalog().some((video) => video.id === id)).toBe(false);
    }
  });
});
