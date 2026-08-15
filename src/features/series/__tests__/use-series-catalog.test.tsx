import { renderHook, waitFor } from '@testing-library/react-native';

import { useSeriesCatalog, useSeriesDetail } from '@/features/series/use-series-catalog';
import type { CatalogSeries, CatalogSeriesDetail } from '@/types/series-catalog';

const mockGetSeriesCatalog = jest.fn();
const mockGetSeriesDetail = jest.fn();

jest.mock('@/services/series/series-catalog-service', () => ({
  getSeriesCatalog: () => mockGetSeriesCatalog(),
  getSeriesDetail: (id: string) => mockGetSeriesDetail(id),
}));

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
