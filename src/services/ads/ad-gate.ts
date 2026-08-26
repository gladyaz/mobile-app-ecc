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
  | 'ad-visible'
  /** A `TEMPORARY_AD_PASS` is running. Spent by the clock; nothing consumed. */
  | 'ad-pass'
  /** A `SKIP_NEXT_INTERSTITIAL` was spent on THIS interruption. */
  | 'perk-skip';

export type AdGateTransitionResult = {
  readonly show: boolean;
  readonly holdReason?: AdGateHoldReason;
  /**
   * The caller must record the single-use skip as spent - server-side, and in
   * the local pacing.
   *
   * `true` on EXACTLY the transition where an interstitial would otherwise
   * have been presented and a skip suppressed it. It is never `true` for a
   * hold that had another cause: a perk the app "uses" on a transition where
   * no ad was due would take something the viewer paid for and give nothing
   * back, which is why the skip check sits below every eligibility check
   * rather than beside `isPremium`.
   */
  readonly consumeSkip?: boolean;
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
 * V1 NOW SHIPS THAT PERK, and it arrived exactly as described: two added
 * flags, decided in this pure function and nowhere else. Both are SERVER
 * state, mirrored into the ads store by `components/ads-bridge.tsx` from
 * `GET /rewards/perks` in the same way `isPremium` is mirrored from
 * `useEntitlement()`, and neither is persisted - a cold start re-reads them
 * from the backend. Nothing in this app can set either locally, which is what
 * keeps "I have a free ad skip" a fact the server established rather than one
 * a client asserted.
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
  /**
   * The viewer holds an unexpired, unconsumed `SKIP_NEXT_INTERSTITIAL`.
   *
   * SERVER-DERIVED, copied from `GET /rewards/perks`. The client does NOT
   * re-derive it by inspecting the perk array - that rule belongs to the
   * backend, and a second implementation would drift on the one code path
   * where drift means showing an ad to someone who spent coins not to see one.
   *
   * Defaults to `false` when omitted, which is the SAFE direction: an
   * unavailable rewards API suppresses nothing and grants nothing.
   */
  readonly skipNextInterstitial?: boolean;
  /**
   * Epoch milliseconds until which no interstitial may be shown at all, from
   * the furthest-out active `TEMPORARY_AD_PASS`, or `null` when none is
   * running. Compared against `now` rather than read from a stored "active"
   * flag, so a pass stops working at exactly its expiry with no sweeper
   * involved - the failure that avoids is a two-hour pass still suppressing
   * ads a week later because nothing ran to mark it over.
   */
  readonly adFreeUntil?: number | null;
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

  // ---------------------------------------------------------------------
  // EVERY CHECK ABOVE THIS LINE ANSWERS "WOULD AN AD HAVE BEEN SHOWN?".
  // Only past it is the answer yes - which is why the two perk checks live
  // here and not beside `isPremium`. A skip spent on a transition that was
  // already going to be quiet is a perk the viewer bought and never received.
  // ---------------------------------------------------------------------

  // The PASS is checked before the SKIP, and the order is load-bearing for a
  // viewer holding both: the pass covers this interruption by the clock and
  // costs nothing to use, so spending the single-use skip on the same
  // interruption would destroy the one that cannot be replaced.
  if (opts.adFreeUntil != null && opts.adFreeUntil > opts.now) {
    // Nothing is consumed. A duration pass is spent by time passing;
    // "consuming" one could only destroy time the viewer paid for.
    return { show: false, holdReason: 'ad-pass' };
  }

  if (opts.skipNextInterstitial === true) {
    // EXACTLY the next eligible interstitial, and the caller is told to spend
    // it. A skip the app honours without recording leaves the server still
    // believing the perk is held, so the next ad break would skip again for
    // free and the receipt would stop describing what happened.
    return { show: false, holdReason: 'perk-skip', consumeSkip: true };
  }

  return { show: true };
}

/**
 * Commits a SKIPPED interstitial to the pacing state.
 *
 * IT RESETS PACING EXACTLY AS A SHOWN AD WOULD, and that is the point rather
 * than an oversight: "skip the next interstitial" means this ad break is over,
 * so the next one is due after the normal interval. Leaving the counter alone
 * would mean the very next video transition is due again and shows an ad - the
 * viewer would have spent 150 coins to defer one interruption by a single
 * episode, which is not what the offer says.
 *
 * IT DOES NOT SPEND A SESSION SLOT. `adsShownThisSession` bounds how many
 * full-screen INTERRUPTIONS one sitting may contain, and a skipped ad is not
 * one. Charging the skip against that ceiling would let a viewer who bought
 * ad skips reach the cap sooner and, past it, see nothing at all - which
 * sounds like a win until it is the reason the ceiling stops protecting the
 * viewers it was written for.
 */
export function markInterstitialSkipped(
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
