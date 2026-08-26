import {
  applyCheckInResponse,
  mapDailyCheckIn,
  mapLedgerEntry,
  mapLedgerPage,
  mapRedemption,
  mapRewardsSnapshot,
  mapTask,
  mapWallet,
} from '@/features/rewards/rewards-mapper';
import { DEFAULT_LANGUAGE, translations } from '@/services/i18n/translations';
import type {
  CheckInResponseDto,
  DailyCheckInDto,
  RewardRedemptionOfferDto,
  RewardTaskDto,
  RewardWalletDto,
  RewardsSnapshotDto,
} from '@/services/rewards/rewards-dto';
import type { Translate } from '@/stores/language';

/**
 * The wire-format seam.
 *
 * The split it enforces is the whole reason this module exists:
 *
 *   SERVER owns economics and availability - every point value, cost,
 *   duration, streak figure, `isClaimSupported`, `isRedeemSupported` and
 *   `availability`. These cases assert each one is COPIED, never computed,
 *   defaulted, or nudged toward a friendlier value.
 *
 *   CLIENT owns copy and formatting. These cases assert the mapper supplies
 *   the words (the backend sends none, deliberately, because the app ships
 *   three languages) without ever letting a word imply an economic fact the
 *   server did not send.
 *
 * `t` is stubbed to return its key. Every assertion below is about FLAGS and
 * NUMBERS, and a key-returning stub keeps it that way: a case that started
 * depending on Indonesian wording would fail loudly here instead of silently
 * pinning one language.
 */
const t = ((key: string) => key) as unknown as Translate;
const idCopy = translations[DEFAULT_LANGUAGE];

/** Interpolating `t`, for the two cases that DO care about a parameter. */
const interpolate = ((key: keyof typeof idCopy, params?: Record<string, string | number>) =>
  Object.entries(params ?? {}).reduce(
    (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
    idCopy[key]
  )) as unknown as Translate;

const WALLET_DTO: RewardWalletDto = {
  balancePoints: 1250,
  lifetimeEarnedPoints: 8400,
  isServerAuthoritative: true,
  updatedAt: '2026-08-22T03:04:00.000Z',
  version: 7,
};

const CHECK_IN_DTO: DailyCheckInDto = {
  currentStreakDays: 3,
  longestStreakDays: 11,
  totalCheckInDays: 14,
  todayRewardPoints: 25,
  isTodayClaimed: false,
  days: [
    { day: 1, rewardPoints: 10, state: 'CLAIMED', isBonus: false },
    { day: 7, rewardPoints: 100, state: 'UPCOMING', isBonus: true },
  ],
  isClaimSupported: true,
  periodKey: '2026-08-22',
  timezone: 'Asia/Jakarta',
  resetsAt: '2026-08-22T17:00:00.000Z',
};

describe('mapWallet', () => {
  it('copies the balance through untouched', () => {
    expect(mapWallet(WALLET_DTO).balancePoints).toBe(1250);
    expect(mapWallet(WALLET_DTO).lifetimeEarnedPoints).toBe(8400);
  });

  it('carries the server-authoritative flag through as sent', () => {
    expect(mapWallet(WALLET_DTO).isServerAuthoritative).toBe(true);
  });

  it('refuses to PROMOTE a wallet that did not claim to be authoritative', () => {
    // The flag is how the UI tells real state from anything else. A mapper
    // that defaulted it to `true` would make it unfalsifiable, and the
    // preview labelling would silently stop appearing when it was needed.
    const notAuthoritative = mapWallet({
      ...WALLET_DTO,
      isServerAuthoritative: false,
    });

    expect(notAuthoritative.isServerAuthoritative).toBe(false);

    const missingFlag = mapWallet({
      ...WALLET_DTO,
      isServerAuthoritative: undefined as unknown as boolean,
    });

    expect(missingFlag.isServerAuthoritative).toBe(false);
  });

  it('formats the update instant on this side, since the server sends ISO', () => {
    const label = mapWallet(WALLET_DTO).updatedAtLabel;

    expect(label).not.toBe(WALLET_DTO.updatedAt);
    expect(label).toMatch(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/);
  });

  it('leaves the label null for a wallet that has never moved', () => {
    expect(mapWallet({ ...WALLET_DTO, updatedAt: null }).updatedAtLabel).toBeNull();
  });
});

describe('mapDailyCheckIn', () => {
  it('copies every streak and reward figure verbatim', () => {
    const checkIn = mapDailyCheckIn(CHECK_IN_DTO, t);

    expect(checkIn.currentStreakDays).toBe(3);
    expect(checkIn.longestStreakDays).toBe(11);
    expect(checkIn.todayRewardPoints).toBe(25);
    expect(checkIn.days.map((day) => day.rewardPoints)).toEqual([10, 100]);
    expect(checkIn.days.map((day) => day.state)).toEqual(['CLAIMED', 'UPCOMING']);
  });

  it('carries the server’s claim support through unchanged', () => {
    expect(mapDailyCheckIn(CHECK_IN_DTO, t).isClaimSupported).toBe(true);
    expect(
      mapDailyCheckIn({ ...CHECK_IN_DTO, isClaimSupported: false }, t).isClaimSupported
    ).toBe(false);
  });

  it('supplies the CTA word itself, because the server sends no copy', () => {
    expect(mapDailyCheckIn(CHECK_IN_DTO, t).ctaLabel).toBe('rewards.checkInCta');
  });

  it('says "checked in" once the server reports today claimed', () => {
    expect(
      mapDailyCheckIn({ ...CHECK_IN_DTO, isTodayClaimed: true }, t).ctaLabel
    ).toBe('rewards.checkedInCta');
  });

  it('names the timezone that OWNS the reward day in the reset label', () => {
    // The device clock never defines "today". Rendering only a local time
    // would imply it does; naming the service zone keeps the boundary
    // attributable to the server that actually decides it.
    const label = mapDailyCheckIn(CHECK_IN_DTO, interpolate).resetsAtLabel;

    expect(label).toContain('Asia/Jakarta');
    expect(label).toMatch(/\d{2}:\d{2}/);
  });
});

describe('mapTask', () => {
  const socialDto: RewardTaskDto = {
    id: 'task_social_facebook',
    type: 'SOCIAL_FOLLOW',
    socialPlatform: 'FACEBOOK',
    rewardPoints: 50,
    status: 'AVAILABLE',
    isClaimSupported: false,
    unsupportedReason: 'NO_VERIFIABLE_SIGNAL',
  };

  /**
   * `mapTask` returns `null` for a task type this build cannot render, which
   * is a real outcome rather than an error. These cases are all about tasks
   * it CAN render, so the null is a test failure rather than something each
   * assertion has to re-check.
   */
  function mapKnownTask(dto: RewardTaskDto, stage?: 'idle' | 'opened' | 'claimed') {
    const task = mapTask(dto, t, stage);

    if (!task) {
      throw new Error(`Expected mapTask to render a task of type ${dto.type}`);
    }

    return task;
  }

  it('copies the reward figure and status through', () => {
    const task = mapKnownTask(socialDto);

    expect(task.rewardPoints).toBe(50);
    expect(task.status).toBe('AVAILABLE');
    expect(task.socialPlatform).toBe('FACEBOOK');
  });

  it('never flips an unsupported task to claimable', () => {
    expect(mapKnownTask(socialDto).isClaimSupported).toBe(false);
    expect(mapKnownTask({ ...socialDto, isClaimSupported: true }).isClaimSupported).toBe(true);
  });

  it('carries the machine-readable unsupported reason', () => {
    expect(mapKnownTask(socialDto).unsupportedReason).toBe('NO_VERIFIABLE_SIGNAL');
  });

  it('gives an unsupported task NO action word', () => {
    // "Follow" beside a +50 pill invites the user to earn points the backend
    // has no verifiable signal for and will refuse to pay.
    expect(mapKnownTask(socialDto).ctaLabel).toBe('rewards.ctaUnavailable');
    expect(
      mapKnownTask({ ...socialDto, unsupportedReason: 'AWAITING_PRODUCT_DECISION' }).ctaLabel
    ).toBe('rewards.ctaSoon');
  });

  it('gives the action word back the moment the server supports the claim', () => {
    expect(mapKnownTask({ ...socialDto, isClaimSupported: true }).ctaLabel).toBe(
      'rewards.ctaFollow'
    );
    expect(
      mapKnownTask({ ...socialDto, socialPlatform: 'YOUTUBE', isClaimSupported: true }).ctaLabel
    ).toBe('rewards.ctaSubscribe');
  });

  it('turns the CTA into a CONFIRMATION once the profile has been opened', () => {
    // The second step of the two-call flow is the viewer confirming an action
    // NOBODY observed. The word has to be theirs ("I've followed"), not a
    // claim that anything was checked.
    expect(mapKnownTask({ ...socialDto, isClaimSupported: true }, 'opened').ctaLabel).toBe(
      'rewards.ctaConfirmFollow'
    );
  });

  it('carries the USER_CONFIRMED evidence class instead of implying verification', () => {
    const task = mapKnownTask({
      ...socialDto,
      isClaimSupported: true,
      verification: 'USER_CONFIRMED',
    });

    expect(task.verification).toBe('USER_CONFIRMED');
  });

  it('withdraws the action word entirely once the server reports the claim paid', () => {
    // A second press would reach a backend that answers `alreadyClaimed`, and
    // a viewer reads that as a reward that silently failed.
    const task = mapKnownTask({
      ...socialDto,
      isClaimSupported: true,
      claimedAt: '2026-08-26T09:00:00.000Z',
    });

    expect(task.isClaimed).toBe(true);
    expect(task.ctaLabel).toBe('rewards.ctaClaimed');
  });

  it('renders WATCH_EPISODES progress from the SERVER pair, never a local count', () => {
    const task = mapKnownTask({
      id: 'task_watch_5_episodes',
      type: 'WATCH_EPISODES',
      rewardPoints: 50,
      status: 'IN_PROGRESS',
      isClaimSupported: true,
      verification: 'SERVER_OBSERVED',
      progress: { current: 3, required: 5 },
    });

    expect(task.type).toBe('WATCH_EPISODES');
    expect(task.progress).toEqual({ current: 3, target: 5 });
  });

  it('carries the server-derived account handle for a social tile', () => {
    const task = mapKnownTask({
      ...socialDto,
      isClaimSupported: true,
      accountHandle: '@redpanda',
      destinationUrl: 'https://www.instagram.com/redpanda',
    });

    expect(task.accountHandle).toBe('@redpanda');
  });

  it('DROPS a task type this build does not know, rather than crashing on it', () => {
    // The backend adds task types server-side and expects already-installed
    // clients to keep working. A `Record` lookup on an unknown member returns
    // `undefined` and then crashes the row, so the seam refuses it here.
    expect(
      mapTask({ ...socialDto, type: 'QUANTUM_MISSION' as never, socialPlatform: undefined }, t)
    ).toBeNull();
  });

  it('renders a known task whose social platform is unknown, without crashing', () => {
    // The platform is decoration; the reward is not. Dropping the whole tile
    // over an unrenderable mark would hide a mission the viewer can complete.
    const task = mapTask({ ...socialDto, socialPlatform: 'BLUESKY' as never }, t);

    expect(task).not.toBeNull();
    expect(task?.socialPlatform).toBeUndefined();
  });

  it('reports no progress for a task the server sent none for', () => {
    // Still true for one-shot missions, and still for the same reason: a
    // client-counted "2 of 5" would be a local number dressed as server
    // progress toward a payout only the server makes.
    expect(mapKnownTask(socialDto).progress).toBeNull();
    expect(
      mapKnownTask({ ...socialDto, type: 'REWARDED_AD', socialPlatform: undefined }).progress
    ).toBeNull();
  });
});

describe('mapRedemption', () => {
  it('copies cost, duration and availability verbatim', () => {
    const offer = mapRedemption(
      {
        id: 'redeem_vip_1d',
        costPoints: 1000,
        grantsDays: 1,
        availability: 'AVAILABLE',
        isRedeemSupported: true,
        kind: 'PREMIUM_DAYS' as const,
      },
      t
    );

    expect(offer.costPoints).toBe(1000);
    expect(offer.grantsDays).toBe(1);
    expect(offer.availability).toBe('AVAILABLE');
    expect(offer.isRedeemSupported).toBe(true);
  });

  it('does not recompute affordability from any balance it can see', () => {
    // `availability` is decided server-side against the server's own
    // balance. A client that recomputed it could light up a button the
    // backend is about to refuse.
    const offer = mapRedemption(
      {
        id: 'redeem_vip_3d',
        costPoints: 2500,
        grantsDays: 3,
        availability: 'INSUFFICIENT_POINTS',
        isRedeemSupported: true,
        kind: 'PREMIUM_DAYS' as const,
      },
      t
    );

    expect(offer.availability).toBe('INSUFFICIENT_POINTS');
  });

  it('names an offer this build has no copy for, rather than dropping it', () => {
    // Hiding a purchasable item would be worse than a generically-named row,
    // and inventing a name for it worse still. The one fact the server sent
    // about it - its duration - is what names it.
    const offer = mapRedemption(
      {
        id: 'redeem_vip_30d_future',
        costPoints: 12000,
        grantsDays: 30,
        availability: 'AVAILABLE',
        isRedeemSupported: true,
        kind: 'PREMIUM_DAYS' as const,
      },
      interpolate
    );

    expect(offer.title).toContain('30');
    expect(offer.costPoints).toBe(12000);
  });
});

describe('mapLedgerEntry', () => {
  it('keeps the sign of the delta and the server’s balanceAfter', () => {
    const entry = mapLedgerEntry({
      id: 'led_1',
      deltaPoints: -1000,
      reason: 'VIP_REDEMPTION',
      sourceType: 'REDEMPTION',
      sourceId: 'rdm_1',
      balanceAfter: 250,
      createdAt: '2026-08-22T04:00:00.000Z',
      metadata: null,
    });

    expect(entry.deltaPoints).toBe(-1000);
    expect(entry.balanceAfter).toBe(250);
    expect(entry.reason).toBe('VIP_REDEMPTION');
  });

  it('renders an unknown reason as a real movement rather than dropping it', () => {
    // A user reconciling their own history against a balance that no longer
    // adds up is a worse failure than a generically-labelled row.
    const entry = mapLedgerEntry({
      id: 'led_2',
      deltaPoints: 500,
      reason: 'SOME_FUTURE_REASON',
      sourceType: 'FUTURE',
      sourceId: null,
      balanceAfter: 750,
      createdAt: '2026-08-22T04:00:00.000Z',
      metadata: null,
    });

    expect(entry.reason).toBe('OTHER');
    expect(entry.deltaPoints).toBe(500);
  });

  it('passes the opaque cursor through a page unchanged', () => {
    const page = mapLedgerPage({ entries: [], nextCursor: 'OPAQUE_CURSOR_123' });

    expect(page.nextCursor).toBe('OPAQUE_CURSOR_123');
  });
});

describe('applyCheckInResponse', () => {
  const ORIGINAL_PREMIUM_FLAG = process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED;

  afterEach(() => {
    process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = ORIGINAL_PREMIUM_FLAG;
  });

  const snapshotDto: RewardsSnapshotDto = {
    wallet: WALLET_DTO,
    dailyCheckIn: CHECK_IN_DTO,
    watchTime: null,
    tasks: [],
    redemptions: [],
    activePerks: { perks: [], skipNextInterstitial: false, adFreeUntil: null },
  };

  const response: CheckInResponseDto = {
    awardedPoints: 10,
    alreadyCheckedIn: false,
    ledgerEntryId: 'led_1',
    wallet: { ...WALLET_DTO, balancePoints: 999, version: 8 },
    dailyCheckIn: { ...CHECK_IN_DTO, isTodayClaimed: true, currentStreakDays: 4 },
  };

  it('REPLACES the wallet rather than adding the award to the old one', () => {
    // The distinguishing number: 1250 + 10 would be 1260. The server said
    // 999, and the server is the authority.
    const before = mapRewardsSnapshot(snapshotDto, t);
    const after = applyCheckInResponse(before, response, t);

    expect(before.wallet.balancePoints).toBe(1250);
    expect(after.wallet.balancePoints).toBe(999);
  });

  it('adopts the server’s check-in state wholesale', () => {
    const after = applyCheckInResponse(mapRewardsSnapshot(snapshotDto, t), response, t);

    expect(after.dailyCheckIn?.isTodayClaimed).toBe(true);
    expect(after.dailyCheckIn?.currentStreakDays).toBe(4);
  });

  it('does not patch redemption availability from the new balance', () => {
    // Availability is server-computed. Recomputing it here from a fresher
    // balance is exactly the client/server divergence this module prevents;
    // the caller re-reads the snapshot instead.
    //
    // Runs with the premium experience ON so the (VIP, premium-granting) offer
    // survives the V1 scope filter and there is something to assert about. The
    // invariant under test is the check-in patch, not the V1 catalog.
    process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = 'true';

    const withOffer = mapRewardsSnapshot(
      {
        ...snapshotDto,
        redemptions: [
          {
            id: 'redeem_vip_1d',
            costPoints: 1000,
            grantsDays: 1,
            availability: 'INSUFFICIENT_POINTS',
            isRedeemSupported: true,
            kind: 'PREMIUM_DAYS' as const,
          },
        ],
        activePerks: { perks: [], skipNextInterstitial: false, adFreeUntil: null },
      },
      t
    );

    const after = applyCheckInResponse(withOffer, response, t);

    expect(after.redemptions[0].availability).toBe('INSUFFICIENT_POINTS');
  });

  it('leaves the previous snapshot object untouched', () => {
    const before = mapRewardsSnapshot(snapshotDto, t);

    applyCheckInResponse(before, response, t);

    expect(before.wallet.balancePoints).toBe(1250);
    expect(before.dailyCheckIn?.isTodayClaimed).toBe(false);
  });
});

describe('mapRewardsSnapshot', () => {
  it('maps a null watchTime straight to the section’s empty state', () => {
    const snapshot = mapRewardsSnapshot(
      {
        wallet: WALLET_DTO,
        dailyCheckIn: CHECK_IN_DTO,
        watchTime: null,
        tasks: [],
        redemptions: [],
        activePerks: { perks: [], skipNextInterstitial: false, adFreeUntil: null },
      },
      t
    );

    // `null` is the backend's ANSWER, not an omission - it has no
    // trustworthy watch-time signal, and nothing here back-fills one.
    expect(snapshot.watchTime).toBeNull();
  });
});

/**
 * V1 IS FREE + ADS. `grantsDays > 0` is how the backend says an offer buys
 * premium access, so such an offer is a coin-priced unlock of episodes that are
 * already free in V1 - it must not reach the Redeem panel. Keyed on the GRANT
 * rather than an id blocklist, so the first genuinely non-premium offer (a Skip
 * Next Ad perk, say) flows through with no client change.
 */
describe('mapRewardsSnapshot redemption scope (V1: free + ads)', () => {
  const ORIGINAL_PREMIUM_FLAG = process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED;

  afterEach(() => {
    process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = ORIGINAL_PREMIUM_FLAG;
  });

  const vipOffer = {
    id: 'redeem_vip_1d',
    costPoints: 1000,
    grantsDays: 1,
    availability: 'AVAILABLE',
    isRedeemSupported: true,
    kind: 'PREMIUM_DAYS' as const,
  } as const;

  /** The forward shape: a perk that grants no premium days. */
  const perkOffer = {
    id: 'redeem_skip_next_ad',
    costPoints: 200,
    grantsDays: 0,
    availability: 'AVAILABLE',
    isRedeemSupported: true,
    kind: 'AD_PERK' as const,
  } as const;

  function snapshotWith(redemptions: readonly RewardRedemptionOfferDto[]) {
    return mapRewardsSnapshot(
      {
        wallet: WALLET_DTO,
        dailyCheckIn: CHECK_IN_DTO,
        watchTime: null,
        tasks: [],
        redemptions: [...redemptions],
        activePerks: { perks: [], skipNextInterstitial: false, adFreeUntil: null },
      },
      t
    );
  }

  it('drops every premium-granting offer, so V1 advertises no paid unlock', () => {
    expect(snapshotWith([vipOffer]).redemptions).toEqual([]);
  });

  it('withholds a PREMIUM_DAYS offer even when it claims to grant zero days', () => {
    // `kind` states the rule directly and `grantsDays` is the fail-closed
    // half beside it. An offer that contradicts itself is still not something
    // V1 sells - the two checks are an AND, not a fallback for each other.
    expect(snapshotWith([{ ...vipOffer, grantsDays: 0 }]).redemptions).toEqual([]);
  });

  it('lets an AD_PERK offer through - it is the coin utility V1 actually ships', () => {
    const [offer] = snapshotWith([perkOffer]).redemptions;

    expect(offer.id).toBe('redeem_skip_next_ad');
    expect(offer.kind).toBe('AD_PERK');
  });

  it('describes an ad perk from the SERVER’s own perk block, never a hardcoded duration', () => {
    // Retuning "2 hours" to "3 hours" server-side has to change this copy
    // with no mobile release, which it only can if the number is data.
    const snapshot = mapRewardsSnapshot(
      {
        wallet: WALLET_DTO,
        dailyCheckIn: CHECK_IN_DTO,
        watchTime: null,
        tasks: [],
        redemptions: [
          {
            id: 'redeem_ad_pass_2h',
            costPoints: 600,
            grantsDays: 0,
            availability: 'AVAILABLE',
            isRedeemSupported: true,
            kind: 'AD_PERK',
            perk: { type: 'TEMPORARY_AD_PASS', uses: null, durationMinutes: 120 },
          },
        ],
        activePerks: { perks: [], skipNextInterstitial: false, adFreeUntil: null },
      },
      t
    );

    expect(snapshot.redemptions[0].perk).toEqual({
      type: 'TEMPORARY_AD_PASS',
      uses: null,
      durationMinutes: 120,
    });
  });

  it('maps the perks the account already HOLDS, so they render beside what sells them', () => {
    const snapshot = mapRewardsSnapshot(
      {
        wallet: WALLET_DTO,
        dailyCheckIn: CHECK_IN_DTO,
        watchTime: null,
        tasks: [],
        redemptions: [],
        activePerks: {
          perks: [
            {
              id: 'perk-1',
              perkType: 'SKIP_NEXT_INTERSTITIAL',
              expiresAt: '2026-08-27T09:00:00.000Z',
              remainingUses: 1,
              grantedAt: '2026-08-26T09:00:00.000Z',
            },
          ],
          skipNextInterstitial: true,
          adFreeUntil: null,
        },
      },
      t
    );

    expect(snapshot.activePerks.perks).toHaveLength(1);
    // COPIED, not recomputed from the array - that rule is the server's.
    expect(snapshot.activePerks.skipNextInterstitial).toBe(true);
  });

  it('reports NO perks for a snapshot that predates the field, rather than crashing', () => {
    // The safe direction as well as the honest one: it suppresses no ad and
    // grants no skip.
    const snapshot = mapRewardsSnapshot(
      {
        wallet: WALLET_DTO,
        dailyCheckIn: CHECK_IN_DTO,
        watchTime: null,
        tasks: [],
        redemptions: [],
      } as never,
      t
    );

    expect(snapshot.activePerks).toEqual({
      perks: [],
      skipNextInterstitial: false,
      adFreeUntil: null,
    });
  });

  it('keeps an offer that grants no premium days, so coin utility can still ship', () => {
    expect(snapshotWith([perkOffer]).redemptions.map((offer) => offer.id)).toEqual([
      'redeem_skip_next_ad',
    ]);
  });

  it('filters the premium offer out of a mixed catalog without touching the rest', () => {
    expect(snapshotWith([vipOffer, perkOffer]).redemptions.map((offer) => offer.id)).toEqual([
      'redeem_skip_next_ad',
    ]);
  });

  it('serves the premium offers again once the premium experience is on', () => {
    // PRESERVED V1.1/V2 BEHAVIOUR: the offers, their copy and their mapping
    // are intact - only the V1 filter stands between them and the panel.
    process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED = 'true';

    expect(snapshotWith([vipOffer, perkOffer]).redemptions.map((offer) => offer.id)).toEqual([
      'redeem_vip_1d',
      'redeem_skip_next_ad',
    ]);
  });
});
