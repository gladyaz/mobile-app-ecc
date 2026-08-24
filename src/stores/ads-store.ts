import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DEFAULT_ADS_CONFIG,
  markAdShown as markAdShownPure,
  recordWatch as recordWatchPure,
  rollThreshold,
  type AdGateState,
  type AdsConfig,
} from '@/services/ads/ad-gate';

const ADS_STORE_STORAGE_NAME = 'ads-gate-storage';

type PersistedAdGateState = Pick<
  AdGateState,
  'lifetimeWatched' | 'watchedSinceLastAd' | 'activeThreshold' | 'lastAdShownAt'
>;

export type AdsStoreState = AdGateState & {
  /** Fetched once from `GET /config/ads` by `AdsBridge`; never persisted. */
  readonly config: AdsConfig;
  /** Mirrors `useEntitlement().isPremium`; never persisted (re-derived from auth each launch). */
  readonly isPremium: boolean;
  /** Whether an interstitial is currently on screen; never persisted (a leftover `true` across app restarts would wedge playback forever). */
  readonly adVisible: boolean;
  readonly recordWatch: () => void;
  readonly markAdShown: (now: number, rng?: () => number) => void;
  readonly setConfig: (config: AdsConfig) => void;
  readonly setPremium: (isPremium: boolean) => void;
  readonly setAdVisible: (adVisible: boolean) => void;
};

function extractAdGateState(state: AdsStoreState): AdGateState {
  return {
    lifetimeWatched: state.lifetimeWatched,
    watchedSinceLastAd: state.watchedSinceLastAd,
    activeThreshold: state.activeThreshold,
    lastAdShownAt: state.lastAdShownAt,
    adsShownThisSession: state.adsShownThisSession,
  };
}

export const useAdsStore = create<AdsStoreState>()(
  persist(
    (set, get) => ({
      lifetimeWatched: 0,
      watchedSinceLastAd: 0,
      // Rolled from DEFAULT_ADS_CONFIG with Math.random at store-creation
      // time, so a state that never gets a chance to rehydrate (e.g. the
      // very first cold start, before AsyncStorage responds) still has a
      // sane threshold instead of 0. If a persisted value exists, zustand's
      // `persist` middleware overwrites this field with the persisted
      // `activeThreshold` as soon as rehydration completes - the persisted
      // value always wins over this initial roll.
      activeThreshold: rollThreshold(DEFAULT_ADS_CONFIG, Math.random),
      lastAdShownAt: null,
      // Deliberately absent from `partialize` below: the per-session cap is
      // a ceiling on ONE sitting, so it starts at zero on every cold start.
      // Persisting it would eventually silence ads permanently.
      adsShownThisSession: 0,
      config: DEFAULT_ADS_CONFIG,
      isPremium: false,
      adVisible: false,
      recordWatch: () => {
        const state = get();
        set(recordWatchPure(extractAdGateState(state), state.config));
      },
      markAdShown: (now, rng = Math.random) => {
        const state = get();
        set(markAdShownPure(extractAdGateState(state), state.config, now, rng));
      },
      setConfig: (config) => set({ config }),
      setPremium: (isPremium) => set({ isPremium }),
      setAdVisible: (adVisible) => set({ adVisible }),
    }),
    {
      name: ADS_STORE_STORAGE_NAME,
      storage: createJSONStorage(() => AsyncStorage),
      // Only the raw counter/cooldown fields survive an app restart -
      // config, isPremium, adVisible and adsShownThisSession are all
      // re-derived fresh on every launch (fetched, mirrored from auth, and
      // reset-to-zero/false respectively), so persisting them would risk
      // serving a stale config, a wedged `adVisible: true` from a killed
      // app, or a session cap that never resets.
      partialize: (state): PersistedAdGateState => ({
        lifetimeWatched: state.lifetimeWatched,
        watchedSinceLastAd: state.watchedSinceLastAd,
        activeThreshold: state.activeThreshold,
        lastAdShownAt: state.lastAdShownAt,
      }),
    }
  )
);

/** Test-only: resets the module-level store singleton to a known state. */
export function __resetAdsStoreForTests(overrides?: Partial<AdsStoreState>): void {
  useAdsStore.setState({
    lifetimeWatched: 0,
    watchedSinceLastAd: 0,
    activeThreshold: rollThreshold(DEFAULT_ADS_CONFIG, () => 0),
    lastAdShownAt: null,
    adsShownThisSession: 0,
    config: DEFAULT_ADS_CONFIG,
    isPremium: false,
    adVisible: false,
    ...overrides,
  });
}
