import { useCallback, useEffect, useRef, useState } from 'react';

import {
  applyCheckInResponse,
  mapLedgerPage,
  mapRewardsSnapshot,
  mapWallet,
} from '@/features/rewards/rewards-mapper';
import { ApiError } from '@/services/api/client';
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

const INITIAL_FETCHED = (userId: string): FetchedRewards => ({
  userId,
  view: { status: 'loading' },
  ledger: { status: 'loading' },
});

export function useRewardsCenter(): RewardsCenterController {
  const { t } = useTranslation();
  const { isAuthenticated, isHydrated: isAuthHydrated, user } = useAuth();
  const { refresh: refreshEntitlement } = useEntitlement();

  const [fetched, setFetched] = useState<FetchedRewards | null>(null);
  const [notice, setNotice] = useState<RewardsNotice | null>(null);
  const [pendingActionId, setPendingActionId] = useState<string | null>(null);
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
   * The idempotency key of the last redemption ATTEMPT per offer, kept only
   * while that attempt's outcome is unknown. See `isIndeterminateFailure`.
   */
  const pendingRedemptionKeysRef = useRef<Record<string, string>>({});
  /** Guards against overlapping mutations without relying on render timing. */
  const isMutatingRef = useRef(false);
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

    (async () => {
      try {
        const page = await fetchRewardsLedger({ limit: LEDGER_PAGE_SIZE });

        if (!isForActiveUser(targetUserId)) {
          return;
        }

        const mapped = mapLedgerPage(page);

        ledgerCursorRef.current = mapped.nextCursor;
        setLedger(targetUserId, {
          status: 'ready',
          entries: mapped.entries,
          hasMore: mapped.nextCursor !== null,
          isLoadingMore: false,
          loadMoreError: null,
        });
      } catch (error) {
        if (!isForActiveUser(targetUserId)) {
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
  }, [isAuthHydrated, isAuthenticated, user, reloadToken, t, isForActiveUser, setLedger, setView]);

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
      try {
        const page = await fetchRewardsLedger({ limit: LEDGER_PAGE_SIZE });

        if (!isForActiveUser(targetUserId)) {
          return;
        }

        const mapped = mapLedgerPage(page);

        ledgerCursorRef.current = mapped.nextCursor;
        setLedger(targetUserId, {
          status: 'ready',
          entries: mapped.entries,
          hasMore: mapped.nextCursor !== null,
          isLoadingMore: false,
          loadMoreError: null,
        });
      } catch {
        if (!isForActiveUser(targetUserId)) {
          return;
        }

        setLedger(targetUserId, { status: 'error', message: t('rewards.historyError') });
      }
    },
    [isForActiveUser, setLedger, t]
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

    updateLedger(targetUserId, (current) =>
      current.status === 'ready'
        ? { ...current, isLoadingMore: true, loadMoreError: null }
        : current
    );

    (async () => {
      try {
        const page = await fetchRewardsLedger({ limit: LEDGER_PAGE_SIZE, cursor });

        if (!isForActiveUser(targetUserId)) {
          return;
        }

        const mapped = mapLedgerPage(page);

        ledgerCursorRef.current = mapped.nextCursor;
        updateLedger(targetUserId, (current) =>
          current.status === 'ready'
            ? {
                status: 'ready',
                // Appended, because the server returns pages newest-first and
                // each page continues where the last one stopped.
                entries: [...current.entries, ...mapped.entries],
                hasMore: mapped.nextCursor !== null,
                isLoadingMore: false,
                loadMoreError: null,
              }
            : current
        );
      } catch {
        if (!isForActiveUser(targetUserId)) {
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
        isLoadingMoreRef.current = false;
      }
    })();
  }, [isForActiveUser, t, updateLedger]);

  // -------------------------------------------------------- check-in

  const checkIn = useCallback(() => {
    const targetUserId = activeUserIdRef.current;

    if (!targetUserId || isMutatingRef.current) {
      return;
    }

    isMutatingRef.current = true;
    setNotice(null);
    setPendingActionId('check-in');

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
        isMutatingRef.current = false;
        // Cleared UNCONDITIONALLY, unlike the data above. `pendingActionId`
        // is a local spinner, not account state: if this request outlived an
        // account switch, the new account has no action in flight, and
        // leaving it set would strand a spinner on a button they never
        // pressed.
        setPendingActionId(null);
      }
    })();
  }, [isForActiveUser, refreshLedgerHead, setView, t, updateSnapshot]);

  // ---------------------------------------------------------- redeem

  const redeem = useCallback(
    (redemption: RewardRedemption) => {
      const targetUserId = activeUserIdRef.current;

      if (!targetUserId || isMutatingRef.current) {
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

      isMutatingRef.current = true;
      setNotice(null);
      setPendingActionId(redemption.id);

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
          isMutatingRef.current = false;
          // See the note on the check-in path: a spinner is local UI, so it
          // is cleared even when the response belongs to a previous account.
          setPendingActionId(null);
        }
      })();
    },
    [isForActiveUser, refreshEntitlement, refreshLedgerHead, setView, t, updateSnapshot]
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
  const view: RewardsViewState = !isAuthHydrated
    ? { status: 'loading' }
    : !isAuthenticated || !user
      ? { status: 'signInRequired' }
      : fetched?.userId === user.id
        ? fetched.view
        : { status: 'loading' };

  const ledger: RewardsLedgerState =
    isAuthHydrated && isAuthenticated && user && fetched?.userId === user.id
      ? fetched.ledger
      : { status: 'loading' };

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
