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

/**
 * How many times the one-time first-login merge may be attempted in a single
 * session before it is left for the next cold start. Two is a blip's worth of
 * tolerance, not a reconnection strategy.
 */
const MAX_MERGE_ATTEMPTS = 2;

/** Long enough for a transient failure to clear, short enough to still matter. */
const MERGE_RETRY_DELAY_MS = 5000;

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
 * captured once at drain-start time and is safe to keep only because the
 * session-epoch is checked on BOTH sides of every network await - before the
 * request is sent and again before anything is mutated or persisted with the
 * result. Checking only before the send would leave the key stale for exactly
 * as long as a request takes.
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

      // RE-CHECKED AFTER THE AWAIT, not just before it. The check at the top
      // of the loop proves the identity was still ours when the request was
      // SENT; it says nothing about the moment the response lands. A sign-out
      // and sign-in during that window replaces `queueRef.current` with the
      // new session's queue, while `queueKey` still names the previous user's
      // storage slot - so slicing and persisting here would drop the NEW
      // user's first command and write their remaining queue under the OLD
      // user's key, to be replayed under the old user's token at their next
      // sign-in. Abandoning the result is safe: the command was not removed
      // from any queue, so it survives to be retried by whoever owns it.
      if (sessionEpochRef.current !== epochAtStart) {
        return;
      }

      queueRef.current = queueRef.current.slice(1);
      await persistProgressQueue(queueKey, queueRef.current);
    } catch {
      // Same window, same reason - see the success path above. The failure
      // path is if anything worse: it re-heads the stale command into
      // whatever queue is live now.
      if (sessionEpochRef.current !== epochAtStart) {
        return;
      }

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

/**
 * Account-deletion-only cleanup (Phase 12, work unit 12C-M1) - mirrors
 * `clearPersistedInteractionsForIdentity` in
 * `src/stores/video-interactions.tsx`; see that function's doc comment for
 * the full rationale. Removes EVERY key this store persists for a specific,
 * now-permanently-gone identity: the main progress data, the sync queue, and
 * the one-time first-login merge flag. Deliberately more aggressive than an
 * ordinary logout, which leaves this data behind on purpose for a possible
 * later login as the SAME account - account deletion has no such "later" to
 * preserve it for.
 */
export async function clearPersistedProgressForIdentity(identityKey: string): Promise<void> {
  await Promise.all([
    removeItem(withIdentitySuffix(STORAGE_KEYS.seriesProgress, identityKey)),
    removeItem(withIdentitySuffix(SERIES_PROGRESS_QUEUE_STORAGE_KEY, identityKey)),
    removeItem(withIdentitySuffix(SERIES_PROGRESS_SYNCED_STORAGE_KEY, identityKey)),
  ]);
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
  const mergeRetryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasMergeStartedRef = useRef(false);
  /**
   * Re-triggers the first-login merge after a failed remote pull.
   *
   * Releasing `hasMergeStartedRef` alone is NOT a retry: every other dependency
   * of the merge effect is stable for the life of a session, so nothing would
   * ever re-run it and the account would sit un-merged until the next cold
   * start. Bumping this state is what actually schedules another attempt.
   *
   * Bounded on purpose. A device that is simply offline must not re-drive the
   * merge forever, and the cost of stopping is small and self-healing: the
   * synced flag was never written, so the next launch tries again from scratch.
   */
  const mergeAttemptsRef = useRef(0);
  const [mergeAttempt, setMergeAttempt] = useState(0);
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

    // A merge retry scheduled for the previous identity must not fire under
    // this one - it would re-run the merge for an account that never failed.
    if (mergeRetryTimeoutRef.current !== null) {
      clearTimeout(mergeRetryTimeoutRef.current);
      mergeRetryTimeoutRef.current = null;
    }

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
            '[SeriesProgress] Failed to fetch remote progress for first-login merge; ' +
              'aborting the merge so it can be retried.',
            error
          );
        }

        // ABORT, rather than continue with an empty list. Continuing would
        // make a failed pull indistinguishable from "this account has no
        // remote progress", and the two lead to opposite outcomes: every
        // local entry would look like it needs a convergence push, so this
        // device's positions would be written over the server's NEWER ones -
        // and then `hasSynced` would be set, permanently, so the real remote
        // progress would never be pulled on this device again. One failed
        // request at first login would silently cost the account its
        // cross-device history.
        //
        // Releasing the started-flag lets the effect run again; bumping the
        // attempt counter is what makes it actually re-run, since none of its
        // other dependencies ever change within a session.
        hasMergeStartedRef.current = false;

        if (mergeAttemptsRef.current < MAX_MERGE_ATTEMPTS - 1) {
          mergeAttemptsRef.current += 1;

          mergeRetryTimeoutRef.current = setTimeout(() => {
            setMergeAttempt((attempt) => attempt + 1);
          }, MERGE_RETRY_DELAY_MS);
        }

        return;
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
    mergeAttempt,
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
