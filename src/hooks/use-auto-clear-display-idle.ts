import { useEffect, useLayoutEffect, useRef } from 'react';

type AutoClearDisplayIdleOptions = {
  /**
   * The ONE derived predicate for "an idle countdown may run right now."
   * The caller owns its definition (active item, chrome visible, genuinely
   * playing, no sheet/modal/fullscreen, app foreground, no screen reader);
   * this hook owns only the timer mechanics. Any flip to false cancels the
   * pending timer via effect cleanup; any flip back to true starts a FRESH,
   * full countdown - remaining time is never carried across states.
   */
  readonly isEligible: boolean;
  readonly delayMs: number;
  /**
   * Bumped by the caller on a meaningful chrome interaction (a rail tap,
   * etc.). Each bump cancels the pending timer and starts a fresh full
   * countdown - the reset contract from the spec: "cancel old timer, start
   * one fresh timer if eligible."
   */
  readonly interactionNonce: number;
  readonly onAutoHide: () => void;
};

/**
 * Auto clear display on idle: one cancellable setTimeout per eligible
 * caller, nothing else.
 *
 * Architecture notes, in the order reviewers ask about them:
 *
 * - ONE timer, ever. The single effect below owns the single timeout; there
 *   is no interval, no recursion, no module-level timer, and nothing shared
 *   across feed items (each item mounts its own hook instance).
 * - Re-render churn cannot touch the timer. The feed item re-renders every
 *   ~250ms while playing (timeUpdate drives the progress bar); the effect
 *   deliberately depends only on [isEligible, interactionNonce, delayMs] -
 *   all stable across those renders - so the countdown neither restarts nor
 *   leaks on unrelated renders. `onAutoHide` is read through a ref for the
 *   same reason: callers pass fresh closures every render.
 * - Cleanup covers every exit: eligibility change, nonce bump, delay change,
 *   and unmount all run the same clearTimeout. There is no path that leaves
 *   a timer pending, so no state update after unmount is possible.
 * - Fire-time re-check. Eligibility is mirrored into a ref (layout effect,
 *   so it is current within the same commit) and re-read when the timeout
 *   actually fires. React's commit ordering already guarantees cleanup runs
 *   before a later timer tick can observe stale state; the ref check is
 *   cheap insurance against any queued-macrotask edge where the timeout was
 *   dequeued in the same tick eligibility collapsed.
 * - This hook never touches playback. It calls `onAutoHide` - a purely
 *   presentational state change owned by the caller - and nothing else. No
 *   player, no source, no authorization, no pause/play.
 */
export function useAutoClearDisplayIdle({
  isEligible,
  delayMs,
  interactionNonce,
  onAutoHide,
}: AutoClearDisplayIdleOptions): void {
  const onAutoHideRef = useRef(onAutoHide);

  useLayoutEffect(() => {
    onAutoHideRef.current = onAutoHide;
  }, [onAutoHide]);

  const isEligibleRef = useRef(isEligible);

  useLayoutEffect(() => {
    isEligibleRef.current = isEligible;
  }, [isEligible]);

  useEffect(() => {
    if (!isEligible) {
      return;
    }

    const timeoutId = setTimeout(() => {
      if (!isEligibleRef.current) {
        return;
      }

      onAutoHideRef.current();
    }, delayMs);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [isEligible, interactionNonce, delayMs]);
}
