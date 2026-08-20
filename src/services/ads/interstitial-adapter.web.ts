import type { Presenter } from '@/services/ads/ad-presenter-registry';
import type { InterstitialCallbacks } from '@/services/ads/interstitial-contract';

export type { InterstitialCallbacks };

/**
 * The web counterpart to `interstitial-adapter.ts`. Metro picks this file for
 * `platform: web` (the same `*.web.ts` convention already used by
 * `use-color-scheme.web.ts` and `animated-icon.web.tsx`), so the native
 * adapter - and therefore `react-native-google-mobile-ads` - is never
 * RESOLVED into the web bundle at all.
 *
 * That build-time exclusion is the whole point of this file. The native
 * adapter's `Platform.OS === 'web'` early return could not achieve it,
 * because Metro resolves the `require('react-native-google-mobile-ads')`
 * below that guard at BUILD time regardless of which branch would run: the
 * package's `index.js` re-exports `BannerAd`, which imports
 * `react-native/Libraries/Utilities/codegenNativeComponent`, and Expo's web
 * resolver rejects that outright ("Importing native-only module ... on web").
 *
 * Every import in this file is `import type`, so nothing here survives into
 * the emitted web bundle beyond the function below. Adding a value import
 * from the native adapter would defeat the boundary - see
 * `interstitial-adapter.web.test.ts`, which fails loudly if that happens.
 */
export function createInterstitialPresenter(_callbacks: InterstitialCallbacks): Presenter | null {
  // `null` is the pre-existing documented web contract, not a new fallback:
  // `use-interstitial-ad.ts` already bails out on a null presenter without
  // registering anything, so `ad-controller.ts` finds no presenter and every
  // transition resolves to a hold. No ad is ever requested, shown, or
  // counted on web, and no callback is ever invoked.
  return null;
}
