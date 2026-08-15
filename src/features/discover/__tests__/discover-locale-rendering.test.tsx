import { render, within } from '@testing-library/react-native';

import { DiscoverListRow } from '@/features/discover/discover-cards';
import { DiscoverPoster } from '@/features/discover/discover-poster';
import { LANGUAGES, translations, type Language } from '@/services/i18n/translations';
import type { DiscoverSeriesCard } from '@/types/discover';

/**
 * Every other Discover component test renders in the Indonesian fallback,
 * because `useTranslation()` resolves to DEFAULT_LANGUAGE when no provider
 * wraps the tree. That leaves English and Chinese rendering unexercised - the
 * exact gap that lets a half-translated card reach device QA.
 *
 * These cases drive the same components through all three locales. What they
 * genuinely prove is KEY WIRING and interpolation: point a component at the
 * wrong key, drop an interpolation token, or start translating a
 * backend-owned title, and all three locales fail here instead of on a device.
 *
 * What they deliberately do NOT prove: copy quality. The assertions resolve
 * through the same `translations` record the component renders, so a reworded
 * string follows the test. Key PRESENCE is covered by tsc (`Copy` is a total
 * record) and by discover-i18n.test.ts.
 */
let mockLanguage: Language = 'id';
// `mock`-prefixed so the jest factory may close over it; only read when a
// component actually calls t(), which is long after module init.
const mockCopy = translations;

jest.mock('@/stores/language', () => ({
  useTranslation: () => ({
    language: mockLanguage,
    setLanguage: jest.fn(),
    t: (key: string, params?: Record<string, string | number>) =>
      Object.entries(params ?? {}).reduce(
        (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
        mockCopy[mockLanguage][key as keyof (typeof mockCopy)['id']]
      ),
  }),
}));

/** A real backend title: it must survive every locale byte-for-byte. */
const BACKEND_TITLE = 'Malapetaka Datang: Benteng Bergerakku - Episode 1';

function buildCard(overrides: Partial<DiscoverSeriesCard> = {}): DiscoverSeriesCard {
  return {
    seriesId: 'series-104',
    title: BACKEND_TITLE,
    posterUrl: 'https://cdn.example.com/series-104.jpg',
    category: 'Romance',
    episodeCount: 10,
    likeCount: 716,
    hasPremiumEpisodes: true,
    badges: ['Premium', 'Hot'],
    ...overrides,
  };
}

afterEach(() => {
  mockLanguage = 'id';
});

describe.each(LANGUAGES)('Discover rendered in %s', (language) => {
  const copy = translations[language];

  beforeEach(() => {
    mockLanguage = language;
  });

  it('renders the access badge in this language', async () => {
    const { getByTestId } = await render(<DiscoverPoster card={buildCard()} variant="grid" />);

    expect(
      within(getByTestId('discover-poster-series-104')).getByText(copy['discover.badgePremium'])
    ).toBeTruthy();
  });

  it('renders the editorial badge in this language on an unranked grid poster', async () => {
    const { getByText } = await render(<DiscoverPoster card={buildCard()} variant="grid" />);

    expect(getByText(copy['discover.badgeHot'])).toBeTruthy();
  });

  it('renders the rank pill in this language', async () => {
    const { getByText } = await render(
      <DiscoverPoster card={buildCard()} rank={1} variant="grid" />
    );

    expect(getByText(copy['discover.rankPill'].replace('{rank}', '1'))).toBeTruthy();
  });

  it('renders the episode pill in this language', async () => {
    const { getByText } = await render(<DiscoverPoster card={buildCard()} variant="grid" />);

    expect(getByText(copy['discover.episodePill'].replace('{count}', '10'))).toBeTruthy();
  });

  it('renders the localized category and episode count on a row', async () => {
    const { getByText } = await render(<DiscoverListRow card={buildCard()} onPress={jest.fn()} />);

    const expectedMeta = `${copy['discover.categoryRomance']} · ${copy[
      'discover.episodeCount'
    ].replace('{count}', '10')}`;

    expect(getByText(expectedMeta)).toBeTruthy();
  });

  it('leaves the backend-owned title untranslated', async () => {
    const { getByText } = await render(<DiscoverListRow card={buildCard()} onPress={jest.fn()} />);

    expect(getByText(BACKEND_TITLE)).toBeTruthy();
  });

  it('announces the card in this language, title verbatim', async () => {
    const { getByLabelText } = await render(<DiscoverListRow card={buildCard()} onPress={jest.fn()} />);

    const label = new RegExp(
      `${BACKEND_TITLE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, ${copy['discover.badgePremium']}`
    );

    expect(getByLabelText(label)).toBeTruthy();
  });

});

describe.each(LANGUAGES)('Discover rank announcement in %s', (language) => {
  const copy = translations[language];

  beforeEach(() => {
    mockLanguage = language;
  });

  it('announces the rank with this locale\'s own phrasing', async () => {
    const { getByLabelText } = await render(
      <DiscoverListRow card={buildCard()} onPress={jest.fn()} rank={4} showLikeCount />
    );

    // `discover.rankA11y` is the only Discover string with a mid-string token
    // ("第 {rank} 名"), so it is the one most likely to break on
    // interpolation.
    expect(getByLabelText(new RegExp(copy['discover.rankA11y'].replace('{rank}', '4')))).toBeTruthy();
  });
});

describe('locale differences that a default-language-only suite cannot see', () => {
  it('gives Chinese its own badge copy rather than falling back to English', () => {
    expect(translations.zh['discover.badgePremium']).not.toBe(
      translations.en['discover.badgePremium']
    );
    expect(translations.zh['discover.badgeHot']).not.toBe(translations.en['discover.badgeHot']);
  });

  it('gives Chinese its own rank-pill form', () => {
    expect(translations.zh['discover.rankPill']).not.toBe(translations.en['discover.rankPill']);
    expect(translations.zh['discover.rankPill']).toContain('{rank}');
  });

  it('localizes every category chip away from the raw filter value in id and zh', () => {
    // The chip label must never be the raw VideoCategory value in a
    // non-English locale - that was the drift this slice fixed.
    expect(translations.id['discover.categoryRomance']).not.toBe('Romance');
    expect(translations.zh['discover.categoryRomance']).not.toBe('Romance');
    expect(translations.en['discover.categoryRomance']).toBe('Romance');
  });
});
