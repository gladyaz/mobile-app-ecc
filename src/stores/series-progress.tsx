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
 * Sentinel identity namespace used while not authenticated. Every key this
 * store touches is suffixed with the current identity (`user.id` once
 * authenticated, or this sentinel otherwise) - see `withIdentitySuffix` and
 * `loadIdentityScopedItem` below for the full rationale (fix for the
 * cross-account local-storage bleed defect found in Phase 9 QA). Mirrored
 * from `src/stores/video-interactions.tsx`.
 */
const GUEST_IDENTITY_KEY = 'guest';

function withIdentitySuffix(baseKey: string, identityKey: string): string {
  return `${baseKey}:${identityKey}`;
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
// commands survive an app restart. Base key - always used with an identity
// suffix, never directly.
const SERIES_PROGRESS_QUEUE_STORAGE_KEY = '@mobile-app-ecc/series-progress-sync-queue';
const SERIES_PROGRESS_QUEUE_STORAGE_VERSION = 1;

type PersistedProgressSyncQueue = {
  readonly queue: readonly ProgressSyncCommand[];
};

// Tracks (per authenticated identity) whether the one-time "local wins"
// first-login merge against the backend has already happened. Base key -
// always used with an identity suffix.
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

function persistProgressQueue(
  queueKey: string,
  queue: readonly ProgressSyncCommand[]
): Promise<void> {
  return setItem<PersistedProgressSyncQueue>(queueKey, SERIES_PROGRESS_QUEUE_STORAGE_VERSION, {
    queue,
  });
}

/**
 * Loads a value for the given identity namespace, with one-time "guest data
 * adoption": if this identity has no data of its own yet, but guest-scoped
 * (logged-out) data exists, that guest data is adopted as this identity's
 * starting point and the guest slot is then cleared so a LATER, different
 * identity logging in on this device does not also inherit it. Mirrored from
 * `src/stores/video-interactions.tsx`.
 */
async function loadIdentityScopedItem<T>(
  baseKey: string,
  version: number,
  identityKey: string
): Promise<T | undefined> {
  const ownKey = withIdentitySuffix(baseKey, identityKey);

  if (identityKey === GUEST_IDENTITY_KEY) {
    return getItem<T>(ownKey, version);
  }

  const own = await getItem<T>(ownKey, version);

  if (own !== undefined) {
    return own;
  }

  const guestKey = withIdentitySuffix(baseKey, GUEST_IDENTITY_KEY);
  const guestData = await getItem<T>(guestKey, version);

  if (guestData === undefined) {
    return undefined;
  }

  await setItem<T>(ownKey, version, guestData);
  await removeItem(guestKey);

  return guestData;
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
  readonly queueKey: string;
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
 * enqueue can't start a second, overlapping drain loop. `queueKey` is
 * captured once at drain-start time - the session-epoch check below already
 * guarantees the drain loop stops as soon as the identity changes, so the
 * key can never go stale mid-loop.
 */
async function runProgressDrainLoop(params: DrainLoopParams, epochAtStart: number): Promise<void> {
  const { queueRef, queueKey, authRef, sessionEpochRef, isDrainingRef, onSyncFailure } = params;

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
      await persistProgressQueue(queueKey, queueRef.current);
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
        await persistProgressQueue(queueKey, queueRef.current);
        onSyncFailure();
        continue;
      }

      queueRef.current = [{ ...command, attempts }, ...queueRef.current.slice(1)];
      await persistProgressQueue(queueKey, queueRef.current);

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
  const { isAuthenticated, isHydrated: isAuthHydrated, user } = useAuth();

  // The ref IS the synchronous source of truth for reads/writes. React
  // state (`progressBySeriesId`) exists purely to trigger re-renders and is
  // always set to a snapshot (the same object reference) of the ref.
  const progressRef = useRef<Record<string, SeriesProgress>>({});

  const queueRef = useRef<ProgressSyncCommand[]>([]);
  const isDrainingRef = useRef(false);
  const hasMergeStartedRef = useRef(false);
  const sessionEpochRef = useRef(0);
  const authRef = useRef({ isAuthenticated, isAuthHydrated });
  // Distinct from `null` (no identity resolved yet, i.e. "before first
  // effect run") so the first run always performs the initial hydration.
  const identityKeyRef = useRef<string | null>(null);

  // The namespace this store's storage keys are currently scoped to: the
  // authenticated user's id, or the guest sentinel when logged out.
  const identityKey = useMemo(
    () => (isAuthenticated && user ? user.id : GUEST_IDENTITY_KEY),
    [isAuthenticated, user]
  );

  useEffect(() => {
    authRef.current = { isAuthenticated, isAuthHydrated };
  }, [isAuthenticated, isAuthHydrated]);

  const commitProgress = useCallback((next: Record<string, SeriesProgress>) => {
    progressRef.current = next;
    setProgressState(next);
  }, []);

  // Persists a snapshot of `progressBySeriesId` under a specific,
  // already-resolved identity key, passed in explicitly by the caller (never
  // read from a ref or effect dependency at the time this function runs).
  // Called inline, in the same synchronous function call as every
  // `commitProgress` write below - never inferred later via a reactive
  // `[progressBySeriesId, isHydrated]` effect. Mirrors the fix in
  // `src/stores/video-interactions.tsx` for the same-commit
  // identity/action collision defect.
  const persistProgress = useCallback(
    (persistIdentityKey: string, next: Record<string, SeriesProgress>) => {
      void setItem<PersistedSeriesProgress>(
        withIdentitySuffix(STORAGE_KEYS.seriesProgress, persistIdentityKey),
        SERIES_PROGRESS_STORAGE_VERSION,
        { progressBySeriesId: next }
      );
    },
    []
  );

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
        queueKey: withIdentitySuffix(SERIES_PROGRESS_QUEUE_STORAGE_KEY, identityKey),
        authRef,
        sessionEpochRef,
        isDrainingRef,
        onSyncFailure: () => setHasSyncFailures(true),
      },
      sessionEpochRef.current
    );
  }, [identityKey]);

  // Identity-scoped hydration: (re-)runs whenever the current identity
  // (authenticated user id, or the guest sentinel) changes - not just once
  // on mount. Replaces whatever was in memory/storage-loaded for the
  // PREVIOUS identity with the new identity's own state (or empty, adopting
  // guest data at most once - see `loadIdentityScopedItem`).
  useEffect(() => {
    const previousIdentityKey = identityKeyRef.current;

    if (previousIdentityKey === identityKey) {
      return;
    }

    // True only when this transition is leaving a real (non-guest) identity
    // - i.e. a logout, or (never in practice, but handled safely regardless)
    // a direct switch between two authenticated identities. Never true for
    // the very first hydration on mount (`previousIdentityKey` is `null`).
    const isLeavingAuthenticatedIdentity =
      previousIdentityKey !== null && previousIdentityKey !== GUEST_IDENTITY_KEY;

    identityKeyRef.current = identityKey;
    sessionEpochRef.current += 1;
    const epochAtStart = sessionEpochRef.current;
    isDrainingRef.current = false;
    hasMergeStartedRef.current = false;
    setHasSyncFailures(false);
    setIsHydrated(false);

    (async () => {
      // Logout (or any departure from an authenticated identity): pending
      // user-scoped jobs are explicitly discarded (acceptable per the
      // approved design - not required to preserve them across users/sessions).
      if (isLeavingAuthenticatedIdentity) {
        queueRef.current = [];
        await removeItem(
          withIdentitySuffix(SERIES_PROGRESS_QUEUE_STORAGE_KEY, previousIdentityKey)
        );
      }

      const [persistedData, persistedSyncFlag, persistedQueue] = await Promise.all([
        loadIdentityScopedItem<PersistedSeriesProgress>(
          STORAGE_KEYS.seriesProgress,
          SERIES_PROGRESS_STORAGE_VERSION,
          identityKey
        ),
        loadIdentityScopedItem<PersistedSeriesProgressSyncFlag>(
          SERIES_PROGRESS_SYNCED_STORAGE_KEY,
          SERIES_PROGRESS_SYNCED_STORAGE_VERSION,
          identityKey
        ),
        isLeavingAuthenticatedIdentity
          ? Promise.resolve(undefined)
          : loadIdentityScopedItem<PersistedProgressSyncQueue>(
              SERIES_PROGRESS_QUEUE_STORAGE_KEY,
              SERIES_PROGRESS_QUEUE_STORAGE_VERSION,
              identityKey
            ),
      ]);

      // A newer identity change superseded this one mid-flight - discard
      // this now-stale result instead of clobbering the newer identity's state.
      if (sessionEpochRef.current !== epochAtStart) {
        return;
      }

      const hydratedProgress = persistedData?.progressBySeriesId ?? {};

      commitProgress(hydratedProgress);
      // `identityKey` here is the local closure captured at the START of
      // this hydration run (this effect's own dependency-array value, fixed
      // for the lifetime of this specific async invocation) - never re-read
      // from `identityKeyRef` later, so a hydration run for one identity can
      // never persist under a DIFFERENT identity's key even if the ref
      // moves on while this run is still in flight.
      persistProgress(identityKey, hydratedProgress);
      setHasSynced(Boolean(persistedSyncFlag?.hasSynced));
      queueRef.current = isLeavingAuthenticatedIdentity ? [] : [...(persistedQueue?.queue ?? [])];
      setIsHydrated(true);
      drainQueue();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  useEffect(() => {
    if (isAuthenticated && isAuthHydrated) {
      drainQueue();
    }
  }, [isAuthenticated, isAuthHydrated, drainQueue]);

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
    const epochAtStart = sessionEpochRef.current;

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

      // A newer identity change superseded this one mid-flight - discard
      // this now-stale merge result instead of clobbering the newer
      // identity's live state (mirrors the hydration effect's guard above).
      if (sessionEpochRef.current !== epochAtStart) {
        return;
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
        // `identityKey` is this effect's own dependency-array value, closed
        // over at the start of this merge run - stable for its lifetime.
        persistProgress(identityKey, merged);
      }

      for (const [seriesId, localProgress] of Object.entries(localSnapshot)) {
        // Re-checked on every iteration: an identity change mid-loop (not
        // just before the loop started) must also stop further pushes -
        // otherwise a partially-completed loop could keep pushing a stale
        // identity's data under a since-changed (now-current) auth session.
        if (sessionEpochRef.current !== epochAtStart) {
          return;
        }

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

      if (sessionEpochRef.current !== epochAtStart) {
        return;
      }

      setHasSynced(true);
      void setItem<PersistedSeriesProgressSyncFlag>(
        withIdentitySuffix(SERIES_PROGRESS_SYNCED_STORAGE_KEY, identityKey),
        SERIES_PROGRESS_SYNCED_STORAGE_VERSION,
        { hasSynced: true }
      );
    })();
  }, [
    isHydrated,
    isAuthHydrated,
    isAuthenticated,
    hasSynced,
    commitProgress,
    persistProgress,
    identityKey,
  ]);

  const getProgress = useCallback(
    (seriesId: string) => progressRef.current[seriesId],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [progressBySeriesId]
  );

  const enqueueCommand = useCallback(
    (command: ProgressSyncCommand) => {
      queueRef.current = [...queueRef.current, command];
      void persistProgressQueue(
        withIdentitySuffix(SERIES_PROGRESS_QUEUE_STORAGE_KEY, identityKey),
        queueRef.current
      );
      drainQueue();
    },
    [drainQueue, identityKey]
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

      const nextProgress = {
        ...progressRef.current,
        [seriesId]: {
          lastWatchedVideoId: videoId,
          lastWatchedEpisodeNumber: episodeNumber,
          positionSeconds: clampedPositionSeconds,
          durationSeconds,
          updatedAt: new Date().toISOString(),
        },
      };
      const persistIdentityKey = identityKeyRef.current ?? GUEST_IDENTITY_KEY;

      commitProgress(nextProgress);
      // Persisted inline, synchronously, using the identity key current AT
      // THIS EXACT POINT (captured as a local constant above) - see
      // `persistProgress` for the full rationale.
      persistProgress(persistIdentityKey, nextProgress);

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
    [commitProgress, enqueueCommand, persistProgress]
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
