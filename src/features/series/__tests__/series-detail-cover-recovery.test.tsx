import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import SeriesDetailScreen from '@/app/series/[id]';
import type { CatalogSeriesDetail } from '@/types/series-catalog';

/**
 * SIGNED COVER RECOVERY - Series Detail, end to end.
 *
 * Runs the REAL `useSeriesDetail` against a mocked Series service. The point of
 * the suite is WHICH endpoint is called and how often, so mocking the hook
 * would remove the behaviour under test.
 */

const mockUseLocalSearchParams = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
  useLocalSearchParams: () => mockUseLocalSearchParams(),
}));

const mockGetSeriesCatalog = jest.fn();
const mockGetSeriesDetail = jest.fn();
const mockIsSeriesMetadataRemote = jest.fn();

jest.mock('@/services/series/series-catalog-service', () => ({
  getSeriesCatalog: () => mockGetSeriesCatalog(),
  getSeriesDetail: (id: string) => mockGetSeriesDetail(id),
  isSeriesMetadataRemote: () => mockIsSeriesMetadataRemote(),
}));

jest.mock('@/stores/series-progress', () => ({
  useSeriesProgress: () => ({ getProgress: () => undefined, recordProgress: jest.fn() }),
}));

jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => ({ isPremium: false, refresh: jest.fn() }),
}));

// The real queue schedules flush timers and hits the network.
jest.mock('@/services/analytics/analytics-queue', () => ({
  trackEvent: jest.fn(),
}));

const CANONICAL_TITLE = 'Kontrak Cinta CEO Dingin';
const COVER_EXPIRED =
  'https://r2.example.com/admin-series/series-x/cover/expired?X-Amz-Expires=3600';
const COVER_FRESH = 'https://r2.example.com/admin-series/series-x/cover/fresh?X-Amz-Expires=3600';

function buildDetail(coverUrl: string | null): CatalogSeriesDetail {
  return {
    id: 'series-x',
    title: CANONICAL_TITLE,
    coverUrl,
    category: 'CEO',
    sourceLanguage: 'zh',
    episodeCount: 0,
    totalLikes: 600,
    hasPremiumEpisodes: false,
    episodes: [],
  };
}

function sourceUriOf(element: { props: { source?: unknown } }): string | undefined {
  const { source } = element.props;
  const first = Array.isArray(source) ? source[0] : source;

  return (first as { uri?: string } | undefined)?.uri;
}

/** Settles already-resolved promises without introducing a timer. */
async function flushPending() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderDetail() {
  const view = await render(<SeriesDetailScreen />);

  await waitFor(() => expect(view.getByText(CANONICAL_TITLE)).toBeTruthy());

  return view;
}

beforeEach(() => {
  mockUseLocalSearchParams.mockReturnValue({ id: 'series-x' });
  mockIsSeriesMetadataRemote.mockReturnValue(true);
  mockGetSeriesDetail.mockResolvedValue(buildDetail(COVER_EXPIRED));
});

describe('Series Detail cover recovery', () => {
  it('renders the authoritative cover on a cold deep link, with no Discover state', async () => {
    const { getByTestId } = await renderDetail();

    // A direct link into /series/<id> fetches by id and reads nothing Discover
    // left behind - unchanged by the cover work.
    expect(mockGetSeriesDetail).toHaveBeenCalledWith('series-x');
    expect(mockGetSeriesCatalog).not.toHaveBeenCalled();
    expect(sourceUriOf(getByTestId('series-detail-cover'))).toBe(COVER_EXPIRED);
  });

  it('refetches THIS series exactly once when its cover fails', async () => {
    const view = await renderDetail();

    await fireEvent(view.getByTestId('series-detail-cover'), 'error', {
      nativeEvent: { error: 'unknown image failure' },
    });

    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2));
    expect(mockGetSeriesDetail).toHaveBeenLastCalledWith('series-x');
    // Detail must not pull the whole catalog to fix one poster.
    expect(mockGetSeriesCatalog).not.toHaveBeenCalled();
  });

  it('renders the refreshed signature with no user action', async () => {
    mockGetSeriesDetail
      .mockResolvedValueOnce(buildDetail(COVER_EXPIRED))
      .mockResolvedValueOnce(buildDetail(COVER_FRESH));

    const view = await renderDetail();

    await fireEvent(view.getByTestId('series-detail-cover'), 'error', {
      nativeEvent: { error: 'expired' },
    });

    await waitFor(() =>
      expect(sourceUriOf(view.getByTestId('series-detail-cover'))).toBe(COVER_FRESH)
    );
  });

  it('holds the empty cover surface without looping when the same URL comes back', async () => {
    mockGetSeriesDetail.mockResolvedValue(buildDetail(COVER_EXPIRED));

    const view = await renderDetail();

    await fireEvent(view.getByTestId('series-detail-cover'), 'error', {
      nativeEvent: { error: 'expired' },
    });
    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2));

    // The URL-keyed latch still matches, so the cover stays hidden...
    expect(view.queryByTestId('series-detail-cover')).toBeNull();
    await flushPending();
    // ...and no further request follows.
    expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2);
  });

  it('never requests anything for a series with no artwork', async () => {
    mockGetSeriesDetail.mockResolvedValue(buildDetail(null));

    const view = await renderDetail();

    // `null` is authoritative "no cover uploaded". No <Image>, nothing to fail,
    // nothing to recover.
    expect(view.queryByTestId('series-detail-cover')).toBeNull();
    await flushPending();
    expect(mockGetSeriesDetail).toHaveBeenCalledTimes(1);
  });

  it('keeps the series readable when recovery fails offline', async () => {
    mockGetSeriesDetail
      .mockResolvedValueOnce(buildDetail(COVER_EXPIRED))
      .mockRejectedValueOnce(new Error('offline'));

    const view = await renderDetail();

    await fireEvent(view.getByTestId('series-detail-cover'), 'error', {
      nativeEvent: { error: 'offline' },
    });
    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2));

    // A missing poster must never turn a working screen into an error page.
    expect(view.getByText(CANONICAL_TITLE)).toBeTruthy();
    await flushPending();
    expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2);
  });

  it('issues no request at all in mock/demo mode', async () => {
    mockIsSeriesMetadataRemote.mockReturnValue(false);

    const view = await renderDetail();

    await fireEvent(view.getByTestId('series-detail-cover'), 'error', {
      nativeEvent: { error: 'bundled asset missing' },
    });
    await flushPending();

    expect(mockGetSeriesDetail).toHaveBeenCalledTimes(1);
  });
});
