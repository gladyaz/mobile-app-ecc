import { useCallback, useEffect, useRef, useState } from 'react';

import {
  createCoverRecoveryBudget,
  type CoverRecoveryBudget,
  type ReportCoverFailure,
} from '@/features/series/cover-recovery';
import {
  getSeriesCatalog,
  getSeriesDetail,
  isSeriesMetadataRemote,
} from '@/services/series/series-catalog-service';
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

/**
 * `visible` is a load the user asked for (mount, id change, Retry): it may show
 * a spinner and must surface a failure as an error state.
 *
 * `silent` is background cover recovery. It updates data on success and does
 * NOTHING on failure - no spinner, no error state, no toast. Nothing the user
 * asked for failed, and the branded fallback is already on screen saying the
 * only true thing there is to say.
 */
type FetchMode = 'visible' | 'silent';

type AsyncResource<TData> = {
  readonly data: TData;
  readonly isLoading: boolean;
  readonly error: Error | null;
  /** User-triggered reload. Replenishes the automatic cover-recovery attempt. */
  readonly refresh: () => void;
  /**
   * Reports that an authoritative, non-null `coverUrl` from THIS resource
   * failed to load, so a bounded metadata refresh can fetch a fresh signature.
   * See `cover-recovery.ts` for the budget that bounds it.
   */
  readonly recoverCover: ReportCoverFailure;
};

function toError(caught: unknown, fallbackMessage: string): Error {
  return caught instanceof Error ? caught : new Error(fallbackMessage);
}

/**
 * One budget per mounted resource, created exactly once.
 *
 * A lazy `useState` initializer rather than `useRef(createCoverRecoveryBudget())`,
 * which would build a throwaway budget on EVERY render and discard it - and
 * Discover re-renders on every like or save anywhere in the app. The setter is
 * deliberately never used: this is a stable per-mount instance, not state, so
 * mutating the budget never re-renders anything.
 */
function useCoverRecoveryBudget(): CoverRecoveryBudget {
  const [budget] = useState(createCoverRecoveryBudget);

  return budget;
}

/** `GET /series` - the Discover catalog. */
export function useSeriesCatalog(): AsyncResource<readonly CatalogSeries[]> {
  const [series, setSeries] = useState<readonly CatalogSeries[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  /**
   * Whether a request is in flight, so a cover failure can JOIN it instead of
   * starting a second one. That join is not only a saved request: it is what
   * makes it impossible for a silent recovery to supersede an in-flight
   * visible load and strand its `isLoading` forever, because a silent failure
   * settles nothing and so must never own the request id a spinner waits on.
   */
  const isFetchingRef = useRef(false);
  const recoveryBudget = useCoverRecoveryBudget();

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Only settles state inside the then/catch continuations, never
  // synchronously, so it is safe to call straight from the mount effect.
  const fetchSeries = useCallback((mode: FetchMode) => {
    const requestId = ++requestIdRef.current;
    isFetchingRef.current = true;

    return getSeriesCatalog()
      .then((fetched) => {
        // A superseded response settles nothing - not even the in-flight flag,
        // which now belongs to the newer request.
        if (requestIdRef.current !== requestId) {
          return;
        }

        isFetchingRef.current = false;

        if (!isMountedRef.current) {
          return;
        }

        setSeries(fetched);
        setError(null);
        setIsLoading(false);
      })
      .catch((caught: unknown) => {
        if (requestIdRef.current !== requestId) {
          return;
        }

        isFetchingRef.current = false;

        if (!isMountedRef.current || mode === 'silent') {
          return;
        }

        // No silent fall back to bundled fixtures: hiding a backend failure
        // behind mock data would make a broken catalog look healthy.
        setError(toError(caught, 'Failed to load the series catalog.'));
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    void fetchSeries('visible');
  }, [fetchSeries]);

  const refresh = useCallback(() => {
    recoveryBudget.replenish();
    setIsLoading(true);
    setError(null);
    void fetchSeries('visible');
  }, [fetchSeries, recoveryBudget]);

  /**
   * Stable across renders, so handing it to every poster through context
   * cannot re-render the Discover tree - and so all of them report into the
   * SAME budget, which is what turns four simultaneous expiries into one
   * request.
   */
  const recoverCover = useCallback<ReportCoverFailure>(
    (failedUrl) => {
      // Mock/demo covers are bundled assets with no endpoint behind them.
      if (!isSeriesMetadataRemote()) {
        return;
      }

      if (!recoveryBudget.claim(failedUrl, { isFetching: isFetchingRef.current })) {
        return;
      }

      void fetchSeries('silent');
    },
    [fetchSeries, recoveryBudget]
  );

  return { data: series, isLoading, error, refresh, recoverCover };
}

export type SeriesDetailResource = AsyncResource<CatalogSeriesDetail | undefined> & {
  /** True once the request resolved and the backend answered 404. */
  readonly isNotFound: boolean;
};

/**
 * `GET /series/:id` - Series Detail's own request.
 *
 * It fetches by id and depends on nothing Discover left in memory, so a cold
 * deep link into /series/<id> renders the same as a tap from the catalog. That
 * holds for cover recovery too: a failed detail cover refetches THIS series,
 * never the whole catalog.
 */
export function useSeriesDetail(id: string | undefined): SeriesDetailResource {
  /**
   * The settled result carries the id it belongs to. A route param change
   * therefore invalidates it by comparison instead of by an effect that
   * resets state - so the screen can never render the previous series under
   * the new id while the next request is in flight.
   */
  const [settled, setSettled] = useState<{
    readonly id: string;
    readonly detail: CatalogSeriesDetail | undefined;
  } | null>(null);
  const [error, setErrorState] = useState<{ readonly id: string; readonly error: Error } | null>(
    null
  );
  const requestIdRef = useRef(0);
  const isMountedRef = useRef(true);
  const isFetchingRef = useRef(false);
  const recoveryBudget = useCoverRecoveryBudget();

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // A missing route param is DERIVED below rather than pushed into state: the
  // mount effect must never settle state synchronously.
  const hasId = typeof id === 'string' && id.length > 0;

  const fetchDetail = useCallback(
    (mode: FetchMode) => {
      if (!hasId) {
        return Promise.resolve();
      }

      const requestId = ++requestIdRef.current;
      isFetchingRef.current = true;

      return getSeriesDetail(id)
        .then((fetched) => {
          if (requestIdRef.current !== requestId) {
            return;
          }

          isFetchingRef.current = false;

          if (!isMountedRef.current) {
            return;
          }

          setErrorState(null);
          setSettled({ id, detail: fetched });
        })
        .catch((caught: unknown) => {
          if (requestIdRef.current !== requestId) {
            return;
          }

          isFetchingRef.current = false;

          // A silent recovery failure leaves the screen exactly as it was. The
          // series is still rendered and only its artwork is missing; turning
          // that into a full-screen error would destroy a working screen over
          // a poster.
          if (!isMountedRef.current || mode === 'silent') {
            return;
          }

          setErrorState({ id, error: toError(caught, 'Failed to load the series.') });
        });
    },
    [hasId, id]
  );

  useEffect(() => {
    // An id change is an explicit load, exactly like a mount or a Retry, so it
    // hands back the one automatic attempt. Without this, a cover that failed
    // on the series the user looked at BEFORE would silently disable recovery
    // for the series they are looking at now. (On first mount the budget is
    // already full, so this is a no-op there.)
    recoveryBudget.replenish();
    void fetchDetail('visible');
  }, [fetchDetail, recoveryBudget]);

  const refresh = useCallback(() => {
    recoveryBudget.replenish();
    setSettled(null);
    setErrorState(null);
    void fetchDetail('visible');
  }, [fetchDetail, recoveryBudget]);

  const recoverCover = useCallback<ReportCoverFailure>(
    (failedUrl) => {
      if (!isSeriesMetadataRemote()) {
        return;
      }

      if (!recoveryBudget.claim(failedUrl, { isFetching: isFetchingRef.current })) {
        return;
      }

      void fetchDetail('silent');
    },
    [fetchDetail, recoveryBudget]
  );

  // Everything below is derived from "does the settled result belong to the id
  // being asked about right now?".
  const settledForId = hasId && settled?.id === id ? settled : null;
  const errorForId = hasId && error?.id === id ? error.error : null;

  return {
    data: settledForId?.detail,
    isLoading: hasId && settledForId === null && errorForId === null,
    error: errorForId,
    isNotFound: !hasId || (settledForId !== null && settledForId.detail === undefined),
    refresh,
    recoverCover,
  };
}
