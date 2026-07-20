import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { getItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';

type SeriesProgress = {
  readonly lastWatchedVideoId: string;
  readonly lastWatchedEpisodeNumber: number;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly updatedAt: string;
};

type PersistedSeriesProgress = {
  readonly progressBySeriesId: Record<string, SeriesProgress>;
};

const SERIES_PROGRESS_STORAGE_VERSION = 1;

// Don't offer to resume an episode that's already essentially finished -
// within this many seconds of the end, treat it as complete and restart
// from 0 next time instead of "resuming" at the very end.
const COMPLETION_THRESHOLD_SECONDS = 5;

function clampPositionSeconds(positionSeconds: number, durationSeconds?: number): number {
  const safePosition = Number.isFinite(positionSeconds) ? Math.max(0, positionSeconds) : 0;

  if (durationSeconds == null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return safePosition;
  }

  const clampedToDuration = Math.min(safePosition, durationSeconds);

  if (durationSeconds - clampedToDuration <= COMPLETION_THRESHOLD_SECONDS) {
    return 0;
  }

  return clampedToDuration;
}

type SeriesProgressContextValue = {
  readonly isHydrated: boolean;
  readonly getProgress: (seriesId: string) => SeriesProgress | undefined;
  readonly recordProgress: (
    seriesId: string,
    videoId: string,
    episodeNumber: number,
    positionSeconds?: number,
    durationSeconds?: number
  ) => void;
};

const SeriesProgressContext = createContext<SeriesProgressContextValue | null>(null);

export function SeriesProgressProvider({ children }: PropsWithChildren) {
  const [progressBySeriesId, setProgressBySeriesId] = useState<Record<string, SeriesProgress>>({});
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    getItem<PersistedSeriesProgress>(STORAGE_KEYS.seriesProgress, SERIES_PROGRESS_STORAGE_VERSION)
      .then((persisted) => {
        if (persisted?.progressBySeriesId) {
          setProgressBySeriesId(persisted.progressBySeriesId);
        }
      })
      .finally(() => {
        setIsHydrated(true);
      });
  }, []);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void setItem<PersistedSeriesProgress>(
      STORAGE_KEYS.seriesProgress,
      SERIES_PROGRESS_STORAGE_VERSION,
      { progressBySeriesId }
    );
  }, [progressBySeriesId, isHydrated]);

  const getProgress = useCallback(
    (seriesId: string) => progressBySeriesId[seriesId],
    [progressBySeriesId]
  );

  const recordProgress = useCallback(
    (
      seriesId: string,
      videoId: string,
      episodeNumber: number,
      positionSeconds = 0,
      durationSeconds?: number
    ) => {
      const clampedPositionSeconds = clampPositionSeconds(positionSeconds, durationSeconds);

      setProgressBySeriesId((current) => {
        const existing = current[seriesId];

        if (
          existing?.lastWatchedVideoId === videoId &&
          existing.positionSeconds === clampedPositionSeconds
        ) {
          return current;
        }

        return {
          ...current,
          [seriesId]: {
            lastWatchedVideoId: videoId,
            lastWatchedEpisodeNumber: episodeNumber,
            positionSeconds: clampedPositionSeconds,
            durationSeconds,
            updatedAt: new Date().toISOString(),
          },
        };
      });
    },
    []
  );

  const contextValue = useMemo(
    () => ({ isHydrated, getProgress, recordProgress }),
    [isHydrated, getProgress, recordProgress]
  );

  return (
    <SeriesProgressContext.Provider value={contextValue}>{children}</SeriesProgressContext.Provider>
  );
}

export function useSeriesProgress(): SeriesProgressContextValue {
  const contextValue = useContext(SeriesProgressContext);

  if (!contextValue) {
    throw new Error('useSeriesProgress must be used within SeriesProgressProvider');
  }

  return contextValue;
}
