import { act, render } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useInterstitialAd } from '@/hooks/use-interstitial-ad';
import { DEFAULT_ADS_CONFIG } from '@/services/ads/ad-gate';
import {
  __resetPresenterRegistryForTests,
  getPresenter,
  type Presenter,
} from '@/services/ads/ad-presenter-registry';
import {
  createInterstitialPresenter,
  type InterstitialCallbacks,
} from '@/services/ads/interstitial-adapter';
import { __resetAdsStoreForTests, useAdsStore } from '@/stores/ads-store';

/**
 * Drives `use-interstitial-ad.ts`'s presenter-lifecycle logic (in
 * particular, the OPENED-commits/ERROR-preserves-counter behavior) by
 * mounting it inside a tiny probe component via `render()` - matching this
 * codebase's existing hook-testing idiom (see
 * `src/stores/__tests__/entitlement.test.tsx`'s `EntitlementProbe`).
 *
 * `flushMacrotask()` below is called after every mount/act in this file:
 * the `test-renderer` package's host config schedules some reconciler work
 * via a real `setTimeout` (not only microtasks), which was observed to
 * leave later mounts in the same file silently un-invoked without a real
 * macrotask flush in between.
 *
 * `interstitial-adapter.ts` is mocked out entirely, so
 * `react-native-google-mobile-ads` itself is never imported by this test.
 */
jest.mock('@/services/ads/interstitial-adapter');

function flushMacrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function InterstitialAdProbe() {
  useInterstitialAd();
  return null;
}

const mockedCreatePresenter = createInterstitialPresenter as jest.MockedFunction<
  typeof createInterstitialPresenter
>;

function buildFakePresenter(): Presenter {
  return {
    isReady: jest.fn(() => true),
    show: jest.fn(),
    loadIfNeeded: jest.fn(),
  };
}

let capturedCallbacks: InterstitialCallbacks | undefined;
let fakePresenter: Presenter;
let capturedAppStateListener: ((nextState: string) => void) | undefined;

beforeEach(() => {
  __resetAdsStoreForTests();
  __resetPresenterRegistryForTests();
  capturedCallbacks = undefined;
  fakePresenter = buildFakePresenter();

  mockedCreatePresenter.mockImplementation((callbacks) => {
    capturedCallbacks = callbacks;
    return fakePresenter;
  });

  capturedAppStateListener = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _type: string,
    listener: (nextState: string) => void
  ) => {
    capturedAppStateListener = listener;
    return { remove: jest.fn() };
  }) as typeof AppState.addEventListener);
});

afterEach(async () => {
  await flushMacrotask();
  jest.restoreAllMocks();
});

describe('useInterstitialAd', () => {
  it('creates, registers, and loads a presenter on mount', async () => {
    await render(<InterstitialAdProbe />);
    await flushMacrotask();

    expect(mockedCreatePresenter).toHaveBeenCalledTimes(1);
    expect(fakePresenter.loadIfNeeded).toHaveBeenCalledTimes(1);
    expect(getPresenter()).toBe(fakePresenter);
  });

  it('does not create a presenter when ads are disabled', async () => {
    __resetAdsStoreForTests({ config: { ...DEFAULT_ADS_CONFIG, enabled: false } });

    await render(<InterstitialAdProbe />);
    await flushMacrotask();

    expect(mockedCreatePresenter).not.toHaveBeenCalled();
  });

  it('does not create a presenter for a premium user', async () => {
    __resetAdsStoreForTests({ isPremium: true });

    await render(<InterstitialAdProbe />);
    await flushMacrotask();

    expect(mockedCreatePresenter).not.toHaveBeenCalled();
  });

  it('on OPENED: sets adVisible true and commits markAdShown, resetting watchedSinceLastAd', async () => {
    __resetAdsStoreForTests({ watchedSinceLastAd: 4, activeThreshold: 4, lastAdShownAt: null });
    await render(<InterstitialAdProbe />);
    await flushMacrotask();

    await act(async () => {
      capturedCallbacks?.onOpened();
      await flushMacrotask();
    });

    const state = useAdsStore.getState();
    expect(state.adVisible).toBe(true);
    expect(state.watchedSinceLastAd).toBe(0);
    expect(state.lastAdShownAt).not.toBeNull();
  });

  it('on CLOSED: sets adVisible false and immediately loads the next ad', async () => {
    await render(<InterstitialAdProbe />);
    await flushMacrotask();
    (fakePresenter.loadIfNeeded as jest.Mock).mockClear();

    await act(async () => {
      capturedCallbacks?.onClosed();
      await flushMacrotask();
    });

    expect(useAdsStore.getState().adVisible).toBe(false);
    expect(fakePresenter.loadIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('an ERROR before OPENED preserves watchedSinceLastAd (never commits a show)', async () => {
    __resetAdsStoreForTests({ watchedSinceLastAd: 4, activeThreshold: 4, lastAdShownAt: null });
    await render(<InterstitialAdProbe />);
    await flushMacrotask();

    await act(async () => {
      capturedCallbacks?.onError(new Error('failed to show'));
      await flushMacrotask();
    });

    const state = useAdsStore.getState();
    expect(state.watchedSinceLastAd).toBe(4);
    expect(state.adVisible).toBe(false);
    expect(state.lastAdShownAt).toBeNull();
  });

  it('loads the next ad when the app returns to the foreground', async () => {
    await render(<InterstitialAdProbe />);
    await flushMacrotask();
    (fakePresenter.loadIfNeeded as jest.Mock).mockClear();

    await act(async () => {
      capturedAppStateListener?.('active');
      await flushMacrotask();
    });

    expect(fakePresenter.loadIfNeeded).toHaveBeenCalledTimes(1);
  });

  it('does not load on a foreground event when moving to background/inactive', async () => {
    await render(<InterstitialAdProbe />);
    await flushMacrotask();
    (fakePresenter.loadIfNeeded as jest.Mock).mockClear();

    await act(async () => {
      capturedAppStateListener?.('background');
      await flushMacrotask();
    });

    expect(fakePresenter.loadIfNeeded).not.toHaveBeenCalled();
  });

  it('unregisters the presenter on unmount', async () => {
    const { unmount } = await render(<InterstitialAdProbe />);
    await flushMacrotask();
    expect(getPresenter()).toBe(fakePresenter);

    await unmount();
    await flushMacrotask();

    expect(getPresenter()).toBeNull();
  });
});
