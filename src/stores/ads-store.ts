import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

import {
  DEFAULT_ADS_CONFIG,
  markAdShown as markAdShownPure,
  markInterstitialSkipped as markInterstitialSkippedPure,
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

/**
 * The reward perks the SERVER says this account holds, mirrored for the
 * module-level ad controller (which cannot call React hooks).
 *
 * NEVER PERSISTED, for the same reason `isPremium` is not: a perk is server
 * state, and a copy that survived a cold start would be this client asserting
 * an entitlement the backend never re-confirmed. Every launch re-reads it from
 * `GET /rewards/perks`, and until that answers, the values below are the safe
 * defaults - no suppression, no grant.
 */
export type AdPerkState = {
  /** SERVER-DERIVED. Copied from the response; never recomputed from `perks[]`. */
  readonly skipNextInterstitial: boolean;
  /** Epoch ms of the furthest-out active `TEMPORARY_AD_PASS`, or `null`. */
  readonly adFreeUntil: number | null;
  /**
   * Which perk row `POST /rewards/perks/:id/consume` should address when the
   * skip is spent.
   *
   * The DECISION to suppress comes from `skipNextInterstitial` above - a
   * server-owned rule this client does not re-derive. This id is only the
   * ADDRESS of the row to spend, which the array is the sole source of.
   */
  readonly skipPerkId: string | null;
};

export type AdsStoreState = AdGateState &
  AdPerkState & {
    /** Fetched once from `GET /config/ads` by `AdsBridge`; never persisted. */
    readonly config: AdsConfig;
    /** Mirrors `useEntitlement().isPremium`; never persisted (re-derived from auth each launch). */
    readonly isPremium: boolean;
    /** Whether an interstitial is currently on screen; never persisted (a leftover `true` across app restarts would wedge playback forever). */
    readonly adVisible: boolean;
    readonly recordWatch: () => void;
    readonly markAdShown: (now: number, rng?: () => number) => void;
    /**
     * Commits a SKIPPED interstitial to pacing: the ad break is over, so the
     * next one is due after the normal interval rather than on the very next
     * transition. Does not spend a session slot - no interruption happened.
     */
    readonly markInterstitialSkipped: (now: number, rng?: () => number) => void;
    readonly setConfig: (config: AdsConfig) => void;
    readonly setPremium: (isPremium: boolean) => void;
    readonly setAdVisible: (adVisible: boolean) => void;
    /** Adopts a fresh `GET /rewards/perks` answer wholesale. */
    readonly setPerks: (perks: AdPerkState) => void;
    /**
     * Clears the single-use skip LOCALLY and returns the perk id to report as
     * spent, or `null` if there was nothing to spend.
     *
     * SYNCHRONOUS, AND IT CLEARS BEFORE ANY NETWORK CALL. That ordering is the
     * whole double-consume defence: two video transitions inside one tick
     * cannot both see `skipNextInterstitial: true`, and a retried or dropped
     * consume request cannot suppress a second ad while it is in flight. The
     * server's own `alreadyConsumed: true` reply is the second layer, not the
     * first.
     */
    readonly consumeSkipPerk: () => string | null;
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
      // Absent from `partialize` below, like every other server-derived field:
      // a perk that survived a restart would be a client asserting an
      // entitlement the backend never re-confirmed.
      skipNextInterstitial: false,
      adFreeUntil: null,
      skipPerkId: null,
      recordWatch: () => {
        const state = get();
        set(recordWatchPure(extractAdGateState(state), state.config));
      },
      markAdShown: (now, rng = Math.random) => {
        const state = get();
        set(markAdShownPure(extractAdGateState(state), state.config, now, rng));
      },
      markInterstitialSkipped: (now, rng = Math.random) => {
        const state = get();
        set(markInterstitialSkippedPure(extractAdGateState(state), state.config, now, rng));
      },
      setConfig: (config) => set({ config }),
      setPremium: (isPremium) => set({ isPremium }),
      setAdVisible: (adVisible) => set({ adVisible }),
      setPerks: (perks) =>
        set({
          skipNextInterstitial: perks.skipNextInterstitial,
          adFreeUntil: perks.adFreeUntil,
          skipPerkId: perks.skipPerkId,
        }),
      consumeSkipPerk: () => {
        const { skipNextInterstitial, skipPerkId } = get();

        if (!skipNextInterstitial) {
          return null;
        }

        set({ skipNextInterstitial: false, skipPerkId: null });

        return skipPerkId;
      },
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
    skipNextInterstitial: false,
    adFreeUntil: null,
    skipPerkId: null,
    ...overrides,
  });
}
