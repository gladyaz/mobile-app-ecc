import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Dimensions, StyleSheet } from 'react-native';

import DiscoverScreen from '@/app/(tabs)/discover';
import { DISCOVER_GRID_GAP } from '@/features/discover/use-discover-grid';
import type { Video } from '@/types/video';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const mockUseVideoCatalog = jest.fn();

jest.mock('@/features/videos/video-catalog-provider', () => ({
  useVideoCatalog: () => mockUseVideoCatalog(),
}));

// `expo-video` is deliberately NOT mocked here: Discover must never pull in a
// feed video player, so this test failing to resolve that native module would
// be a real regression signal.
jest.mock('@/stores/video-interactions', () => ({
  useVideoInteractions: () => ({ getLikeCount: (video: Video) => video.likeCount }),
}));

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
    likeCount: 2000,
    isSaved: false,
    // Real content by default; a case that needs a fixture says so.
    contentKind: 'drama',
    ...overrides,
  };
}

const CEO_TITLE = 'Kontrak Cinta CEO Dingin';
const NONA_TITLE = 'Pernikahan Kilat Nona Shen';

/**
 * Catalog order is deliberately the OPPOSITE of like order: the low-like Nona
 * series comes first, exactly as `/videos/feed` returned it. That way a tab
 * that renders catalog order and a tab that renders like order cannot both be
 * satisfied by the same sequence.
 */
const feedVideos: readonly Video[] = [
  buildVideo({
    id: 'nona-ep-1',
    seriesId: 'series-nona-shen',
    title: NONA_TITLE,
    category: 'Romance',
    channelName: 'Drama Harian CN',
    caption: 'Pernikahan palsu mulai terasa terlalu nyata.',
    likeCount: 500,
  }),
  ...[1, 2, 3, 4, 5, 6].map((episodeNumber) =>
    buildVideo({ id: `ceo-ep-${episodeNumber}`, seriesId: 'series-ceo-dingin', episodeNumber })
  ),
];

// Jest is configured with `clearMocks`, which wipes call records but leaves an
// installed spy (and its return value) in place. Without this, the 320pt
// `Dimensions.get` spy below would silently re-lay-out every later test.
afterEach(() => {
  jest.restoreAllMocks();
});

type CatalogOverrides = {
  readonly videos?: readonly Video[];
  readonly isLoading?: boolean;
  readonly error?: Error | null;
};

function mockCatalog(overrides: CatalogOverrides = {}) {
  const refresh = jest.fn();

  mockUseVideoCatalog.mockReturnValue({
    videos: feedVideos,
    isLoading: false,
    error: null,
    refresh,
    ...overrides,
  });

  return refresh;
}

describe('DiscoverScreen sub-navigation', () => {
  it('renders the Home, New and Rankings tabs', async () => {
    mockCatalog();

    const { getByText } = await render(<DiscoverScreen />);

    expect(getByText('Home')).toBeTruthy();
    expect(getByText('New')).toBeTruthy();
    expect(getByText('Rankings')).toBeTruthy();
  });

  it('opens the New tab with its catalog-order disclosure', async () => {
    mockCatalog();

    const { getByText } = await render(<DiscoverScreen />);

    await fireEvent.press(getByText('New'));

    expect(getByText('Urutan Katalog')).toBeTruthy();
    expect(getByText(/urutan katalog yang dikirim server/i)).toBeTruthy();
  });

  it('opens the Rankings tab with Top Hits and the ranking metric stated', async () => {
    mockCatalog();

    const { getByText } = await render(<DiscoverScreen />);

    await fireEvent.press(getByText('Rankings'));

    expect(getByText('Top Hits')).toBeTruthy();
    expect(getByText(/total suka semua episode/i)).toBeTruthy();
  });
});

describe('DiscoverScreen home grid', () => {
  it('renders one poster card per series, not one per episode', async () => {
    mockCatalog();

    const { getByText, getAllByText } = await render(<DiscoverScreen />);

    expect(getAllByText(CEO_TITLE)).toHaveLength(1);
    expect(getByText(NONA_TITLE)).toBeTruthy();
    expect(getByText('6 EP')).toBeTruthy();
  });

  it('marks a series that has premium episodes with the app’s own Premium wording', async () => {
    mockCatalog();

    const { getByText, queryByText } = await render(<DiscoverScreen />);

    expect(getByText('Premium')).toBeTruthy();
    // "VIP" would be a tier name that exists nowhere else in this product.
    expect(queryByText('VIP')).toBeNull();
  });

  it('renders a Hot badge for a series that clearly leads the catalog', async () => {
    mockCatalog({
      videos: [50_000, 100, 100].map((likeCount, index) =>
        buildVideo({
          id: `hot-${index}-ep-1`,
          seriesId: `series-hot-${index}`,
          title: `Drama Hot ${index}`,
          likeCount,
        })
      ),
    });

    const { getAllByText } = await render(<DiscoverScreen />);

    // Exactly one card is badged - the badge is a signal, not decoration.
    expect(getAllByText('Hot')).toHaveLength(1);
  });

  it('navigates to the existing series detail route when a poster is pressed', async () => {
    mockCatalog();

    const { getByText } = await render(<DiscoverScreen />);

    await fireEvent.press(getByText(CEO_TITLE));

    expect(router.push).toHaveBeenCalledWith({
      pathname: '/series/[id]',
      params: { id: 'series-ceo-dingin' },
    });
  });

  it('filters the grid by category and offers a way back to everything', async () => {
    mockCatalog();

    const { getByLabelText, getByText, queryByText } = await render(<DiscoverScreen />);

    await fireEvent.press(getByLabelText('Kategori Romance'));

    expect(getByText(NONA_TITLE)).toBeTruthy();
    expect(queryByText(CEO_TITLE)).toBeNull();

    await fireEvent.press(getByLabelText('Kategori Action'));

    expect(getByText('Kategori ini masih kosong')).toBeTruthy();

    await fireEvent.press(getByText('Tampilkan semua'));

    expect(getByText(CEO_TITLE)).toBeTruthy();
  });

  it('fits two poster columns inside a 320pt phone without overflowing', async () => {
    jest.spyOn(Dimensions, 'get').mockReturnValue({
      width: 320,
      height: 568,
      scale: 2,
      fontScale: 1,
    });
    mockCatalog();

    const { getAllByRole } = await render(<DiscoverScreen />);
    const [firstCard] = getAllByRole('button').filter((node) =>
      cardLabels([node]).length > 0
    );
    const posterWidth = StyleSheet.flatten(firstCard.props.style)?.width as number;

    // 320 - 2*16 padding = 288 available; 2 columns + one 10pt gap.
    expect(posterWidth).toBeCloseTo(139, 5);
    expect(posterWidth * 2 + DISCOVER_GRID_GAP).toBeLessThanOrEqual(288);
  });

  it('clamps a long title to two lines', async () => {
    const longTitle =
      'Kontrak Cinta CEO Dingin yang Menikahi Sekretaris Rahasianya di Malam Bersalju Panjang';

    mockCatalog({
      videos: [buildVideo({ id: 'long-ep-1', seriesId: 'series-long', title: longTitle })],
    });

    const { getByText } = await render(<DiscoverScreen />);

    expect(getByText(longTitle).props.numberOfLines).toBe(2);
  });
});

/** Card labels in render order; unlabelled controls (chips) are excluded. */
function cardLabels(nodes: readonly { props: { accessibilityLabel?: string } }[]): string[] {
  return nodes
    .map((node) => node.props.accessibilityLabel)
    .filter((label): label is string => typeof label === 'string' && label.includes('episode'));
}

/**
 * Carried over from the pre-redesign Discover suite. The screen that shipped
 * before the content hub asserted this exact metadata line on its series
 * card; the redesign changed the surrounding layout but not the promise that
 * a card states its category and episode count from data the client already
 * has - no invented backend field. Keeping the assertion means the redesign
 * had to preserve that, rather than quietly dropping it.
 */
describe('DiscoverScreen series card metadata (preserved from the previous Discover)', () => {
  it('shows the series title with category and episode-count metadata', async () => {
    mockCatalog();

    const { getByText, getAllByText, getByLabelText } = await render(<DiscoverScreen />);

    fireEvent.press(getByText('New'));

    expect(getAllByText(CEO_TITLE).length).toBeGreaterThan(0);
    // The redesign splits the metadata line into separate text nodes, so the
    // old single-string query no longer applies. The card's accessibility
    // label is where the two facts are now guaranteed to travel together -
    // and it is the stricter assertion, because Pressable is accessible by
    // default and this label REPLACES the child text for a screen reader.
    // Six CEO episodes were fed in, grouped onto one series card.
    expect(getByLabelText(/Kontrak Cinta CEO Dingin, CEO, 6 episode/)).toBeTruthy();
    // ...and the category is still visibly rendered on the card itself.
    expect(getAllByText('CEO').length).toBeGreaterThan(0);
  });
});

describe('DiscoverScreen new tab', () => {
  it('lists series in catalog order, not in like order', async () => {
    mockCatalog();

    const { getAllByRole, getByText } = await render(<DiscoverScreen />);

    await fireEvent.press(getByText('New'));

    const rowLabels = cardLabels(getAllByRole('button'));

    // Catalog order puts the less-liked series first; a like-ordered list
    // would invert these two.
    expect(rowLabels[0]).toContain(NONA_TITLE);
    expect(rowLabels[1]).toContain(CEO_TITLE);
  });
});

describe('DiscoverScreen rankings tab', () => {
  it('ranks by like total, inverting catalog order, and prints the metric', async () => {
    mockCatalog();

    const { getAllByRole, getByText } = await render(<DiscoverScreen />);

    await fireEvent.press(getByText('Rankings'));

    const rankedLabels = cardLabels(getAllByRole('button'));

    expect(rankedLabels[0]).toContain('Peringkat 1');
    expect(rankedLabels[0]).toContain(CEO_TITLE);
    expect(rankedLabels[1]).toContain('Peringkat 2');
    expect(rankedLabels[1]).toContain(NONA_TITLE);
    // 6 episodes x 2000 likes summed, and 500 for the single-episode series.
    // The word "total" is part of the claim: it is not a per-episode figure.
    expect(getByText('12.0K suka total')).toBeTruthy();
    expect(getByText('500 suka total')).toBeTruthy();
  });

  it('numbers the ranked rows below Top Hits continuing from the featured cards', async () => {
    const rankedFeed: readonly Video[] = [1, 2, 3, 4, 5].map((index) =>
      buildVideo({
        id: `ranked-${index}-ep-1`,
        seriesId: `series-ranked-${index}`,
        title: `Drama Peringkat ${index}`,
        likeCount: 6000 - index * 1000,
      })
    );

    mockCatalog({ videos: rankedFeed });

    const { getAllByRole, getByText } = await render(<DiscoverScreen />);

    await fireEvent.press(getByText('Rankings'));

    expect(getByText('Peringkat lainnya')).toBeTruthy();

    const rankedLabels = cardLabels(getAllByRole('button'));

    // Three featured cards, then the list rows pick up at 4.
    expect(rankedLabels[3]).toContain('Peringkat 4');
    expect(rankedLabels[3]).toContain('Drama Peringkat 4');
    expect(rankedLabels[4]).toContain('Peringkat 5');
    // The metric is printed on the ranked rows too, not only on the rail.
    expect(getByText('2.0K suka total')).toBeTruthy();
  });
});

describe('DiscoverScreen search', () => {
  it('filters the catalog with the existing in-memory search', async () => {
    mockCatalog();

    const { getByLabelText, getByText, queryByText } = await render(<DiscoverScreen />);

    await fireEvent.changeText(getByLabelText('Cari drama'), 'Nona');

    expect(getByText('1 hasil untuk “Nona”')).toBeTruthy();
    expect(getByText(NONA_TITLE)).toBeTruthy();
    expect(queryByText(CEO_TITLE)).toBeNull();
  });

  it('matches on channel name the same way the previous screen did', async () => {
    mockCatalog();

    const { getByLabelText, getByText } = await render(<DiscoverScreen />);

    await fireEvent.changeText(getByLabelText('Cari drama'), 'Drama Harian');

    expect(getByText(NONA_TITLE)).toBeTruthy();
  });

  it('still matches on an episode caption, and says what search matches on', async () => {
    mockCatalog();

    const { getByLabelText, getByText } = await render(<DiscoverScreen />);

    await fireEvent.changeText(getByLabelText('Cari drama'), 'Pernikahan palsu');

    expect(getByText(NONA_TITLE)).toBeTruthy();
    // A caption hit renders the series poster, so the screen has to explain
    // why a card whose visible text lacks the query is a result.
    expect(getByText(/Dicocokkan dengan judul, deskripsi episode/i)).toBeTruthy();
  });

  it('keeps the selected category applied to the query, as the previous screen did', async () => {
    mockCatalog();

    const { getByLabelText, getByText, queryByText } = await render(<DiscoverScreen />);

    await fireEvent.press(getByLabelText('Kategori Romance'));
    await fireEvent.changeText(getByLabelText('Cari drama'), 'CEO');

    // "CEO" matches the CEO series by title and category, but the Romance
    // filter is still in force and the chips stay visible while searching.
    expect(getByText('Tidak ada hasil')).toBeTruthy();
    expect(queryByText(CEO_TITLE)).toBeNull();
    expect(getByLabelText('Kategori Romance')).toBeTruthy();
  });

  it('leaves search when a sub-tab is selected, so the tab strip never lies', async () => {
    mockCatalog();

    const { getByLabelText, getByText, queryByText } = await render(<DiscoverScreen />);

    await fireEvent.changeText(getByLabelText('Cari drama'), 'Nona');
    await fireEvent.press(getByText('Rankings'));

    expect(getByText('Top Hits')).toBeTruthy();
    expect(queryByText(/hasil untuk/)).toBeNull();
  });

  it('marks no sub-tab as selected while a query is in force', async () => {
    mockCatalog();

    const { getAllByRole, getByLabelText } = await render(<DiscoverScreen />);

    expect(
      getAllByRole('tab').filter((tab) => tab.props.accessibilityState?.selected)
    ).toHaveLength(1);

    await fireEvent.changeText(getByLabelText('Cari drama'), 'Nona');

    // The body is now search results, so no tab may claim to be the one shown.
    expect(
      getAllByRole('tab').filter((tab) => tab.props.accessibilityState?.selected)
    ).toHaveLength(0);
  });

  it('shows a no-results state and restores the catalog when the query is cleared', async () => {
    mockCatalog();

    const { getByLabelText, getByText } = await render(<DiscoverScreen />);

    await fireEvent.changeText(getByLabelText('Cari drama'), 'zzzz');

    expect(getByText('Tidak ada hasil')).toBeTruthy();

    await fireEvent.press(getByText('Hapus pencarian'));

    expect(getByText(CEO_TITLE)).toBeTruthy();
  });
});

describe('DiscoverScreen catalog states', () => {
  it('shows a poster skeleton while the catalog is loading', async () => {
    mockCatalog({ videos: [], isLoading: true });

    const { getByLabelText } = await render(<DiscoverScreen />);

    expect(getByLabelText('Memuat katalog Discover')).toBeTruthy();
  });

  it('shows a retryable error state when the catalog request failed', async () => {
    const refresh = mockCatalog({ videos: [], error: new Error('offline') });

    const { getByText } = await render(<DiscoverScreen />);

    expect(getByText('Katalog gagal dimuat')).toBeTruthy();

    await fireEvent.press(getByText('Coba lagi'));

    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('shows an empty-catalog state when the feed returned nothing', async () => {
    mockCatalog({ videos: [] });

    const { getByText } = await render(<DiscoverScreen />);

    expect(getByText('Katalog masih kosong')).toBeTruthy();
  });

  it('keeps rendering a populated catalog when a refresh fails', async () => {
    mockCatalog({ error: new Error('offline') });

    const { getByText, queryByText } = await render(<DiscoverScreen />);

    expect(getByText(CEO_TITLE)).toBeTruthy();
    expect(queryByText('Katalog gagal dimuat')).toBeNull();
  });
});
