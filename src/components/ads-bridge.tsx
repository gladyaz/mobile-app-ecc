import { useEffect } from 'react';

import { useInterstitialAd } from '@/hooks/use-interstitial-ad';
import { fetchAdsConfig } from '@/services/ads/ads-config-service';
import { useAdsStore } from '@/stores/ads-store';
import { useEntitlement } from '@/stores/entitlement';

/**
 * Slice 15A-S1: a tiny, deliberately dumb, null-rendering bridge between the
 * React tree (`useEntitlement()`, hook lifecycle) and the ads store/gate.
 * Mounted once inside `AppContent` in `_layout.tsx`, after hydration, so
 * `useEntitlement().isPremium` has already settled before the interstitial
 * hook starts loading ads.
 */
export function AdsBridge() {
  const setConfig = useAdsStore((state) => state.setConfig);
  const setPremium = useAdsStore((state) => state.setPremium);
  const { isPremium } = useEntitlement();

  // Fetches the ads pacing config once on mount. `setConfig` is a zustand
  // action (stable identity), so this effect never re-runs on its own.
  useEffect(() => {
    let isCancelled = false;

    void fetchAdsConfig().then((config) => {
      if (!isCancelled) {
        setConfig(config);
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [setConfig]);

  // Mirrors the entitlement signal into the store so the module-level
  // ad-controller (which cannot call React hooks) can read it.
  useEffect(() => {
    setPremium(isPremium);
  }, [isPremium, setPremium]);

  useInterstitialAd();

  return null;
}
