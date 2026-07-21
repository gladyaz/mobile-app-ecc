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
import type { Video } from '@/types/video';

type VideoInteraction = {
  readonly isLiked: boolean;
  readonly isSaved: boolean;
};

type PersistedVideoInteractions = {
  readonly interactions: Record<string, VideoInteraction>;
};

const VIDEO_INTERACTIONS_STORAGE_VERSION = 1;

type VideoInteractionsContextValue = {
  readonly isHydrated: boolean;
  readonly getInteraction: (videoId: string) => VideoInteraction;
  readonly getLikeCount: (video: Video) => number;
  readonly savedVideoIds: readonly string[];
  readonly likedVideoIds: readonly string[];
  readonly toggleLike: (videoId: string) => void;
  readonly toggleSave: (videoId: string) => void;
};

const defaultInteraction: VideoInteraction = {
  isLiked: false,
  isSaved: false,
};

const VideoInteractionsContext = createContext<VideoInteractionsContextValue | null>(null);

export function VideoInteractionsProvider({ children }: PropsWithChildren) {
  const [interactions, setInteractions] = useState<Record<string, VideoInteraction>>({});
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    getItem<PersistedVideoInteractions>(
      STORAGE_KEYS.videoInteractions,
      VIDEO_INTERACTIONS_STORAGE_VERSION
    )
      .then((persisted) => {
        if (persisted?.interactions) {
          setInteractions(persisted.interactions);
        }
      })
      .finally(() => {
        setIsHydrated(true);
      });
  }, []);

  // Only persist once hydration has resolved, so we never overwrite storage
  // with the initial empty state before the real persisted data has loaded.
  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    void setItem<PersistedVideoInteractions>(
      STORAGE_KEYS.videoInteractions,
      VIDEO_INTERACTIONS_STORAGE_VERSION,
      { interactions }
    );
  }, [interactions, isHydrated]);

  const getInteraction = useCallback(
    (videoId: string) => interactions[videoId] ?? defaultInteraction,
    [interactions]
  );

  const getLikeCount = useCallback(
    (video: Video) => video.likeCount + (getInteraction(video.id).isLiked ? 1 : 0),
    [getInteraction]
  );

  const savedVideoIds = useMemo(
    () =>
      Object.entries(interactions)
        .filter(([, interaction]) => interaction.isSaved)
        .map(([videoId]) => videoId),
    [interactions]
  );

  const likedVideoIds = useMemo(
    () =>
      Object.entries(interactions)
        .filter(([, interaction]) => interaction.isLiked)
        .map(([videoId]) => videoId),
    [interactions]
  );

  const toggleLike = useCallback((videoId: string) => {
    setInteractions((currentInteractions) => {
      const currentInteraction = currentInteractions[videoId] ?? defaultInteraction;

      return {
        ...currentInteractions,
        [videoId]: {
          ...currentInteraction,
          isLiked: !currentInteraction.isLiked,
        },
      };
    });
  }, []);

  const toggleSave = useCallback((videoId: string) => {
    setInteractions((currentInteractions) => {
      const currentInteraction = currentInteractions[videoId] ?? defaultInteraction;

      return {
        ...currentInteractions,
        [videoId]: {
          ...currentInteraction,
          isSaved: !currentInteraction.isSaved,
        },
      };
    });
  }, []);

  const contextValue = useMemo(
    () => ({
      isHydrated,
      getInteraction,
      getLikeCount,
      savedVideoIds,
      likedVideoIds,
      toggleLike,
      toggleSave,
    }),
    [
      isHydrated,
      getInteraction,
      getLikeCount,
      savedVideoIds,
      likedVideoIds,
      toggleLike,
      toggleSave,
    ]
  );

  return (
    <VideoInteractionsContext.Provider value={contextValue}>
      {children}
    </VideoInteractionsContext.Provider>
  );
}

export function useVideoInteractions() {
  const contextValue = useContext(VideoInteractionsContext);

  if (!contextValue) {
    throw new Error('useVideoInteractions must be used within VideoInteractionsProvider');
  }

  return contextValue;
}
