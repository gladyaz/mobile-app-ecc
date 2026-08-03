/**
 * Slice 15A-S1: pure, framework-free counter/cooldown logic for the
 * interstitial ad gate. This module MUST NOT import react or react-native -
 * every function here is a pure transform of plain data, with randomness
 * injected via an `rng: () => number` parameter so callers (and tests) fully
 * control it. React-facing state (the zustand store) and side effects (the
 * actual ad SDK) live in sibling modules that call into these functions.
 *
 * Semantics pinned by the 15A-S1 approval:
 * - `graceVideos` videos never count toward the threshold. With
 *   `graceVideos: 5`, lifetime watches 1-5 never count; watch 6 is the
 *   first one that can push `watchedSinceLastAd` past 0.
 * - "Ad due" is DERIVED (`watchedSinceLastAd >= activeThreshold`), never a
 *   separately stored boolean flag.
 * - A cooldown HOLDS the ad (does not show it) but never resets the
 *   counter - the next check after the cooldown elapses can show
 *   immediately, without needing another video watched.
 */

export type AdsConfig = {
  readonly enabled: boolean;
  readonly minVideosBetweenAds: number;
  readonly maxVideosBetweenAds: number;
  readonly minSecondsBetweenAds: number;
  readonly graceVideos: number;
};

export const DEFAULT_ADS_CONFIG: AdsConfig = {
  enabled: true,
  minVideosBetweenAds: 3,
  maxVideosBetweenAds: 6,
  minSecondsBetweenAds: 120,
  graceVideos: 5,
};

export type AdGateState = {
  readonly lifetimeWatched: number;
  readonly watchedSinceLastAd: number;
  readonly activeThreshold: number;
  readonly lastAdShownAt: number | null;
};

export type AdGateHoldReason =
  | 'disabled'
  | 'premium'
  | 'not-due'
  | 'cooldown'
  | 'ad-not-ready'
  | 'ad-visible';

export type AdGateTransitionResult = {
  readonly show: boolean;
  readonly holdReason?: AdGateHoldReason;
};

export type AdGateTransitionOptions = {
  readonly isPremium: boolean;
  readonly adReady: boolean;
  readonly adVisible: boolean;
  readonly now: number;
};

/**
 * Rolls a new inclusive-random threshold in `[min, max]` (min/max swapped if
 * `min > max`, defaulted individually if non-finite). `rng` must return a
 * value in `[0, 1)` - inject `Math.random` in production code, a stub in
 * tests.
 */
export function rollThreshold(cfg: AdsConfig, rng: () => number): number {
  const rawMin = cfg.minVideosBetweenAds;
  const rawMax = cfg.maxVideosBetweenAds;

  const safeMin = Number.isFinite(rawMin) ? rawMin : DEFAULT_ADS_CONFIG.minVideosBetweenAds;
  const safeMax = Number.isFinite(rawMax) ? rawMax : DEFAULT_ADS_CONFIG.maxVideosBetweenAds;

  const min = Math.min(safeMin, safeMax);
  const max = Math.max(safeMin, safeMax);

  const roll = rng();
  return min + Math.floor(roll * (max - min + 1));
}

/**
 * Always increments `lifetimeWatched`. Only increments `watchedSinceLastAd`
 * once the new lifetime total is past `graceVideos` - so the first
 * `graceVideos` watches (lifetime 1..graceVideos) never move the counter
 * that `evaluateTransition` compares against `activeThreshold`.
 */
export function recordWatch(state: AdGateState, cfg: AdsConfig): AdGateState {
  const lifetimeWatched = state.lifetimeWatched + 1;
  const countsTowardThreshold = lifetimeWatched > cfg.graceVideos;

  return {
    ...state,
    lifetimeWatched,
    watchedSinceLastAd: countsTowardThreshold
      ? state.watchedSinceLastAd + 1
      : state.watchedSinceLastAd,
  };
}

/**
 * Whether the interstitial should show right now. Checks are evaluated in
 * the same order as the pinned "show requires" list, so when multiple
 * conditions independently fail, the reported `holdReason` is the first one
 * in that list, not an arbitrary one.
 */
export function evaluateTransition(
  state: AdGateState,
  cfg: AdsConfig,
  opts: AdGateTransitionOptions
): AdGateTransitionResult {
  if (!cfg.enabled) {
    return { show: false, holdReason: 'disabled' };
  }

  if (opts.isPremium) {
    return { show: false, holdReason: 'premium' };
  }

  if (opts.adVisible) {
    return { show: false, holdReason: 'ad-visible' };
  }

  if (state.watchedSinceLastAd < state.activeThreshold) {
    return { show: false, holdReason: 'not-due' };
  }

  if (!opts.adReady) {
    return { show: false, holdReason: 'ad-not-ready' };
  }

  const cooldownOk =
    state.lastAdShownAt == null ||
    opts.now - state.lastAdShownAt >= cfg.minSecondsBetweenAds * 1000;

  if (!cooldownOk) {
    // Deliberately does NOT touch watchedSinceLastAd - the cooldown holds
    // the ad, it never resets progress toward the next one.
    return { show: false, holdReason: 'cooldown' };
  }

  return { show: true };
}

/**
 * Commits an ad presentation to state: resets the since-last-ad counter,
 * stamps `now` as the cooldown anchor, and re-rolls the next threshold.
 */
export function markAdShown(
  state: AdGateState,
  cfg: AdsConfig,
  now: number,
  rng: () => number
): AdGateState {
  return {
    ...state,
    watchedSinceLastAd: 0,
    lastAdShownAt: now,
    activeThreshold: rollThreshold(cfg, rng),
  };
}
