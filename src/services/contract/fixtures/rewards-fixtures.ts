/**
 * CANONICAL `/rewards/*` WIRE PAYLOADS.
 *
 * Copied field for field from the backend commit named in `provenance.ts`,
 * including the real catalog numbers (`REWARD_REDEMPTION_OFFERS`,
 * `WATCH_MISSION_DEFINITIONS`, `CHECK_IN_REWARD_CURVE`,
 * `SOCIAL_MISSION_DEFINITIONS`) rather than invented ones, so a fixture that
 * stops matching the server is a real signal instead of a stale guess.
 *
 * `satisfies` WITHOUT `as const`: the wire mirror declares mutable arrays
 * (`tasks: RewardTaskDto[]`), and a readonly tuple is not assignable to one.
 * `satisfies` alone still supplies the contextual type that narrows every
 * string literal to its union member, which is the check that matters.
 */
import type {
  ActivePerksDto,
  CheckInResponseDto,
  MissionClaimResponseDto,
  MissionOpenResponseDto,
  PerkConsumeResponseDto,
  RedeemResponseDto,
  RewardLedgerPageDto,
  RewardWalletDto,
  RewardsSnapshotDto,
} from '@/services/rewards/rewards-dto';

/**
 * The reward day this whole fixture set is pinned to. A reward day is the
 * SERVER's calendar day in `REWARDS_TIMEZONE` (default `Asia/Jakarta`,
 * UTC+7), so its rollover instant is 17:00 UTC on the previous date - never
 * the device's midnight, which is the whole reason `resetsAt` and `timezone`
 * are on the wire at all.
 */
export const FIXTURE_PERIOD_KEY = '2026-08-27';
export const FIXTURE_TIMEZONE = 'Asia/Jakarta';
export const FIXTURE_RESETS_AT = '2026-08-27T17:00:00.000Z';

const WALLET = {
  balancePoints: 240,
  lifetimeEarnedPoints: 640,
  isServerAuthoritative: true,
  updatedAt: '2026-08-27T03:12:44.000Z',
  version: 12,
} satisfies RewardWalletDto;

/**
 * A full Rewards Center read.
 *
 * TASK ORDER IS THE SERVER'S: claimable missions first, then the tiles that
 * still have no verifiable signal. A client that renders the array in order
 * shows a viewer what they can actually do before what they cannot.
 *
 * FACEBOOK IS ABSENT ON PURPOSE - it is `requiredForV1: false` in the
 * backend catalog and a mission with no configured URL is omitted entirely
 * rather than served as a dead tile. This fixture therefore models the
 * ordinary V1 deployment, not a degraded one.
 */
export const REWARDS_SNAPSHOT = {
  wallet: WALLET,
  dailyCheckIn: {
    currentStreakDays: 3,
    longestStreakDays: 9,
    totalCheckInDays: 21,
    todayRewardPoints: 25,
    isTodayClaimed: false,
    days: [
      { day: 1, rewardPoints: 10, state: 'CLAIMED', isBonus: false },
      { day: 2, rewardPoints: 15, state: 'CLAIMED', isBonus: false },
      { day: 3, rewardPoints: 20, state: 'CLAIMED', isBonus: false },
      { day: 4, rewardPoints: 25, state: 'TODAY', isBonus: false },
      { day: 5, rewardPoints: 30, state: 'UPCOMING', isBonus: false },
      { day: 6, rewardPoints: 40, state: 'UPCOMING', isBonus: false },
      { day: 7, rewardPoints: 100, state: 'UPCOMING', isBonus: true },
    ],
    isClaimSupported: true,
    periodKey: FIXTURE_PERIOD_KEY,
    timezone: FIXTURE_TIMEZONE,
    resetsAt: FIXTURE_RESETS_AT,
  },
  watchTime: null,
  tasks: [
    {
      id: 'task_social_instagram',
      type: 'SOCIAL_FOLLOW',
      rewardPoints: 50,
      status: 'AVAILABLE',
      socialPlatform: 'INSTAGRAM',
      isClaimSupported: true,
      verification: 'USER_CONFIRMED',
      destinationUrl: 'https://www.instagram.com/redpanda',
      accountHandle: '@redpanda',
      claimedAt: null,
    },
    {
      id: 'task_social_tiktok',
      type: 'SOCIAL_FOLLOW',
      rewardPoints: 50,
      // The server recorded an `open` and is waiting to be told the viewer
      // came back. `CLAIMABLE` is what that middle state looks like on the
      // wire; the client's own `socialStage` is device state and is not here.
      status: 'CLAIMABLE',
      socialPlatform: 'TIKTOK',
      isClaimSupported: true,
      verification: 'USER_CONFIRMED',
      destinationUrl: 'https://www.tiktok.com/@redpanda',
      accountHandle: '@redpanda',
      claimedAt: null,
    },
    {
      id: 'task_social_youtube',
      type: 'SOCIAL_FOLLOW',
      rewardPoints: 50,
      status: 'COMPLETED',
      socialPlatform: 'YOUTUBE',
      // A CLAIMED social mission: `isClaimSupported` flips to false because
      // there is nothing left to pay, and `verification` is STILL sent -
      // `toSocialTask` emits it unconditionally so no client can render a
      // paid social claim as anything stronger than user-confirmed.
      isClaimSupported: false,
      verification: 'USER_CONFIRMED',
      destinationUrl: 'https://www.youtube.com/@redpanda',
      accountHandle: '@redpanda',
      claimedAt: '2026-08-20T08:41:00.000Z',
    },
    {
      id: 'task_watch_3_episodes',
      type: 'WATCH_EPISODES',
      rewardPoints: 30,
      status: 'IN_PROGRESS',
      isClaimSupported: true,
      verification: 'SERVER_OBSERVED',
      progress: { current: 2, required: 3 },
      claimedAt: null,
      resetsAt: FIXTURE_RESETS_AT,
    },
    {
      id: 'task_watch_5_episodes',
      type: 'WATCH_EPISODES',
      rewardPoints: 50,
      status: 'AVAILABLE',
      isClaimSupported: true,
      verification: 'SERVER_OBSERVED',
      progress: { current: 0, required: 5 },
      claimedAt: null,
      resetsAt: FIXTURE_RESETS_AT,
    },
    {
      id: 'task_rewarded_ad',
      type: 'REWARDED_AD',
      rewardPoints: 20,
      status: 'AVAILABLE',
      isClaimSupported: false,
      unsupportedReason: 'NO_VERIFIABLE_SIGNAL',
    },
    {
      id: 'task_campaign_placeholder',
      type: 'CAMPAIGN',
      rewardPoints: 150,
      status: 'LOCKED',
      isClaimSupported: false,
      unsupportedReason: 'AWAITING_PRODUCT_DECISION',
    },
  ],
  redemptions: [
    {
      id: 'redeem_skip_next_ad',
      costPoints: 150,
      grantsDays: 0,
      availability: 'AVAILABLE',
      isRedeemSupported: true,
      kind: 'AD_PERK',
      perk: { type: 'SKIP_NEXT_INTERSTITIAL', uses: 1, durationMinutes: 1440 },
    },
    {
      id: 'redeem_ad_pass_2h',
      costPoints: 600,
      grantsDays: 0,
      // Server-computed against the SERVER's balance (240 < 600), never
      // re-derived on the device.
      availability: 'INSUFFICIENT_POINTS',
      isRedeemSupported: true,
      kind: 'AD_PERK',
      perk: { type: 'TEMPORARY_AD_PASS', uses: null, durationMinutes: 120 },
    },
    {
      id: 'redeem_vip_1d',
      costPoints: 1000,
      grantsDays: 1,
      availability: 'COMING_SOON',
      isRedeemSupported: false,
      kind: 'PREMIUM_DAYS',
      unavailableReason: 'NOT_APPLICABLE_IN_FREE_MODE',
    },
    {
      id: 'redeem_vip_3d',
      costPoints: 2500,
      grantsDays: 3,
      availability: 'COMING_SOON',
      isRedeemSupported: false,
      kind: 'PREMIUM_DAYS',
      unavailableReason: 'NOT_APPLICABLE_IN_FREE_MODE',
    },
    {
      id: 'redeem_vip_7d',
      costPoints: 5000,
      grantsDays: 7,
      availability: 'COMING_SOON',
      isRedeemSupported: false,
      kind: 'PREMIUM_DAYS',
      unavailableReason: 'NOT_APPLICABLE_IN_FREE_MODE',
    },
  ],
  activePerks: {
    perks: [
      {
        id: 'perk_fixture_skip',
        perkType: 'SKIP_NEXT_INTERSTITIAL',
        expiresAt: '2026-08-28T03:00:00.000Z',
        remainingUses: 1,
        grantedAt: '2026-08-27T03:00:00.000Z',
      },
    ],
    skipNextInterstitial: true,
    adFreeUntil: null,
  },
} satisfies RewardsSnapshotDto;

/**
 * The same read from a LATER backend that has grown vocabulary this build
 * has never heard of: a new task type, a new social platform, a new perk
 * type, a new offer id, and extra fields on shapes that already existed.
 *
 * Typed `unknown` because every one of those values sits outside a closed
 * union on purpose - that IS the drift being modelled. None of it may crash
 * the Rewards Center, and the parts this build DOES understand must survive
 * intact beside it.
 */
export const REWARDS_SNAPSHOT_WITH_FUTURE_VALUES: unknown = {
  wallet: { ...WALLET, tierName: 'GOLD' },
  dailyCheckIn: REWARDS_SNAPSHOT.dailyCheckIn,
  watchTime: null,
  tasks: [
    REWARDS_SNAPSHOT.tasks[0],
    {
      id: 'task_referral_invite',
      type: 'REFERRAL_INVITE',
      rewardPoints: 200,
      status: 'AVAILABLE',
      isClaimSupported: true,
      verification: 'SERVER_OBSERVED',
    },
    {
      id: 'task_social_threads',
      type: 'SOCIAL_FOLLOW',
      rewardPoints: 50,
      status: 'AVAILABLE',
      socialPlatform: 'THREADS',
      isClaimSupported: true,
      verification: 'USER_CONFIRMED',
      destinationUrl: 'https://www.threads.net/@redpanda',
      claimedAt: null,
    },
    REWARDS_SNAPSHOT.tasks[3],
  ],
  redemptions: [
    REWARDS_SNAPSHOT.redemptions[0],
    {
      id: 'redeem_mystery_box',
      costPoints: 300,
      grantsDays: 0,
      availability: 'AVAILABLE',
      isRedeemSupported: true,
      kind: 'AD_PERK',
      perk: { type: 'DOUBLE_POINTS_HOUR', uses: null, durationMinutes: 60 },
    },
  ],
  activePerks: {
    perks: [
      REWARDS_SNAPSHOT.activePerks.perks[0],
      {
        id: 'perk_fixture_future',
        perkType: 'DOUBLE_POINTS_HOUR',
        expiresAt: '2026-08-28T03:00:00.000Z',
        remainingUses: null,
        grantedAt: '2026-08-27T03:00:00.000Z',
      },
    ],
    skipNextInterstitial: true,
    adFreeUntil: null,
  },
};

/** `POST /rewards/check-in` - a real claim. */
export const CHECK_IN_RESPONSE = {
  awardedPoints: 25,
  alreadyCheckedIn: false,
  ledgerEntryId: 'ldg_fixture_checkin',
  wallet: { ...WALLET, balancePoints: 265, lifetimeEarnedPoints: 665, version: 13 },
  dailyCheckIn: {
    ...REWARDS_SNAPSHOT.dailyCheckIn,
    currentStreakDays: 4,
    isTodayClaimed: true,
    days: [
      { day: 1, rewardPoints: 10, state: 'CLAIMED', isBonus: false },
      { day: 2, rewardPoints: 15, state: 'CLAIMED', isBonus: false },
      { day: 3, rewardPoints: 20, state: 'CLAIMED', isBonus: false },
      { day: 4, rewardPoints: 25, state: 'CLAIMED', isBonus: false },
      { day: 5, rewardPoints: 30, state: 'UPCOMING', isBonus: false },
      { day: 6, rewardPoints: 40, state: 'UPCOMING', isBonus: false },
      { day: 7, rewardPoints: 100, state: 'UPCOMING', isBonus: true },
    ],
  },
} satisfies CheckInResponseDto;

/**
 * A REPLAY - a double-tap, a retry after a dropped response, or a looping
 * client. 200, not 409: nothing moved, and `awardedPoints: 0` beside an
 * unchanged wallet is what makes that visible.
 */
export const CHECK_IN_REPLAY = {
  awardedPoints: 0,
  alreadyCheckedIn: true,
  ledgerEntryId: 'ldg_fixture_checkin',
  wallet: CHECK_IN_RESPONSE.wallet,
  dailyCheckIn: CHECK_IN_RESPONSE.dailyCheckIn,
} satisfies CheckInResponseDto;

/** `POST /rewards/missions/:id/open`. The destination comes BACK; it is never sent. */
export const MISSION_OPEN_RESPONSE = {
  missionId: 'task_social_instagram',
  destinationUrl: 'https://www.instagram.com/redpanda',
  openedAt: '2026-08-27T04:00:00.000Z',
  // SOCIAL_MISSION_MIN_DWELL_SECONDS = 5. Not a security boundary - the
  // server re-checks it - but it is what lets the client disable its confirm
  // control instead of letting a viewer tap into an error.
  claimableAfter: '2026-08-27T04:00:05.000Z',
  task: {
    ...REWARDS_SNAPSHOT.tasks[0],
    status: 'CLAIMABLE',
  },
} satisfies MissionOpenResponseDto;

/** `POST /rewards/missions/:id/claim` - a real social claim. */
export const MISSION_CLAIM_RESPONSE = {
  missionId: 'task_social_instagram',
  awardedPoints: 50,
  alreadyClaimed: false,
  ledgerEntryId: 'ldg_fixture_social',
  wallet: { ...WALLET, balancePoints: 290, lifetimeEarnedPoints: 690, version: 13 },
  task: {
    ...REWARDS_SNAPSHOT.tasks[0],
    status: 'COMPLETED',
    isClaimSupported: false,
    claimedAt: '2026-08-27T04:00:30.000Z',
  },
} satisfies MissionClaimResponseDto;

/** The duplicate-claim state: already paid, nothing moved, still a 200. */
export const MISSION_CLAIM_REPLAY = {
  missionId: 'task_social_instagram',
  awardedPoints: 0,
  alreadyClaimed: true,
  ledgerEntryId: 'ldg_fixture_social',
  wallet: MISSION_CLAIM_RESPONSE.wallet,
  task: MISSION_CLAIM_RESPONSE.task,
} satisfies MissionClaimResponseDto;

/** A watch-milestone claim - the other half of the V1 earn loop. */
export const WATCH_MISSION_CLAIM_RESPONSE = {
  missionId: 'task_watch_3_episodes',
  awardedPoints: 30,
  alreadyClaimed: false,
  ledgerEntryId: 'ldg_fixture_watch',
  wallet: { ...WALLET, balancePoints: 270, lifetimeEarnedPoints: 670, version: 13 },
  task: {
    id: 'task_watch_3_episodes',
    type: 'WATCH_EPISODES',
    rewardPoints: 30,
    status: 'COMPLETED',
    isClaimSupported: false,
    verification: 'SERVER_OBSERVED',
    progress: { current: 3, required: 3 },
    claimedAt: '2026-08-27T05:00:00.000Z',
    resetsAt: FIXTURE_RESETS_AT,
  },
} satisfies MissionClaimResponseDto;

/* -------------------------------------------------------------------------
 * PERKS
 * ---------------------------------------------------------------------- */

/** One unspent single-use skip. `skipNextInterstitial` is the derived truth. */
export const ACTIVE_PERKS_SKIP = {
  perks: [
    {
      id: 'perk_fixture_skip',
      perkType: 'SKIP_NEXT_INTERSTITIAL',
      expiresAt: '2026-08-28T03:00:00.000Z',
      remainingUses: 1,
      grantedAt: '2026-08-27T03:00:00.000Z',
    },
  ],
  skipNextInterstitial: true,
  adFreeUntil: null,
} satisfies ActivePerksDto;

/**
 * A live two-hour pass. `remainingUses` is `null` - it is spent by the
 * CLOCK, not by a call - and `adFreeUntil` is the furthest-out expiry.
 */
export const ACTIVE_PERKS_AD_PASS = {
  perks: [
    {
      id: 'perk_fixture_pass',
      perkType: 'TEMPORARY_AD_PASS',
      expiresAt: '2026-08-27T06:00:00.000Z',
      remainingUses: null,
      grantedAt: '2026-08-27T04:00:00.000Z',
    },
  ],
  skipNextInterstitial: false,
  adFreeUntil: '2026-08-27T06:00:00.000Z',
} satisfies ActivePerksDto;

export const ACTIVE_PERKS_EMPTY = {
  perks: [],
  skipNextInterstitial: false,
  adFreeUntil: null,
} satisfies ActivePerksDto;

/** `POST /rewards/perks/:id/consume` - this call spent it. */
export const PERK_CONSUME_RESPONSE = {
  perkId: 'perk_fixture_skip',
  consumed: true,
  alreadyConsumed: false,
  perks: ACTIVE_PERKS_EMPTY,
} satisfies PerkConsumeResponseDto;

/**
 * A retried consume after a dropped response - the NORMAL case, and a 200
 * rather than a 409 precisely so the retry is safe instead of a double-spend.
 */
export const PERK_CONSUME_REPLAY = {
  perkId: 'perk_fixture_skip',
  consumed: false,
  alreadyConsumed: true,
  perks: ACTIVE_PERKS_EMPTY,
} satisfies PerkConsumeResponseDto;

/**
 * `POST /rewards/redemptions` for the ad-skip offer.
 *
 * EXACTLY ONE of `entitlementExpiresAt` / `perk` is non-null on a fulfilled
 * receipt. V1 only ever sees the `perk` half, because every `PREMIUM_DAYS`
 * offer is withheld under `CONTENT_ACCESS_MODE=free`.
 */
export const REDEEM_AD_PERK_RESPONSE = {
  redemptionId: 'rdm_fixture_skip',
  offerId: 'redeem_skip_next_ad',
  costPoints: 150,
  grantsDays: 0,
  status: 'FULFILLED',
  replayed: false,
  wallet: { ...WALLET, balancePoints: 90, version: 13 },
  entitlementExpiresAt: null,
  perk: {
    id: 'perk_fixture_skip',
    perkType: 'SKIP_NEXT_INTERSTITIAL',
    expiresAt: '2026-08-28T03:00:00.000Z',
    remainingUses: 1,
    grantedAt: '2026-08-27T03:00:00.000Z',
  },
} satisfies RedeemResponseDto;

/** An idempotent replay: nothing debited, no second perk, the original receipt. */
export const REDEEM_REPLAY_RESPONSE = {
  ...REDEEM_AD_PERK_RESPONSE,
  replayed: true,
} satisfies RedeemResponseDto;

/** `GET /rewards/ledger` - newest first, opaque cursor. */
export const LEDGER_PAGE = {
  entries: [
    {
      id: 'ldg_fixture_social',
      deltaPoints: 50,
      reason: 'EXTERNAL_SOCIAL_ACTION',
      sourceType: 'MISSION',
      sourceId: 'task_social_instagram',
      balanceAfter: 290,
      createdAt: '2026-08-27T04:00:30.000Z',
      metadata: null,
    },
    {
      id: 'ldg_fixture_skip',
      deltaPoints: -150,
      reason: 'AD_PERK_REDEMPTION',
      sourceType: 'REDEMPTION',
      sourceId: 'rdm_fixture_skip',
      balanceAfter: 240,
      createdAt: '2026-08-27T03:00:00.000Z',
      metadata: null,
    },
    {
      id: 'ldg_fixture_watch',
      deltaPoints: 30,
      reason: 'WATCH_MILESTONE',
      sourceType: 'MISSION',
      sourceId: 'task_watch_3_episodes',
      balanceAfter: 390,
      createdAt: '2026-08-26T14:20:00.000Z',
      metadata: null,
    },
    {
      // An unrecognised reason still renders with its real amount and
      // timestamp: dropping it would leave a viewer reconciling their own
      // history against a balance that no longer adds up.
      id: 'ldg_fixture_future_reason',
      deltaPoints: 5,
      reason: 'REFERRAL_BONUS',
      sourceType: 'REFERRAL',
      sourceId: null,
      balanceAfter: 360,
      createdAt: '2026-08-26T10:00:00.000Z',
      metadata: null,
    },
  ],
  nextCursor: 'fixture-opaque-cursor-do-not-parse',
} satisfies RewardLedgerPageDto;
