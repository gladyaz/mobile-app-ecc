import { Platform } from 'react-native';

import { createInterstitialPresenter } from '@/services/ads/interstitial-adapter';

/**
 * Only exercises the `Platform.OS === 'web'` guard, which returns BEFORE
 * the lazy `require('react-native-google-mobile-ads')` - so this is the
 * one test file that imports `interstitial-adapter.ts` without ever
 * actually loading the native SDK, matching the "no RNGMA import anywhere
 * in tests" constraint.
 */
describe('createInterstitialPresenter', () => {
  it('returns null on web without requiring react-native-google-mobile-ads', () => {
    const originalOS = Platform.OS;
    Platform.OS = 'web';

    try {
      const presenter = createInterstitialPresenter({
        onOpened: jest.fn(),
        onClosed: jest.fn(),
        onError: jest.fn(),
      });

      expect(presenter).toBeNull();
    } finally {
      Platform.OS = originalOS;
    }
  });
});
