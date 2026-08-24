import { evaluateTransition } from '@/services/ads/ad-gate';
import { getPresenter } from '@/services/ads/ad-presenter-registry';
import { useAdsStore } from '@/stores/ads-store';

/**
 * Slice 15A-S1: module-level functions only, deliberately - no hooks, no
 * component. `onVideoTransition()` is called directly from
 * `(tabs)/index.tsx`'s `handleViewableItemsChanged`, whose own dependency
 * array must stay `[]` (see that file's comments); a plain module import
 * adds no dependency, matching the existing `trackEvent` precedent.
 *
 * Committing an actual ad presentation (`markAdShown`) is NOT this module's
 * job - it happens in `use-interstitial-ad.ts`'s `onOpened` callback, so an
 * ERROR-before-OPENED race never silently consumes a "due" ad the user
 * never saw. This module only ever reads store state and asks the
 * registered `Presenter` to show.
 */

/** Records that a video was watched long enough to count toward pacing. */
export function recordVideoWatched(_videoId: string): void {
  useAdsStore.getState().recordWatch();
}

/**
 * When `presenter.show()` was last called, or `null` if nothing is in
 * flight. Covers the window between that call and the hook's `onOpened`
 * (or `onError`) callback: `adVisible` alone cannot, because it only flips
 * true on the native OPENED event, so two transitions arriving in quick
 * succession before OPENED would both see `adVisible: false` with the
 * counter still unreset, and call `show()` twice (the MEDIUM found in this
 * unit's review). Module-level by design, same reasoning as
 * `onVideoTransition` itself.
 */
let showRequestedAt: number | null = null;

/**
 * How long that window may stay open before it is treated as abandoned.
 *
 * A timestamp rather than a boolean, because this guard has exactly one
 * failure mode and it is fatal to V1's only revenue path: if the release
 * never comes, EVERY later interstitial is held for the rest of the
 * session. The native module has a path that produces no ad event at all -
 * `ReactNativeGoogleMobileAdsFullScreenAdModule.kt` never overrides
 * `onAdFailedToShowFullScreenContent`, and resolves the `show()` promise
 * before presentation is even attempted - so neither `onOpened` nor
 * `onError` is guaranteed to arrive. The adapter now reports every failure
 * it CAN observe; this ceiling covers the ones it cannot.
 *
 * 10s is far beyond the sub-second real gap between `show()` and OPENED,
 * so it never fires on a healthy presentation - it only bounds the damage
 * of a silent native one.
 */
const SHOW_IN_FLIGHT_TIMEOUT_MS = 10_000;

function isShowInFlight(now: number): boolean {
  return showRequestedAt !== null && now - showRequestedAt < SHOW_IN_FLIGHT_TIMEOUT_MS;
}

/**
 * Cleared by `use-interstitial-ad.ts` on OPENED (the `adVisible` flag takes
 * over from there) and on ERROR (so a failed show() doesn't wedge ads off
 * for the rest of the session), and on hook teardown. Also used by tests
 * for isolation.
 */
export function clearShowInFlight(): void {
  showRequestedAt = null;
}

/**
 * Called once per genuine "the active feed video changed" transition.
 * Evaluates the gate and, if due, asks the currently registered presenter
 * to show. The `showInFlight` guard above plus the `adVisible` store flag
 * are the two-layer backstop against a double-show.
 */
export function onVideoTransition(): void {
  const state = useAdsStore.getState();
  const presenter = getPresenter();
  // One `now` for the whole evaluation, so the cooldown check and the
  // in-flight window can never disagree about what "now" is.
  const now = Date.now();

  const result = evaluateTransition(
    {
      lifetimeWatched: state.lifetimeWatched,
      watchedSinceLastAd: state.watchedSinceLastAd,
      activeThreshold: state.activeThreshold,
      lastAdShownAt: state.lastAdShownAt,
      adsShownThisSession: state.adsShownThisSession,
    },
    state.config,
    {
      isPremium: state.isPremium,
      adReady: presenter?.isReady() ?? false,
      adVisible: state.adVisible || isShowInFlight(now),
      now,
    }
  );

  if (result.show && presenter) {
    presenter.show();
    showRequestedAt = now;
  }
}
