import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { clearShowInFlight } from '@/services/ads/ad-controller';
import type { Presenter } from '@/services/ads/ad-presenter-registry';
import { registerPresenter, unregisterPresenter } from '@/services/ads/ad-presenter-registry';
import { createInterstitialPresenter } from '@/services/ads/interstitial-adapter';
import { useAdsStore } from '@/stores/ads-store';

/**
 * Owns the interstitial `Presenter`'s entire lifecycle: creates and loads it
 * on mount (when ads are enabled and the user isn't premium), registers it
 * so `ad-controller.ts`'s `onVideoTransition()` can find it, and keeps it
 * loaded across ad presentations and app foregrounding. Mounted once, from
 * `AdsBridge`.
 */
export function useInterstitialAd(): void {
  const enabled = useAdsStore((state) => state.config.enabled);
  const isPremium = useAdsStore((state) => state.isPremium);
  const setAdVisible = useAdsStore((state) => state.setAdVisible);
  const markAdShown = useAdsStore((state) => state.markAdShown);
  const presenterRef = useRef<Presenter | null>(null);

  useEffect(() => {
    if (!enabled || isPremium) {
      return;
    }

    const presenter = createInterstitialPresenter({
      onOpened: () => {
        setAdVisible(true);
        // The `adVisible` flag now covers the double-show window, so the
        // controller's transient show-in-flight guard hands over here.
        clearShowInFlight();
        // Committed here (on OPENED), not at the `show()` call site in
        // `ad-controller.ts` - so a race where the ad errors out between
        // `show()` and actually opening leaves `watchedSinceLastAd`
        // untouched, instead of silently consuming a "due" ad the user
        // never actually saw.
        markAdShown(Date.now());
      },
      onClosed: () => {
        setAdVisible(false);
        // Immediately start loading the next one so it has the best
        // chance of being ready by the time it's next due.
        presenterRef.current?.loadIfNeeded();
      },
      onError: () => {
        // A show() that failed before OPENED must release the controller's
        // show-in-flight guard, or ads would be wedged off for the rest of
        // the session (no-op for plain load errors, where nothing is in
        // flight). Beyond that: `isReady()` already reflects "not ready",
        // and `evaluateTransition`'s `ad-not-ready` hold naturally retries
        // via `loadIfNeeded()` at the next video transition or app
        // foreground below.
        clearShowInFlight();
      },
    });

    presenterRef.current = presenter;

    if (!presenter) {
      return;
    }

    registerPresenter(presenter);
    presenter.loadIfNeeded();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        presenterRef.current?.loadIfNeeded();
      }
    });

    return () => {
      subscription.remove();
      unregisterPresenter(presenter);
      presenterRef.current = null;
      // Never leave a stale in-flight guard behind a teardown (e.g. the
      // user turning premium mid-session while a show() races OPENED).
      clearShowInFlight();
    };
  }, [enabled, isPremium, setAdVisible, markAdShown]);
}
