import { Platform } from 'react-native';

import type { Presenter } from '@/services/ads/ad-presenter-registry';
import { ensureAdsConsent } from '@/services/ads/consent-gate';
import type { InterstitialCallbacks } from '@/services/ads/interstitial-contract';

export type { InterstitialCallbacks };

function resolveAdUnitId(testInterstitialId: string): string {
  // Checked BEFORE the env is even read, so no ordering mistake here can
  // let a non-production build reach a live unit. Clicking your own live
  // ads is an AdMob policy violation that gets the account banned, so this
  // guarantee is worth two independent signals rather than one:
  //   - `__DEV__` is false only in a release JS bundle;
  //   - `NODE_ENV === 'test'` covers Jest, where a developer's `.env` (or a
  //     CI secret) can still be present in `process.env` even though
  //     nothing about the run is a release.
  if (__DEV__ || process.env.NODE_ENV === 'test') {
    return testInterstitialId;
  }

  const envUnitId = (
    Platform.OS === 'ios'
      ? process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_IOS
      : process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_AD_UNIT_ANDROID
  )?.trim();

  // An unset env placeholder also means "use Google's published test unit" -
  // production unit IDs only ever come from the env, never hardcoded, per
  // the 15A-S1 approval. `.env.example` ships these keys with an EMPTY
  // value, and Metro inlines that as `''`, so the trim above is what stops
  // a whitespace-only value from being handed to the SDK as an ad unit.
  if (!envUnitId) {
    return testInterstitialId;
  }

  return envUnitId;
}

/**
 * The native (iOS/Android) interstitial presenter, and still the ONLY module
 * allowed to import `react-native-google-mobile-ads`.
 *
 * Web never reaches this file: `interstitial-adapter.web.ts` sits next to it
 * and Metro resolves that one for `platform: web`, so the native SDK is
 * excluded from the web bundle at BUILD time. That platform split - not the
 * `Platform.OS` check below - is what makes the web bundle work. The runtime
 * guard alone could not: Metro resolves the `require()` in this function at
 * build time whichever branch would actually run, so the package's
 * `index.js` (-> `BannerAd` -> `codegenNativeComponent`) used to land in the
 * web graph and Expo's web resolver rejected it outright.
 *
 * The lazy `require()` stays exactly where it was, INSIDE the function body
 * rather than at module scope, because it still does a second, native-side
 * job: merely importing this file on a device never triggers the SDK's
 * load-time side effects. Every other ads module talks to the `Presenter`
 * interface returned here, which is why only the two tests that exercise
 * the SDK boundary itself (`interstitial-adapter.native.test.ts` and
 * `consent-gate.test.ts`) need to stand `react-native-google-mobile-ads` in.
 *
 * `loadIfNeeded()` is the app's ONLY ad request, so the UMP consent gate is
 * enforced there rather than at any call site: no caller can request an ad
 * ahead of consent even by mistake. See `consent-gate.ts`.
 *
 * The `Platform.OS === 'web'` early return is kept as a second net rather
 * than the boundary itself: it is what `interstitial-adapter.test.ts`
 * exercises, and it keeps the documented null contract true for any caller
 * that reaches this file directly - an explicit `.ts` specifier, or a
 * bundler configured without platform extensions - instead of through the
 * platform-resolved specifier.
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
  /**
   * True between the native OPENED and CLOSED events - i.e. exactly while
   * the caller believes an ad is covering the screen. Needed because the
   * caller reacts to OPENED by suppressing video playback, so every path
   * that ends the presentation MUST produce a matching `onClosed()`; see
   * the ERROR listener below for the path that used not to.
   */
  let isShowing = false;

  /** Ends the presentation exactly once, whichever event got us here. */
  function finishShowing(): void {
    if (!isShowing) {
      return;
    }

    isShowing = false;
    callbacks.onClosed();
  }

  function attachListeners(instance: InterstitialAdInstance): void {
    instance.addAdEventListener(AdEventType.LOADED, () => {
      isLoaded = true;
      isLoading = false;
    });

    instance.addAdEventListener(AdEventType.ERROR, (error: Error) => {
      isLoaded = false;
      isLoading = false;
      callbacks.onError(error);
      // An ERROR that arrives AFTER OPENED (iOS emits OPENED from
      // `adWillPresentFullScreenContent` and can then emit ERROR from
      // `ad:didFailToPresentFullScreenContentWithError:`) used to end the
      // presentation with no CLOSED at all. The caller had already
      // suppressed playback on OPENED and had nothing left to un-suppress
      // it: the feed stayed silent and paused for the rest of the session.
      // Normalizing it here keeps the OPENED/CLOSED pairing an invariant of
      // this adapter instead of a hope about native event ordering.
      finishShowing();
    });

    instance.addAdEventListener(AdEventType.OPENED, () => {
      isShowing = true;
      callbacks.onOpened();
    });

    instance.addAdEventListener(AdEventType.CLOSED, () => {
      isLoaded = false;

      // A shown InterstitialAd instance can never be shown again - swap in
      // a fresh, not-yet-loaded instance now so a follow-up
      // `loadIfNeeded()` (triggered by the hook's onClosed callback) has
      // something to load.
      //
      // Wrapped because `createForAdRequest` validates its arguments and
      // throws: an exception escaping this listener would skip
      // `finishShowing()` below, and playback would stay suppressed
      // forever. Losing the next ad is recoverable; a dead feed is not.
      try {
        ad = createAd();
      } catch (error) {
        isLoading = false;
        callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      }

      finishShowing();
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

      /**
       * A rejected show() must reach `onError`, or monetization dies
       * silently for the rest of the session.
       *
       * The native module rejects this promise WITHOUT emitting any ad
       * event when the current Activity is null - see
       * `ReactNativeGoogleMobileAdsFullScreenAdModule.kt`'s
       * `show()`/`"null-activity"` branch, which calls
       * `rejectPromiseWithCodeAndMessage` and returns. The old `void
       * ad.show()` discarded that rejection (and produced an unhandled
       * promise rejection with it), so the caller's show-in-flight guard
       * was never released and every later interstitial was held forever.
       *
       * `MobileAd.show()` also throws SYNCHRONOUSLY when its own `_loaded`
       * flag disagrees with ours, which the try/catch covers for the same
       * reason.
       */
      try {
        const shown = ad.show();

        if (shown && typeof shown.catch === 'function') {
          shown.catch((error: unknown) => {
            callbacks.onError(error instanceof Error ? error : new Error(String(error)));
          });
        }
      } catch (error) {
        callbacks.onError(error instanceof Error ? error : new Error(String(error)));
      }
    },
    loadIfNeeded() {
      if (isLoaded || isLoading) {
        return;
      }

      // Claimed BEFORE the await so concurrent callers cannot each start a
      // consent run plus a load; released again on every path that does not
      // reach `ad.load()`, so a later transition can retry.
      isLoading = true;

      // The consent gate is what makes "no ad request before consent has
      // settled" true, and it is enforced HERE rather than at a call site
      // because this is the only place in the app that requests an ad.
      // `ensureAdsConsent()` never rejects; `false` means fail closed.
      void ensureAdsConsent().then((canRequestAds) => {
        if (!canRequestAds) {
          isLoading = false;
          return;
        }

        // Re-checked after the await: a CLOSED event during the consent
        // round trip swaps `ad` for a fresh instance and may already have
        // started loading it.
        if (isLoaded) {
          isLoading = false;
          return;
        }

        ad.load();
      });
    },
  };
}
