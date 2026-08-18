import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import DiscoverScreen from '@/app/(tabs)/discover';
import type { CatalogSeries } from '@/types/series-catalog';

/**
 * SIGNED COVER RECOVERY - Discover, end to end.
 *
 * This suite runs the REAL `useSeriesCatalog` against a mocked Series service,
 * because the thing under test is a request count. Mocking the hook (as the
 * other Discover suites do) would mock away the entire behaviour.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
}));

const mockGetSeriesCatalog = jest.fn();
const mockIsSeriesMetadataRemote = jest.fn();

jest.mock('@/services/series/series-catalog-service', () => ({
  getSeriesCatalog: () => mockGetSeriesCatalog(),
  getSeriesDetail: jest.fn(),
  isSeriesMetadataRemote: () => mockIsSeriesMetadataRemote(),
}));

/**
 * Signed URLs in the shape the backend actually returns. Nothing in the app
 * parses these query parameters - they are opaque identity keys - so the tests
 * treat them the same way.
 */
function signedCover(seriesNumber: number, signature: string): string {
  return `https://r2.example.com/admin-series/series-${seriesNumber}/cover/${signature}?X-Amz-Expires=3600`;
}

/**
 * Distinct initials on purpose. The branded fallback renders the title's first
 * character, so same-initial titles would make "is THIS card showing the
 * fallback?" ambiguous.
 */
const TITLES = ['Aurora Terakhir', 'Bintang Jatuh', 'Cakra Membara', 'Dewi Bayangan'] as const;

function buildSeries(seriesNumber: number, signature: string): CatalogSeries {
  return {
    id: `series-${seriesNumber}`,
    title: TITLES[seriesNumber - 1],
    coverUrl: signedCover(seriesNumber, signature),
    category: 'CEO',
    sourceLanguage: 'zh',
    episodeCount: 6,
    totalLikes: 1_000 + seriesNumber,
    hasPremiumEpisodes: false,
  };
}

const FOUR_CARDS: readonly CatalogSeries[] = [1, 2, 3, 4].map((n) => buildSeries(n, 'expired'));
const FOUR_CARDS_REFRESHED: readonly CatalogSeries[] = [1, 2, 3, 4].map((n) =>
  buildSeries(n, 'fresh')
);

function posterImageId(seriesNumber: number): string {
  return `discover-poster-image-series-${seriesNumber}`;
}

/**
 * `expo-image` normalizes `source` into an array of sources before it reaches
 * the host component, so the URI is read through this helper rather than
 * assumed to be a bare object.
 */
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

/** Resolves once the catalog has painted real artwork. */
async function renderDiscoverWithPosters() {
  const view = await render(<DiscoverScreen />);

  await waitFor(() => expect(view.getByTestId(posterImageId(1))).toBeTruthy());

  return view;
}

type DiscoverView = Awaited<ReturnType<typeof renderDiscoverWithPosters>>;

/** One poster's signed URL stops working. */
async function failPoster(view: DiscoverView, seriesNumber: number) {
  // RN does not reliably expose an HTTP status here, so neither does this
  // fixture: the app must recover from an opaque failure.
  await fireEvent(view.getByTestId(posterImageId(seriesNumber)), 'error', {
    nativeEvent: { error: 'unknown image failure' },
  });
}

beforeEach(() => {
  // `clearMocks` wipes implementations too, so the defaults are restated here.
  mockIsSeriesMetadataRemote.mockReturnValue(true);
  mockGetSeriesCatalog.mockResolvedValue(FOUR_CARDS);
});

describe('Discover cover recovery', () => {
  it('renders the authoritative artwork when the signed URL works', async () => {
    const { getByTestId } = await renderDiscoverWithPosters();

    expect(sourceUriOf(getByTestId(posterImageId(1)))).toBe(signedCover(1, 'expired'));
    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(1);
  });

  it('shows the branded fallback for a null cover and requests NOTHING', async () => {
    mockGetSeriesCatalog.mockResolvedValue([
      { ...buildSeries(1, 'unused'), coverUrl: null },
      ...FOUR_CARDS.slice(1),
    ]);

    const { getByText, queryByTestId } = await render(<DiscoverScreen />);

    await waitFor(() => expect(getByText(TITLES[0])).toBeTruthy());

    // `null` is authoritative "no artwork uploaded", not an expired URL. There
    // is no <Image> to fail, and nothing to recover.
    expect(queryByTestId(posterImageId(1))).toBeNull();
    expect(getByText('A', { includeHiddenElements: true })).toBeTruthy();
    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(1);
  });

  it('refetches the catalog exactly once when one signed cover fails', async () => {
    const view = await renderDiscoverWithPosters();

    await failPoster(view, 1);

    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));
    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2);
  });

  /**
   * THE REQUEST-COUNT PROOF.
   *
   * Four posters signed at the same moment expire at the same moment. Without
   * a shared budget this is four `GET /series` calls for one problem.
   */
  it('collapses four simultaneous poster failures into ONE catalog refresh', async () => {
    const view = await renderDiscoverWithPosters();

    await failPoster(view, 1);
    await failPoster(view, 2);
    await failPoster(view, 3);
    await failPoster(view, 4);

    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));

    // 1 initial load + 1 recovery. Never 5.
    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2);
    // All four are on the branded fallback, so the count is not low because
    // three of them quietly kept rendering broken artwork.
    expect(view.getByText('A', { includeHiddenElements: true })).toBeTruthy();
    expect(view.getByText('D', { includeHiddenElements: true })).toBeTruthy();
  });

  it('renders the refreshed signature once recovery returns new artwork', async () => {
    mockGetSeriesCatalog
      .mockResolvedValueOnce(FOUR_CARDS)
      .mockResolvedValueOnce(FOUR_CARDS_REFRESHED);

    const view = await renderDiscoverWithPosters();
    await failPoster(view, 1);

    // No user action, no toast, no spinner: the poster simply comes back.
    await waitFor(() =>
      expect(sourceUriOf(view.getByTestId(posterImageId(1)))).toBe(signedCover(1, 'fresh'))
    );
  });

  it('lets a cover Admin replaced render, rather than blacklisting the series', async () => {
    const brandNewCover = 'https://r2.example.com/admin-series/series-1/cover/brand-new';
    const adminReplaced = [{ ...FOUR_CARDS[0], coverUrl: brandNewCover }, ...FOUR_CARDS.slice(1)];
    mockGetSeriesCatalog.mockResolvedValueOnce(FOUR_CARDS).mockResolvedValueOnce(adminReplaced);

    const view = await renderDiscoverWithPosters();
    await failPoster(view, 1);

    // Failure is remembered against the URL, never the series id - so entirely
    // new artwork for a series that just failed is not suppressed.
    await waitFor(() =>
      expect(sourceUriOf(view.getByTestId(posterImageId(1)))).toBe(brandNewCover)
    );
  });

  it('stays on the fallback without looping when the refetch returns the same URL', async () => {
    // The backend hands back the identical signature it already gave us.
    mockGetSeriesCatalog.mockResolvedValue(FOUR_CARDS);

    const view = await renderDiscoverWithPosters();
    await failPoster(view, 1);

    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));

    // The URL-keyed latch still matches, so the branded initial holds...
    expect(view.queryByTestId(posterImageId(1))).toBeNull();
    expect(view.getByText('A', { includeHiddenElements: true })).toBeTruthy();

    // ...and no further request follows.
    await flushPending();
    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2);
  });

  it('stays usable and silent when recovery itself fails offline', async () => {
    mockGetSeriesCatalog
      .mockResolvedValueOnce(FOUR_CARDS)
      .mockRejectedValueOnce(new Error('offline'));

    const view = await renderDiscoverWithPosters();
    await failPoster(view, 1);

    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));

    // The catalog the user was browsing is untouched: a background failure
    // must never replace a working screen with an error state.
    expect(view.getByText(TITLES[1])).toBeTruthy();
    expect(view.getByText('A', { includeHiddenElements: true })).toBeTruthy();
    // And it does not retry into the void.
    await flushPending();
    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2);
  });

  it('bounds, rather than bans: a later failure while still offline adds no requests', async () => {
    mockGetSeriesCatalog
      .mockResolvedValueOnce(FOUR_CARDS)
      .mockRejectedValueOnce(new Error('offline'));

    const view = await renderDiscoverWithPosters();
    await failPoster(view, 1);
    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));

    await failPoster(view, 2);
    await flushPending();

    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2);
  });

  it('issues no backend request at all in mock/demo mode', async () => {
    // Bundled covers are app-binary assets: no signature, no expiry, no
    // endpoint behind them. A failure there has nothing to recover from.
    mockIsSeriesMetadataRemote.mockReturnValue(false);

    const view = await renderDiscoverWithPosters();

    await failPoster(view, 1);
    await failPoster(view, 2);
    await flushPending();

    // Only the initial load. The offline showcase stays backend-independent.
    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(1);
    expect(view.getByText('A', { includeHiddenElements: true })).toBeTruthy();
    expect(view.getByText('B', { includeHiddenElements: true })).toBeTruthy();
  });

  it('schedules no polling: recovery is event-driven only', async () => {
    // Deliberately no `waitFor` in this test - RNTL polls with setInterval, so
    // its own timer would drown out the thing being asserted.
    const setIntervalSpy = jest.spyOn(globalThis, 'setInterval');

    const view = await render(<DiscoverScreen />);
    await flushPending();

    await failPoster(view as DiscoverView, 1);
    await flushPending();

    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2);
    // Nothing in the load -> fail -> recover path schedules a repeating timer.
    expect(setIntervalSpy).not.toHaveBeenCalled();

    // And real elapsed time produces no further requests: there is no retry
    // schedule anywhere, only the failure event.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
    });

    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2);
    setIntervalSpy.mockRestore();
  });

  it('survives unmounting while a recovery request is still in flight', async () => {
    let resolveRecovery: (value: readonly CatalogSeries[]) => void = () => {};
    mockGetSeriesCatalog.mockResolvedValueOnce(FOUR_CARDS).mockReturnValueOnce(
      new Promise<readonly CatalogSeries[]>((resolve) => {
        resolveRecovery = resolve;
      })
    );
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});

    const view = await render(<DiscoverScreen />);
    await flushPending();
    await failPoster(view as DiscoverView, 1);
    await flushPending();

    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2);

    await act(async () => {
      view.unmount();
      // The response lands on a screen that no longer exists.
      resolveRecovery(FOUR_CARDS_REFRESHED);
      await Promise.resolve();
      await Promise.resolve();
    });

    // It settles nothing and warns about nothing - in particular no "state
    // update on an unmounted component" from a dead card or a dead hook.
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
