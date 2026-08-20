import * as nativeAdapter from '@/services/ads/interstitial-adapter';
import * as webAdapter from '@/services/ads/interstitial-adapter.web';

/**
 * Regression guard for the Expo Web bundle failure:
 *
 *   Importing native-only module
 *   "react-native/Libraries/Utilities/codegenNativeComponent" on web from:
 *   react-native-google-mobile-ads/.../GoogleMobileAdsBannerViewNativeComponent.ts
 *
 * The import stack ran `_layout.tsx` -> `ads-bridge.tsx` ->
 * `use-interstitial-ad.ts` -> `interstitial-adapter.ts` ->
 * `react-native-google-mobile-ads`. Metro resolves that last edge at BUILD
 * time, so the adapter's `Platform.OS === 'web'` early return never got a
 * chance to prevent it; only a `*.web.ts` platform file does.
 *
 * The mock below is a hard tripwire, not a stub. It throws instead of
 * returning a fake module, so if `interstitial-adapter.web.ts` - or anything
 * it imports, transitively - ever requires the native SDK again, this file
 * fails at import time with the reason rather than silently passing on a
 * stub. A source-text grep could not catch an indirect edge; module
 * resolution is transitive, so this does.
 */
jest.mock('react-native-google-mobile-ads', () => {
  throw new Error(
    'react-native-google-mobile-ads was pulled into the web adapter module graph. ' +
      'interstitial-adapter.web.ts and everything it imports must stay free of it, ' +
      'or the Expo Web bundle breaks again at resolution time.'
  );
});

function makeCallbacks() {
  return {
    onOpened: jest.fn(),
    onClosed: jest.fn(),
    onError: jest.fn(),
  };
}

describe('interstitial-adapter.web', () => {
  it('loads without pulling react-native-google-mobile-ads into its module graph', () => {
    // Reaching this line at all is the assertion: the tripwire above would
    // have thrown during this file's imports otherwise.
    expect(typeof webAdapter.createInterstitialPresenter).toBe('function');
  });

  it('returns null instead of a presenter, so no ad is ever registered on web', () => {
    expect(webAdapter.createInterstitialPresenter(makeCallbacks())).toBeNull();
  });

  it('does not throw and never invokes a callback', () => {
    const callbacks = makeCallbacks();

    expect(() => webAdapter.createInterstitialPresenter(callbacks)).not.toThrow();

    expect(callbacks.onOpened).not.toHaveBeenCalled();
    expect(callbacks.onClosed).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('is safe to call repeatedly - it holds no state and starts no work', () => {
    const callbacks = makeCallbacks();

    for (let i = 0; i < 3; i += 1) {
      expect(webAdapter.createInterstitialPresenter(callbacks)).toBeNull();
    }

    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});

describe('interstitial adapter platform contract', () => {
  /**
   * The two platform files are resolved interchangeably by Metro, so callers
   * must not be able to tell which one they got. This catches an export
   * added to one file and forgotten in the other - which would compile and
   * pass every native test, then fail only in the web bundle.
   */
  it('exposes the identical public surface on both platforms', () => {
    expect(Object.keys(webAdapter).sort()).toEqual(Object.keys(nativeAdapter).sort());
  });

  it('keeps the same call signature on both platforms', () => {
    expect(webAdapter.createInterstitialPresenter).toHaveLength(
      nativeAdapter.createInterstitialPresenter.length
    );
  });

  /**
   * Importing the native adapter under the tripwire above proves its
   * `require()` is still lazy: a module-scope import would have thrown while
   * this file's own imports were being evaluated.
   */
  it('leaves the native adapter importable without evaluating the native SDK', () => {
    expect(typeof nativeAdapter.createInterstitialPresenter).toBe('function');
  });
});
