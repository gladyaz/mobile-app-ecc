import { fireEvent, render, within } from '@testing-library/react-native';

import { DiscoverListRow, DiscoverPosterCard } from '@/features/discover/discover-cards';
import { DiscoverPoster } from '@/features/discover/discover-poster';
import type { DiscoverSeriesCard } from '@/types/discover';

function buildCard(overrides: Partial<DiscoverSeriesCard> = {}): DiscoverSeriesCard {
  return {
    seriesId: 'series-a',
    title: 'Balas Dendam Sang Pewaris',
    posterUrl: 'https://cdn.example.com/series-a.jpg',
    category: 'Revenge',
    channelName: 'Short Drama Mandarin',
    episodeCount: 10,
    likeCount: 18_400,
    hasPremiumEpisodes: true,
    badges: ['Premium', 'Hot'],
    ...overrides,
  };
}

const POSTER_TEST_ID = 'discover-poster-series-a';

describe('Premium and Hot placement', () => {
  it('renders both badges inside the poster media region', async () => {
    const card = buildCard();

    const { getByTestId } = await render(<DiscoverPoster card={card} variant="grid" />);
    const poster = within(getByTestId(POSTER_TEST_ID));

    expect(poster.getByText('Premium')).toBeTruthy();
    expect(poster.getByText('Hot')).toBeTruthy();
  });

  it('keeps the title out of the poster region, so a badge cannot overlap it', async () => {
    const card = buildCard();

    const { getByTestId, getByText } = await render(
      <DiscoverListRow card={card} onPress={jest.fn()} />
    );
    const poster = within(getByTestId(POSTER_TEST_ID));

    // The badge lives in the media subtree...
    expect(poster.getByText('Premium')).toBeTruthy();
    // ...and the title provably does not, so the two cannot share a box.
    expect(poster.queryByText(card.title)).toBeNull();
    expect(getByText(card.title)).toBeTruthy();
  });

  it('keeps the grid title out of the poster region too', async () => {
    const card = buildCard();

    const { getByTestId, getByText } = await render(
      <DiscoverPosterCard card={card} onPress={jest.fn()} titleMinHeight={32} width={110} />
    );

    expect(within(getByTestId(POSTER_TEST_ID)).queryByText(card.title)).toBeNull();
    expect(getByText(card.title)).toBeTruthy();
  });

  it('does not put the episode count in the same overlay as the badges', async () => {
    const card = buildCard();

    const { getByText } = await render(<DiscoverPoster card={card} variant="grid" />);
    const episodePill = getByText('10 EP');
    const premiumBadge = getByText('Premium');

    // Different parents means different absolutely-positioned corners; they
    // cannot stack on each other however long the localized label gets.
    expect(episodePill.parent).not.toBe(premiumBadge.parent);
  });

  it('omits the episode pill on compact rows, where the metadata line carries it', async () => {
    const card = buildCard();

    const { queryByText } = await render(<DiscoverPoster card={card} variant="row" />);

    expect(queryByText('10 EP')).toBeNull();
    expect(queryByText('Premium')).toBeTruthy();
  });

  it('renders a rank pill alongside badges without a separate overlay', async () => {
    const card = buildCard();

    const { getByTestId } = await render(<DiscoverPoster card={card} rank={1} variant="grid" />);
    const poster = within(getByTestId(POSTER_TEST_ID));

    // One wrapping row holds rank and badges, so they flow instead of overlap.
    expect(poster.getByText('#1').parent).toBe(poster.getByText('Premium').parent);
  });
});

describe('badge meaning', () => {
  it('states Premium and Hot as words, never as colour alone', async () => {
    const card = buildCard();

    const { getByText } = await render(<DiscoverPoster card={card} variant="grid" />);

    expect(getByText('Premium')).toBeTruthy();
    expect(getByText('Hot')).toBeTruthy();
  });

  it('announces the badges as part of the card, not as separate elements', async () => {
    const card = buildCard();

    const { getByLabelText, getByTestId, queryByLabelText } = await render(
      <DiscoverListRow card={card} onPress={jest.fn()} />
    );

    // The label is built from the same badge budget the poster renders with,
    // so a compact row announces Premium and does NOT announce the Hot chip
    // it deliberately does not draw.
    expect(getByLabelText(/Balas Dendam Sang Pewaris, Premium, 10 episode/)).toBeTruthy();
    expect(queryByLabelText(/Hot/)).toBeNull();
    // The artwork itself stays out of the accessibility tree.
    expect(getByTestId('discover-poster-image-series-a').props.accessible).toBe(false);
  });

  it('renders no badge markup at all for a series that earns none', async () => {
    const card = buildCard({ badges: [], hasPremiumEpisodes: false });

    const { queryByText } = await render(<DiscoverPoster card={card} variant="grid" />);

    expect(queryByText('Premium')).toBeNull();
    expect(queryByText('Hot')).toBeNull();
  });
});

describe('poster fallback', () => {
  it('shows a branded initial instead of a blank frame when the catalog has no artwork', async () => {
    const card = buildCard({ posterUrl: '' });

    const { getByText, queryByTestId } = await render(
      <DiscoverPoster card={card} variant="grid" />
    );

    expect(getByText('B', { includeHiddenElements: true })).toBeTruthy();
    expect(queryByTestId('discover-poster-image-series-a')).toBeNull();
  });

  it('treats a whitespace-only poster url as missing artwork', async () => {
    const card = buildCard({ posterUrl: '   ' });

    const { getByText } = await render(<DiscoverPoster card={card} variant="grid" />);

    expect(getByText('B', { includeHiddenElements: true })).toBeTruthy();
  });

  it('falls back when artwork fails to load rather than leaving a black rectangle', async () => {
    const card = buildCard();

    const { getByTestId, getByText, queryByTestId } = await render(
      <DiscoverPoster card={card} variant="grid" />
    );

    await fireEvent(getByTestId('discover-poster-image-series-a'), 'error', {
      nativeEvent: { error: 'Not found' },
    });

    expect(getByText('B', { includeHiddenElements: true })).toBeTruthy();
    expect(queryByTestId('discover-poster-image-series-a')).toBeNull();
  });

  it('does not re-request a failed url when the catalog rebuilds the same card', async () => {
    const card = buildCard();

    const { getByTestId, queryByTestId, rerender } = await render(
      <DiscoverPoster card={card} variant="grid" />
    );

    await fireEvent(getByTestId('discover-poster-image-series-a'), 'error', {
      nativeEvent: { error: 'Offline' },
    });

    // `cards` is rebuilt on every like/save anywhere in the app, so a fresh
    // card object with identical artwork must NOT remount the Image - that
    // would turn unrelated like churn into a re-request storm against a URL
    // that just failed.
    await rerender(<DiscoverPoster card={{ ...card }} variant="grid" />);

    expect(queryByTestId('discover-poster-image-series-a')).toBeNull();
  });

  it('retries when the series is given new artwork', async () => {
    const card = buildCard();

    const { getByTestId, queryByTestId, rerender } = await render(
      <DiscoverPoster card={card} variant="grid" />
    );

    await fireEvent(getByTestId('discover-poster-image-series-a'), 'error', {
      nativeEvent: { error: 'Not found' },
    });

    expect(queryByTestId('discover-poster-image-series-a')).toBeNull();

    await rerender(
      <DiscoverPoster
        card={{ ...card, posterUrl: 'https://cdn.example.com/series-a-v2.jpg' }}
        variant="grid"
      />
    );

    expect(getByTestId('discover-poster-image-series-a')).toBeTruthy();
  });

  it('keeps the badges readable on the fallback surface', async () => {
    const card = buildCard({ posterUrl: '' });

    const { getByTestId } = await render(<DiscoverPoster card={card} variant="row" />);
    const poster = within(getByTestId(POSTER_TEST_ID));

    expect(poster.getByText('Premium')).toBeTruthy();
  });

  it('takes the initial from the first code point of a non-Latin title', async () => {
    const card = buildCard({ posterUrl: '', title: '雨夜校花' });

    const { getByText } = await render(<DiscoverPoster card={card} variant="grid" />);

    expect(getByText('雨', { includeHiddenElements: true })).toBeTruthy();
  });

  it('degrades to a neutral mark rather than crashing on an empty title', async () => {
    const card = buildCard({ posterUrl: '', title: '   ' });

    const { getByText } = await render(<DiscoverPoster card={card} variant="grid" />);

    expect(getByText('•', { includeHiddenElements: true })).toBeTruthy();
  });
});
