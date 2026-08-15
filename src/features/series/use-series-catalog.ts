import { useCallback, useEffect, useRef, useState } from 'react';

import { getSeriesCatalog, getSeriesDetail } from '@/services/series/series-catalog-service';
import type { CatalogSeries, CatalogSeriesDetail } from '@/types/series-catalog';

/**
 * Series state deliberately does NOT live in `VideoCatalogProvider`.
 *
 * That provider exists to give Home one shared, already-fetched `/videos/feed`
 * result. Series come from a different endpoint with a different shape, and
 * Series Detail must work on a cold direct link without Discover ever having
 * mounted - so a shared global would be a cache to keep in sync, not a
 * simplification. Each hook owns one request, following the same
 * mount/refresh/stale-guard pattern the provider already established.
 */
type AsyncResource<TData> = {
  readonly data: TData;
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refresh: () => void;
};

function toError(caught: unknown, fallbackMessage: string): Error {
  return caught instanceof Error ? caught : new Error(fallbackMessage);
}

/** `GET /series` - the Discover catalog. */
export function useSeriesCatalog(): AsyncResource<readonly CatalogSeries[]> {
  const [series, setSeries] = useState<readonly CatalogSeries[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Only settles state inside the then/catch continuations, never
  // synchronously, so it is safe to call straight from the mount effect.
  const fetchSeries = useCallback(() => {
    const requestId = ++requestIdRef.current;

    return getSeriesCatalog()
      .then((fetched) => {
        if (!isMountedRef.current || requestIdRef.current !== requestId) {
          return;
        }

        setSeries(fetched);
        setError(null);
        setIsLoading(false);
      })
      .catch((caught: unknown) => {
        if (!isMountedRef.current || requestIdRef.current !== requestId) {
          return;
        }

        // No silent fall back to bundled fixtures: hiding a backend failure
        // behind mock data would make a broken catalog look healthy.
        setError(toError(caught, 'Failed to load the series catalog.'));
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    void fetchSeries();
  }, [fetchSeries]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    void fetchSeries();
  }, [fetchSeries]);

  return { data: series, isLoading, error, refresh };
}

export type SeriesDetailResource = AsyncResource<CatalogSeriesDetail | undefined> & {
  /** True once the request resolved and the backend answered 404. */
  readonly isNotFound: boolean;
};

/**
 * `GET /series/:id` - Series Detail's own request.
 *
 * It fetches by id and depends on nothing Discover left in memory, so a cold
 * deep link into /series/<id> renders the same as a tap from the catalog.
 */
export function useSeriesDetail(id: string | undefined): SeriesDetailResource {
  const [detail, setDetail] = useState<CatalogSeriesDetail | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);
  const [isNotFound, setIsNotFound] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // A missing route param is DERIVED below rather than pushed into state: the
  // mount effect must never settle state synchronously.
  const hasId = typeof id === 'string' && id.length > 0;

  const fetchDetail = useCallback(() => {
    if (!hasId) {
      return Promise.resolve();
    }

    const requestId = ++requestIdRef.current;

    return getSeriesDetail(id)
      .then((fetched) => {
        if (!isMountedRef.current || requestIdRef.current !== requestId) {
          return;
        }

        setDetail(fetched);
        setIsNotFound(fetched === undefined);
        setError(null);
        setIsLoading(false);
      })
      .catch((caught: unknown) => {
        if (!isMountedRef.current || requestIdRef.current !== requestId) {
          return;
        }

        setError(toError(caught, 'Failed to load the series.'));
        setIsLoading(false);
      });
  }, [hasId, id]);

  useEffect(() => {
    void fetchDetail();
  }, [fetchDetail]);

  const refresh = useCallback(() => {
    setIsLoading(true);
    setIsNotFound(false);
    setError(null);
    void fetchDetail();
  }, [fetchDetail]);

  return {
    data: hasId ? detail : undefined,
    isLoading: hasId ? isLoading : false,
    error,
    isNotFound: hasId ? isNotFound : true,
    refresh,
  };
}
