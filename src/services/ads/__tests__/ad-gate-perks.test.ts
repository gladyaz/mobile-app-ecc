import {
  DEFAULT_ADS_CONFIG,
  evaluateTransition,
  markInterstitialSkipped,
  MAX_INTERSTITIALS_PER_SESSION,
  type AdGateState,
} from '@/services/ads/ad-gate';

/**
 * The REWARD PERK half of the ad gate, kept in its own suite because it is a
 * different question from pacing.
 *
 * Two properties are load-bearing here and are asserted rather than assumed:
 *
 *  1. A skip is spent ONLY on a transition where an interstitial would
 *     genuinely have been shown. A perk burned on a quiet transition is one
 *     the viewer paid for and never received.
 *  2. A temporary pass suppresses by the CLOCK and consumes nothing. Spending
 *     a single-use skip while a pass is already covering the interruption
 *     would destroy the perk that cannot be replaced.
 *
 * Every input here is server-derived. Nothing in this module can set a perk;
 * the tests pass the values a `GET /rewards/perks` response would have
 * produced.
 */

const NOW = 1_800_000_000_000;

function dueState(overrides: Partial<AdGateState> = {}): AdGateState {
  return {
    lifetimeWatched: 40,
    watchedSinceLastAd: 3,
    activeThreshold: 3,
    lastAdShownAt: null,
    adsShownThisSession: 0,
    ...overrides,
  };
}

const READY = { isPremium: false, adReady: true, adVisible: false, now: NOW };

describe('evaluateTransition - skip-next-interstitial perk', () => {
  it('shows the ad when the account holds no perk at all', () => {
    const result = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, READY);

    expect(result.show).toBe(true);
    expect(result.consumeSkip).toBeUndefined();
  });

  it('suppresses the due interstitial and asks the caller to spend the skip', () => {
    const result = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, {
      ...READY,
      skipNextInterstitial: true,
    });

    expect(result.show).toBe(false);
    expect(result.holdReason).toBe('perk-skip');
    expect(result.consumeSkip).toBe(true);
  });

  it('does NOT spend the skip on a transition where no ad was due', () => {
    // The failure this prevents: a viewer buys an ad skip, watches one more
    // video with nothing due, and the perk is gone without an ad ever having
    // been suppressed.
    const result = evaluateTransition(
      dueState({ watchedSinceLastAd: 1, activeThreshold: 3 }),
      DEFAULT_ADS_CONFIG,
      { ...READY, skipNextInterstitial: true }
    );

    expect(result.show).toBe(false);
    expect(result.holdReason).toBe('not-due');
    expect(result.consumeSkip).toBeUndefined();
  });

  it('does NOT spend the skip when the ad was not loaded', () => {
    const result = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, {
      ...READY,
      adReady: false,
      skipNextInterstitial: true,
    });

    expect(result.holdReason).toBe('ad-not-ready');
    expect(result.consumeSkip).toBeUndefined();
  });

  it('does NOT spend the skip while the frequency cooldown is still holding', () => {
    const result = evaluateTransition(
      dueState({ lastAdShownAt: NOW - 1_000 }),
      DEFAULT_ADS_CONFIG,
      { ...READY, skipNextInterstitial: true }
    );

    expect(result.holdReason).toBe('cooldown');
    expect(result.consumeSkip).toBeUndefined();
  });

  it('does NOT spend the skip once the session ceiling is reached', () => {
    const result = evaluateTransition(
      dueState({ adsShownThisSession: MAX_INTERSTITIALS_PER_SESSION }),
      DEFAULT_ADS_CONFIG,
      { ...READY, skipNextInterstitial: true }
    );

    expect(result.holdReason).toBe('session-cap');
    expect(result.consumeSkip).toBeUndefined();
  });

  it('does NOT spend the skip for a premium viewer, who sees no ads anyway', () => {
    const result = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, {
      ...READY,
      isPremium: true,
      skipNextInterstitial: true,
    });

    expect(result.holdReason).toBe('premium');
    expect(result.consumeSkip).toBeUndefined();
  });

  it('does NOT spend the skip when ads are disabled for the deployment', () => {
    const result = evaluateTransition(
      dueState(),
      { ...DEFAULT_ADS_CONFIG, enabled: false },
      { ...READY, skipNextInterstitial: true }
    );

    expect(result.holdReason).toBe('disabled');
    expect(result.consumeSkip).toBeUndefined();
  });
});

describe('evaluateTransition - temporary ad pass', () => {
  it('holds the interstitial while the pass is still running, consuming nothing', () => {
    const result = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, {
      ...READY,
      adFreeUntil: NOW + 60_000,
    });

    expect(result.show).toBe(false);
    expect(result.holdReason).toBe('ad-pass');
    // Spent by the clock. "Consuming" one could only destroy time the viewer
    // paid for.
    expect(result.consumeSkip).toBeUndefined();
  });

  it('stops holding the moment the pass expires', () => {
    // Liveness is derived from the clock rather than a stored flag, so a pass
    // cannot keep suppressing ads because no sweeper ran.
    const expired = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, {
      ...READY,
      adFreeUntil: NOW - 1,
    });

    expect(expired.show).toBe(true);
    expect(expired.holdReason).toBeUndefined();
  });

  it('treats an exactly-expiring pass as over', () => {
    const result = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, {
      ...READY,
      adFreeUntil: NOW,
    });

    expect(result.show).toBe(true);
  });

  it('spends nothing when a pass and a skip are both held', () => {
    // The pass covers this interruption for free, so the single-use skip -
    // the one that cannot be replaced - must survive it.
    const result = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, {
      ...READY,
      adFreeUntil: NOW + 60_000,
      skipNextInterstitial: true,
    });

    expect(result.holdReason).toBe('ad-pass');
    expect(result.consumeSkip).toBeUndefined();
  });

  it('falls back to the skip once the pass has run out', () => {
    const result = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, {
      ...READY,
      adFreeUntil: NOW - 1,
      skipNextInterstitial: true,
    });

    expect(result.holdReason).toBe('perk-skip');
    expect(result.consumeSkip).toBe(true);
  });
});

describe('evaluateTransition - a rewards outage is the safe direction', () => {
  it('shows ads exactly as before when no perk information is supplied at all', () => {
    // `GET /rewards/perks` failing must not hand out a free ad-free session.
    const result = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, READY);

    expect(result.show).toBe(true);
  });

  it('treats explicit false/null the same as absent', () => {
    const result = evaluateTransition(dueState(), DEFAULT_ADS_CONFIG, {
      ...READY,
      skipNextInterstitial: false,
      adFreeUntil: null,
    });

    expect(result.show).toBe(true);
  });
});

describe('markInterstitialSkipped', () => {
  it('resets pacing exactly as a shown ad would, so the next ad is a full interval away', () => {
    // Without this, the very next transition is due again and shows an ad -
    // the viewer would have deferred one interruption by a single episode.
    const next = markInterstitialSkipped(dueState(), DEFAULT_ADS_CONFIG, NOW, () => 0);

    expect(next.watchedSinceLastAd).toBe(0);
    expect(next.lastAdShownAt).toBe(NOW);
    expect(next.activeThreshold).toBe(DEFAULT_ADS_CONFIG.minVideosBetweenAds);
  });

  it('does NOT spend a slot of the per-session interruption ceiling', () => {
    // The ceiling bounds full-screen INTERRUPTIONS in one sitting, and a
    // skipped ad is not one.
    const next = markInterstitialSkipped(
      dueState({ adsShownThisSession: 2 }),
      DEFAULT_ADS_CONFIG,
      NOW,
      () => 0
    );

    expect(next.adsShownThisSession).toBe(2);
  });

  it('leaves the input state untouched', () => {
    const state = dueState();

    markInterstitialSkipped(state, DEFAULT_ADS_CONFIG, NOW, () => 0);

    expect(state.watchedSinceLastAd).toBe(3);
    expect(state.lastAdShownAt).toBeNull();
  });
});
