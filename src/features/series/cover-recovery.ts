import { createContext, useContext } from 'react';

/**
 * SIGNED COVER URL RECOVERY
 * =========================
 *
 * `GET /series` and `GET /series/:id` return `coverUrl` as a PRESIGNED R2 GET
 * URL that expires (currently ~1 hour). The app can stay alive longer than
 * that, so a poster that was valid at fetch time can start failing while the
 * user is still looking at it. Before this module the failure was terminal:
 * the branded fallback held until the catalog was refetched or the cell
 * remounted.
 *
 * The trigger is the IMAGE FAILING, never the URL's contents. Nothing here
 * parses `X-Amz-Date`, `X-Amz-Expires` or `X-Amz-Signature`: those are storage
 * implementation details, the expiry window is not ours to hardcode, and a URL
 * can also fail for reasons that have nothing to do with expiry (the object
 * was replaced, storage rotated, the device went offline). React Native's
 * `onError` does not reliably expose an HTTP status either, so no branch here
 * claims to know that a failure was a 403. Every authoritative-URL failure is
 * treated the same way: ask the Series API - the one authority on what the
 * cover URL is right now - for fresh metadata, once.
 *
 * Recovery is silent by design: no spinner, no toast, no announcement, and the
 * branded fallback stays on screen throughout. If recovery works the poster
 * simply appears.
 */

/**
 * Called by a poster when an authoritative, non-empty cover URL failed to
 * load. Implementations must be safe to call many times per frame - four
 * posters expiring together is the normal case, not the edge case.
 */
export type ReportCoverFailure = (failedUrl: string) => void;

/**
 * The default is a no-op, so a poster rendered outside a recovery-owning
 * screen (a unit test, or any future surface with no Series resource behind
 * it) degrades to the pre-existing behaviour - branded fallback, zero
 * requests - instead of throwing.
 */
const IGNORE_COVER_FAILURE: ReportCoverFailure = () => {};

export const CoverRecoveryContext = createContext<ReportCoverFailure>(IGNORE_COVER_FAILURE);

/**
 * Read by every Discover poster. The screen that owns the catalog request
 * provides the implementation, which is what makes N simultaneous poster
 * failures collapse into ONE refetch: they all report into the same budget
 * rather than each owning a private retry.
 */
export function useReportCoverFailure(): ReportCoverFailure {
  return useContext(CoverRecoveryContext);
}

export type ClaimOptions = {
  /**
   * True while a Series request for this resource is already in flight. Such a
   * failure JOINS that request instead of starting a second one: the response
   * already on its way carries fresh URLs for every card.
   */
  readonly isFetching: boolean;
};

/**
 * Bounded recovery bookkeeping for ONE Series resource (the Discover catalog,
 * or one Series Detail).
 *
 * Deliberately pure: it owns no state React can see, starts no request, and
 * knows nothing about fetching. It answers exactly one question - "should the
 * caller issue a metadata refetch for this failed URL?" - which is what makes
 * the storm-prevention rules testable without rendering anything.
 *
 * THE RULE, and why it is this one
 * --------------------------------
 * Two independent guards, either of which alone prevents an infinite loop.
 * Both are kept because they close different holes:
 *
 * 1. PER URL - a given cover URL is reacted to at most once, ever.
 *    Closes the "refetch returned the same URL" loop: URL A fails, we refetch,
 *    the backend hands back the very same A (still valid server-side, or
 *    reissued identically), A fails again - and we do NOT ask again.
 *
 * 2. PER EXPLICIT LOAD - at most ONE automatic refetch per explicit load.
 *    An explicit load is a mount, an id change, or a user-triggered refresh.
 *    A refetch that recovery itself started does NOT replenish the budget.
 *    Closes the "rotating URLs" chain that guard 1 cannot see: if the backend
 *    reissues a distinct signed URL every time and every one of them fails
 *    (storage down), per-URL accounting alone would refetch forever, one
 *    request per rotation. It also makes four cards expiring together cost
 *    exactly one request rather than four.
 *
 * This is the stricter of the two models the slice allowed, and it is also the
 * simpler one: the worst case is bounded at one background request per thing
 * the user actually did, with no timers, no polling, no wall-clock cooldown
 * and no retry schedule anywhere in the system.
 *
 * WHAT IS NOT REMEMBERED
 * ----------------------
 * Failure is remembered against the URL, never against the series id. A series
 * is therefore never blacklisted: when Admin replaces the artwork, or a later
 * refresh simply issues a new signature, the new URL is unknown to this budget
 * and to the poster's own latch, so it renders normally with no user action.
 * Spending the budget only ever costs the AUTOMATIC attempt.
 *
 * The attempted-URL set is intentionally never cleared. After an explicit
 * refresh there is nothing left to recover for a URL that survived it - the
 * refresh WAS the metadata fetch that recovery would have issued.
 */
export type CoverRecoveryBudget = {
  /**
   * Returns true when the caller should issue exactly one silent metadata
   * refetch for this failure. Records the attempt either way, so a URL first
   * seen while the budget was empty is not retried later.
   */
  readonly claim: (failedUrl: string, options: ClaimOptions) => boolean;
  /** Grants the single automatic attempt back. Explicit loads only. */
  readonly replenish: () => void;
};

export function createCoverRecoveryBudget(): CoverRecoveryBudget {
  const attemptedUrls = new Set<string>();
  let hasAutomaticAttempt = true;

  return {
    claim(failedUrl: string, { isFetching }: ClaimOptions): boolean {
      // A missing cover is authoritative "no artwork", not an expired URL, and
      // has no signed URL to refresh. The posters never render an <Image> for
      // one, so this is defence in depth rather than the primary guard.
      if (failedUrl.trim().length === 0) {
        return false;
      }

      if (attemptedUrls.has(failedUrl)) {
        return false;
      }

      attemptedUrls.add(failedUrl);

      // Joining an in-flight request deliberately does NOT spend the budget:
      // that response may well fix this poster, and if it does not, the one
      // automatic attempt is still available for whatever URL it delivered.
      if (!hasAutomaticAttempt || isFetching) {
        return false;
      }

      hasAutomaticAttempt = false;

      return true;
    },
    replenish() {
      hasAutomaticAttempt = true;
    },
  };
}
