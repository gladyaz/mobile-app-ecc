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
 * Sentinel identity namespace used while not authenticated. Every key this
 * store touches is suffixed with the current identity (`user.id` once
 * authenticated, or this sentinel otherwise) - see `withIdentitySuffix` and
 * `loadIdentityScopedItem` below for the full rationale (fix for the
 * cross-account local-storage bleed defect found in Phase 9 QA).
 */
const GUEST_IDENTITY_KEY = 'guest';

function withIdentitySuffix(baseKey: string, identityKey: string): string {
  return `${baseKey}:${identityKey}`;
}

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
// silently lost just because the app was closed before it drained). Base
// key - always used with an identity suffix, never directly.
const VIDEO_INTERACTIONS_QUEUE_STORAGE_KEY = '@mobile-app-ecc/video-interactions-sync-queue';
const VIDEO_INTERACTIONS_QUEUE_STORAGE_VERSION = 1;

type PersistedInteractionSyncQueue = {
  readonly queue: readonly InteractionSyncCommand[];
};

// Tracks (per authenticated identity) whether the one-time "local wins"
// first-login merge against the backend has already happened, so a
// returning already-synced user doesn't redundantly re-push everything on
// every cold start. Base key - always used with an identity suffix.
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

function persistInteractionQueue(
  queueKey: string,
  queue: readonly InteractionSyncCommand[]
): Promise<void> {
  return setItem<PersistedInteractionSyncQueue>(
    queueKey,
    VIDEO_INTERACTIONS_QUEUE_STORAGE_VERSION,
    { queue }
  );
}

/**
 * Loads a value for the given identity namespace, with one-time "guest data
 * adoption": if this identity has no data of its own yet, but guest-scoped
 * (logged-out) data exists, that guest data is adopted as this identity's
 * starting point and the guest slot is then cleared so a LATER, different
 * identity logging in on this device does not also inherit it. This is
 * exactly the fix for the Phase 9 QA cross-account bleed defect: adoption
 * only ever happens once, for whichever identity is first to claim it.
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
  readonly queueKey: string;
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
 * `queueKey` is captured once at drain-start time (not re-read from a ref),
 * because the session-epoch check below already guarantees the drain loop
 * stops as soon as the identity changes - so the key can never go stale
 * mid-loop.
 */
async function runInteractionDrainLoop(params: DrainLoopParams, epochAtStart: number): Promise<void> {
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
      await executeInteractionSyncCommand(command);
      queueRef.current = queueRef.current.slice(1);
      await persistInteractionQueue(queueKey, queueRef.current);
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
        await persistInteractionQueue(queueKey, queueRef.current);
        onSyncFailure();
        continue;
      }

      queueRef.current = [{ ...command, attempts }, ...queueRef.current.slice(1)];
      await persistInteractionQueue(queueKey, queueRef.current);

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
  const { isAuthenticated, isHydrated: isAuthHydrated, user } = useAuth();

  // The ref IS the synchronous source of truth for reads/writes. React state
  // (`interactions`) exists purely to trigger re-renders and is always set
  // to a snapshot (the same object reference) of the ref - never lagged
  // behind it via a separate mirroring effect.
  const interactionsRef = useRef<Record<string, VideoInteraction>>({});

  const queueRef = useRef<InteractionSyncCommand[]>([]);
  const isDrainingRef = useRef(false);
  const hasMergeStartedRef = useRef(false);
  // Bumped on every identity change to invalidate any in-flight retry
  // `setTimeout`/hydration-in-flight from a previous identity, so stale work
  // can never apply itself against a new identity.
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

  const commitInteractions = useCallback((next: Record<string, VideoInteraction>) => {
    interactionsRef.current = next;
    setInteractionsState(next);
  }, []);

  // Persists a snapshot of `interactions` under a specific, already-resolved
  // identity key, passed in explicitly by the caller (never read from a ref
  // or effect dependency at the time this function runs). Called inline, in
  // the same synchronous function call as every `commitInteractions` write
  // below - never inferred later via a reactive `[interactions, isHydrated]`
  // effect. This is the fix for the same-commit identity/action collision
  // defect: a generic persist effect can observe a NEWER identity (updated by
  // the hydration effect, which runs first in hook order within the same
  // commit) while still reacting to interaction state that was written under
  // the OLDER identity - misattributing one identity's data to another's
  // storage slot. Persisting at the exact synchronous point of each write,
  // using the identity key known at that exact moment, makes that
  // misattribution structurally impossible.
  const persistInteractions = useCallback(
    (persistIdentityKey: string, next: Record<string, VideoInteraction>) => {
      void setItem<PersistedVideoInteractions>(
        withIdentitySuffix(STORAGE_KEYS.videoInteractions, persistIdentityKey),
        VIDEO_INTERACTIONS_STORAGE_VERSION,
        { interactions: next }
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
    void runInteractionDrainLoop(
      {
        queueRef,
        queueKey: withIdentitySuffix(VIDEO_INTERACTIONS_QUEUE_STORAGE_KEY, identityKey),
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
          withIdentitySuffix(VIDEO_INTERACTIONS_QUEUE_STORAGE_KEY, previousIdentityKey)
        );
      }

      const [persistedData, persistedSyncFlag, persistedQueue] = await Promise.all([
        loadIdentityScopedItem<PersistedVideoInteractions>(
          STORAGE_KEYS.videoInteractions,
          VIDEO_INTERACTIONS_STORAGE_VERSION,
          identityKey
        ),
        loadIdentityScopedItem<PersistedVideoInteractionsSyncFlag>(
          VIDEO_INTERACTIONS_SYNCED_STORAGE_KEY,
          VIDEO_INTERACTIONS_SYNCED_STORAGE_VERSION,
          identityKey
        ),
        isLeavingAuthenticatedIdentity
          ? Promise.resolve(undefined)
          : loadIdentityScopedItem<PersistedInteractionSyncQueue>(
              VIDEO_INTERACTIONS_QUEUE_STORAGE_KEY,
              VIDEO_INTERACTIONS_QUEUE_STORAGE_VERSION,
              identityKey
            ),
      ]);

      // A newer identity change superseded this one mid-flight - discard
      // this now-stale result instead of clobbering the newer identity's state.
      if (sessionEpochRef.current !== epochAtStart) {
        return;
      }

      const hydratedInteractions = persistedData?.interactions ?? {};

      commitInteractions(hydratedInteractions);
      // `identityKey` here is the local closure captured at the START of
      // this hydration run (it's this effect's own dependency-array value,
      // fixed for the lifetime of this specific async invocation) - never
      // re-read from `identityKeyRef` later, so a hydration run for one
      // identity can never persist under a DIFFERENT identity's key even if
      // the ref moves on while this run is still in flight.
      persistInteractions(identityKey, hydratedInteractions);
      setHasSynced(Boolean(persistedSyncFlag?.hasSynced));
      queueRef.current = isLeavingAuthenticatedIdentity ? [] : [...(persistedQueue?.queue ?? [])];
      setIsHydrated(true);
      drainQueue();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  // Drain whenever auth becomes ready (covers mount-time retry of commands
  // persisted from a prior session, and the moment login/hydration completes).
  useEffect(() => {
    if (isAuthenticated && isAuthHydrated) {
      drainQueue();
    }
  }, [isAuthenticated, isAuthHydrated, drainQueue]);

  // First-login merge - completely separate from the queue. Once hydration
  // (both this store's and auth's) is done, the user is authenticated, and
  // first-sync hasn't happened yet (per this identity's own synced flag):
  // pull the remote list, add any remote-only entries directly to local
  // state (never overwriting an existing local entry - satisfies "must not
  // overwrite newer user actions"), then push every local entry that differs
  // from remote DIRECTLY (not via the queue - this is a one-time bootstrap
  // convergence action, structurally distinct from the per-action queue).
  // Best-effort throughout.
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

      // A newer identity change superseded this one mid-flight - discard
      // this now-stale merge result instead of clobbering the newer
      // identity's live state (mirrors the hydration effect's guard above).
      if (sessionEpochRef.current !== epochAtStart) {
        return;
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
        // `identityKey` is this effect's own dependency-array value, closed
        // over at the start of this merge run - stable for its lifetime.
        persistInteractions(identityKey, merged);
      }

      for (const [videoId, localInteraction] of Object.entries(localSnapshot)) {
        // Re-checked on every iteration: an identity change mid-loop (not
        // just before the loop started) must also stop further pushes -
        // otherwise a partially-completed loop could keep pushing a stale
        // identity's data under a since-changed (now-current) auth session.
        if (sessionEpochRef.current !== epochAtStart) {
          return;
        }

        const remote = remoteByVideoId.get(videoId);
        const needsPush =
          !remote ||
          remote.isLiked !== localInteraction.isLiked ||
          remote.isSaved !== localInteraction.isSaved;

        if (needsPush) {
          await pushInteractionConvergence(videoId, localInteraction, remote);
        }
      }

      if (sessionEpochRef.current !== epochAtStart) {
        return;
      }

      setHasSynced(true);
      void setItem<PersistedVideoInteractionsSyncFlag>(
        withIdentitySuffix(VIDEO_INTERACTIONS_SYNCED_STORAGE_KEY, identityKey),
        VIDEO_INTERACTIONS_SYNCED_STORAGE_VERSION,
        { hasSynced: true }
      );
    })();
  }, [
    isHydrated,
    isAuthHydrated,
    isAuthenticated,
    hasSynced,
    commitInteractions,
    persistInteractions,
    identityKey,
  ]);

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
      void persistInteractionQueue(
        withIdentitySuffix(VIDEO_INTERACTIONS_QUEUE_STORAGE_KEY, identityKey),
        queueRef.current
      );
      drainQueue();
    },
    [drainQueue, identityKey]
  );

  // toggleLike/toggleSave: compute the next value from `interactionsRef`
  // (already-current, since it's the synchronous source of truth), write it
  // to the ref + state, persist it to storage under the identity key
  // current AT THIS EXACT SYNCHRONOUS POINT (captured as a local constant,
  // not re-read later from an effect), THEN push a new command onto the
  // queue - all in the same synchronous function call, no timing ambiguity
  // possible. Persisting inline here (rather than via a generic
  // `[interactions, isHydrated]` effect) is what makes it impossible for a
  // same-commit identity change to cause this write to land under the WRONG
  // identity's storage key: there is no later effect trying to reconstruct
  // "which identity was this write for" after the fact.
  const toggleLike = useCallback(
    (videoId: string) => {
      const currentInteraction = interactionsRef.current[videoId] ?? defaultInteraction;
      const nextIsLiked = !currentInteraction.isLiked;
      const nextInteractions = {
        ...interactionsRef.current,
        [videoId]: { ...currentInteraction, isLiked: nextIsLiked },
      };
      const persistIdentityKey = identityKeyRef.current ?? GUEST_IDENTITY_KEY;

      commitInteractions(nextInteractions);
      persistInteractions(persistIdentityKey, nextInteractions);

      enqueueCommand(
        nextIsLiked
          ? { kind: 'like', videoId, targetIsLiked: true, attempts: 0, enqueuedAt: Date.now() }
          : { kind: 'unlike', videoId, targetIsLiked: false, attempts: 0, enqueuedAt: Date.now() }
      );
    },
    [commitInteractions, enqueueCommand, persistInteractions]
  );

  const toggleSave = useCallback(
    (videoId: string) => {
      const currentInteraction = interactionsRef.current[videoId] ?? defaultInteraction;
      const nextIsSaved = !currentInteraction.isSaved;
      const nextInteractions = {
        ...interactionsRef.current,
        [videoId]: { ...currentInteraction, isSaved: nextIsSaved },
      };
      const persistIdentityKey = identityKeyRef.current ?? GUEST_IDENTITY_KEY;

      commitInteractions(nextInteractions);
      persistInteractions(persistIdentityKey, nextInteractions);

      enqueueCommand(
        nextIsSaved
          ? { kind: 'save', videoId, targetIsSaved: true, attempts: 0, enqueuedAt: Date.now() }
          : { kind: 'unsave', videoId, targetIsSaved: false, attempts: 0, enqueuedAt: Date.now() }
      );
    },
    [commitInteractions, enqueueCommand, persistInteractions]
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
