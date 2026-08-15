import {
  buildDiscoverCards,
  filterDiscoverCardsByCategory,
  formatCompactCount,
  formatLikeTotal,
  rankDiscoverCards,
  translateCategory,
} from '@/features/discover/discover-catalog';
import { DEFAULT_LANGUAGE, translations } from '@/services/i18n/translations';
import type { Translate } from '@/stores/language';
import type { CatalogSeries } from '@/types/series-catalog';

const t = ((key: string, params?: Record<string, string | number>) =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    translations[DEFAULT_LANGUAGE][key as keyof (typeof translations)['id']]
  )) as Translate;

/** Canonical backend title - no "- Episode 1" suffix anywhere. */
const CANONICAL_TITLE = 'Malapetaka Datang: Benteng Bergerakku';

function buildSeries(overrides: Partial<CatalogSeries> = {}): CatalogSeries {
  return {
    id: 'series-104',
    title: CANONICAL_TITLE,
    coverUrl: 'https://cdn.example.com/series-104.jpg',
    category: 'Action',
    sourceLanguage: 'zh',
    episodeCount: 10,
    totalLikes: 716,
    hasPremiumEpisodes: true,
    ...overrides,
  };
}

/** Backend response order: the New tab presents it as-is. */
const catalog: readonly CatalogSeries[] = [
  buildSeries(),
  buildSeries({ id: 'series-010', title: 'Kue Gulung Kaya Raya', category: 'Comedy', totalLikes: 714 }),
  buildSeries({ id: 'series-101', title: 'Hidup Bahagiaku', category: 'Romance', totalLikes: 714 }),
  buildSeries({ id: 'series-105', title: 'Hati Yin yang Jahat', category: 'Drama', totalLikes: 714 }),
];

describe('buildDiscoverCards', () => {
  it('renders the canonical backend title verbatim', () => {
    const [card] = buildDiscoverCards(catalog);

    expect(card.title).toBe(CANONICAL_TITLE);
    expect(card.title).not.toMatch(/Episode/);
  });

  it('produces exactly one card per series, in backend order', () => {
    expect(buildDiscoverCards(catalog).map((card) => card.seriesId)).toEqual([
      'series-104',
      'series-010',
      'series-101',
      'series-105',
    ]);
  });

  it('takes every field from the authoritative series, never a representative episode', () => {
    const [card] = buildDiscoverCards(catalog);

    expect(card.posterUrl).toBe('https://cdn.example.com/series-104.jpg');
    expect(card.category).toBe('Action');
    expect(card.episodeCount).toBe(10);
    // The backend aggregate, used as-is: no client-side re-summing.
    expect(card.likeCount).toBe(716);
    expect(card.hasPremiumEpisodes).toBe(true);
  });

  it('exposes no invented fields, and no channelName the contract lacks', () => {
    const [card] = buildDiscoverCards(catalog);

    expect(Object.keys(card).sort()).toEqual([
      'badges',
      'category',
      'episodeCount',
      'hasPremiumEpisodes',
      'likeCount',
      'posterUrl',
      'seriesId',
      'title',
    ]);
  });

  it('keeps a null cover as null so the branded fallback can take over', () => {
    const [card] = buildDiscoverCards([buildSeries({ coverUrl: null })]);

    expect(card.posterUrl).toBeNull();
  });

  it('keeps a null category as null instead of guessing one', () => {
    const [card] = buildDiscoverCards([buildSeries({ category: null })]);

    expect(card.category).toBeNull();
  });

  it('flags Premium from the backend aggregate alone', () => {
    expect(buildDiscoverCards([buildSeries()])[0].badges).toContain('Premium');
    expect(
      buildDiscoverCards([buildSeries({ hasPremiumEpisodes: false })])[0].badges
    ).not.toContain('Premium');
  });

  it('awards Hot only to a series that clearly leads the catalog median', () => {
    const cards = buildDiscoverCards([
      buildSeries({ id: 'a', totalLikes: 50_000 }),
      buildSeries({ id: 'b', totalLikes: 200 }),
      buildSeries({ id: 'c', totalLikes: 200 }),
    ]);

    expect(cards[0].badges).toContain('Hot');
    expect(cards[1].badges).not.toContain('Hot');
  });

  it('awards Hot to no one on the real, flat catalog', () => {
    // Live totals 716/714/714/714: lower median 714, threshold 1428.
    expect(buildDiscoverCards(catalog).every((card) => !card.badges.includes('Hot'))).toBe(true);
  });

  it('awards Hot to no one when the catalog has barely any likes', () => {
    const cards = buildDiscoverCards([
      buildSeries({ id: 'a', totalLikes: 1 }),
      buildSeries({ id: 'b', totalLikes: 0 }),
      buildSeries({ id: 'c', totalLikes: 0 }),
    ]);

    expect(cards.every((card) => !card.badges.includes('Hot'))).toBe(true);
  });

  it('awards Hot to at most three series', () => {
    const cards = buildDiscoverCards(
      [9000, 8000, 7000, 6000, 100, 100, 100, 100, 100].map((totalLikes, index) =>
        buildSeries({ id: `h-${index}`, totalLikes })
      )
    );

    expect(cards.filter((card) => card.badges.includes('Hot'))).toHaveLength(3);
  });

  it('returns an empty catalog for an empty response', () => {
    expect(buildDiscoverCards([])).toEqual([]);
  });
});

describe('rankDiscoverCards', () => {
  it('ranks by the backend totalLikes aggregate', () => {
    const ranked = rankDiscoverCards(buildDiscoverCards(catalog));

    expect(ranked[0].seriesId).toBe('series-104');
    expect(ranked[0].likeCount).toBe(716);
  });

  it('does not mutate the catalog order it was given', () => {
    const cards = buildDiscoverCards(catalog);

    rankDiscoverCards(cards);

    expect(cards[0].seriesId).toBe('series-104');
  });
});

describe('filterDiscoverCardsByCategory', () => {
  it('returns every card for "All", including one with no category', () => {
    const cards = buildDiscoverCards([...catalog, buildSeries({ id: 'x', category: null })]);

    expect(filterDiscoverCardsByCategory(cards, 'All')).toHaveLength(5);
  });

  it('narrows to one category without re-ordering', () => {
    const cards = buildDiscoverCards(catalog);

    expect(filterDiscoverCardsByCategory(cards, 'Comedy').map((c) => c.seriesId)).toEqual([
      'series-010',
    ]);
  });

  it('excludes a null-category series from a specific chip without reassigning it', () => {
    const cards = buildDiscoverCards([buildSeries({ id: 'x', category: null })]);

    expect(filterDiscoverCardsByCategory(cards, 'Romance')).toHaveLength(0);
    expect(filterDiscoverCardsByCategory(cards, 'All')).toHaveLength(1);
  });
});

describe('display helpers', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [12_800, '12.8K'],
    [1_500_000, '1.5M'],
  ])('formats %s as %s', (value, expected) => {
    expect(formatCompactCount(value)).toBe(expected);
  });

  it('always labels the ranking metric as a total', () => {
    expect(formatLikeTotal(t, 98_560)).toBe('98.6K suka total');
  });

  it('localizes a category label without touching the filter value', () => {
    expect(translateCategory(t, 'Romance')).toBe(translations.id['discover.categoryRomance']);
  });
});
