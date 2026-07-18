import { PropsWithChildren, createContext, useCallback, useContext, useMemo, useState } from 'react';

type SeriesProgress = {
  readonly lastWatchedVideoId: string;
  readonly lastWatchedEpisodeNumber: number;
};

type SeriesProgressContextValue = {
  readonly getProgress: (seriesId: string) => SeriesProgress | undefined;
  readonly recordProgress: (seriesId: string, videoId: string, episodeNumber: number) => void;
};

const SeriesProgressContext = createContext<SeriesProgressContextValue | null>(null);

export function SeriesProgressProvider({ children }: PropsWithChildren) {
  const [progressBySeriesId, setProgressBySeriesId] = useState<Record<string, SeriesProgress>>({});

  const getProgress = useCallback(
    (seriesId: string) => progressBySeriesId[seriesId],
    [progressBySeriesId]
  );

  const recordProgress = useCallback(
    (seriesId: string, videoId: string, episodeNumber: number) => {
      setProgressBySeriesId((current) => {
        const existing = current[seriesId];

        if (existing?.lastWatchedVideoId === videoId) {
          return current;
        }

        return {
          ...current,
          [seriesId]: { lastWatchedVideoId: videoId, lastWatchedEpisodeNumber: episodeNumber },
        };
      });
    },
    []
  );

  const contextValue = useMemo(() => ({ getProgress, recordProgress }), [getProgress, recordProgress]);

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
