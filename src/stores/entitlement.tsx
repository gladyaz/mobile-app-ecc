import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { getMyEntitlement } from '@/services/entitlement/entitlement-service';
import { useAuth } from '@/stores/auth';

type EntitlementContextValue = {
  /**
   * Whether the current user may play premium (episode 6+) content.
   * Fails safe to `false` while logged out, while hydrating, and while a
   * fresh fetch is in flight — a locked-by-default premium gate is the
   * correct failure mode (matches the pre-Phase-10 client-only gate's own
   * "no entitlement backend = never premium" behavior), never an
   * accidentally-open one.
   */
  readonly isPremium: boolean;
  readonly refresh: () => Promise<void>;
};

const EntitlementContext = createContext<EntitlementContextValue | null>(null);

type FetchedStatus = {
  readonly userId: string;
  readonly isPremium: boolean;
};

/**
 * What to store when a status fetch FAILS.
 *
 * The distinction this draws is the whole point: "we have never had an
 * answer for this user" and "we have one and this particular refresh
 * failed" are different states, and collapsing them into `false` turns a
 * transient network blip into a false negative that does not heal.
 *
 * WHY THAT MATTERS CONCRETELY. `refresh()` is called right after a reward
 * redemption, which has ALREADY debited the user's points and granted
 * premium in one server-side transaction. If that follow-up read failed and
 * overwrote a known `true` with `false`, the user would be charged, told the
 * purchase succeeded, and then be locked out of the premium episode they
 * just bought and shown ads again — with no other refresh trigger in the app
 * to correct it before the next sign-in.
 *
 * KEEPING A KNOWN VALUE IS NOT AN OPEN GATE. It preserves whatever the
 * server last actually said, `false` included, and only for the SAME user id
 * — a different or unknown account still falls back to `false`. The premium
 * gate remains fail-closed for anyone we have never had an answer about, and
 * playback authorisation is enforced server-side regardless of what this
 * client believes.
 */
function keepKnownOrFailSafe(
  targetUserId: string
): (current: FetchedStatus | null) => FetchedStatus {
  return (current) =>
    current?.userId === targetUserId ? current : { userId: targetUserId, isPremium: false };
}

/**
 * Phase 10, work unit 10-M1/10-M2: fetches the authenticated user's premium
 * entitlement status from the backend (`GET /users/me/entitlement`) and
 * refetches whenever the authenticated identity changes.
 *
 * `lastFetchedStatus` is tagged with the `userId` it was fetched for, and
 * the exposed `isPremium` value only trusts it when that `userId` matches
 * the CURRENTLY authenticated user. This is deliberate, not just tidiness:
 * a naive "setIsPremium(false) synchronously on logout/identity-change,
 * then fetch" reset would (a) violate the `react-hooks/set-state-in-effect`
 * rule (no synchronous setState in an effect body — see the doc comment on
 * that rule) and (b) briefly expose the PREVIOUS user's stale entitlement
 * value to a newly-logged-in different user during the gap before the new
 * fetch resolves — the same class of cross-account leak that
 * `video-interactions.tsx`/`series-progress.tsx` needed two fix cycles to
 * fully close in Phase 9. Tagging by `userId` and gating on the match makes
 * that gap structurally impossible instead of timing-dependent.
 */
export function EntitlementProvider({ children }: PropsWithChildren) {
  const { isAuthenticated, isHydrated: isAuthHydrated, user } = useAuth();
  const [lastFetchedStatus, setLastFetchedStatus] = useState<FetchedStatus | null>(null);

  // The fetch runs as an inline, immediately-invoked async function
  // (matching `video-interactions.tsx`/`series-progress.tsx`'s existing
  // hydration-effect pattern) rather than a separately-defined `useCallback`
  // called by reference, so the effect body itself never contains a direct
  // `setXxx(...)` statement — satisfying `react-hooks/set-state-in-effect`
  // ("subscribe/fire-and-forget, don't set state synchronously in the
  // effect body").
  useEffect(() => {
    if (!isAuthHydrated || !isAuthenticated || !user) {
      return;
    }

    const targetUserId = user.id;

    (async () => {
      try {
        const status = await getMyEntitlement();
        setLastFetchedStatus({ userId: targetUserId, isPremium: status.isPremium });
      } catch {
        // Fail safe to "not premium" on any error (network, 401, etc.) —
        // never treat a failed fetch as evidence of entitlement. See
        // `keepKnownOrFailSafe` for why this is a fall-back rather than an
        // overwrite: there is a difference between "we have never had an
        // answer for this user" and "we have one and this refresh failed".
        setLastFetchedStatus(keepKnownOrFailSafe(targetUserId));
      }
    })();
    // Re-run whenever the authenticated identity changes (login, logout,
    // account switch), not just on mount.
  }, [isAuthHydrated, isAuthenticated, user]);

  const fetchStatus = useCallback(async () => {
    if (!isAuthenticated || !user) {
      return;
    }

    const targetUserId = user.id;

    try {
      const status = await getMyEntitlement();
      setLastFetchedStatus({ userId: targetUserId, isPremium: status.isPremium });
    } catch {
      setLastFetchedStatus(keepKnownOrFailSafe(targetUserId));
    }
  }, [isAuthenticated, user]);

  const isPremium =
    isAuthenticated && user && lastFetchedStatus?.userId === user.id
      ? lastFetchedStatus.isPremium
      : false;

  const value = useMemo<EntitlementContextValue>(
    () => ({ isPremium, refresh: fetchStatus }),
    [isPremium, fetchStatus]
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement() {
  const context = useContext(EntitlementContext);

  if (!context) {
    throw new Error('useEntitlement must be used within an EntitlementProvider');
  }

  return context;
}
