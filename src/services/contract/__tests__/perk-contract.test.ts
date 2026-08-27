/**
 * V1 REWARD PERK CONTRACT LOCK.
 *
 * The perks are the whole SPEND half of the V1 coin loop - V1 sells nothing
 * else, because every premium offer is withheld under
 * `CONTENT_ACCESS_MODE=free`. Two perk types exist and they behave in
 * OPPOSITE ways, which is where the drift risk lives:
 *
 *   SKIP_NEXT_INTERSTITIAL is spent by a CALL. The client must consume it
 *   when it actually skips, or the server keeps believing the viewer holds
 *   one and the next ad break skips again for free.
 *
 *   TEMPORARY_AD_PASS is spent by the CLOCK. Consuming one could only
 *   destroy time the viewer paid for, and the backend refuses the attempt.
 *
 * The rule that decides "is a skip active right now" is the SERVER'S, and
 * `skipNextInterstitial` / `adFreeUntil` are how it travels. A client that
 * re-derived it from `perks[]` would be running a second implementation on
 * the one code path where drift means showing an ad to someone who spent
 * coins not to see one.
 */
import { mapActivePerks, mapRedemption, mapRewardsSnapshot } from '@/features/rewards/rewards-mapper';
import {
  ACTIVE_PERKS_AD_PASS,
  ACTIVE_PERKS_EMPTY,
  ACTIVE_PERKS_SKIP,
  PERK_CONSUME_REPLAY,
  PERK_CONSUME_RESPONSE,
  REDEEM_AD_PERK_RESPONSE,
  REDEEM_REPLAY_RESPONSE,
  REWARDS_SNAPSHOT,
} from '@/services/contract/fixtures/rewards-fixtures';
import { V1_PERK_TYPES } from '@/services/contract/v1-contract-manifest';
import type { ActivePerksDto } from '@/services/rewards/rewards-dto';
import type { Translate } from '@/stores/language';

const t = ((key: string) => key) as unknown as Translate;

describe('the two V1 perk types are both rendered and both distinct', () => {
  it('locks the vocabulary to exactly the two ad perks V1 sells', () => {
    expect([...V1_PERK_TYPES].sort()).toEqual(['SKIP_NEXT_INTERSTITIAL', 'TEMPORARY_AD_PASS']);
  });

  it('renders a single-use skip with the server\'s own remaining-use count', () => {
    const perks = mapActivePerks(ACTIVE_PERKS_SKIP, t);

    expect(perks.perks).toHaveLength(1);
    expect(perks.perks[0].type).toBe('SKIP_NEXT_INTERSTITIAL');
    expect(perks.perks[0].remainingUses).toBe(1);
  });

  it('renders a duration pass with remainingUses null - it is not counted, it is timed', () => {
    const perks = mapActivePerks(ACTIVE_PERKS_AD_PASS, t);

    expect(perks.perks[0].type).toBe('TEMPORARY_AD_PASS');
    expect(perks.perks[0].remainingUses).toBeNull();
  });
});

describe('the derived booleans are COPIED from the server, never recomputed', () => {
  it('reports skipNextInterstitial exactly as sent', () => {
    expect(mapActivePerks(ACTIVE_PERKS_SKIP, t).skipNextInterstitial).toBe(true);
    expect(mapActivePerks(ACTIVE_PERKS_AD_PASS, t).skipNextInterstitial).toBe(false);
    expect(mapActivePerks(ACTIVE_PERKS_EMPTY, t).skipNextInterstitial).toBe(false);
  });

  it('parses adFreeUntil as the server\'s instant, and null when no pass is active', () => {
    expect(mapActivePerks(ACTIVE_PERKS_AD_PASS, t).adFreeUntil).toBe(
      '2026-08-27T06:00:00.000Z'
    );
    expect(mapActivePerks(ACTIVE_PERKS_SKIP, t).adFreeUntil).toBeNull();
  });

  it('does NOT infer a skip from a perks array the server said was inactive', () => {
    // The contradiction is the point: a `SKIP_NEXT_INTERSTITIAL` row sits in
    // `perks[]` while the server says the skip is not active (expired, or
    // already spent in a way this client cannot see). The server's verdict
    // wins - re-deriving it here is the drift this test exists to forbid.
    const contradictory: ActivePerksDto = {
      perks: ACTIVE_PERKS_SKIP.perks,
      skipNextInterstitial: false,
      adFreeUntil: null,
    };

    expect(mapActivePerks(contradictory, t).skipNextInterstitial).toBe(false);
  });

  it('fails CLOSED for a snapshot from a backend too old to send perks at all', () => {
    // "This account holds nothing" is both the honest reading and the safe
    // direction: it suppresses no ad and grants no skip.
    const absent = mapActivePerks(undefined, t);

    expect(absent).toEqual({ perks: [], skipNextInterstitial: false, adFreeUntil: null });
  });

  it('travels in the snapshot as well as on its own route, so the Centre never contradicts itself', () => {
    const snapshot = mapRewardsSnapshot(REWARDS_SNAPSHOT, t);

    expect(snapshot.activePerks.skipNextInterstitial).toBe(true);
    expect(snapshot.activePerks.perks).toHaveLength(1);
  });
});

describe('the redeem receipt', () => {
  it('hands back a perk and NO entitlement for an AD_PERK offer', () => {
    // Exactly one of the two is non-null on a fulfilled receipt. V1 only
    // ever sees this half.
    expect(REDEEM_AD_PERK_RESPONSE.perk).not.toBeNull();
    expect(REDEEM_AD_PERK_RESPONSE.entitlementExpiresAt).toBeNull();
    expect(REDEEM_AD_PERK_RESPONSE.grantsDays).toBe(0);
  });

  it('reports a replay without debiting again or issuing a second perk', () => {
    expect(REDEEM_REPLAY_RESPONSE.replayed).toBe(true);
    expect(REDEEM_REPLAY_RESPONSE.wallet.balancePoints).toBe(
      REDEEM_AD_PERK_RESPONSE.wallet.balancePoints
    );
    expect(REDEEM_REPLAY_RESPONSE.perk?.id).toBe(REDEEM_AD_PERK_RESPONSE.perk?.id);
  });

  it('states the server\'s affordability verdict on the offer rather than re-deriving it', () => {
    const affordable = mapRedemption(REWARDS_SNAPSHOT.redemptions[0], t);
    const tooExpensive = mapRedemption(REWARDS_SNAPSHOT.redemptions[1], t);

    // The balance is 240. The client never compares it to costPoints itself;
    // it renders the word the server's `availability` chose.
    expect(affordable.availability).toBe('AVAILABLE');
    expect(affordable.ctaLabel).toBe('rewards.ctaRedeem');
    expect(tooExpensive.availability).toBe('INSUFFICIENT_POINTS');
    expect(tooExpensive.ctaLabel).toBe('rewards.ctaInsufficient');
  });

  it('describes an AD_PERK offer from the server\'s own perk block, so retuning needs no release', () => {
    const adPass = mapRedemption(REWARDS_SNAPSHOT.redemptions[1], t);

    expect(adPass.kind).toBe('AD_PERK');
    expect(adPass.perk).toEqual({ type: 'TEMPORARY_AD_PASS', uses: null, durationMinutes: 120 });
  });
});

describe('consuming a perk', () => {
  it('reports the spend that actually happened', () => {
    expect(PERK_CONSUME_RESPONSE.consumed).toBe(true);
    expect(PERK_CONSUME_RESPONSE.alreadyConsumed).toBe(false);
  });

  it('reports a retried consume as a safe no-op, not a failure to render', () => {
    // 200, not 409: a retry after a dropped response is the NORMAL case, and
    // the client's correct reaction - "the perk is gone, show ads again" -
    // is the same either way. That is what makes the retry safe rather than
    // a double-spend.
    expect(PERK_CONSUME_REPLAY.consumed).toBe(false);
    expect(PERK_CONSUME_REPLAY.alreadyConsumed).toBe(true);
  });

  it('returns the refreshed perk state, so the ad gate needs no second read', () => {
    const perks = mapActivePerks(PERK_CONSUME_RESPONSE.perks, t);

    expect(perks.skipNextInterstitial).toBe(false);
    expect(perks.perks).toEqual([]);
  });
});

describe('V1 sells no premium, from either direction', () => {
  it('withholds every PREMIUM_DAYS offer from the rendered catalog', () => {
    const snapshot = mapRewardsSnapshot(REWARDS_SNAPSHOT, t);
    const offered = snapshot.redemptions.map((offer) => offer.id);

    // The backend already marks them COMING_SOON /
    // NOT_APPLICABLE_IN_FREE_MODE; the client filters them out entirely so
    // no viewer meets a tile that would take coins and change nothing.
    expect(offered).toEqual(['redeem_skip_next_ad', 'redeem_ad_pass_2h']);
    expect(offered).not.toContain('redeem_vip_1d');
  });

  it('withholds a premium-granting offer even from a backend too old to send `kind`', () => {
    const snapshot = mapRewardsSnapshot(
      {
        ...REWARDS_SNAPSHOT,
        redemptions: [
          {
            id: 'redeem_vip_legacy',
            costPoints: 1000,
            grantsDays: 1,
            availability: 'AVAILABLE',
            isRedeemSupported: true,
          } as unknown as (typeof REWARDS_SNAPSHOT.redemptions)[number],
        ],
      },
      t
    );

    // `grantsDays` is the fail-closed half of the rule, kept precisely so
    // the filter does not depend on a field a legacy server may not send.
    expect(snapshot.redemptions).toEqual([]);
  });

  it('never issues a premium entitlement through the V1 spend path', () => {
    expect(REDEEM_AD_PERK_RESPONSE.entitlementExpiresAt).toBeNull();
  });
});
