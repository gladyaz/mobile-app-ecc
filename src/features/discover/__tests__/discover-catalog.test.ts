import { DEFAULT_LANGUAGE, translations } from '@/services/i18n/translations';
import type { Translate } from '@/stores/language';
import {
  buildDiscoverCards,
  filterDiscoverCardsByCategory,
  formatCompactCount,
  formatLikeTotal,
  rankDiscoverCards,
} from '@/features/discover/discover-catalog';
import type { Video } from '@/types/video';

function buildVideo(overrides: Partial<Video> & Pick<Video, 'id' | 'seriesId'>): Video {
  return {
    storageKey: `key-${overrides.id}`,
    playbackUrl: `https://media.example.com/${overrides.id}.mp4`,
    thumbnailUrl: `https://cdn.example.com/${overrides.id}.jpg`,
    title: 'Kontrak Cinta CEO Dingin',
    episodeNumber: 1,
    channelName: 'Mandarin Drama ID',
    category: 'CEO',
    sourceLanguage: 'Mandarin',
    hasEmbeddedIndonesianSubtitle: true,
    processingStatus: 'completed',
    caption: 'Pertemuan pertama yang mengubah hidup Lin Yue.',
    likeCount: 100,
    isSaved: false,
    // Real content by default; a case that needs a fixture says so.
    contentKind: 'drama',
    ...overrides,
  };
}

/**
 * Catalog order below is a, b, c, d - the order `/videos/feed` returned. Like
 * totals: a = 600, b = 200, c = 200, d = 0, so the catalog median is 200 and
 * only `a` clears the Hot threshold (2x median).
 */
const feedVideos: readonly Video[] = [
  ...[1, 2, 3, 4, 5, 6].map((episodeNumber) =>
    buildVideo({
      id: `a-ep-${episodeNumber}`,
      seriesId: 'series-a',
      episodeNumber,
      title: 'Kontrak Cinta CEO Dingin',
      likeCount: 100,
    })
  ),
  buildVideo({
    id: 'b-ep-1',
    seriesId: 'series-b',
    title: 'Zeta Drama',
    category: 'Romance',
    likeCount: 200,
  }),
  buildVideo({
    id: 'c-ep-1',
    seriesId: 'series-c',
    title: 'Alpha Drama',
    category: 'Revenge',
    likeCount: 200,
  }),
  buildVideo({
    id: 'd-ep-1',
    seriesId: 'series-d',
    title: 'Drama Tanpa Suka',
    category: 'Family',
    likeCount: 0,
  }),
];

const resolveBackendLikeCount = (video: Video) => video.likeCount;

describe('buildDiscoverCards', () => {
  it('keeps the catalog order the backend returned', () => {
    const cards = buildDiscoverCards(feedVideos, resolveBackendLikeCount);

    expect(cards.map((card) => card.seriesId)).toEqual([
      'series-a',
      'series-b',
      'series-c',
      'series-d',
    ]);
  });

  it('derives episode count and like total from real feed fields only', () => {
    const cards = buildDiscoverCards(feedVideos, resolveBackendLikeCount);
    const seriesA = cards[0];

    expect(seriesA.episodeCount).toBe(6);
    expect(seriesA.likeCount).toBe(600);
    expect(seriesA.title).toBe('Kontrak Cinta CEO Dingin');
    expect(seriesA.category).toBe('CEO');
    expect(seriesA.posterUrl).toBe('https://cdn.example.com/a-ep-1.jpg');
  });

  it('exposes no invented backend fields', () => {
    const [card] = buildDiscoverCards(feedVideos, resolveBackendLikeCount);

    expect(Object.keys(card).sort()).toEqual([
      'badges',
      'category',
      'channelName',
      'episodeCount',
      'hasPremiumEpisodes',
      'likeCount',
      'posterUrl',
      'seriesId',
      'title',
    ]);
  });

  it('flags Premium only for a series that actually has a premium episode', () => {
    const cards = buildDiscoverCards(feedVideos, resolveBackendLikeCount);
    const seriesA = cards[0];
    const seriesB = cards[1];

    expect(seriesA.hasPremiumEpisodes).toBe(true);
    expect(seriesA.badges).toContain('Premium');
    expect(seriesB.hasPremiumEpisodes).toBe(false);
    expect(seriesB.badges).not.toContain('Premium');
  });

  it('awards Hot only to series that clearly lead the catalog median', () => {
    const cards = buildDiscoverCards(feedVideos, resolveBackendLikeCount);
    const hotSeriesIds = cards
      .filter((card) => card.badges.includes('Hot'))
      .map((card) => card.seriesId);

    // series-b and series-c are 2nd and 3rd by likes but only match the
    // median, so a top-3 position alone does not earn the badge.
    expect(hotSeriesIds).toEqual(['series-a']);
  });

  it('awards Hot to no one when every series is roughly as popular', () => {
    const cards = buildDiscoverCards(
      ['p', 'q', 'r', 's', 't'].map((suffix) =>
        buildVideo({
          id: `${suffix}-ep-1`,
          seriesId: `series-${suffix}`,
          title: `Drama ${suffix}`,
          likeCount: 1000,
        })
      ),
      resolveBackendLikeCount
    );

    expect(cards.every((card) => card.badges.length === 0)).toBe(true);
  });

  it('awards Hot to a clear leader on a two-series catalog', () => {
    const cards = buildDiscoverCards(
      [
        buildVideo({ id: 'm-ep-1', seriesId: 'series-m', title: 'Memimpin', likeCount: 12_000 }),
        buildVideo({ id: 'n-ep-1', seriesId: 'series-n', title: 'Tertinggal', likeCount: 500 }),
      ],
      resolveBackendLikeCount
    );

    expect(cards[0].badges).toContain('Hot');
    expect(cards[1].badges).not.toContain('Hot');
  });

  it('awards Hot to no one when the catalog slopes gently', () => {
    const cards = buildDiscoverCards(
      [6000, 5000, 4000, 3000, 2000].map((likeCount, index) =>
        buildVideo({
          id: `slope-${index}-ep-1`,
          seriesId: `series-slope-${index}`,
          title: `Drama Slope ${index}`,
          likeCount,
        })
      ),
      resolveBackendLikeCount
    );

    // Nothing stands out here, so nothing claims to be hot - the top series
    // leads the median by 1.5x, under the 2x gate.
    expect(cards.every((card) => !card.badges.includes('Hot'))).toBe(true);
  });

  it('awards Hot to no one on a catalog with barely any likes yet', () => {
    // Fresh backend, no likes anywhere, then the viewer likes one episode.
    // A median of 0 must not turn that single like into a Hot badge.
    const cards = buildDiscoverCards(
      ['p', 'q', 'r', 's', 't'].map((suffix) =>
        buildVideo({
          id: `${suffix}-ep-1`,
          seriesId: `series-${suffix}`,
          title: `Drama ${suffix}`,
          likeCount: 0,
        })
      ),
      (video) => (video.id === 'p-ep-1' ? 1 : 0)
    );

    expect(cards[0].likeCount).toBe(1);
    expect(cards.every((card) => !card.badges.includes('Hot'))).toBe(true);
  });

  it('still awards Hot to a clear leader on a mostly-unliked catalog', () => {
    const cards = buildDiscoverCards(
      [50_000, 0, 0, 0, 0].map((likeCount, index) =>
        buildVideo({
          id: `sparse-${index}-ep-1`,
          seriesId: `series-sparse-${index}`,
          title: `Drama Sparse ${index}`,
          likeCount,
        })
      ),
      resolveBackendLikeCount
    );

    expect(cards[0].badges).toContain('Hot');
    expect(cards.filter((card) => card.badges.includes('Hot'))).toHaveLength(1);
  });

  it('awards Hot to at most three series even when many lead the median', () => {
    const cards = buildDiscoverCards(
      [9000, 8000, 7000, 6000, 100, 100, 100, 100, 100].map((likeCount, index) =>
        buildVideo({
          id: `h-${index}-ep-1`,
          seriesId: `series-h-${index}`,
          title: `Drama H${index}`,
          likeCount,
        })
      ),
      resolveBackendLikeCount
    );

    expect(cards.filter((card) => card.badges.includes('Hot'))).toHaveLength(3);
  });

  it('never awards Hot to a series with no likes, even inside the top three', () => {
    const cards = buildDiscoverCards(
      [
        buildVideo({ id: 'x-ep-1', seriesId: 'series-x', title: 'Banyak Suka', likeCount: 50_000 }),
        buildVideo({ id: 'y-ep-1', seriesId: 'series-y', title: 'Sedikit Suka', likeCount: 100 }),
        buildVideo({ id: 'z-ep-1', seriesId: 'series-z', title: 'Tanpa Suka', likeCount: 0 }),
      ],
      resolveBackendLikeCount
    );

    // All three are in the top three of a three-series catalog, so only the
    // like threshold can keep the unliked one unbadged.
    expect(cards[0].badges).toContain('Hot');
    expect(cards[1].badges).not.toContain('Hot');
    expect(cards[2].badges).not.toContain('Hot');
  });

  it('includes the locally liked video in the like total', () => {
    const resolveWithLocalLike = (video: Video) =>
      video.likeCount + (video.id === 'b-ep-1' ? 1 : 0);
    const cards = buildDiscoverCards(feedVideos, resolveWithLocalLike);

    expect(cards[1].likeCount).toBe(201);
  });

  it('returns an empty catalog for an empty feed', () => {
    expect(buildDiscoverCards([], resolveBackendLikeCount)).toEqual([]);
  });
});

describe('rankDiscoverCards', () => {
  it('ranks by like count and breaks ties deterministically by title', () => {
    const cards = buildDiscoverCards(feedVideos, resolveBackendLikeCount);

    expect(rankDiscoverCards(cards).map((card) => card.seriesId)).toEqual([
      'series-a',
      'series-c',
      'series-b',
      'series-d',
    ]);
  });

  it('does not mutate the catalog order it was given', () => {
    const cards = buildDiscoverCards(feedVideos, resolveBackendLikeCount);

    rankDiscoverCards(cards);

    expect(cards.map((card) => card.seriesId)).toEqual([
      'series-a',
      'series-b',
      'series-c',
      'series-d',
    ]);
  });
});

describe('filterDiscoverCardsByCategory', () => {
  it('returns every card for "All"', () => {
    const cards = buildDiscoverCards(feedVideos, resolveBackendLikeCount);

    expect(filterDiscoverCardsByCategory(cards, 'All')).toHaveLength(4);
  });

  it('narrows to one category without re-ordering', () => {
    const cards = buildDiscoverCards(feedVideos, resolveBackendLikeCount);

    expect(filterDiscoverCardsByCategory(cards, 'Romance').map((card) => card.seriesId)).toEqual([
      'series-b',
    ]);
  });
});


describe('formatCompactCount', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [12_800, '12.8K'],
    [1_500_000, '1.5M'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatCompactCount(value)).toBe(expected);
  });
});

describe('formatLikeTotal', () => {
  // Resolved through the real Indonesian copy rather than a stub, so this
  // still asserts the shipped wording - the point of the case is that the
  // metric says "total", never a bare count that could read as views.
  const t: Translate = (key, params) =>
    Object.entries(params ?? {}).reduce(
      (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
      translations[DEFAULT_LANGUAGE][key]
    );

  it('always labels the metric as a total, never as a bare count', () => {
    expect(formatLikeTotal(t, 98_560)).toBe('98.6K suka total');
  });
});
