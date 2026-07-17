import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getVideoFeed } from '@/services/videos/video-service';
import type { Video } from '@/types/video';

type VideoCatalogContextValue = {
  readonly videos: readonly Video[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  readonly refresh: () => void;
};

const VideoCatalogContext = createContext<VideoCatalogContextValue | null>(null);

export function VideoCatalogProvider({ children }: PropsWithChildren) {
  const [videos, setVideos] = useState<readonly Video[]>([]);
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

  // Only settles state inside the then/catch continuations (never
  // synchronously), so it is safe to call directly from the mount effect.
  const fetchVideos = useCallback(() => {
    const requestId = ++requestIdRef.current;

    return getVideoFeed()
      .then((fetchedVideos) => {
        if (!isMountedRef.current || requestIdRef.current !== requestId) {
          return;
        }

        setVideos(fetchedVideos);
        setError(null);
        setIsLoading(false);
      })
      .catch((caughtError: unknown) => {
        if (!isMountedRef.current || requestIdRef.current !== requestId) {
          return;
        }

        setError(caughtError instanceof Error ? caughtError : new Error('Failed to load videos.'));
        setIsLoading(false);
      });
  }, []);

  useEffect(() => {
    void fetchVideos();
  }, [fetchVideos]);

  // Resets loading/error synchronously before re-fetching. Only ever called
  // from a user-triggered event handler (e.g. a Retry button), never from
  // inside an effect.
  const refresh = useCallback(() => {
    setIsLoading(true);
    setError(null);
    void fetchVideos();
  }, [fetchVideos]);

  const contextValue = useMemo<VideoCatalogContextValue>(
    () => ({ videos, isLoading, error, refresh }),
    [videos, isLoading, error, refresh]
  );

  return (
    <VideoCatalogContext.Provider value={contextValue}>{children}</VideoCatalogContext.Provider>
  );
}

export function useVideoCatalog(): VideoCatalogContextValue {
  const contextValue = useContext(VideoCatalogContext);

  if (!contextValue) {
    throw new Error('useVideoCatalog must be used within VideoCatalogProvider');
  }

  return contextValue;
}
