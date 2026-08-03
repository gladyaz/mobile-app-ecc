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
 * True from the moment `presenter.show()` is called until the hook's
 * `onOpened` (or `onError`) callback fires. `adVisible` alone cannot cover
 * that window: it only flips true on the native OPENED event, so two
 * transitions arriving in quick succession before OPENED would both see
 * `adVisible: false` with the counter still unreset, and call `show()`
 * twice (the MEDIUM found in this unit's review). Module-level by design,
 * same reasoning as `onVideoTransition` itself.
 */
let showInFlight = false;

/**
 * Cleared by `use-interstitial-ad.ts` on OPENED (the `adVisible` flag takes
 * over from there) and on ERROR (so a failed show() doesn't wedge ads off
 * for the rest of the session), and on hook teardown. Also used by tests
 * for isolation.
 */
export function clearShowInFlight(): void {
  showInFlight = false;
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

  const result = evaluateTransition(
    {
      lifetimeWatched: state.lifetimeWatched,
      watchedSinceLastAd: state.watchedSinceLastAd,
      activeThreshold: state.activeThreshold,
      lastAdShownAt: state.lastAdShownAt,
    },
    state.config,
    {
      isPremium: state.isPremium,
      adReady: presenter?.isReady() ?? false,
      adVisible: state.adVisible || showInFlight,
      now: Date.now(),
    }
  );

  if (result.show && presenter) {
    presenter.show();
    showInFlight = true;
  }
}
