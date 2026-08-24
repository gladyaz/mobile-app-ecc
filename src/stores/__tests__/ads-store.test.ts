import { DEFAULT_ADS_CONFIG } from '@/services/ads/ad-gate';
import { __resetAdsStoreForTests, useAdsStore } from '@/stores/ads-store';

beforeEach(() => {
  __resetAdsStoreForTests();
});

describe('useAdsStore — recordWatch', () => {
  it('increments lifetimeWatched but not watchedSinceLastAd within the grace period', () => {
    __resetAdsStoreForTests({ activeThreshold: 1 });

    for (let i = 0; i < DEFAULT_ADS_CONFIG.graceVideos; i += 1) {
      useAdsStore.getState().recordWatch();
    }

    const state = useAdsStore.getState();
    expect(state.lifetimeWatched).toBe(DEFAULT_ADS_CONFIG.graceVideos);
    expect(state.watchedSinceLastAd).toBe(0);
  });

  it('starts incrementing watchedSinceLastAd once past the grace period', () => {
    __resetAdsStoreForTests({ lifetimeWatched: DEFAULT_ADS_CONFIG.graceVideos, watchedSinceLastAd: 0 });

    useAdsStore.getState().recordWatch();

    const state = useAdsStore.getState();
    expect(state.lifetimeWatched).toBe(DEFAULT_ADS_CONFIG.graceVideos + 1);
    expect(state.watchedSinceLastAd).toBe(1);
  });
});

describe('useAdsStore — markAdShown', () => {
  it('resets watchedSinceLastAd, stamps lastAdShownAt, and re-rolls activeThreshold', () => {
    __resetAdsStoreForTests({ watchedSinceLastAd: 4, activeThreshold: 4, lastAdShownAt: null });

    useAdsStore.getState().markAdShown(9_999, () => 0);

    const state = useAdsStore.getState();
    expect(state.watchedSinceLastAd).toBe(0);
    expect(state.lastAdShownAt).toBe(9_999);
    expect(state.activeThreshold).toBe(DEFAULT_ADS_CONFIG.minVideosBetweenAds);
  });

  it('spends one slot of the per-session budget per committed ad', () => {
    __resetAdsStoreForTests();

    useAdsStore.getState().markAdShown(1_000, () => 0);
    useAdsStore.getState().markAdShown(2_000, () => 0);

    expect(useAdsStore.getState().adsShownThisSession).toBe(2);
  });
});

describe('useAdsStore — config/isPremium/adVisible setters', () => {
  it('setConfig overwrites the in-memory config', () => {
    const customConfig = { ...DEFAULT_ADS_CONFIG, enabled: false };

    useAdsStore.getState().setConfig(customConfig);

    expect(useAdsStore.getState().config).toEqual(customConfig);
  });

  it('setPremium and setAdVisible flip their respective flags', () => {
    useAdsStore.getState().setPremium(true);
    useAdsStore.getState().setAdVisible(true);

    expect(useAdsStore.getState().isPremium).toBe(true);
    expect(useAdsStore.getState().adVisible).toBe(true);
  });
});

describe('useAdsStore — persistence', () => {
  it('partializes to exactly the four AdGateState fields, nothing else', () => {
    useAdsStore.getState().setConfig({ ...DEFAULT_ADS_CONFIG, enabled: false });
    useAdsStore.getState().setPremium(true);
    useAdsStore.getState().setAdVisible(true);
    useAdsStore.getState().markAdShown(1_000, () => 0);

    const persistOptions = useAdsStore.persist.getOptions();
    const partialize = persistOptions.partialize;
    expect(partialize).toBeDefined();

    const persisted = partialize!(useAdsStore.getState()) as Record<string, unknown>;

    expect(Object.keys(persisted).sort()).toEqual(
      ['activeThreshold', 'lastAdShownAt', 'lifetimeWatched', 'watchedSinceLastAd'].sort()
    );
    // Config/isPremium/adVisible must never leak into the persisted subset.
    expect(persisted).not.toHaveProperty('config');
    expect(persisted).not.toHaveProperty('isPremium');
    expect(persisted).not.toHaveProperty('adVisible');
    // Neither may the session counter: persisting it would make the
    // ceiling permanent instead of per-sitting, and ads would go quiet
    // forever a few sessions in.
    expect(persisted).not.toHaveProperty('adsShownThisSession');
  });
});
