import { useCallback, useEffect, useRef, useState } from 'react';

import { dedupeLedgerEntries, mergeLedgerEntries } from '@/features/rewards/ledger-merge';
import {
  applyCheckInResponse,
  mapLedgerPage,
  mapRewardsSnapshot,
  mapWallet,
} from '@/features/rewards/rewards-mapper';
import { ApiError } from '@/services/api/client';
import { isDemoMode } from '@/services/demo/demo-mode';
import { createRedemptionIdempotencyKey } from '@/services/rewards/idempotency-key';
import { REWARD_ERROR_CODES } from '@/services/rewards/rewards-dto';
import {
  claimDailyCheckIn,
  fetchRewardsLedger,
  fetchRewardsSnapshot,
  redeemReward,
} from '@/services/rewards/rewards-service';
import { useAuth } from '@/stores/auth';
import { useEntitlement } from '@/stores/entitlement';
import { useTranslation, type Translate } from '@/stores/language';
import type {
  RewardRedemption,
  RewardsLedgerState,
  RewardsSnapshot,
  RewardsNotice,
  RewardsViewState,
} from '@/types/rewards';

/**
 * The Rewards Center container: everything the screen does that is not
 * rendering.
 *
 * IT LIVES OUTSIDE THE COMPONENTS ON PURPOSE. `RewardsCenterScreen` and
 * every component beneath it stay presentational, take their data as props,
 * and are forbidden by `__tests__/rewards-economics-boundary.test.ts` from
 * importing the rewards service, this hook, or the entitlement system. That
 * boundary is what makes "no component can pay itself points" a structural
 * property rather than a promise.
 *
 * THE FOUR RULES THIS HOOK EXISTS TO ENFORCE:
 *
 * 1. NO OPTIMISTIC BALANCE. Nothing here adds, subtracts or predicts a
 *    balance. A mutation's response carries the authoritative wallet, and
 *    that wallet REPLACES the one on screen. `awardedPoints` is reported to
 *    the user as a description of what happened; it is never an operand.
 *    The failure being designed out is a balance that briefly shows a number
 *    the server never agreed to and then snaps back.
 *
 * 2. NO FIXTURE FALLBACK. Every failure path lands on a truthful state -
 *    error, sign-in required, or feature unavailable. There is no code path
 *    from a failed request to a rendered number.
 *
 * 3. THE SERVER OWNS AVAILABILITY. `isClaimSupported`, `isRedeemSupported`
 *    and `availability` are read, never computed. A press on something the
 *    server marked unsupported never reaches the network.
 *
 * 4. ONE PREMIUM AUTHORITY. A successful redemption refreshes the EXISTING
 *    entitlement store rather than setting a premium flag of its own. "Am I
 *    premium?" must not depend on which screen you asked from.
 */

/** First page size. The server clamps to 1..100 and defaults to 20 anyway. */
const LEDGER_PAGE_SIZE = 20;

function isApiErrorWithCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

/**
 * Whether a failed request left the server's state UNKNOWN to us.
 *
 * This is the question that decides whether retrying may reuse the previous
 * idempotency key. A dropped connection or a 5xx may or may not have
 * committed, so the retry must be able to REPLAY rather than buy a second
 * time. A 4xx is a decision the server actually reached and recorded
 * nothing for, so the next press is a genuinely new attempt.
 */
function isIndeterminateFailure(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return true;
  }

  return error.status === 0 || error.status >= 500;
}

/** Maps a thrown `ApiError` onto copy, without ever leaking a raw message. */
function describeError(error: unknown, t: Translate): string {
  if (isApiErrorWithCode(error, REWARD_ERROR_CODES.INVALID_ACCESS_TOKEN)) {
    return t('rewards.errorSignedOut');
  }

  if (error instanceof ApiError && (error.status === 0 || error.code === 'NETWORK_ERROR')) {
    return t('rewards.errorNetwork');
  }

  return t('rewards.errorGeneric');
}

export type RewardsCenterController = {
  readonly view: RewardsViewState;
  readonly ledger: RewardsLedgerState;
  readonly notice: RewardsNotice | null;
  /** `'check-in'`, an offer id, or `null`. Drives the busy/disabled state. */
  readonly pendingActionId: string | null;
  readonly dismissNotice: () => void;
  readonly reload: () => void;
  readonly checkIn: () => void;
  readonly redeem: (redemption: RewardRedemption) => void;
  readonly retryLedger: () => void;
  readonly loadMoreLedger: () => void;
};

/**
 * Everything fetched for ONE account, tagged with whose account it is.
 *
 * The tag is not tidiness. A naive single `view` would keep rendering the
 * PREVIOUS user's balance in the gap between an account switch and the first
 * response for the new one - the same class of cross-account leak
 * `stores/entitlement.tsx` tags its own fetches to avoid, and that
 * `video-interactions.tsx`/`series-progress.tsx` each needed two fix cycles
 * to close. Gating on an id match makes the gap structurally impossible
 * rather than timing-dependent.
 */
type FetchedRewards = {
  readonly userId: string;
  readonly view: RewardsViewState;
  readonly ledger: RewardsLedgerState;
};

/**
 * A mutation in flight, tagged with who started it.
 *
 * The tag is what keeps a spinner off the check-in button of an account that
 * never pressed it: `pendingActionId` is DERIVED from this against the
 * current user, so the busy state belongs to the account that earned it
 * rather than to the hook.
 */
type PendingMutation = {
  readonly userId: string;
  readonly actionId: string;
};

const INITIAL_FETCHED = (userId: string): FetchedRewards => ({
  userId,
  view: { status: 'loading' },
  ledger: { status: 'loading' },
});

/**
 * A settled, empty history - not a loading one.
 *
 * Used where there is nothing to fetch and never will be (a demo build).
 * Module-level so the reference is stable across renders: the history sheet
 * keys work off this object, and a fresh literal each render would churn it
 * for no reason. Leaving the ledger at `loading` instead would show an
 * ActivityIndicator that nothing could ever resolve.
 */
const EMPTY_LEDGER: RewardsLedgerState = {
  status: 'ready',
  entries: [],
  hasMore: false,
  isLoadingMore: false,
  loadMoreError: null,
};

export function useRewardsCenter(): RewardsCenterController {
  const { t } = useTranslation();
  const { isAuthenticated, isHydrated: isAuthHydrated, user } = useAuth();
  const { refresh: refreshEntitlement } = useEntitlement();

  const [fetched, setFetched] = useState<FetchedRewards | null>(null);
  const [notice, setNotice] = useState<RewardsNotice | null>(null);
  const [pendingMutation, setPendingMutation] = useState<PendingMutation | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * Highest `wallet.version` this hook has adopted. The server increments it
   * on every movement, so a snapshot that was already in flight when a
   * check-in committed arrives carrying an OLDER version and is dropped -
   * without this, a slow read could roll the displayed balance backwards
   * over a newer, correct one.
   */
  const walletVersionRef = useRef<number>(-1);
  /**
   * Which account the in-flight work belongs to. A response for the previous
   * user must never be adopted after an account switch - the same class of
   * cross-account leak `stores/entitlement.tsx` tags its own fetches to
   * avoid.
   */
  const activeUserIdRef = useRef<string | null>(null);
  /** Cursor for the next ledger page. `null` means the history is exhausted. */
  const ledgerCursorRef = useRef<string | null>(null);
  /**
   * Which BUILD of the ledger the rows on screen belong to.
   *
   * Every path that rebuilds the history from the top - the first read, a
   * post-mutation head refresh, a retry, an explicit reload, an account
   * change - bumps this. A `loadMoreLedger` response carrying an older epoch
   * is discarded, because it was computed against a head that no longer
   * exists.
   *
   * Without it, a page in flight when a check-in lands would both splice its
   * rows into a list built from a DIFFERENT cursor and overwrite
   * `ledgerCursorRef` with its own stale `nextCursor` - mis-paging every
   * subsequent page of the history, silently and permanently.
   */
  const ledgerEpochRef = useRef(0);
  /**
   * The idempotency key of the last redemption ATTEMPT per offer, kept only
   * while that attempt's outcome is unknown. See `isIndeterminateFailure`.
   */
  const pendingRedemptionKeysRef = useRef<Record<string, string>>({});
  /**
   * The mutation currently in flight, or `null`.
   *
   * A BARE BOOLEAN WAS NOT ENOUGH, for two reasons that only appear across an
   * account switch:
   *
   *  - it was never released when the account changed, so B's first press was
   *    silently swallowed until A's request happened to settle - the lock
   *    exists to stop ONE user double-spending, and holding it across a
   *    sign-out punishes the wrong person;
   *  - releasing it on the account change instead would let A's late `finally`
   *    clear a lock B was legitimately holding, which is the double-spend the
   *    lock was for.
   *
   * Holding the OWNER, and releasing only on identity match, makes both safe
   * at once: a dead request can tell that the slot is no longer its own.
   */
  const mutationRef = useRef<PendingMutation | null>(null);
  /**
   * The same guard for pagination, and for the same reason.
   *
   * `disabled={isLoadingMore}` on the button only takes effect once the first
   * tap's state update has RENDERED. Two presses inside one synchronous
   * window - a fast double-tap, or a slow re-render on the low-end Android
   * this demo targets - would both read the same cursor and both APPEND the
   * same page, showing every row of it twice.
   */
  const isLoadingMoreRef = useRef(false);

  const isForActiveUser = useCallback((userId: string | null) => {
    return activeUserIdRef.current === userId;
  }, []);

  /**
   * Takes the single mutation slot for `userId`, or returns `null` if a
   * mutation is already in flight.
   *
   * Acquired SYNCHRONOUSLY, before any `await`, so a second press inside the
   * same tick - a real double-tap, or a slow re-render on the low-end Android
   * this build targets - finds the slot taken. `disabled={isPending}` alone
   * would not: it only takes effect once the first press has rendered.
   */
  const acquireMutation = useCallback((userId: string, actionId: string) => {
    if (mutationRef.current) {
      return null;
    }

    const mutation: PendingMutation = { userId, actionId };

    mutationRef.current = mutation;
    setPendingMutation(mutation);

    return mutation;
  }, []);

  /**
   * Releases the slot, but ONLY if this mutation still holds it.
   *
   * The identity check is the whole point: an account change hands the slot
   * back so the next user is not locked out, and the previous user's request
   * then settles into a world where the slot may already belong to someone
   * else. Clearing unconditionally there would re-open a window for exactly
   * the double-spend this lock prevents.
   */
  const releaseMutation = useCallback((mutation: PendingMutation) => {
    if (mutationRef.current === mutation) {
      mutationRef.current = null;
    }

    setPendingMutation((current) => (current === mutation ? null : current));
  }, []);

  /**
   * Starts a new BUILD of the history and returns its epoch.
   *
   * Every path that replaces the list from the top goes through here, and the
   * two things it does are one decision, not two: bumping the epoch cancels
   * whatever page was in flight, so the pagination slot that page was holding
   * has to be released in the same breath. Splitting them would leave the
   * "load more" control permanently disabled after any refresh that outran a
   * page.
   */
  const beginLedgerBuild = useCallback(() => {
    const epoch = ledgerEpochRef.current + 1;

    ledgerEpochRef.current = epoch;
    isLoadingMoreRef.current = false;

    return epoch;
  }, []);

  /**
   * Writes fetched state for one account, discarding anything held for a
   * different one. Callers still check `isForActiveUser` first; this is the
   * second, structural half of the same guarantee.
   */
  const patchFetched = useCallback(
    (userId: string, update: (previous: FetchedRewards) => FetchedRewards) => {
      setFetched((current) =>
        update(current && current.userId === userId ? current : INITIAL_FETCHED(userId))
      );
    },
    []
  );

  const setView = useCallback(
    (userId: string, next: RewardsViewState) => {
      patchFetched(userId, (previous) => ({ ...previous, view: next }));
    },
    [patchFetched]
  );

  const setLedger = useCallback(
    (userId: string, next: RewardsLedgerState) => {
      patchFetched(userId, (previous) => ({ ...previous, ledger: next }));
    },
    [patchFetched]
  );

  /** Updates the ledger from its own previous value (append, mark loading). */
  const updateLedger = useCallback(
    (userId: string, update: (previous: RewardsLedgerState) => RewardsLedgerState) => {
      patchFetched(userId, (previous) => ({ ...previous, ledger: update(previous.ledger) }));
    },
    [patchFetched]
  );

  /** Updates the ready snapshot in place; a no-op in any other state. */
  const updateSnapshot = useCallback(
    (userId: string, update: (snapshot: RewardsSnapshot) => RewardsSnapshot) => {
      patchFetched(userId, (previous) =>
        previous.view.status === 'ready'
          ? { ...previous, view: { status: 'ready', snapshot: update(previous.view.snapshot) } }
          : previous
      );
    },
    [patchFetched]
  );

  // ---------------------------------------------------------------- load

  useEffect(() => {
    // An offline demo build has no backend, so there is no request to make.
    // Returning here - ahead of the auth guards - is what keeps a demo
    // viewer off the generic `error` state, whose Retry button could never
    // succeed, and off the permanent spinner the API layer's missing
    // timeout would otherwise allow. The state shown instead is DERIVED
    // below, for the same reason the signed-out state is.
    if (isDemoMode()) {
      return;
    }

    if (!isAuthHydrated) {
      return;
    }

    if (!isAuthenticated || !user) {
      // Refs only - no `setState` here. The signed-out view is DERIVED during
      // render (see `view` below) rather than pushed from an effect: a guest
      // needs the sign-in affordance on the very first frame, and setting it
      // from an effect would both flash a loading state and trip
      // `react-hooks/set-state-in-effect`.
      activeUserIdRef.current = null;
      walletVersionRef.current = -1;
      ledgerCursorRef.current = null;
      pendingRedemptionKeysRef.current = {};
      // Hand the mutation slot back. Whatever was in flight belongs to an
      // account that is no longer signed in, and `releaseMutation` will
      // decline to clear the slot if someone has since taken it.
      mutationRef.current = null;

      return;
    }

    const targetUserId = user.id;
    const isAccountChange = activeUserIdRef.current !== targetUserId;

    activeUserIdRef.current = targetUserId;

    // RESET ONLY ON A REAL ACCOUNT CHANGE - never on a plain effect re-run.
    //
    // This effect re-fires for reasons that have nothing to do with the
    // wallet (a language change moves `t`; `reload()` bumps the token) while
    // the tab stays mounted. Resetting the version guard on those runs would
    // disarm it exactly when it is needed: a `GET /rewards/snapshot` can
    // outrace a `POST /rewards/check-in` that is waiting on a row lock, and
    // adopting that older read would roll the just-credited balance
    // backwards with no visible error.
    if (isAccountChange) {
      walletVersionRef.current = -1;
      ledgerCursorRef.current = null;
      // The lock stops ONE user from spending twice; it is not a queue across
      // accounts. Holding it here would make the new account's first press
      // silently do nothing until a stranger's request happened to settle.
      mutationRef.current = null;
      // Keys belong to the account that created them. Carrying one across a
      // sign-out would make the next account's first redemption reuse it -
      // harmless, because the server scopes uniqueness to [userId, key], but
      // untrue, and untrue state is what later bugs are built on.
      pendingRedemptionKeysRef.current = {};
    }

    // Inline async IIFE rather than a `useCallback` called by reference, so
    // the effect body itself contains no synchronous `setState` - matching
    // the `stores/entitlement.tsx` hydration-effect precedent and the
    // `react-hooks/set-state-in-effect` rule.
    (async () => {
      try {
        const snapshotDto = await fetchRewardsSnapshot();

        if (!isForActiveUser(targetUserId)) {
          return;
        }

        // THE SAME GUARD EVERY MUTATION PATH APPLIES. This was the one call
        // site that adopted a wallet unconditionally, which is what made the
        // conditional reset above load-bearing rather than merely tidy.
        if (snapshotDto.wallet.version >= walletVersionRef.current) {
          walletVersionRef.current = snapshotDto.wallet.version;
          setView(targetUserId, {
            status: 'ready',
            snapshot: mapRewardsSnapshot(snapshotDto, t),
          });
        }
      } catch (error) {
        if (!isForActiveUser(targetUserId)) {
          return;
        }

        // A deployment with the feature dark answers 503 on every route. It
        // is a bounded dead end with its own copy - NOT an error to retry,
        // and never a reason to render preview numbers instead.
        if (isApiErrorWithCode(error, REWARD_ERROR_CODES.REWARDS_DISABLED)) {
          setView(targetUserId, {
            status: 'unavailable',
            message: t('rewards.unavailableBody'),
          });
          setLedger(targetUserId, {
            status: 'ready',
            entries: [],
            hasMore: false,
            isLoadingMore: false,
            loadMoreError: null,
          });

          return;
        }

        if (isApiErrorWithCode(error, REWARD_ERROR_CODES.INVALID_ACCESS_TOKEN)) {
          setView(targetUserId, { status: 'signInRequired' });

          return;
        }

        setView(targetUserId, { status: 'error', message: describeError(error, t) });
      }
    })();

    // A fresh read of the head is a fresh BUILD of the history: any page
    // still in flight from the previous build belongs to a list that is
    // about to be replaced.
    const ledgerEpoch = beginLedgerBuild();

    (async () => {
      try {
        const page = await fetchRewardsLedger({ limit: LEDGER_PAGE_SIZE });

        if (!isForActiveUser(targetUserId) || ledgerEpochRef.current !== ledgerEpoch) {
          return;
        }

        const mapped = mapLedgerPage(page);

        ledgerCursorRef.current = mapped.nextCursor;
        setLedger(targetUserId, {
          status: 'ready',
          // Deduped on the way in, so `RewardsLedgerState.entries` upholds
          // the same identity rule on EVERY path rather than only where two
          // pages meet. See `ledger-merge.ts`.
          entries: dedupeLedgerEntries(mapped.entries),
          hasMore: mapped.nextCursor !== null,
          isLoadingMore: false,
          loadMoreError: null,
        });
      } catch (error) {
        if (!isForActiveUser(targetUserId) || ledgerEpochRef.current !== ledgerEpoch) {
          return;
        }

        // The snapshot branch owns the disabled/signed-out copy; here those
        // codes only need to stop the history from claiming a load failure.
        if (
          isApiErrorWithCode(error, REWARD_ERROR_CODES.REWARDS_DISABLED) ||
          isApiErrorWithCode(error, REWARD_ERROR_CODES.INVALID_ACCESS_TOKEN)
        ) {
          setLedger(targetUserId, {
            status: 'ready',
            entries: [],
            hasMore: false,
            isLoadingMore: false,
            loadMoreError: null,
          });

          return;
        }

        setLedger(targetUserId, { status: 'error', message: t('rewards.historyError') });
      }
    })();
  }, [
    isAuthHydrated,
    isAuthenticated,
    user,
    reloadToken,
    t,
    beginLedgerBuild,
    isForActiveUser,
    setLedger,
    setView,
  ]);

  const reload = useCallback(() => {
    setNotice(null);
    // Dropping the tagged state entirely is what makes the retry a real
    // re-read rather than a re-render of whatever was already there.
    setFetched(null);
    // AN EXPLICIT RELOAD IS THE ONE NON-ACCOUNT-CHANGE CASE THAT MAY RESET
    // THE VERSION GUARD, and it must: the user asked for whatever the server
    // says now, and without this the guard would reject the fresh read as
    // "older than what we already adopted" and leave the screen stuck
    // loading. That is safe precisely because it is user-initiated - a read
    // started after a committed write always sees at least that write's
    // version. The incidental effect re-runs the guard exists to survive (a
    // language change moving `t`) do NOT come through here.
    walletVersionRef.current = -1;
    ledgerCursorRef.current = null;
    setReloadToken((token) => token + 1);
  }, []);

  // ------------------------------------------------- ledger-only refresh

  /**
   * Re-reads the FIRST page after a movement, replacing what is on screen.
   *
   * The new entry is fetched, never synthesised. Composing a row locally
   * from a mutation response would make the history a second, client-owned
   * record of the same events - one that silently disagrees with the server
   * the first time a request succeeds remotely and fails on the wire.
   */
  const refreshLedgerHead = useCallback(
    async (targetUserId: string) => {
      // Same reasoning as the first read: this REPLACES the list, so any
      // `loadMoreLedger` still in flight is now paging a history that no
      // longer exists and must not be allowed to write into this one.
      const ledgerEpoch = beginLedgerBuild();

      try {
        const page = await fetchRewardsLedger({ limit: LEDGER_PAGE_SIZE });

        if (!isForActiveUser(targetUserId) || ledgerEpochRef.current !== ledgerEpoch) {
          return;
        }

        const mapped = mapLedgerPage(page);

        ledgerCursorRef.current = mapped.nextCursor;
        setLedger(targetUserId, {
          status: 'ready',
          entries: dedupeLedgerEntries(mapped.entries),
          hasMore: mapped.nextCursor !== null,
          isLoadingMore: false,
          loadMoreError: null,
        });
      } catch {
        if (!isForActiveUser(targetUserId) || ledgerEpochRef.current !== ledgerEpoch) {
          return;
        }

        setLedger(targetUserId, { status: 'error', message: t('rewards.historyError') });
      }
    },
    [beginLedgerBuild, isForActiveUser, setLedger, t]
  );

  const retryLedger = useCallback(() => {
    const targetUserId = activeUserIdRef.current;

    if (!targetUserId) {
      return;
    }

    setLedger(targetUserId, { status: 'loading' });
    void refreshLedgerHead(targetUserId);
  }, [refreshLedgerHead, setLedger]);

  const loadMoreLedger = useCallback(() => {
    const targetUserId = activeUserIdRef.current;
    const cursor = ledgerCursorRef.current;

    if (!targetUserId || !cursor || isLoadingMoreRef.current) {
      return;
    }

    isLoadingMoreRef.current = true;

    // The build of the history this page is being fetched FOR. If anything
    // rebuilds the list from the top before the response lands, this page
    // describes a history that no longer exists.
    const ledgerEpoch = ledgerEpochRef.current;

    updateLedger(targetUserId, (current) =>
      current.status === 'ready'
        ? { ...current, isLoadingMore: true, loadMoreError: null }
        : current
    );

    (async () => {
      try {
        const page = await fetchRewardsLedger({ limit: LEDGER_PAGE_SIZE, cursor });

        if (!isForActiveUser(targetUserId) || ledgerEpochRef.current !== ledgerEpoch) {
          // Dropped WITHOUT touching `ledgerCursorRef`: the refresh that
          // superseded this page already set the cursor that belongs to the
          // list now on screen, and overwriting it with this page's stale
          // `nextCursor` would mis-page the rest of the history for good.
          return;
        }

        const mapped = mapLedgerPage(page);

        ledgerCursorRef.current = mapped.nextCursor;
        updateLedger(targetUserId, (current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                // MERGED, not concatenated. The pages arrive newest-first and
                // each continues where the last stopped, so appending is the
                // right shape - but only rows this list does not already hold
                // may join it, or the panel would render two children under
                // one `key={entry.id}`. See `ledger-merge.ts` for why the
                // server re-serving a row is an ordinary event.
                entries: mergeLedgerEntries(current.entries, mapped.entries),
                hasMore: mapped.nextCursor !== null,
                isLoadingMore: false,
                loadMoreError: null,
              }
            : current
        );
      } catch {
        if (!isForActiveUser(targetUserId) || ledgerEpochRef.current !== ledgerEpoch) {
          return;
        }

        // The already-loaded rows stay on screen: discarding a page the user
        // is reading in order to report a network blip is worse than the blip.
        updateLedger(targetUserId, (current) =>
          current.status === 'ready'
            ? { ...current, isLoadingMore: false, loadMoreError: t('rewards.historyLoadMoreError') }
            : current
        );
      } finally {
        // Only the request that still owns the slot releases it. A superseded
        // page must not, because `beginLedgerBuild` already handed the slot to
        // the build that replaced it - clearing it here would let this dead
        // request re-open pagination that the live list has moved past.
        if (ledgerEpochRef.current === ledgerEpoch) {
          isLoadingMoreRef.current = false;
        }
      }
    })();
  }, [isForActiveUser, t, updateLedger]);

  // -------------------------------------------------------- check-in

  const checkIn = useCallback(() => {
    const targetUserId = activeUserIdRef.current;

    if (!targetUserId) {
      return;
    }

    const mutation = acquireMutation(targetUserId, 'check-in');

    if (!mutation) {
      return;
    }

    setNotice(null);

    (async () => {
      try {
        // NO ARGUMENTS. The date, the amount and the idempotency key are all
        // the server's. A double-tap produces the same server-derived key and
        // therefore the same day's single payout.
        const response = await claimDailyCheckIn();

        if (!isForActiveUser(targetUserId)) {
          return;
        }

        if (response.wallet.version >= walletVersionRef.current) {
          walletVersionRef.current = response.wallet.version;
          // ADOPTED, not incremented. The response's wallet replaces the one
          // on screen outright.
          updateSnapshot(targetUserId, (snapshot) =>
            applyCheckInResponse(snapshot, response, t)
          );
        }

        // A replay is a successful no-op, not a failure: the server answers
        // 200 with `awardedPoints: 0`, and the honest thing to show is that
        // today was already claimed rather than a fabricated second credit.
        setNotice(
          response.alreadyCheckedIn
            ? { tone: 'info', message: t('rewards.checkInAlready') }
            : {
                tone: 'success',
                message: t('rewards.checkInSuccess', { points: response.awardedPoints }),
              }
        );

        await refreshLedgerHead(targetUserId);
      } catch (error) {
        if (!isForActiveUser(targetUserId)) {
          return;
        }

        if (isApiErrorWithCode(error, REWARD_ERROR_CODES.REWARDS_DISABLED)) {
          setView(targetUserId, {
            status: 'unavailable',
            message: t('rewards.unavailableBody'),
          });

          return;
        }

        setNotice({ tone: 'error', message: describeError(error, t) });
      } finally {
        // Released even when the response belonged to a previous account -
        // but only if this request still owns the slot. A spinner is local
        // UI, so it must never outlive its request; the slot is shared, so it
        // must never be taken from whoever holds it now.
        releaseMutation(mutation);
      }
    })();
  }, [
    acquireMutation,
    isForActiveUser,
    refreshLedgerHead,
    releaseMutation,
    setView,
    t,
    updateSnapshot,
  ]);

  // ---------------------------------------------------------- redeem

  const redeem = useCallback(
    (redemption: RewardRedemption) => {
      const targetUserId = activeUserIdRef.current;

      if (!targetUserId || mutationRef.current) {
        return;
      }

      // Both checks read SERVER state. Nothing here compares the balance in
      // the hero against the cost: affordability is the server's answer, and
      // a client that recomputed it would either offer a debit the backend
      // refuses or hide one it would have allowed.
      if (!redemption.isRedeemSupported) {
        setNotice({
          tone: 'info',
          message: t('rewards.redeemUnavailable', { title: redemption.title }),
        });

        return;
      }

      if (redemption.availability === 'INSUFFICIENT_POINTS') {
        // Refused before the network, and - critically - WITHOUT touching the
        // balance. Nothing is debited, nothing is re-rendered.
        setNotice({
          tone: 'error',
          message: t('rewards.redeemInsufficient', { title: redemption.title }),
        });

        return;
      }

      // Taken only AFTER the two server-flag refusals above, which reach no
      // network and so have no slot to hold.
      const mutation = acquireMutation(targetUserId, redemption.id);

      if (!mutation) {
        return;
      }

      setNotice(null);

      // Reuse the previous key ONLY when the previous attempt's outcome is
      // unknown, so a retry after a dropped connection replays rather than
      // buying a second day. Any settled outcome cleared it below.
      const idempotencyKey =
        pendingRedemptionKeysRef.current[redemption.id] ?? createRedemptionIdempotencyKey();

      pendingRedemptionKeysRef.current = {
        ...pendingRedemptionKeysRef.current,
        [redemption.id]: idempotencyKey,
      };

      (async () => {
        try {
          // INTENT ONLY: an offer id and a key. No cost, no points, no
          // duration - every economic value is resolved server-side.
          const response = await redeemReward({ offerId: redemption.id, idempotencyKey });

          if (!isForActiveUser(targetUserId)) {
            return;
          }

          // Settled: the next press on this offer is a new purchase.
          const { [redemption.id]: _settled, ...rest } = pendingRedemptionKeysRef.current;

          pendingRedemptionKeysRef.current = rest;

          if (response.wallet.version >= walletVersionRef.current) {
            walletVersionRef.current = response.wallet.version;
            updateSnapshot(targetUserId, (snapshot) => ({
              ...snapshot,
              wallet: mapWallet(response.wallet),
            }));
          }

          setNotice(
            response.replayed
              ? { tone: 'info', message: t('rewards.redeemReplayed', { title: redemption.title }) }
              : {
                  tone: 'success',
                  message: t('rewards.redeemSuccess', {
                    title: redemption.title,
                    points: response.costPoints,
                  }),
                }
          );

          // EVERYTHING AFTER THIS POINT IS FOLLOW-UP, AND IS SEPARATELY
          // GUARDED. The purchase has already committed on the server; a
          // failure while re-reading its consequences must not be reported as
          // a failed redemption. Letting these throw into the outer catch
          // would tell a user who just successfully bought premium that it
          // went wrong - and would clear the success notice naming what they
          // bought.
          try {
            // THE EXISTING entitlement store is re-read - this hook never
            // sets a premium flag of its own. The backend granted premium in
            // the same transaction as the debit; all this does is make the
            // rest of the app (series gating, profile, ads) see it without a
            // relaunch.
            await refreshEntitlement();

            // Re-read rather than patch: a new balance changes which offers
            // are affordable, and `availability` is server-computed.
            const [snapshotDto] = await Promise.all([
              fetchRewardsSnapshot(),
              refreshLedgerHead(targetUserId),
            ]);

            if (!isForActiveUser(targetUserId)) {
              return;
            }

            if (snapshotDto.wallet.version >= walletVersionRef.current) {
              walletVersionRef.current = snapshotDto.wallet.version;
              setView(targetUserId, {
                status: 'ready',
                snapshot: mapRewardsSnapshot(snapshotDto, t),
              });
            }
          } catch {
            // The wallet adopted from the receipt above is still correct and
            // stays on screen. The offer list may now be one refresh stale,
            // which the next load settles - and which the server would refuse
            // to act on anyway.
          }
        } catch (error) {
          if (!isForActiveUser(targetUserId)) {
            return;
          }

          if (!isIndeterminateFailure(error)) {
            const { [redemption.id]: _refused, ...rest } = pendingRedemptionKeysRef.current;

            pendingRedemptionKeysRef.current = rest;
          }

          if (isApiErrorWithCode(error, REWARD_ERROR_CODES.REWARDS_DISABLED)) {
            setView(targetUserId, {
              status: 'unavailable',
              message: t('rewards.unavailableBody'),
            });

            return;
          }

          // The balance is deliberately left exactly as it was. The server
          // refused, so nothing moved, and re-rendering the hero here would
          // be inventing a movement to explain a refusal.
          if (isApiErrorWithCode(error, REWARD_ERROR_CODES.INSUFFICIENT_REWARD_POINTS)) {
            setNotice({
              tone: 'error',
              message: t('rewards.redeemInsufficient', { title: redemption.title }),
            });

            return;
          }

          if (isApiErrorWithCode(error, REWARD_ERROR_CODES.REWARD_OFFER_UNAVAILABLE)) {
            setNotice({
              tone: 'error',
              message: t('rewards.redeemUnavailable', { title: redemption.title }),
            });

            return;
          }

          if (isApiErrorWithCode(error, REWARD_ERROR_CODES.REWARD_OFFER_NOT_FOUND)) {
            setNotice({
              tone: 'error',
              message: t('rewards.redeemNotFound', { title: redemption.title }),
            });

            return;
          }

          setNotice({ tone: 'error', message: describeError(error, t) });
        } finally {
          // See the note on the check-in path: released unconditionally for
          // this request, never taken from whoever holds the slot now.
          releaseMutation(mutation);
        }
      })();
    },
    [
      acquireMutation,
      isForActiveUser,
      refreshEntitlement,
      refreshLedgerHead,
      releaseMutation,
      setView,
      t,
      updateSnapshot,
    ]
  );

  const dismissNotice = useCallback(() => setNotice(null), []);

  /**
   * DERIVED DURING RENDER, not pushed from an effect.
   *
   * Two things fall out of this that a stored `view` could not give:
   * a guest sees the sign-in affordance on the FIRST frame rather than after
   * a loading flash, and a freshly-switched account can never be shown the
   * previous account's balance, because state tagged with someone else's id
   * is not trusted at all.
   */
  /**
   * Demo mode is checked BEFORE the auth branches, deliberately.
   *
   * Ordering it after would let a demo viewer see the good
   * `signInRequired` prompt, then lose it by signing in - and demo login
   * accepts anything, so that is the natural thing to do. Rewards is
   * unavailable in this build whoever is looking, which is both simpler to
   * explain and the truth.
   *
   * `unavailable` is the SAME state a `REWARDS_ENABLED=false` deployment
   * produces, reusing copy that already exists in id/en/zh. Nothing is
   * fabricated: no balance, no streak, no ledger row.
   */
  const isDemoBuild = isDemoMode();

  const view: RewardsViewState = isDemoBuild
    ? { status: 'unavailable', message: t('rewards.unavailableBody') }
    : !isAuthHydrated
      ? { status: 'loading' }
      : !isAuthenticated || !user
        ? { status: 'signInRequired' }
        : fetched?.userId === user.id
          ? fetched.view
          : { status: 'loading' };

  const ledger: RewardsLedgerState = isDemoBuild
    ? EMPTY_LEDGER
    : isAuthHydrated && isAuthenticated && user && fetched?.userId === user.id
      ? fetched.ledger
      : { status: 'loading' };

  /**
   * DERIVED, and gated on the tag, for the same reason `view` is.
   *
   * A busy button is a claim that THIS user has something in flight. Between
   * an account switch and the previous account's response landing, that claim
   * was false: the new account saw a spinner on a check-in they never pressed.
   * Reading the tag makes the gap structurally impossible rather than a race
   * that usually resolves fast enough not to be noticed.
   */
  const pendingActionId: string | null =
    user && pendingMutation?.userId === user.id ? pendingMutation.actionId : null;

  return {
    view,
    ledger,
    notice,
    pendingActionId,
    dismissNotice,
    reload,
    checkIn,
    redeem,
    retryLedger,
    loadMoreLedger,
  };
}
