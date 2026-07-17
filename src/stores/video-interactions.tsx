import { PropsWithChildren, createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { Video } from '@/types/video';

type VideoInteraction = {
  readonly isLiked: boolean;
  readonly isSaved: boolean;
};

type VideoInteractionsContextValue = {
  readonly getInteraction: (videoId: string) => VideoInteraction;
  readonly getLikeCount: (video: Video) => number;
  readonly savedVideoIds: readonly string[];
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
      getInteraction,
      getLikeCount,
      savedVideoIds,
      toggleLike,
      toggleSave,
    }),
    [getInteraction, getLikeCount, savedVideoIds, toggleLike, toggleSave]
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
