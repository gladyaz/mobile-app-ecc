import { Platform } from 'react-native';

import type { Presenter } from '@/services/ads/ad-presenter-registry';

export type InterstitialCallbacks = {
  readonly onOpened: () => void;
  readonly onClosed: () => void;
  readonly onError: (error: Error) => void;
};

function resolveAdUnitId(testInterstitialId: string): string {
  const envUnitId =
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_IOS
      : process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID;

  // __DEV__ or an unset env placeholder both mean "use Google's published
  // test unit" - production unit IDs only ever come from the env, never
  // hardcoded, per the 15A-S1 approval.
  if (__DEV__ || !envUnitId) {
    return testInterstitialId;
  }

  return envUnitId;
}

/**
 * The ONLY module allowed to import `react-native-google-mobile-ads`, and it
 * does so with a lazy `require()` INSIDE this function body - never at
 * module scope - so merely importing this file (which every other ads
 * module does, transitively) never triggers the native SDK's own load-time
 * side effects. Every other ads module talks to the `Presenter` interface
 * returned here, which is why no other test in this codebase needs to mock
 * `react-native-google-mobile-ads`.
 */
export function createInterstitialPresenter(callbacks: InterstitialCallbacks): Presenter | null {
  if (Platform.OS === 'web') {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const rngma = require('react-native-google-mobile-ads') as typeof import('react-native-google-mobile-ads');
  const { InterstitialAd, AdEventType, TestIds } = rngma;
  const adUnitId = resolveAdUnitId(TestIds.INTERSTITIAL);

  // `InterstitialAd` has a protected constructor (only reachable through
  // its own static `createForAdRequest`), so its instance type has to be
  // derived via `ReturnType` rather than `InstanceType<typeof ...>`.
  type InterstitialAdInstance = ReturnType<typeof InterstitialAd.createForAdRequest>;

  let ad: InterstitialAdInstance;
  let isLoaded = false;
  let isLoading = false;

  function attachListeners(instance: InterstitialAdInstance): void {
    instance.addAdEventListener(AdEventType.LOADED, () => {
      isLoaded = true;
      isLoading = false;
    });

    instance.addAdEventListener(AdEventType.ERROR, (error: Error) => {
      isLoaded = false;
      isLoading = false;
      callbacks.onError(error);
    });

    instance.addAdEventListener(AdEventType.OPENED, () => {
      callbacks.onOpened();
    });

    instance.addAdEventListener(AdEventType.CLOSED, () => {
      isLoaded = false;
      // A shown InterstitialAd instance can never be shown again - swap in
      // a fresh, not-yet-loaded instance now so a follow-up
      // `loadIfNeeded()` (triggered by the hook's onClosed callback) has
      // something to load.
      ad = createAd();
      callbacks.onClosed();
    });
  }

  function createAd(): InterstitialAdInstance {
    const instance = InterstitialAd.createForAdRequest(adUnitId);
    attachListeners(instance);
    return instance;
  }

  ad = createAd();

  return {
    isReady() {
      return isLoaded;
    },
    show() {
      if (!isLoaded) {
        return;
      }
      void ad.show();
    },
    loadIfNeeded() {
      if (isLoaded || isLoading) {
        return;
      }
      isLoading = true;
      ad.load();
    },
  };
}
