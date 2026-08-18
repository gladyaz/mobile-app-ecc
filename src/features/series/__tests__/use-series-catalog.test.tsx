import { renderHook, waitFor } from '@testing-library/react-native';

import { useSeriesCatalog, useSeriesDetail } from '@/features/series/use-series-catalog';
import type { CatalogSeries, CatalogSeriesDetail } from '@/types/series-catalog';

const mockGetSeriesCatalog = jest.fn();
const mockGetSeriesDetail = jest.fn();
const mockIsSeriesMetadataRemote = jest.fn();

jest.mock('@/services/series/series-catalog-service', () => ({
  getSeriesCatalog: () => mockGetSeriesCatalog(),
  getSeriesDetail: (id: string) => mockGetSeriesDetail(id),
  isSeriesMetadataRemote: () => mockIsSeriesMetadataRemote(),
}));

beforeEach(() => {
  // `clearMocks` wipes implementations, so the real-backend default (the only
  // mode in which a signed cover URL exists at all) is restated per test.
  mockIsSeriesMetadataRemote.mockReturnValue(true);
});

/** A presigned cover URL. Its query string is opaque to the app. */
const COVER_A = 'https://r2.example.com/admin-series/series-104/cover/a?X-Amz-Expires=3600';
const COVER_B = 'https://r2.example.com/admin-series/series-104/cover/b?X-Amz-Expires=3600';

const CANONICAL_TITLE = 'Malapetaka Datang: Benteng Bergerakku';

const series: CatalogSeries = {
  id: 'series-104',
  title: CANONICAL_TITLE,
  coverUrl: 'https://cdn.example.com/series-104.jpg',
  category: 'Action',
  sourceLanguage: 'zh',
  episodeCount: 10,
  totalLikes: 716,
  hasPremiumEpisodes: true,
};

const detail: CatalogSeriesDetail = { ...series, episodes: [] };

describe('useSeriesCatalog', () => {
  it('loads the catalog from the Series endpoint', async () => {
    mockGetSeriesCatalog.mockResolvedValueOnce([series]);

    const { result } = await renderHook(() => useSeriesCatalog());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data[0].title).toBe(CANONICAL_TITLE);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a backend failure instead of falling back to bundled fixtures', async () => {
    mockGetSeriesCatalog.mockRejectedValueOnce(new Error('offline'));

    const { result } = await renderHook(() => useSeriesCatalog());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    // A silent mock fallback here would make a broken catalog look healthy.
    expect(result.current.data).toEqual([]);
  });

  it('refetches on refresh', async () => {
    mockGetSeriesCatalog.mockResolvedValue([series]);

    const { result } = await renderHook(() => useSeriesCatalog());

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    result.current.refresh();

    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));
  });
});

describe('useSeriesDetail', () => {
  it('fetches by id on a cold mount, with no Discover state involved', async () => {
    mockGetSeriesDetail.mockResolvedValueOnce(detail);

    const { result } = await renderHook(() => useSeriesDetail('series-104'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetSeriesDetail).toHaveBeenCalledWith('series-104');
    expect(result.current.data?.title).toBe(CANONICAL_TITLE);
    expect(result.current.isNotFound).toBe(false);
  });

  it('reports not-found when the backend answers 404', async () => {
    mockGetSeriesDetail.mockResolvedValueOnce(undefined);

    const { result } = await renderHook(() => useSeriesDetail('nope'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isNotFound).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('reports a network failure as an error, not as not-found', async () => {
    mockGetSeriesDetail.mockRejectedValueOnce(new Error('offline'));

    const { result } = await renderHook(() => useSeriesDetail('series-104'));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.isNotFound).toBe(false);
  });

  it('treats a missing route param as not-found without requesting anything', async () => {
    const { result } = await renderHook(() => useSeriesDetail(undefined));

    expect(mockGetSeriesDetail).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isNotFound).toBe(true);
  });

  it('never renders the previous series under a new id', async () => {
    const other: CatalogSeriesDetail = { ...detail, id: 'series-010', title: 'Kue Gulung' };
    // The second response is held open so the in-flight window is observable:
    // that window is exactly where a stale render would show.
    let resolveSecond: (value: CatalogSeriesDetail) => void = () => {};
    mockGetSeriesDetail
      .mockResolvedValueOnce(detail)
      .mockReturnValueOnce(
        new Promise<CatalogSeriesDetail>((resolve) => {
          resolveSecond = resolve;
        })
      );

    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useSeriesDetail(id),
      { initialProps: { id: 'series-104' } }
    );

    await waitFor(() => expect(result.current.data?.id).toBe('series-104'));

    await rerender({ id: 'series-010' });

    // The settled result belongs to the OLD id, so it is invalidated by
    // comparison rather than briefly rendered under the new one.
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(true);

    resolveSecond(other);

    await waitFor(() => expect(result.current.data?.id).toBe('series-010'));
  });

  it('refetches when the id changes', async () => {
    mockGetSeriesDetail.mockResolvedValue(detail);

    const { rerender } = await renderHook(({ id }: { id: string }) => useSeriesDetail(id), {
      initialProps: { id: 'series-104' },
    });

    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledWith('series-104'));
    await rerender({ id: 'series-010' });

    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledWith('series-010'));
  });
});

describe('useSeriesCatalog cover recovery', () => {
  it('refetches the catalog once when an authoritative cover fails', async () => {
    mockGetSeriesCatalog.mockResolvedValue([series]);

    const { result } = await renderHook(() => useSeriesCatalog());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.recoverCover(COVER_A);

    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));
  });

  it('reports the SAME failed url repeatedly without issuing a second request', async () => {
    mockGetSeriesCatalog.mockResolvedValue([series]);

    const { result } = await renderHook(() => useSeriesCatalog());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A recycled cell can fire onError again before the refetch lands, and
    // again after it returns the same URL. None of that may add a request.
    result.current.recoverCover(COVER_A);
    result.current.recoverCover(COVER_A);
    result.current.recoverCover(COVER_A);

    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));
    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2);
  });

  it('recovers silently: no spinner while the background refresh runs', async () => {
    mockGetSeriesCatalog.mockResolvedValue([series]);

    const { result } = await renderHook(() => useSeriesCatalog());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.recoverCover(COVER_A);

    // The user did not ask for this, so the catalog must not flip to a
    // loading state and flash a skeleton over content they are reading.
    expect(result.current.isLoading).toBe(false);
    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps the catalog and raises no error when recovery fails', async () => {
    mockGetSeriesCatalog
      .mockResolvedValueOnce([series])
      .mockRejectedValueOnce(new Error('offline'));

    const { result } = await renderHook(() => useSeriesCatalog());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.recoverCover(COVER_A);
    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));

    // Nothing the user asked for failed. Surfacing an error here would blank a
    // working screen because one poster lost its signature.
    expect(result.current.error).toBeNull();
    expect(result.current.data).toHaveLength(1);
  });

  it('lets a later explicit refresh deliver artwork that recovery could not', async () => {
    const replaced = { ...series, coverUrl: COVER_B };
    mockGetSeriesCatalog
      .mockResolvedValueOnce([series])
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce([replaced]);

    const { result } = await renderHook(() => useSeriesCatalog());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.recoverCover(COVER_A);
    await waitFor(() => expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(2));

    // The automatic attempt is spent, but the series is not banned: the user
    // coming back online and retrying still gets the new cover.
    result.current.refresh();

    await waitFor(() => expect(result.current.data[0].coverUrl).toBe(COVER_B));
  });

  it('issues no request at all when Series data is bundled, not fetched', async () => {
    mockIsSeriesMetadataRemote.mockReturnValue(false);
    mockGetSeriesCatalog.mockResolvedValue([series]);

    const { result } = await renderHook(() => useSeriesCatalog());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.recoverCover(COVER_A);

    expect(mockGetSeriesCatalog).toHaveBeenCalledTimes(1);
  });
});

describe('useSeriesDetail cover recovery', () => {
  it('refetches only this series, never the catalog', async () => {
    mockGetSeriesDetail.mockResolvedValue(detail);

    const { result } = await renderHook(() => useSeriesDetail('series-104'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.recoverCover(COVER_A);

    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2));
    expect(mockGetSeriesDetail).toHaveBeenLastCalledWith('series-104');
    // Detail owns its own request; fixing its cover must not pull /series.
    expect(mockGetSeriesCatalog).not.toHaveBeenCalled();
  });

  it('does not re-request the same failed detail cover', async () => {
    mockGetSeriesDetail.mockResolvedValue(detail);

    const { result } = await renderHook(() => useSeriesDetail('series-104'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.recoverCover(COVER_A);
    result.current.recoverCover(COVER_A);

    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2));
    expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2);
  });

  it('never requests anything for a series with no artwork', async () => {
    mockGetSeriesDetail.mockResolvedValue({ ...detail, coverUrl: null });

    const { result } = await renderHook(() => useSeriesDetail('series-104'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // What the screen passes for a null cover, defensively.
    result.current.recoverCover('');

    expect(mockGetSeriesDetail).toHaveBeenCalledTimes(1);
  });

  it('keeps the screen intact when detail recovery fails', async () => {
    mockGetSeriesDetail
      .mockResolvedValueOnce(detail)
      .mockRejectedValueOnce(new Error('offline'));

    const { result } = await renderHook(() => useSeriesDetail('series-104'));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.recoverCover(COVER_A);
    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2));

    // A missing poster must never turn a readable series into an error page.
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.data?.title).toBe(CANONICAL_TITLE);
  });

  it('gives a newly opened series its own recovery attempt', async () => {
    mockGetSeriesDetail.mockResolvedValue(detail);

    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useSeriesDetail(id),
      { initialProps: { id: 'series-104' } }
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // The cover on the FIRST series fails, spending that series' attempt.
    result.current.recoverCover(COVER_A);
    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2));

    // The user opens a different series. That is an explicit load.
    await rerender({ id: 'series-010' });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetSeriesDetail).toHaveBeenCalledTimes(3);

    // The new series must not be born with a budget the PREVIOUS series spent.
    result.current.recoverCover(COVER_B);

    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(4));
  });

  it('cannot let a late recovery response render under a different series', async () => {
    const other: CatalogSeriesDetail = { ...detail, id: 'series-010', title: 'Kue Gulung' };
    let resolveRecovery: (value: CatalogSeriesDetail) => void = () => {};
    mockGetSeriesDetail
      .mockResolvedValueOnce(detail)
      .mockReturnValueOnce(
        new Promise<CatalogSeriesDetail>((resolve) => {
          resolveRecovery = resolve;
        })
      )
      .mockResolvedValueOnce(other);

    const { result, rerender } = await renderHook(
      ({ id }: { id: string }) => useSeriesDetail(id),
      { initialProps: { id: 'series-104' } }
    );
    await waitFor(() => expect(result.current.data?.id).toBe('series-104'));

    result.current.recoverCover(COVER_A);
    await waitFor(() => expect(mockGetSeriesDetail).toHaveBeenCalledTimes(2));

    // The user navigates to a different series while that recovery is open.
    await rerender({ id: 'series-010' });
    await waitFor(() => expect(result.current.data?.id).toBe('series-010'));

    resolveRecovery(detail);

    // The stale response belongs to a superseded request and must settle
    // nothing - series-010 keeps rendering series-010.
    await waitFor(() => expect(result.current.data?.id).toBe('series-010'));
    expect(result.current.data?.title).toBe('Kue Gulung');
  });
});
