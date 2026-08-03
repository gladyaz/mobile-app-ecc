import { DEFAULT_ADS_CONFIG } from '@/services/ads/ad-gate';
import { clearShowInFlight, onVideoTransition, recordVideoWatched } from '@/services/ads/ad-controller';
import {
  __resetPresenterRegistryForTests,
  registerPresenter,
  type Presenter,
} from '@/services/ads/ad-presenter-registry';
import { __resetAdsStoreForTests, useAdsStore } from '@/stores/ads-store';

/**
 * Exercises `ad-controller.ts` against a FAKE presenter registered directly
 * through `ad-presenter-registry.ts` - `react-native-google-mobile-ads` is
 * never imported here, by design (see `interstitial-adapter.ts`'s header
 * comment).
 */
function buildFakePresenter(overrides: Partial<Presenter> = {}): Presenter {
  return {
    isReady: jest.fn(() => true),
    show: jest.fn(),
    loadIfNeeded: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  __resetAdsStoreForTests();
  __resetPresenterRegistryForTests();
  clearShowInFlight();
});

describe('recordVideoWatched', () => {
  it('delegates to the ads store recordWatch action', () => {
    __resetAdsStoreForTests({ lifetimeWatched: DEFAULT_ADS_CONFIG.graceVideos, watchedSinceLastAd: 0 });

    recordVideoWatched('video-1');

    const state = useAdsStore.getState();
    expect(state.lifetimeWatched).toBe(DEFAULT_ADS_CONFIG.graceVideos + 1);
    expect(state.watchedSinceLastAd).toBe(1);
  });
});

describe('onVideoTransition', () => {
  it('calls show() exactly once when the gate is due and the presenter is ready', () => {
    __resetAdsStoreForTests({ watchedSinceLastAd: 3, activeThreshold: 3 });
    const presenter = buildFakePresenter({ isReady: jest.fn(() => true) });
    registerPresenter(presenter);

    onVideoTransition();

    expect(presenter.show).toHaveBeenCalledTimes(1);
  });

  it('does not call show() again on an immediate second transition while adVisible is true', () => {
    __resetAdsStoreForTests({ watchedSinceLastAd: 3, activeThreshold: 3 });
    const presenter = buildFakePresenter({ isReady: jest.fn(() => true) });
    registerPresenter(presenter);

    onVideoTransition();
    expect(presenter.show).toHaveBeenCalledTimes(1);

    // Simulates what the real hook does on the `onOpened` callback: flips
    // adVisible true. A second transition arriving before the ad closes
    // must be held, not shown again.
    useAdsStore.getState().setAdVisible(true);

    onVideoTransition();

    expect(presenter.show).toHaveBeenCalledTimes(1);
  });

  it('does not double-show when a second transition lands BEFORE the native OPENED event', () => {
    // The review's MEDIUM finding: `adVisible` only flips true on OPENED,
    // so in the window between show() and OPENED a second transition used
    // to see adVisible=false with the counter unreset (markAdShown also
    // commits on OPENED) and a still-ready presenter -> a second show().
    // The controller's show-in-flight guard must hold that window closed
    // with NO simulated onOpened callback in between.
    __resetAdsStoreForTests({ watchedSinceLastAd: 3, activeThreshold: 3 });
    const presenter = buildFakePresenter({ isReady: jest.fn(() => true) });
    registerPresenter(presenter);

    onVideoTransition();
    onVideoTransition();

    expect(presenter.show).toHaveBeenCalledTimes(1);
  });

  it('shows again after a failed show() releases the in-flight guard (onError path)', () => {
    __resetAdsStoreForTests({ watchedSinceLastAd: 3, activeThreshold: 3 });
    const presenter = buildFakePresenter({ isReady: jest.fn(() => true) });
    registerPresenter(presenter);

    onVideoTransition();
    expect(presenter.show).toHaveBeenCalledTimes(1);

    // Simulates what the real hook does in its `onError` callback when a
    // show() dies before OPENED: releases the guard so ads are not wedged
    // off for the rest of the session. The counter was never reset
    // (markAdShown commits on OPENED only), so the gate is still due.
    clearShowInFlight();

    onVideoTransition();

    expect(presenter.show).toHaveBeenCalledTimes(2);
  });

  it('does not call show() when no presenter is registered', () => {
    __resetAdsStoreForTests({ watchedSinceLastAd: 3, activeThreshold: 3 });

    expect(() => onVideoTransition()).not.toThrow();
  });

  it('does not call show() when the presenter reports not ready', () => {
    __resetAdsStoreForTests({ watchedSinceLastAd: 3, activeThreshold: 3 });
    const presenter = buildFakePresenter({ isReady: jest.fn(() => false) });
    registerPresenter(presenter);

    onVideoTransition();

    expect(presenter.show).not.toHaveBeenCalled();
  });

  it('does not call show() when the threshold has not been reached yet', () => {
    __resetAdsStoreForTests({ watchedSinceLastAd: 1, activeThreshold: 3 });
    const presenter = buildFakePresenter();
    registerPresenter(presenter);

    onVideoTransition();

    expect(presenter.show).not.toHaveBeenCalled();
  });

  it('does not call show() for a premium user', () => {
    __resetAdsStoreForTests({ watchedSinceLastAd: 3, activeThreshold: 3, isPremium: true });
    const presenter = buildFakePresenter();
    registerPresenter(presenter);

    onVideoTransition();

    expect(presenter.show).not.toHaveBeenCalled();
  });
});
