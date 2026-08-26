import { clearShowInFlight, onVideoTransition } from '@/services/ads/ad-controller';
import {
  __resetPerkRegistryForTests,
  registerPerkConsumer,
  type PerkConsumer,
} from '@/services/ads/ad-perk-registry';
import { DEFAULT_ADS_CONFIG } from '@/services/ads/ad-gate';
import {
  __resetPresenterRegistryForTests,
  registerPresenter,
  type Presenter,
} from '@/services/ads/ad-presenter-registry';
import { __resetAdsStoreForTests, useAdsStore } from '@/stores/ads-store';

/**
 * The controller half of the ad-perk integration: what actually happens on a
 * real video transition when the account holds a perk.
 *
 * The gate's own suite proves WHEN a skip may be spent. This one proves the
 * three things only the controller can get wrong:
 *
 *  - the interstitial is genuinely not presented;
 *  - the spend is reported to the backend EXACTLY once, even under a burst
 *    of transitions arriving before the request resolves;
 *  - pacing is committed, so a skipped ad break is a real ad break.
 */

function buildFakePresenter(overrides: Partial<Presenter> = {}): Presenter {
  return {
    isReady: jest.fn(() => true),
    show: jest.fn(),
    loadIfNeeded: jest.fn(),
    ...overrides,
  };
}

function buildFakeConsumer(): PerkConsumer & { readonly consumeSkip: jest.Mock } {
  return { consumeSkip: jest.fn() };
}

/** A gate state where an interstitial is due and everything else says yes. */
function dueOverrides() {
  return { watchedSinceLastAd: 3, activeThreshold: 3, lifetimeWatched: 40 };
}

beforeEach(() => {
  __resetAdsStoreForTests();
  __resetPresenterRegistryForTests();
  __resetPerkRegistryForTests();
  clearShowInFlight();
});

describe('onVideoTransition - a held ad skip', () => {
  it('suppresses the interstitial the viewer would otherwise have seen', () => {
    __resetAdsStoreForTests({
      ...dueOverrides(),
      skipNextInterstitial: true,
      skipPerkId: 'perk-1',
    });
    const presenter = buildFakePresenter();
    registerPresenter(presenter);
    registerPerkConsumer(buildFakeConsumer());

    onVideoTransition();

    expect(presenter.show).not.toHaveBeenCalled();
  });

  it('reports the spend to the backend, naming the perk the server issued', () => {
    __resetAdsStoreForTests({
      ...dueOverrides(),
      skipNextInterstitial: true,
      skipPerkId: 'perk-1',
    });
    registerPresenter(buildFakePresenter());
    const consumer = buildFakeConsumer();
    registerPerkConsumer(consumer);

    onVideoTransition();

    // A perk the app "uses" by quietly not showing an ad is a perk the server
    // still believes is held - the next break would skip again for free.
    expect(consumer.consumeSkip).toHaveBeenCalledTimes(1);
    expect(consumer.consumeSkip).toHaveBeenCalledWith('perk-1');
  });

  it('consumes ONCE across a burst of transitions inside one tick', () => {
    // The local flag is cleared synchronously before the (async) report, so a
    // second transition arriving before the request resolves cannot ride the
    // same perk.
    __resetAdsStoreForTests({
      ...dueOverrides(),
      skipNextInterstitial: true,
      skipPerkId: 'perk-1',
    });
    registerPresenter(buildFakePresenter());
    const consumer = buildFakeConsumer();
    registerPerkConsumer(consumer);

    onVideoTransition();
    onVideoTransition();
    onVideoTransition();

    expect(consumer.consumeSkip).toHaveBeenCalledTimes(1);
  });

  it('clears the local perk state immediately, before any network call resolves', () => {
    __resetAdsStoreForTests({
      ...dueOverrides(),
      skipNextInterstitial: true,
      skipPerkId: 'perk-1',
    });
    registerPresenter(buildFakePresenter());
    registerPerkConsumer(buildFakeConsumer());

    onVideoTransition();

    const state = useAdsStore.getState();
    expect(state.skipNextInterstitial).toBe(false);
    expect(state.skipPerkId).toBeNull();
  });

  it('commits the skipped break to pacing, so the next transition is not due again', () => {
    __resetAdsStoreForTests({
      ...dueOverrides(),
      skipNextInterstitial: true,
      skipPerkId: 'perk-1',
    });
    const presenter = buildFakePresenter();
    registerPresenter(presenter);
    registerPerkConsumer(buildFakeConsumer());

    onVideoTransition();

    expect(useAdsStore.getState().watchedSinceLastAd).toBe(0);

    // The very next transition must NOT produce an ad: the viewer bought a
    // skipped ad break, not a one-video deferral.
    onVideoTransition();
    expect(presenter.show).not.toHaveBeenCalled();
  });

  it('does not spend a slot of the per-session interruption ceiling', () => {
    __resetAdsStoreForTests({
      ...dueOverrides(),
      skipNextInterstitial: true,
      skipPerkId: 'perk-1',
    });
    registerPresenter(buildFakePresenter());
    registerPerkConsumer(buildFakeConsumer());

    onVideoTransition();

    expect(useAdsStore.getState().adsShownThisSession).toBe(0);
  });

  it('still suppresses the ad when no consumer is registered at all', () => {
    // A build without the rewards wiring has no perk state either, so this is
    // defence rather than a reachable state - but the ad path must never
    // depend on a registry entry existing.
    __resetAdsStoreForTests({
      ...dueOverrides(),
      skipNextInterstitial: true,
      skipPerkId: 'perk-1',
    });
    const presenter = buildFakePresenter();
    registerPresenter(presenter);

    expect(() => onVideoTransition()).not.toThrow();
    expect(presenter.show).not.toHaveBeenCalled();
  });
});

describe('onVideoTransition - a running ad pass', () => {
  it('holds the interstitial and consumes nothing', () => {
    __resetAdsStoreForTests({
      ...dueOverrides(),
      adFreeUntil: Date.now() + 60_000,
    });
    const presenter = buildFakePresenter();
    registerPresenter(presenter);
    const consumer = buildFakeConsumer();
    registerPerkConsumer(consumer);

    onVideoTransition();

    expect(presenter.show).not.toHaveBeenCalled();
    expect(consumer.consumeSkip).not.toHaveBeenCalled();
  });

  it('does NOT reset pacing, so the ad held during the pass is still due after it', () => {
    // Same semantics as the frequency cooldown: a pass HOLDS an ad, it does
    // not consume the slot the ad was going to fill.
    __resetAdsStoreForTests({
      ...dueOverrides(),
      adFreeUntil: Date.now() + 60_000,
    });
    registerPresenter(buildFakePresenter());

    onVideoTransition();

    expect(useAdsStore.getState().watchedSinceLastAd).toBe(3);
  });

  it('shows the ad again once the pass has expired', () => {
    __resetAdsStoreForTests({
      ...dueOverrides(),
      adFreeUntil: Date.now() - 1,
    });
    const presenter = buildFakePresenter();
    registerPresenter(presenter);

    onVideoTransition();

    expect(presenter.show).toHaveBeenCalledTimes(1);
  });

  it('protects the single-use skip while the pass covers the interruption', () => {
    __resetAdsStoreForTests({
      ...dueOverrides(),
      adFreeUntil: Date.now() + 60_000,
      skipNextInterstitial: true,
      skipPerkId: 'perk-1',
    });
    registerPresenter(buildFakePresenter());
    const consumer = buildFakeConsumer();
    registerPerkConsumer(consumer);

    onVideoTransition();

    expect(consumer.consumeSkip).not.toHaveBeenCalled();
    expect(useAdsStore.getState().skipNextInterstitial).toBe(true);
  });
});

describe('onVideoTransition - no perks held', () => {
  it('behaves exactly as it did before perks existed', () => {
    __resetAdsStoreForTests(dueOverrides());
    const presenter = buildFakePresenter();
    registerPresenter(presenter);
    const consumer = buildFakeConsumer();
    registerPerkConsumer(consumer);

    onVideoTransition();

    expect(presenter.show).toHaveBeenCalledTimes(1);
    expect(consumer.consumeSkip).not.toHaveBeenCalled();
    expect(useAdsStore.getState().config).toEqual(DEFAULT_ADS_CONFIG);
  });
});
