import {
  DEFAULT_ADS_CONFIG,
  evaluateTransition,
  markAdShown,
  recordWatch,
  rollThreshold,
  type AdGateState,
  type AdsConfig,
} from '@/services/ads/ad-gate';

const BASE_CONFIG: AdsConfig = {
  ...DEFAULT_ADS_CONFIG,
  minVideosBetweenAds: 3,
  maxVideosBetweenAds: 6,
  minSecondsBetweenAds: 120,
  graceVideos: 5,
};

function buildState(overrides: Partial<AdGateState> = {}): AdGateState {
  return {
    lifetimeWatched: 0,
    watchedSinceLastAd: 0,
    activeThreshold: 1,
    lastAdShownAt: null,
    ...overrides,
  };
}

describe('rollThreshold', () => {
  it('returns min when the rng returns 0 (inclusive lower bound)', () => {
    expect(rollThreshold(BASE_CONFIG, () => 0)).toBe(3);
  });

  it('returns max when the rng returns just under 1 (inclusive upper bound)', () => {
    expect(rollThreshold(BASE_CONFIG, () => 0.999999)).toBe(6);
  });

  it('swaps min and max when min > max', () => {
    const swappedConfig: AdsConfig = { ...BASE_CONFIG, minVideosBetweenAds: 6, maxVideosBetweenAds: 3 };

    expect(rollThreshold(swappedConfig, () => 0)).toBe(3);
    expect(rollThreshold(swappedConfig, () => 0.999999)).toBe(6);
  });

  it('falls back to the default for a non-finite min or max', () => {
    const brokenConfig: AdsConfig = {
      ...BASE_CONFIG,
      minVideosBetweenAds: NaN,
      maxVideosBetweenAds: Infinity,
    };

    // min defaults to 3, max defaults to 6 (DEFAULT_ADS_CONFIG), same as BASE_CONFIG.
    expect(rollThreshold(brokenConfig, () => 0)).toBe(3);
    expect(rollThreshold(brokenConfig, () => 0.999999)).toBe(6);
  });
});

describe('recordWatch — grace boundary', () => {
  it('never counts lifetime watches 1 through graceVideos (5) toward the threshold', () => {
    let state = buildState({ activeThreshold: 1 });

    for (let watchNumber = 1; watchNumber <= 5; watchNumber += 1) {
      state = recordWatch(state, BASE_CONFIG);
      expect(state.lifetimeWatched).toBe(watchNumber);
      expect(state.watchedSinceLastAd).toBe(0);
    }
  });

  it('counts the 6th lifetime watch (the first past graceVideos) toward the threshold', () => {
    let state = buildState({ lifetimeWatched: 5, watchedSinceLastAd: 0, activeThreshold: 1 });

    state = recordWatch(state, BASE_CONFIG);

    expect(state.lifetimeWatched).toBe(6);
    expect(state.watchedSinceLastAd).toBe(1);
  });
});

describe('evaluateTransition', () => {
  const READY_OPTS = { isPremium: false, adReady: true, adVisible: false, now: 0 };

  it('shows when enabled, not premium, ad visible is false, threshold reached, ad ready, and no cooldown yet recorded', () => {
    const state = buildState({ watchedSinceLastAd: 3, activeThreshold: 3, lastAdShownAt: null });

    expect(evaluateTransition(state, BASE_CONFIG, READY_OPTS)).toEqual({ show: true });
  });

  it('holds with not-due when the threshold has not been reached', () => {
    const state = buildState({ watchedSinceLastAd: 2, activeThreshold: 3 });

    expect(evaluateTransition(state, BASE_CONFIG, READY_OPTS)).toEqual({
      show: false,
      holdReason: 'not-due',
    });
  });

  it('holds with disabled when the config is disabled, even if everything else is due', () => {
    const state = buildState({ watchedSinceLastAd: 3, activeThreshold: 3 });
    const disabledConfig: AdsConfig = { ...BASE_CONFIG, enabled: false };

    expect(evaluateTransition(state, disabledConfig, READY_OPTS)).toEqual({
      show: false,
      holdReason: 'disabled',
    });
  });

  it('holds with premium for a premium user, even if everything else is due', () => {
    const state = buildState({ watchedSinceLastAd: 3, activeThreshold: 3 });

    expect(
      evaluateTransition(state, BASE_CONFIG, { ...READY_OPTS, isPremium: true })
    ).toEqual({ show: false, holdReason: 'premium' });
  });

  it('holds with ad-visible when an ad is already on screen', () => {
    const state = buildState({ watchedSinceLastAd: 3, activeThreshold: 3 });

    expect(
      evaluateTransition(state, BASE_CONFIG, { ...READY_OPTS, adVisible: true })
    ).toEqual({ show: false, holdReason: 'ad-visible' });
  });

  it('holds with ad-not-ready when due but the presenter has no loaded ad', () => {
    const state = buildState({ watchedSinceLastAd: 3, activeThreshold: 3 });

    expect(
      evaluateTransition(state, BASE_CONFIG, { ...READY_OPTS, adReady: false })
    ).toEqual({ show: false, holdReason: 'ad-not-ready' });
  });

  it('holds with cooldown, WITHOUT touching the counter, when due+ready but the last ad was too recent', () => {
    const state = buildState({ watchedSinceLastAd: 3, activeThreshold: 3, lastAdShownAt: 0 });
    // 60s later, cooldown is 120s: still on cooldown.
    const result = evaluateTransition(state, BASE_CONFIG, { ...READY_OPTS, now: 60_000 });

    expect(result).toEqual({ show: false, holdReason: 'cooldown' });
    expect(state.watchedSinceLastAd).toBe(3);
  });

  it('shows once the cooldown has elapsed, with zero additional watches recorded', () => {
    const state = buildState({ watchedSinceLastAd: 3, activeThreshold: 3, lastAdShownAt: 0 });
    // 121s later, cooldown is 120s: cooldown has elapsed.
    const result = evaluateTransition(state, BASE_CONFIG, { ...READY_OPTS, now: 121_000 });

    expect(result).toEqual({ show: true });
  });
});

describe('markAdShown', () => {
  it('resets the counter, stamps now, and re-rolls the next threshold', () => {
    const state = buildState({ watchedSinceLastAd: 6, activeThreshold: 3, lastAdShownAt: 0 });

    const next = markAdShown(state, BASE_CONFIG, 5_000, () => 0.5);

    expect(next.watchedSinceLastAd).toBe(0);
    expect(next.lastAdShownAt).toBe(5_000);
    // rng() = 0.5 over [3, 6] (4 integers: 3,4,5,6) -> 3 + floor(0.5*4) = 5.
    expect(next.activeThreshold).toBe(5);
    // lifetimeWatched is untouched by markAdShown - only recordWatch changes it.
    expect(next.lifetimeWatched).toBe(state.lifetimeWatched);
  });
});
