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

import { getProgress as fetchRemoteProgress, upsertProgress } from '@/services/progress/progress-service';
import { getItem, removeItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
import type { UserSeriesProgress } from '@/types/progress';

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

/**
 * Explicit, typed sync command. Enqueued directly (and only) inside
 * `recordProgress`, using the exact arguments it already received (after
 * clamping) - never inferred from a state diff. See
 * `src/stores/video-interactions.tsx` for the mirrored architecture and full
 * rationale.
 */
type ProgressSyncCommand = {
  readonly seriesId: string;
  readonly videoId: string;
  readonly episodeNumber: number;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  readonly attempts: number;
  readonly enqueuedAt: number;
};

// Persisted separately from the progress data itself, so pending sync
// commands survive an app restart.
const SERIES_PROGRESS_QUEUE_STORAGE_KEY = '@mobile-app-ecc/series-progress-sync-queue';
const SERIES_PROGRESS_QUEUE_STORAGE_VERSION = 1;

type PersistedProgressSyncQueue = {
  readonly queue: readonly ProgressSyncCommand[];
};

// Tracks (per authenticated session) whether the one-time "local wins"
// first-login merge against the backend has already happened.
const SERIES_PROGRESS_SYNCED_STORAGE_KEY = '@mobile-app-ecc/series-progress-synced';
const SERIES_PROGRESS_SYNCED_STORAGE_VERSION = 1;

type PersistedSeriesProgressSyncFlag = {
  readonly hasSynced: boolean;
};

const MAX_SYNC_ATTEMPTS = 5;
const RETRY_BACKOFF_BASE_MS = 1000;
const RETRY_BACKOFF_CAP_MS = 15000;

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
  /** Additive field: true when at least one queued sync command was dropped
   * after exhausting its retry attempts. Existing consumers that ignore this
   * field are unaffected. */
  readonly hasSyncFailures: boolean;
};

const SeriesProgressContext = createContext<SeriesProgressContextValue | null>(null);

function persistProgressQueue(queue: readonly ProgressSyncCommand[]): Promise<void> {
  return setItem<PersistedProgressSyncQueue>(
    SERIES_PROGRESS_QUEUE_STORAGE_KEY,
    SERIES_PROGRESS_QUEUE_STORAGE_VERSION,
    { queue }
  );
}

/** Executes a single queued command against the backend. Throws on failure
 * so the caller (the drain loop) can retry/back off. */
async function executeProgressSyncCommand(command: ProgressSyncCommand): Promise<void> {
  await upsertProgress(
    command.seriesId,
    command.videoId,
    command.episodeNumber,
    command.positionSeconds,
    command.durationSeconds
  );
}

type DrainLoopParams = {
  readonly queueRef: MutableRefObject<ProgressSyncCommand[]>;
  readonly authRef: MutableRefObject<{ isAuthenticated: boolean; isAuthHydrated: boolean }>;
  readonly sessionEpochRef: MutableRefObject<number>;
  readonly isDrainingRef: MutableRefObject<boolean>;
  readonly onSyncFailure: () => void;
};

/**
 * Module-level (not a hook) recursive drain loop, so a scheduled retry can
 * call itself by name without any "self-referencing hook" ordering issue.
 * Drains the queue strictly FIFO, one command at a time. `isDrainingRef`
 * stays true across a scheduled retry's backoff window too, so a concurrent
 * enqueue can't start a second, overlapping drain loop.
 */
async function runProgressDrainLoop(params: DrainLoopParams, epochAtStart: number): Promise<void> {
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
      await executeProgressSyncCommand(command);
      queueRef.current = queueRef.current.slice(1);
      await persistProgressQueue(queueRef.current);
    } catch {
      const attempts = command.attempts + 1;

      if (attempts >= MAX_SYNC_ATTEMPTS) {
        if (__DEV__) {
          console.warn(
            '[SeriesProgress] Dropping sync command after exhausting retry attempts.',
            command
          );
        }

        queueRef.current = queueRef.current.slice(1);
        await persistProgressQueue(queueRef.current);
        onSyncFailure();
        continue;
      }

      queueRef.current = [{ ...command, attempts }, ...queueRef.current.slice(1)];
      await persistProgressQueue(queueRef.current);

      const backoffMs = Math.min(RETRY_BACKOFF_BASE_MS * attempts, RETRY_BACKOFF_CAP_MS);

      setTimeout(() => {
        if (sessionEpochRef.current === epochAtStart) {
          void runProgressDrainLoop(params, epochAtStart);
        }
      }, backoffMs);

      return;
    }
  }

  isDrainingRef.current = false;
}

/**
 * Direct (non-queued) convergence push used ONLY by the first-login merge's
 * one-time "local wins" convergence loop below - structurally distinct from
 * `queueRef`, never observed by the queue-drain logic. Best-effort:
 * swallows all errors.
 */
async function pushProgressConvergence(seriesId: string, progress: SeriesProgress): Promise<void> {
  try {
    await upsertProgress(
      seriesId,
      progress.lastWatchedVideoId,
      progress.lastWatchedEpisodeNumber,
      progress.positionSeconds,
      progress.durationSeconds
    );
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[SeriesProgress] Failed to converge progress to backend during first-login merge.',
        error
      );
    }
  }
}

export function SeriesProgressProvider({ children }: PropsWithChildren) {
  const [progressBySeriesId, setProgressState] = useState<Record<string, SeriesProgress>>({});
  const [isHydrated, setIsHydrated] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
  const [hasSyncFailures, setHasSyncFailures] = useState(false);
  const { isAuthenticated, isHydrated: isAuthHydrated } = useAuth();

  // The ref IS the synchronous source of truth for reads/writes. React
  // state (`progressBySeriesId`) exists purely to trigger re-renders and is
  // always set to a snapshot (the same object reference) of the ref.
  const progressRef = useRef<Record<string, SeriesProgress>>({});

  const queueRef = useRef<ProgressSyncCommand[]>([]);
  const isDrainingRef = useRef(false);
  const hasMergeStartedRef = useRef(false);
  const wasAuthenticatedRef = useRef(false);
  const sessionEpochRef = useRef(0);
  const authRef = useRef({ isAuthenticated, isAuthHydrated });

  useEffect(() => {
    authRef.current = { isAuthenticated, isAuthHydrated };
  }, [isAuthenticated, isAuthHydrated]);

  const commitProgress = useCallback((next: Record<string, SeriesProgress>) => {
    progressRef.current = next;
    setProgressState(next);
  }, []);

  // Hydration: loads persisted local progress. Writes directly to the ref +
  // state, exactly as before. Does NOT touch the sync queue at all.
  useEffect(() => {
    getItem<PersistedSeriesProgress>(STORAGE_KEYS.seriesProgress, SERIES_PROGRESS_STORAGE_VERSION)
      .then((persisted) => {
        if (persisted?.progressBySeriesId) {
          commitProgress(persisted.progressBySeriesId);
        }
      })
      .finally(() => {
        setIsHydrated(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    getItem<PersistedSeriesProgressSyncFlag>(
      SERIES_PROGRESS_SYNCED_STORAGE_KEY,
      SERIES_PROGRESS_SYNCED_STORAGE_VERSION
    ).then((persisted) => {
      if (persisted?.hasSynced) {
        setHasSynced(true);
      }
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
    void runProgressDrainLoop(
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

  // Load any queue persisted from a prior session, then attempt to drain it
  // once ready.
  useEffect(() => {
    getItem<PersistedProgressSyncQueue>(
      SERIES_PROGRESS_QUEUE_STORAGE_KEY,
      SERIES_PROGRESS_QUEUE_STORAGE_VERSION
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

  useEffect(() => {
    if (isAuthenticated && isAuthHydrated) {
      drainQueue();
    }
  }, [isAuthenticated, isAuthHydrated, drainQueue]);

  // Logout: pending user-scoped jobs are explicitly discarded (acceptable
  // per the approved design). Bumping the epoch neutralizes any in-flight
  // retry `setTimeout` from this session.
  useEffect(() => {
    if (wasAuthenticatedRef.current && !isAuthenticated) {
      queueRef.current = [];
      void removeItem(SERIES_PROGRESS_QUEUE_STORAGE_KEY);
      sessionEpochRef.current += 1;
      isDrainingRef.current = false;
      setHasSyncFailures(false);
    }

    wasAuthenticatedRef.current = isAuthenticated;
  }, [isAuthenticated]);

  // First-login merge - completely separate from the queue. Adds
  // remote-only series directly to local state (never overwriting an
  // existing local entry), then pushes every local entry that differs from
  // remote DIRECTLY (not via the queue). Best-effort throughout.
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
      let remoteProgressList: readonly UserSeriesProgress[] = [];

      try {
        remoteProgressList = await fetchRemoteProgress();
      } catch (error) {
        if (__DEV__) {
          console.warn(
            '[SeriesProgress] Failed to fetch remote progress for first-login merge.',
            error
          );
        }
      }

      const remoteBySeriesId = new Map(
        remoteProgressList.map((progress) => [progress.seriesId, progress])
      );

      const localSnapshot = progressRef.current;

      let hasNewEntries = false;
      const merged = { ...localSnapshot };

      for (const remote of remoteProgressList) {
        if (!(remote.seriesId in localSnapshot)) {
          merged[remote.seriesId] = {
            lastWatchedVideoId: remote.videoId,
            lastWatchedEpisodeNumber: remote.episodeNumber,
            positionSeconds: remote.positionSeconds,
            durationSeconds: remote.durationSeconds,
            updatedAt: new Date().toISOString(),
          };
          hasNewEntries = true;
        }
      }

      if (hasNewEntries) {
        commitProgress(merged);
      }

      for (const [seriesId, localProgress] of Object.entries(localSnapshot)) {
        const remote = remoteBySeriesId.get(seriesId);
        const needsPush =
          !remote ||
          remote.videoId !== localProgress.lastWatchedVideoId ||
          remote.episodeNumber !== localProgress.lastWatchedEpisodeNumber ||
          remote.positionSeconds !== localProgress.positionSeconds ||
          remote.durationSeconds !== localProgress.durationSeconds;

        if (needsPush) {
          await pushProgressConvergence(seriesId, localProgress);
        }
      }

      setHasSynced(true);
      void setItem<PersistedSeriesProgressSyncFlag>(
        SERIES_PROGRESS_SYNCED_STORAGE_KEY,
        SERIES_PROGRESS_SYNCED_STORAGE_VERSION,
        { hasSynced: true }
      );
    })();
  }, [isHydrated, isAuthHydrated, isAuthenticated, hasSynced, commitProgress]);

  const getProgress = useCallback(
    (seriesId: string) => progressRef.current[seriesId],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progressBySeriesId]
  );

  const enqueueCommand = useCallback(
    (command: ProgressSyncCommand) => {
      queueRef.current = [...queueRef.current, command];
      void persistProgressQueue(queueRef.current);
      drainQueue();
    },
    [drainQueue]
  );

  // recordProgress already receives seriesId/videoId/episodeNumber/
  // positionSeconds/durationSeconds as explicit arguments - no ambiguity to
  // resolve. Computes+writes via the ref, THEN enqueues directly using those
  // exact (already-clamped) arguments.
  const recordProgress = useCallback(
    (
      seriesId: string,
      videoId: string,
      episodeNumber: number,
      positionSeconds = 0,
      durationSeconds?: number
    ) => {
      const clampedPositionSeconds = clampPositionSeconds(positionSeconds, durationSeconds);
      const existing = progressRef.current[seriesId];

      if (
        existing?.lastWatchedVideoId === videoId &&
        existing.positionSeconds === clampedPositionSeconds
      ) {
        return;
      }

      commitProgress({
        ...progressRef.current,
        [seriesId]: {
          lastWatchedVideoId: videoId,
          lastWatchedEpisodeNumber: episodeNumber,
          positionSeconds: clampedPositionSeconds,
          durationSeconds,
          updatedAt: new Date().toISOString(),
        },
      });

      enqueueCommand({
        seriesId,
        videoId,
        episodeNumber,
        positionSeconds: clampedPositionSeconds,
        durationSeconds,
        attempts: 0,
        enqueuedAt: Date.now(),
      });
    },
    [commitProgress, enqueueCommand]
  );

  const contextValue = useMemo(
    () => ({ isHydrated, getProgress, recordProgress, hasSyncFailures }),
    [isHydrated, getProgress, recordProgress, hasSyncFailures]
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
