/**
 * V1 REWARDS CONTRACT LOCK.
 *
 * Feeds the canonical `/rewards/*` payloads through the REAL mapper
 * (`features/rewards/rewards-mapper.ts`), which is the one seam between the
 * wire format and what the Rewards Center renders.
 *
 * WHAT IS BEING PINNED, and why each one is a product failure if it drifts:
 *
 *  - the THREE V1 earn concepts (daily check-in, watch-episodes, social) all
 *    survive the mapping, so a viewer is never shown an earn loop with a
 *    third of it missing;
 *  - every economic value is COPIED, never recomputed, so the app can never
 *    display a balance or a progress figure the server did not send;
 *  - an unknown task, platform or perk type from a LATER backend degrades
 *    gracefully instead of crashing a screen that already shipped.
 */
import { mapRewardsSnapshot, mapTask, mapLedgerPage } from '@/features/rewards/rewards-mapper';
import {
  LEDGER_PAGE,
  REWARDS_SNAPSHOT,
  REWARDS_SNAPSHOT_WITH_FUTURE_VALUES,
  MISSION_CLAIM_REPLAY,
  MISSION_OPEN_RESPONSE,
  WATCH_MISSION_CLAIM_RESPONSE,
} from '@/services/contract/fixtures/rewards-fixtures';
import {
  V1_OPTIONAL_SOCIAL_PLATFORMS,
  V1_RENDERABLE_TASK_TYPES,
  V1_REQUIRED_EARN_CONCEPTS,
  V1_REQUIRED_SOCIAL_PLATFORMS,
  V1_REWARDS_ENDPOINTS,
} from '@/services/contract/v1-contract-manifest';
import type { RewardsSnapshotDto, RewardTaskDto } from '@/services/rewards/rewards-dto';
import type { Translate } from '@/stores/language';

/**
 * `t` returns its key. Every assertion here is about FLAGS and NUMBERS, and
 * a key-returning stub keeps it that way - a case that started depending on
 * Indonesian wording would fail loudly rather than silently pin one
 * language.
 */
const t = ((key: string) => key) as unknown as Translate;

const snapshot = mapRewardsSnapshot(REWARDS_SNAPSHOT, t);

describe('the rewards snapshot carries the whole V1 earn loop', () => {
  it('maps the canonical snapshot without dropping a single known tile', () => {
    expect(snapshot.tasks).toHaveLength(REWARDS_SNAPSHOT.tasks.length);
  });

  it('serves every earn concept V1 requires', () => {
    const concepts = new Set<string>(snapshot.tasks.map((task) => task.type));

    // DAILY_CHECK_IN does not ride in `tasks[]` - it has its own block, and
    // that block being present is the same requirement.
    expect(snapshot.dailyCheckIn).not.toBeNull();
    V1_REQUIRED_EARN_CONCEPTS.filter((concept) => concept !== 'DAILY_CHECK_IN').forEach(
      (concept) => expect(concepts.has(concept)).toBe(true)
    );
  });

  it('serves all three REQUIRED social platforms, and does not require the optional one', () => {
    const platforms = snapshot.tasks
      .map((task) => task.socialPlatform)
      .filter((platform): platform is NonNullable<typeof platform> => platform !== undefined);

    V1_REQUIRED_SOCIAL_PLATFORMS.forEach((platform) =>
      expect(platforms).toContain(platform)
    );
    // Facebook is `requiredForV1: false` server-side and is simply absent
    // when its URL is unconfigured. A release is never held for it.
    V1_OPTIONAL_SOCIAL_PLATFORMS.forEach((platform) =>
      expect(platforms).not.toContain(platform)
    );
  });

  it('reports the watch mission as EPISODES, with server-computed progress copied verbatim', () => {
    const watch = snapshot.tasks.find((task) => task.id === 'task_watch_3_episodes');

    expect(watch?.type).toBe('WATCH_EPISODES');
    // `required` becomes `target`; the PAIR is never derived on the device -
    // a locally counted bar is a client number dressed as progress toward a
    // payout only the server makes.
    expect(watch?.progress).toEqual({ current: 2, target: 3 });
  });

  it('never renames an episode count into watch TIME - the backend cannot measure time', () => {
    expect(snapshot.watchTime).toBeNull();
    expect(snapshot.tasks.some((task) => task.type === 'WATCH_TIME')).toBe(false);
  });

  it('copies the wallet rather than recomputing anything from it', () => {
    expect(snapshot.wallet.balancePoints).toBe(REWARDS_SNAPSHOT.wallet.balancePoints);
    expect(snapshot.wallet.lifetimeEarnedPoints).toBe(
      REWARDS_SNAPSHOT.wallet.lifetimeEarnedPoints
    );
    expect(snapshot.wallet.isServerAuthoritative).toBe(true);
  });

  it('reports the streak from the server, and names the ZONE that defines the reward day', () => {
    expect(snapshot.dailyCheckIn?.currentStreakDays).toBe(3);
    expect(snapshot.dailyCheckIn?.days).toHaveLength(7);
    // The device clock never decides the boundary, so the label has to carry
    // the server's zone.
    expect(snapshot.dailyCheckIn?.resetsAtLabel).toContain('rewards.resetsAt');
  });
});

describe('social missions stay honest about what was actually observed', () => {
  it('marks every social task USER_CONFIRMED - never anything stronger', () => {
    const socialTasks = snapshot.tasks.filter((task) => task.socialPlatform !== undefined);

    expect(socialTasks.length).toBeGreaterThan(0);
    socialTasks.forEach((task) => expect(task.verification).toBe('USER_CONFIRMED'));
  });

  it('keeps `verification` on a CLAIMED social mission, where isClaimSupported is already false', () => {
    // The paid claim is precisely the one a UI is most tempted to describe
    // as verified, so the evidence class has to still be there to refuse it.
    // The backend's `toSocialTask` emits it unconditionally; this pins that
    // the mapper carries it through rather than dropping it with the flag.
    const claimed = snapshot.tasks.find((task) => task.id === 'task_social_youtube');

    expect(claimed?.isClaimed).toBe(true);
    expect(claimed?.isClaimSupported).toBe(false);
    expect(claimed?.verification).toBe('USER_CONFIRMED');
  });

  it('marks the server-observed missions SERVER_OBSERVED, which is a different claim', () => {
    const watch = snapshot.tasks.find((task) => task.id === 'task_watch_5_episodes');

    expect(watch?.verification).toBe('SERVER_OBSERVED');
  });

  it('offers no action word on an already-claimed mission', () => {
    const claimed = snapshot.tasks.find((task) => task.id === 'task_social_youtube');

    // Leaving "Follow" live would offer a second payout the backend answers
    // `alreadyClaimed: true` to, which reads as a reward that silently
    // failed.
    expect(claimed?.ctaLabel).toBe('rewards.ctaClaimed');
  });

  it('offers no action word on a task the server cannot pay', () => {
    const rewardedAd = snapshot.tasks.find((task) => task.id === 'task_rewarded_ad');

    expect(rewardedAd?.isClaimSupported).toBe(false);
    expect(rewardedAd?.ctaLabel).toBe('rewards.ctaUnavailable');
  });

  it('carries the destination the server owns, and the handle it derived', () => {
    const instagram = snapshot.tasks.find((task) => task.id === 'task_social_instagram');

    expect(instagram?.accountHandle).toBe('@redpanda');
    // The URL the app OPENS comes from the open response, not the snapshot -
    // a route that accepted a destination would be a phishing primitive.
    expect(MISSION_OPEN_RESPONSE.destinationUrl).toMatch(/^https:\/\/www\.instagram\.com\//);
  });

  it('reports a duplicate claim as a visible no-op, never as a second payout', () => {
    expect(MISSION_CLAIM_REPLAY.alreadyClaimed).toBe(true);
    expect(MISSION_CLAIM_REPLAY.awardedPoints).toBe(0);
    // The wallet comes back UNCHANGED, so nothing is added to a local total.
    expect(MISSION_CLAIM_REPLAY.wallet.balancePoints).toBe(290);
  });

  it('reports a watch-milestone claim with the milestone reached, not exceeded', () => {
    const claimed = mapTask(WATCH_MISSION_CLAIM_RESPONSE.task, t);

    // Clamped server-side for display: a viewer who started nine episodes
    // has met a three-episode goal, and "9/3" reads like a bug.
    expect(claimed?.progress).toEqual({ current: 3, target: 3 });
    expect(claimed?.isClaimed).toBe(true);
  });
});

describe('an unknown value from a LATER backend never crashes this build', () => {
  const future = mapRewardsSnapshot(
    REWARDS_SNAPSHOT_WITH_FUTURE_VALUES as RewardsSnapshotDto,
    t
  );

  it('drops a task type this build has no copy for, and keeps the ones it does', () => {
    const ids = future.tasks.map((task) => task.id);

    expect(ids).not.toContain('task_referral_invite');
    expect(ids).toContain('task_social_instagram');
    expect(ids).toContain('task_watch_3_episodes');
  });

  it('renders a known task type carrying an UNKNOWN social platform, rather than dropping it', () => {
    // `SOCIAL_FOLLOW` is renderable; only the platform is unfamiliar. The
    // tile survives with generic copy instead of vanishing, because the
    // reward is real either way.
    const threads = future.tasks.find((task) => task.id === 'task_social_threads');

    expect(threads).toBeDefined();
    expect(threads?.socialPlatform).toBeUndefined();
  });

  it('drops an unknown PERK from the display list but keeps the benefit it carries', () => {
    expect(future.activePerks.perks.map((perk) => perk.type)).toEqual([
      'SKIP_NEXT_INTERSTITIAL',
    ]);
    // The two derived booleans are the server's, and they still reach the ad
    // gate - so a viewer keeps a benefit this build cannot name.
    expect(future.activePerks.skipNextInterstitial).toBe(true);
  });

  it('still renders an offer id it has no copy for, named by a fact the server sent', () => {
    const mystery = future.redemptions.find((offer) => offer.id === 'redeem_mystery_box');

    expect(mystery).toBeDefined();
    expect(mystery?.costPoints).toBe(300);
  });

  it('renders a ledger movement with an unrecognised reason rather than hiding it', () => {
    const page = mapLedgerPage(LEDGER_PAGE);
    const future = page.entries.find((entry) => entry.id === 'ldg_fixture_future_reason');

    // Dropping it would leave a viewer reconciling their own history against
    // a balance that no longer adds up.
    expect(future?.reason).toBe('OTHER');
    expect(future?.deltaPoints).toBe(5);
    expect(future?.balanceAfter).toBe(360);
  });

  it('treats the ledger cursor as opaque and passes it back untouched', () => {
    expect(mapLedgerPage(LEDGER_PAGE).nextCursor).toBe(LEDGER_PAGE.nextCursor);
  });

  it('survives a snapshot whose optional blocks are missing entirely', () => {
    const bare = {
      wallet: REWARDS_SNAPSHOT.wallet,
      dailyCheckIn: REWARDS_SNAPSHOT.dailyCheckIn,
      watchTime: null,
    } as unknown as RewardsSnapshotDto;

    expect(() => mapRewardsSnapshot(bare, t)).not.toThrow();

    const mapped = mapRewardsSnapshot(bare, t);

    expect(mapped.tasks).toEqual([]);
    expect(mapped.redemptions).toEqual([]);
    // The honest reading of an absent perks block is "this account holds
    // nothing", which is also the safe direction: it suppresses no ad.
    expect(mapped.activePerks).toEqual({
      perks: [],
      skipNextInterstitial: false,
      adFreeUntil: null,
    });
  });
});

describe('the renderable task vocabulary matches what the mapper can actually render', () => {
  it.each(V1_RENDERABLE_TASK_TYPES)('renders a %s tile', (type) => {
    const task: RewardTaskDto = {
      id: `task_${type.toLowerCase()}`,
      type: type as RewardTaskDto['type'],
      rewardPoints: 10,
      status: 'AVAILABLE',
      isClaimSupported: true,
    };

    expect(mapTask(task, t)).not.toBeNull();
  });

  it('drops a type outside the vocabulary rather than rendering an unnamed reward', () => {
    const task = {
      id: 'task_unknown',
      type: 'REFERRAL_INVITE',
      rewardPoints: 200,
      status: 'AVAILABLE',
      isClaimSupported: true,
    } as unknown as RewardTaskDto;

    expect(mapTask(task, t)).toBeNull();
  });
});

describe('the rewards endpoint manifest is complete and authenticated', () => {
  it('declares all eight V1 rewards routes, each exactly once', () => {
    const paths = V1_REWARDS_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`);

    expect(paths).toHaveLength(8);
    expect(new Set(paths).size).toBe(8);
  });

  it('marks every rewards route authenticated - there is no anonymous wallet', () => {
    // A wallet without an account has no owner and a streak has nothing to
    // attach to, so an anonymous rewards surface would have to invent both.
    V1_REWARDS_ENDPOINTS.forEach((endpoint) => expect(endpoint.requiresAuth).toBe(true));
  });
});
