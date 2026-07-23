import {
  MutableRefObject,
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  getInteractions,
  likeVideo,
  saveVideo,
  unlikeVideo,
  unsaveVideo,
} from '@/services/interactions/interactions-service';
import { getItem, removeItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
import type { UserInteraction } from '@/types/interaction';
import type { Video } from '@/types/video';

type VideoInteraction = {
  readonly isLiked: boolean;
  readonly isSaved: boolean;
};

type PersistedVideoInteractions = {
  readonly interactions: Record<string, VideoInteraction>;
};

const VIDEO_INTERACTIONS_STORAGE_VERSION = 1;

const defaultInteraction: VideoInteraction = {
  isLiked: false,
  isSaved: false,
};

/**
 * Explicit, typed sync commands. Enqueued directly (and only) at the point
 * of a user action inside `toggleLike`/`toggleSave` - never inferred from a
 * state diff. See DECISIONS.md "Phase 9 resumed with a replacement
 * architecture for 9-M2" for the full rationale: the previous 3 attempts all
 * failed variations of "distinguish merge/hydration-caused state changes
 * from user-caused ones via shared reactive state" - this architecture has
 * no shared reactive-state mechanism for that confusion to occur through.
 */
type InteractionSyncCommand =
  | { kind: 'like'; videoId: string; targetIsLiked: true; attempts: number; enqueuedAt: number }
  | { kind: 'unlike'; videoId: string; targetIsLiked: false; attempts: number; enqueuedAt: number }
  | { kind: 'save'; videoId: string; targetIsSaved: true; attempts: number; enqueuedAt: number }
  | { kind: 'unsave'; videoId: string; targetIsSaved: false; attempts: number; enqueuedAt: number };

// Persisted separately from the interaction data itself, so pending sync
// commands survive an app restart (a failed/queued push must never be
// silently lost just because the app was closed before it drained).
const VIDEO_INTERACTIONS_QUEUE_STORAGE_KEY = '@mobile-app-ecc/video-interactions-sync-queue';
const VIDEO_INTERACTIONS_QUEUE_STORAGE_VERSION = 1;

type PersistedInteractionSyncQueue = {
  readonly queue: readonly InteractionSyncCommand[];
};

// Tracks (per authenticated session) whether the one-time "local wins"
// first-login merge against the backend has already happened, so a
// returning already-synced user doesn't redundantly re-push everything on
// every cold start.
const VIDEO_INTERACTIONS_SYNCED_STORAGE_KEY = '@mobile-app-ecc/video-interactions-synced';
const VIDEO_INTERACTIONS_SYNCED_STORAGE_VERSION = 1;

type PersistedVideoInteractionsSyncFlag = {
  readonly hasSynced: boolean;
};

const MAX_SYNC_ATTEMPTS = 5;
const RETRY_BACKOFF_BASE_MS = 1000;
const RETRY_BACKOFF_CAP_MS = 15000;

type VideoInteractionsContextValue = {
  readonly isHydrated: boolean;
  readonly getInteraction: (videoId: string) => VideoInteraction;
  readonly getLikeCount: (video: Video) => number;
  readonly savedVideoIds: readonly string[];
  readonly likedVideoIds: readonly string[];
  readonly toggleLike: (videoId: string) => void;
  readonly toggleSave: (videoId: string) => void;
  /** Additive field: true when at least one queued sync command was dropped
   * after exhausting its retry attempts. Existing consumers that ignore this
   * field are unaffected. */
  readonly hasSyncFailures: boolean;
};

const VideoInteractionsContext = createContext<VideoInteractionsContextValue | null>(null);

function persistInteractionQueue(queue: readonly InteractionSyncCommand[]): Promise<void> {
  return setItem<PersistedInteractionSyncQueue>(
    VIDEO_INTERACTIONS_QUEUE_STORAGE_KEY,
    VIDEO_INTERACTIONS_QUEUE_STORAGE_VERSION,
    { queue }
  );
}

/** Executes a single queued command against the backend. Throws on failure
 * so the caller (the drain loop) can retry/back off. */
async function executeInteractionSyncCommand(command: InteractionSyncCommand): Promise<void> {
  switch (command.kind) {
    case 'like':
      await likeVideo(command.videoId);
      return;
    case 'unlike':
      await unlikeVideo(command.videoId);
      return;
    case 'save':
      await saveVideo(command.videoId);
      return;
    case 'unsave':
      await unsaveVideo(command.videoId);
      return;
  }
}

type DrainLoopParams = {
  readonly queueRef: MutableRefObject<InteractionSyncCommand[]>;
  readonly authRef: MutableRefObject<{ isAuthenticated: boolean; isAuthHydrated: boolean }>;
  readonly sessionEpochRef: MutableRefObject<number>;
  readonly isDrainingRef: MutableRefObject<boolean>;
  readonly onSyncFailure: () => void;
};

/**
 * Module-level (not a hook) recursive drain loop, so a scheduled retry can
 * call itself by name without any "self-referencing hook" ordering issue.
 * Drains the queue strictly FIFO, one command at a time - globally ordered
 * (not just per-entity), which gives per-entity ordering "for free".
 * `isDrainingRef` stays true across a scheduled retry's backoff window too,
 * so a concurrent enqueue can't start a second, overlapping drain loop.
 */
async function runInteractionDrainLoop(params: DrainLoopParams, epochAtStart: number): Promise<void> {
  const { queueRef, authRef, sessionEpochRef, isDrainingRef, onSyncFailure } = params;

  while (queueRef.current.length > 0) {
    if (sessionEpochRef.current !== epochAtStart) {
      return;
    }

    const authNow = authRef.current;

    if (!authNow.isAuthenticated || !authNow.isAuthHydrated) {
      break;
    }

    const command = queueRef.current[0];

    try {
      await executeInteractionSyncCommand(command);
      queueRef.current = queueRef.current.slice(1);
      await persistInteractionQueue(queueRef.current);
    } catch {
      const attempts = command.attempts + 1;

      if (attempts >= MAX_SYNC_ATTEMPTS) {
        if (__DEV__) {
          console.warn(
            '[VideoInteractions] Dropping sync command after exhausting retry attempts.',
            command
          );
        }

        queueRef.current = queueRef.current.slice(1);
        await persistInteractionQueue(queueRef.current);
        onSyncFailure();
        continue;
      }

      queueRef.current = [{ ...command, attempts }, ...queueRef.current.slice(1)];
      await persistInteractionQueue(queueRef.current);

      const backoffMs = Math.min(RETRY_BACKOFF_BASE_MS * attempts, RETRY_BACKOFF_CAP_MS);

      setTimeout(() => {
        if (sessionEpochRef.current === epochAtStart) {
          void runInteractionDrainLoop(params, epochAtStart);
        }
      }, backoffMs);

      return;
    }
  }

  isDrainingRef.current = false;
}

/**
 * Direct (non-queued) convergence push used ONLY by the first-login merge's
 * one-time "local wins" convergence loop below. This is structurally
 * distinct from `queueRef` - it can never be misclassified as a queued user
 * action, and the queue-drain logic never observes it. Best-effort: swallows
 * all errors, matching prior phases' convention for background sync.
 */
async function pushInteractionConvergence(
  videoId: string,
  local: VideoInteraction,
  remote: UserInteraction | undefined
): Promise<void> {
  try {
    if (local.isLiked !== (remote?.isLiked ?? false)) {
      if (local.isLiked) {
        await likeVideo(videoId);
      } else {
        await unlikeVideo(videoId);
      }
    }

    if (local.isSaved !== (remote?.isSaved ?? false)) {
      if (local.isSaved) {
        await saveVideo(videoId);
      } else {
        await unsaveVideo(videoId);
      }
    }
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[VideoInteractions] Failed to converge interaction to backend during first-login merge.',
        error
      );
    }
  }
}

export function VideoInteractionsProvider({ children }: PropsWithChildren) {
  const [interactions, setInteractionsState] = useState<Record<string, VideoInteraction>>({});
  const [isHydrated, setIsHydrated] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
  const [hasSyncFailures, setHasSyncFailures] = useState(false);
  const { isAuthenticated, isHydrated: isAuthHydrated } = useAuth();

  // The ref IS the synchronous source of truth for reads/writes. React state
  // (`interactions`) exists purely to trigger re-renders and is always set
  // to a snapshot (the same object reference) of the ref - never lagged
  // behind it via a separate mirroring effect.
  const interactionsRef = useRef<Record<string, VideoInteraction>>({});

  const queueRef = useRef<InteractionSyncCommand[]>([]);
  const isDrainingRef = useRef(false);
  const hasMergeStartedRef = useRef(false);
  const wasAuthenticatedRef = useRef(false);
  // Bumped on logout to invalidate any in-flight retry `setTimeout` from a
  // previous session, so a stale retry can never fire against a new session.
  const sessionEpochRef = useRef(0);
  const authRef = useRef({ isAuthenticated, isAuthHydrated });

  useEffect(() => {
    authRef.current = { isAuthenticated, isAuthHydrated };
  }, [isAuthenticated, isAuthHydrated]);

  const commitInteractions = useCallback((next: Record<string, VideoInteraction>) => {
    interactionsRef.current = next;
    setInteractionsState(next);
  }, []);

  // Hydration: loads persisted local interactions. Writes directly to the
  // ref + state, exactly as before. Does NOT touch the sync queue at all.
  useEffect(() => {
    getItem<PersistedVideoInteractions>(
      STORAGE_KEYS.videoInteractions,
      VIDEO_INTERACTIONS_STORAGE_VERSION
    )
      .then((persisted) => {
        if (persisted?.interactions) {
          commitInteractions(persisted.interactions);
        }
      })
      .finally(() => {
        setIsHydrated(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getItem<PersistedVideoInteractionsSyncFlag>(
      VIDEO_INTERACTIONS_SYNCED_STORAGE_KEY,
      VIDEO_INTERACTIONS_SYNCED_STORAGE_VERSION
    ).then((persisted) => {
      if (persisted?.hasSynced) {
        setHasSynced(true);
      }
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

  const drainQueue = useCallback(() => {
    if (isDrainingRef.current) {
      return;
    }

    const authSnapshot = authRef.current;

    if (!authSnapshot.isAuthenticated || !authSnapshot.isAuthHydrated) {
      return;
    }

    if (queueRef.current.length === 0) {
      return;
    }

    isDrainingRef.current = true;
    void runInteractionDrainLoop(
      {
        queueRef,
        authRef,
        sessionEpochRef,
        isDrainingRef,
        onSyncFailure: () => setHasSyncFailures(true),
      },
      sessionEpochRef.current
    );
  }, []);

  // Load any queue persisted from a prior session (so pending commands
  // survive an app restart), then attempt to drain it once ready.
  useEffect(() => {
    getItem<PersistedInteractionSyncQueue>(
      VIDEO_INTERACTIONS_QUEUE_STORAGE_KEY,
      VIDEO_INTERACTIONS_QUEUE_STORAGE_VERSION
    )
      .then((persisted) => {
        if (persisted?.queue?.length) {
          queueRef.current = [...persisted.queue];
        }
      })
      .finally(() => {
        drainQueue();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drain whenever auth becomes ready (covers mount-time retry of commands
  // persisted from a prior session, and the moment login/hydration completes).
  useEffect(() => {
    if (isAuthenticated && isAuthHydrated) {
      drainQueue();
    }
  }, [isAuthenticated, isAuthHydrated, drainQueue]);

  // Logout: pending user-scoped jobs are explicitly discarded (acceptable
  // per the approved design - not required to preserve them across users).
  // Bumping the epoch neutralizes any in-flight retry `setTimeout` from this
  // session, and resetting `isDrainingRef` ensures a later login's drain
  // isn't permanently blocked by a drain that was interrupted mid-backoff.
  useEffect(() => {
    if (wasAuthenticatedRef.current && !isAuthenticated) {
      queueRef.current = [];
      void removeItem(VIDEO_INTERACTIONS_QUEUE_STORAGE_KEY);
      sessionEpochRef.current += 1;
      isDrainingRef.current = false;
      setHasSyncFailures(false);
    }

    wasAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // First-login merge - completely separate from the queue. Once hydration
  // (both this store's and auth's) is done, the user is authenticated, and
  // first-sync hasn't happened yet: pull the remote list, add any
  // remote-only entries directly to local state (never overwriting an
  // existing local entry - satisfies "must not overwrite newer user
  // actions"), then push every local entry that differs from remote
  // DIRECTLY (not via the queue - this is a one-time bootstrap convergence
  // action, structurally distinct from the per-action queue). Best-effort
  // throughout.
  useEffect(() => {
    if (
      !isHydrated ||
      !isAuthHydrated ||
      !isAuthenticated ||
      hasSynced ||
      hasMergeStartedRef.current
    ) {
      return;
    }

    hasMergeStartedRef.current = true;

    (async () => {
      let remoteInteractions: readonly UserInteraction[] = [];

      try {
        remoteInteractions = await getInteractions();
      } catch (error) {
        if (__DEV__) {
          console.warn(
            '[VideoInteractions] Failed to fetch remote interactions for first-login merge.',
            error
          );
        }
      }

      const remoteByVideoId = new Map(
        remoteInteractions.map((interaction) => [interaction.videoId, interaction])
      );

      // Snapshot local state as it stood at merge start, for both "which
      // entries need a convergence push" and "which videoIds already exist
      // locally" (only missing entries get added from remote).
      const localSnapshot = interactionsRef.current;

      let hasNewEntries = false;
      const merged = { ...localSnapshot };

      for (const remote of remoteInteractions) {
        if (!(remote.videoId in localSnapshot)) {
          merged[remote.videoId] = { isLiked: remote.isLiked, isSaved: remote.isSaved };
          hasNewEntries = true;
        }
      }

      if (hasNewEntries) {
        commitInteractions(merged);
      }

      for (const [videoId, localInteraction] of Object.entries(localSnapshot)) {
        const remote = remoteByVideoId.get(videoId);
        const needsPush =
          !remote ||
          remote.isLiked !== localInteraction.isLiked ||
          remote.isSaved !== localInteraction.isSaved;

        if (needsPush) {
          await pushInteractionConvergence(videoId, localInteraction, remote);
        }
      }

      setHasSynced(true);
      void setItem<PersistedVideoInteractionsSyncFlag>(
        VIDEO_INTERACTIONS_SYNCED_STORAGE_KEY,
        VIDEO_INTERACTIONS_SYNCED_STORAGE_VERSION,
        { hasSynced: true }
      );
    })();
  }, [isHydrated, isAuthHydrated, isAuthenticated, hasSynced, commitInteractions]);

  const getInteraction = useCallback(
    (videoId: string) => interactionsRef.current[videoId] ?? defaultInteraction,
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const enqueueCommand = useCallback(
    (command: InteractionSyncCommand) => {
      queueRef.current = [...queueRef.current, command];
      void persistInteractionQueue(queueRef.current);
      drainQueue();
    },
    [drainQueue]
  );

  // toggleLike/toggleSave: compute the next value from `interactionsRef`
  // (already-current, since it's the synchronous source of truth), write it
  // to the ref + state, THEN push a new command onto the queue - all in the
  // same synchronous function call, no timing ambiguity possible.
  const toggleLike = useCallback(
    (videoId: string) => {
      const currentInteraction = interactionsRef.current[videoId] ?? defaultInteraction;
      const nextIsLiked = !currentInteraction.isLiked;

      commitInteractions({
        ...interactionsRef.current,
        [videoId]: { ...currentInteraction, isLiked: nextIsLiked },
      });

      enqueueCommand(
        nextIsLiked
          ? { kind: 'like', videoId, targetIsLiked: true, attempts: 0, enqueuedAt: Date.now() }
          : { kind: 'unlike', videoId, targetIsLiked: false, attempts: 0, enqueuedAt: Date.now() }
      );
    },
    [commitInteractions, enqueueCommand]
  );

  const toggleSave = useCallback(
    (videoId: string) => {
      const currentInteraction = interactionsRef.current[videoId] ?? defaultInteraction;
      const nextIsSaved = !currentInteraction.isSaved;

      commitInteractions({
        ...interactionsRef.current,
        [videoId]: { ...currentInteraction, isSaved: nextIsSaved },
      });

      enqueueCommand(
        nextIsSaved
          ? { kind: 'save', videoId, targetIsSaved: true, attempts: 0, enqueuedAt: Date.now() }
          : { kind: 'unsave', videoId, targetIsSaved: false, attempts: 0, enqueuedAt: Date.now() }
      );
    },
    [commitInteractions, enqueueCommand]
  );

  const contextValue = useMemo(
    () => ({
      isHydrated,
      getInteraction,
      getLikeCount,
      savedVideoIds,
      likedVideoIds,
      toggleLike,
      toggleSave,
      hasSyncFailures,
    }),
    [
      isHydrated,
      getInteraction,
      getLikeCount,
      savedVideoIds,
      likedVideoIds,
      toggleLike,
      toggleSave,
      hasSyncFailures,
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
