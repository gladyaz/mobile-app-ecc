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

/**
 * Hard ceiling on interstitials per app session (process lifetime), sitting
 * ON TOP of the counter/cooldown pacing above - it does not replace it.
 *
 * The pacing model alone has no ceiling: with `minVideosBetweenAds: 3` and
 * `minSecondsBetweenAds: 120`, a viewer who binges for three hours is
 * eligible for ~90 interstitials, and every one of them is a full-screen
 * interruption. Play Store policy calls that out directly ("ads that
 * interfere with... normal use") and it is exactly the escalation a long
 * session produces, so the ceiling is enforced client-side rather than
 * hoped for.
 *
 * 8 is derived from the shipped pacing, not picked freely: 8 ads at the
 * 120s floor is ~16 minutes of unavoidable spacing, so a normal session
 * never reaches it and only an unusually long one does. It is deliberately
 * NOT part of `AdsConfig` - `GET /config/ads` is a frozen five-field
 * contract (see docs/api-contract.md), and a backend that could raise this
 * remotely would defeat the point of a ceiling.
 */
export const MAX_INTERSTITIALS_PER_SESSION = 8;

export type AdGateState = {
  readonly lifetimeWatched: number;
  readonly watchedSinceLastAd: number;
  readonly activeThreshold: number;
  readonly lastAdShownAt: number | null;
  /**
   * Interstitials committed since this app process started. Session-scoped
   * on purpose and therefore never persisted - a cold start is a new
   * session and legitimately gets a fresh budget.
   */
  readonly adsShownThisSession: number;
};

export type AdGateHoldReason =
  | 'disabled'
  | 'premium'
  | 'session-cap'
  | 'not-due'
  | 'cooldown'
  | 'ad-not-ready'
  | 'ad-visible';

export type AdGateTransitionResult = {
  readonly show: boolean;
  readonly holdReason?: AdGateHoldReason;
};

/**
 * Everything OUTSIDE the counter state that can hold an interstitial.
 *
 * THIS IS THE PERK SEAM, and it already has the shape a reward-granted ad perk
 * needs. `evaluateTransition` asks one question - "show the next interstitial?"
 * - and answers with a `holdReason` naming which input said no. A future
 * "Skip Next Ad" reward is therefore an added FLAG here plus a matching
 * `AdGateHoldReason`, decided in this pure function and nowhere else. Nothing
 * about the presenter, the controller or the store has to move.
 *
 * WHAT THE FLAG MUST BE, when that reward exists: a value derived from state
 * the SERVER granted, mirrored in the way `isPremium` already is
 * (`components/ads-bridge.tsx` mirrors `useEntitlement()` into the ads store,
 * and the store never persists it - it is re-derived from auth on every
 * launch). A locally-set "I have a skip" boolean would be a client granting
 * itself a paid perk, which is the same class of mistake
 * `features/rewards/__tests__/rewards-economics-boundary.test.ts` exists to
 * prevent for the points balance.
 *
 * V1 SHIPS NO SUCH PERK. `isPremium` is the only suppression input today, no
 * redemption in V1 grants it (`features/rewards/rewards-mapper.ts` filters
 * premium-granting offers out of the V1 catalog), and nothing here should be
 * read as a partially-built skip feature.
 */
export type AdGateTransitionOptions = {
  /**
   * Server-granted entitlement, mirrored from `useEntitlement()`. Never a
   * client-side assertion - see the note above.
   */
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

  // Checked here, next to the other two "ads are off, full stop" reasons,
  // because that is what reaching the ceiling means for the rest of this
  // session. Placing it below `not-due`/`cooldown` would report a
  // transient-looking hold reason for a permanent state.
  if (state.adsShownThisSession >= MAX_INTERSTITIALS_PER_SESSION) {
    return { show: false, holdReason: 'session-cap' };
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
 * stamps `now` as the cooldown anchor, re-rolls the next threshold, and
 * spends one unit of the session budget.
 *
 * The session counter is incremented HERE rather than at the `show()` call
 * site for the same reason the rest of this commit is: `markAdShown` only
 * runs on the native OPENED event, so an ad the viewer never actually saw
 * never costs them a slot.
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
    adsShownThisSession: state.adsShownThisSession + 1,
  };
}
