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

  it('copies the reward figure and status through', () => {
    const task = mapTask(socialDto, t);

    expect(task.rewardPoints).toBe(50);
    expect(task.status).toBe('AVAILABLE');
    expect(task.socialPlatform).toBe('FACEBOOK');
  });

  it('never flips an unsupported task to claimable', () => {
    expect(mapTask(socialDto, t).isClaimSupported).toBe(false);
    expect(mapTask({ ...socialDto, isClaimSupported: true }, t).isClaimSupported).toBe(true);
  });

  it('carries the machine-readable unsupported reason', () => {
    expect(mapTask(socialDto, t).unsupportedReason).toBe('NO_VERIFIABLE_SIGNAL');
  });

  it('gives an unsupported task NO action word', () => {
    // "Follow" beside a +50 pill invites the user to earn points the backend
    // has no verifiable signal for and will refuse to pay.
    expect(mapTask(socialDto, t).ctaLabel).toBe('rewards.ctaUnavailable');
    expect(
      mapTask({ ...socialDto, unsupportedReason: 'AWAITING_PRODUCT_DECISION' }, t).ctaLabel
    ).toBe('rewards.ctaSoon');
  });

  it('gives the action word back the moment the server supports the claim', () => {
    expect(mapTask({ ...socialDto, isClaimSupported: true }, t).ctaLabel).toBe(
      'rewards.ctaFollow'
    );
    expect(
      mapTask({ ...socialDto, socialPlatform: 'YOUTUBE', isClaimSupported: true }, t).ctaLabel
    ).toBe('rewards.ctaSubscribe');
  });

  it('reports no task progress, because the server sends none', () => {
    // A client-counted "2 of 5 ads watched" would be a local number dressed
    // as server progress toward a reward the server will not pay.
    expect(mapTask(socialDto, t).progress).toBeNull();
    expect(
      mapTask({ ...socialDto, type: 'REWARDED_AD', socialPlatform: undefined }, t).progress
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
          },
        ],
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
      { wallet: WALLET_DTO, dailyCheckIn: CHECK_IN_DTO, watchTime: null, tasks: [], redemptions: [] },
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
  } as const;

  /** The forward shape: a perk that grants no premium days. */
  const perkOffer = {
    id: 'redeem_skip_next_ad',
    costPoints: 200,
    grantsDays: 0,
    availability: 'AVAILABLE',
    isRedeemSupported: true,
  } as const;

  function snapshotWith(redemptions: readonly (typeof vipOffer | typeof perkOffer)[]) {
    return mapRewardsSnapshot(
      {
        wallet: WALLET_DTO,
        dailyCheckIn: CHECK_IN_DTO,
        watchTime: null,
        tasks: [],
        redemptions: [...redemptions],
      },
      t
    );
  }

  it('drops every premium-granting offer, so V1 advertises no paid unlock', () => {
    expect(snapshotWith([vipOffer]).redemptions).toEqual([]);
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
