/**
 * The `/rewards/*` WIRE CONTRACT, mirrored from the backend.
 *
 * Canonical source: `short-drama-backend/docs/rewards-api-contract.md` and
 * `src/rewards/rewards.types.ts` in that repository. These declarations are
 * a mirror, not a design: nothing here may be widened, defaulted, or
 * "improved" to make the client's life easier, because every divergence
 * turns a contract mismatch into a silent rendering bug.
 *
 * WHY THIS IS A SEPARATE FILE FROM `@/types/rewards`. The view model and the
 * wire format differ in two deliberate ways, both in the same direction -
 * the server sends DATA, the client owns PRESENTATION:
 *
 *  1. NO COPY. The server sends no `title`, `description`, `ctaLabel` or
 *     `resetsAtLabel`. This app ships three languages and localises through
 *     `t()`; a backend that sent "Check in" would either force English on
 *     every locale or drag a translation catalog into that service.
 *  2. NO FORMATTING. `updatedAt` / `resetsAt` / `createdAt` are ISO-8601
 *     instants. The client formats them.
 *
 * `rewards-mapper.ts` is the single place that crosses the two, so a
 * component can never accidentally render a raw wire value.
 */

export interface RewardWalletDto {
  balancePoints: number;
  lifetimeEarnedPoints: number;
  /** Always `true` from the real backend. */
  isServerAuthoritative: boolean;
  /** ISO-8601 UTC, or `null` for a wallet that has never moved. */
  updatedAt: string | null;
  /**
   * Optimistic-concurrency counter, incremented on every movement. The
   * client holds the highest version it has seen and ignores any response
   * carrying an older one, so a slow snapshot landing after a fast check-in
   * cannot roll the displayed balance backwards.
   */
  version: number;
}

export type DailyCheckInDayStateDto = 'CLAIMED' | 'TODAY' | 'UPCOMING';

export interface DailyCheckInDayDto {
  day: number;
  rewardPoints: number;
  state: DailyCheckInDayStateDto;
  isBonus: boolean;
}

export interface DailyCheckInDto {
  currentStreakDays: number;
  longestStreakDays: number;
  totalCheckInDays: number;
  /** Points the NEXT successful check-in pays, per the server's cycle curve. */
  todayRewardPoints: number;
  isTodayClaimed: boolean;
  days: DailyCheckInDayDto[];
  isClaimSupported: boolean;
  /** The SERVER's current reward date (`YYYY-MM-DD`). Never the device's. */
  periodKey: string;
  /** IANA zone that defines the reward day, e.g. `Asia/Jakarta`. */
  timezone: string;
  /** ISO-8601 UTC instant at which the streak day rolls over. */
  resetsAt: string;
}

/**
 * `WATCH_EPISODES` is a NEW member rather than a reuse of `WATCH_TIME`, and
 * the distinction is the whole point: the V1 watch mission counts DISTINCT
 * EPISODES the server authorised playback for within one reward day. It does
 * not measure time, and the backend cannot measure time. Serving an episode
 * count under a member named `WATCH_TIME` would hand every downstream reader
 * a unit that is wrong.
 *
 * A MEMBER THIS BUILD DOES NOT KNOW IS NOT A CRASH. The backend adds task
 * types server-side and expects already-installed clients to skip what they
 * cannot render - so `rewards-mapper.ts` narrows against this union at the
 * seam and DROPS an unrecognised tile rather than trusting the cast. That is
 * why this stays a closed union here (it documents what this build renders)
 * while the mapper treats the wire value as `string`.
 */
export type RewardTaskTypeDto =
  | 'DAILY_CHECK_IN'
  | 'SOCIAL_FOLLOW'
  | 'REWARDED_AD'
  | 'WATCH_TIME'
  | 'WATCH_EPISODES'
  | 'CAMPAIGN';

export type RewardTaskStatusDto =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'CLAIMABLE'
  | 'COMPLETED';

export type SocialPlatformDto = 'FACEBOOK' | 'YOUTUBE' | 'TIKTOK' | 'INSTAGRAM';

/**
 * HOW STRONG THE EVIDENCE BEHIND A CLAIMABLE TASK ACTUALLY IS.
 *
 * There is deliberately NO `PLATFORM_VERIFIED` member. Nothing in V1 can
 * produce one, and a union member nothing produces is an invitation to
 * produce it dishonestly.
 *
 * - `USER_CONFIRMED` - the account holder said they did it. The server handed
 *   out a destination URL and saw them come back; it did NOT observe the
 *   external action. Every social mission is this.
 * - `SERVER_OBSERVED` - the backend itself performed or authorised the thing
 *   being rewarded. Check-in and the watch missions are this.
 *
 * THE UI MUST NOT PRESENT `USER_CONFIRMED` AS VERIFICATION. Instagram, TikTok
 * and YouTube expose no API that answers "did user X follow page Y", so no
 * layer of this app may render the words "verified follow" - the honest claim
 * is that the viewer confirmed an external action they were sent to perform.
 */
export type RewardTaskVerificationDto = 'USER_CONFIRMED' | 'SERVER_OBSERVED';

/** Progress toward a counted mission. SERVER-COMPUTED; never client-supplied. */
export interface RewardTaskProgressDto {
  current: number;
  required: number;
}

export interface RewardTaskDto {
  id: string;
  type: RewardTaskTypeDto;
  rewardPoints: number;
  status: RewardTaskStatusDto;
  socialPlatform?: SocialPlatformDto;
  /**
   * SERVER-OWNED. `true` for the social and watch missions the backend can
   * actually pay; `false` for the task types that still have no
   * server-verifiable completion signal (`REWARDED_AD` needs an ad-network
   * server callback that does not exist; `CAMPAIGN` has no defined completion
   * signal). The flag is server-owned precisely so the day a signal exists,
   * flipping it makes every already-installed client offer the claim with no
   * mobile release.
   */
  isClaimSupported: boolean;
  unsupportedReason?: 'NO_VERIFIABLE_SIGNAL' | 'AWAITING_PRODUCT_DECISION';
  /** Present exactly when `isClaimSupported` is true. See the union's doc. */
  verification?: RewardTaskVerificationDto;
  /**
   * Where a social mission sends the viewer. SERVER-OWNED: it comes from
   * deployment configuration and is validated at boot to be an https URL on
   * that platform's own domain. Absent for every non-social task.
   *
   * The snapshot's copy is for DISPLAY (deriving the handle). The URL the app
   * actually opens is the one `POST /rewards/missions/:id/open` returns, so
   * the open is always the one the server recorded.
   */
  destinationUrl?: string;
  /**
   * The account handle to show beside the tile (`"@redpanda"`), derived
   * server-side from `destinationUrl`. `undefined` when the URL shape carries
   * no handle - fall back to the platform name rather than inventing one.
   */
  accountHandle?: string;
  /** Present on counted missions (the watch milestones). */
  progress?: RewardTaskProgressDto;
  /** ISO-8601 UTC of the claim, or `null` if this task has not been claimed. */
  claimedAt?: string | null;
  /**
   * ISO-8601 UTC at which a DAILY-RESETTING mission becomes claimable again.
   * Absent for one-time missions, whose completion is permanent.
   */
  resetsAt?: string;
}

export type RewardRedemptionAvailabilityDto =
  | 'AVAILABLE'
  | 'INSUFFICIENT_POINTS'
  | 'COMING_SOON';

export type RewardOfferKindDto = 'PREMIUM_DAYS' | 'AD_PERK';

export type RewardPerkTypeDto = 'SKIP_NEXT_INTERSTITIAL' | 'TEMPORARY_AD_PASS';

/** What an `AD_PERK` offer will issue, so the client can describe the purchase. */
export interface RewardOfferPerkDto {
  type: RewardPerkTypeDto;
  /** `1` for a single-use skip; `null` for a duration pass. */
  uses: number | null;
  durationMinutes: number;
}

export interface RewardRedemptionOfferDto {
  id: string;
  costPoints: number;
  grantsDays: number;
  /** Computed server-side against the server's balance, not the client's. */
  availability: RewardRedemptionAvailabilityDto;
  isRedeemSupported: boolean;
  /** What this offer hands over. */
  kind: RewardOfferKindDto;
  /** Present exactly when `kind === 'AD_PERK'`. */
  perk?: RewardOfferPerkDto;
  /**
   * Why an offer is `COMING_SOON`, machine-readable so the client words the
   * tile correctly instead of guessing.
   *
   * `NOT_APPLICABLE_IN_FREE_MODE` is the honest answer for a VIP offer under
   * `CONTENT_ACCESS_MODE=free`: every episode is already free, so the offer
   * would charge points and change nothing. V1 filters those out entirely
   * (`rewards-mapper.ts`), so this reason is read rather than rendered.
   */
  unavailableReason?: 'NOT_YET_LAUNCHED' | 'NOT_APPLICABLE_IN_FREE_MODE';
}

/**
 * ---------------------------------------------------------------------------
 * PERKS - what a spent coin actually bought.
 * ---------------------------------------------------------------------------
 */

export interface RewardPerkDto {
  id: string;
  perkType: RewardPerkTypeDto;
  /** ISO-8601 UTC. Always set - every perk has a shelf life. */
  expiresAt: string;
  /** `1` for an unspent single-use perk; `null` for a duration pass. */
  remainingUses: number | null;
  /** ISO-8601 UTC of the redemption that issued it. */
  grantedAt: string;
}

/**
 * `GET /rewards/perks`, and the `activePerks` block of the snapshot.
 *
 * READ THE TWO DERIVED VALUES, NOT THE ARRAY. A client that inspected
 * `perks[]` and reimplemented "is a `SKIP_NEXT_INTERSTITIAL` active and
 * unexpired?" would be reimplementing a rule the server owns - and the two
 * would drift, on a code path where drift means showing an ad to someone who
 * spent coins not to see one. The array is for DISPLAY ("you hold 1 ad
 * skip"); `skipNextInterstitial` / `adFreeUntil` are what the ad gate reads.
 */
export interface ActivePerksDto {
  perks: RewardPerkDto[];
  /**
   * `true` when the caller holds an unexpired, unconsumed
   * `SKIP_NEXT_INTERSTITIAL`. The client suppresses the next interstitial it
   * WOULD have shown AND calls `POST /rewards/perks/:id/consume` when it
   * actually does, so the spend is recorded server-side.
   */
  skipNextInterstitial: boolean;
  /**
   * ISO-8601 UTC until which NO interstitial should be shown at all, from the
   * furthest-out active `TEMPORARY_AD_PASS`, or `null` if none is active.
   * Nothing is consumed for this one - it is spent by the clock.
   */
  adFreeUntil: string | null;
}

export interface RewardsSnapshotDto {
  wallet: RewardWalletDto;
  dailyCheckIn: DailyCheckInDto;
  /**
   * Always `null` today, and that is an answer rather than an omission - the
   * backend has no trustworthy watch-time signal to report. Typed `null` so
   * a client cannot start rendering a number that does not exist.
   */
  watchTime: null;
  tasks: RewardTaskDto[];
  redemptions: RewardRedemptionOfferDto[];
  /**
   * The perks this account currently holds, in the SAME read as everything
   * else. The Rewards Center has to render "you have 1 ad skip" beside the
   * offer that sells one, and a second request to do it could interleave with
   * a redemption and show a balance that has paid for a perk the tile below
   * does not yet know about. `GET /rewards/perks` exists for the AD GATE,
   * which asks far more often and needs none of the rest of this payload.
   */
  activePerks: ActivePerksDto;
}

export interface CheckInResponseDto {
  /** Points THIS call awarded. `0` on an idempotent replay. */
  awardedPoints: number;
  /**
   * `true` when the request replayed a check-in that had already happened
   * today. The HTTP status is 200 either way - a repeated check-in is a
   * successful no-op, not a client error.
   */
  alreadyCheckedIn: boolean;
  ledgerEntryId: string | null;
  wallet: RewardWalletDto;
  dailyCheckIn: DailyCheckInDto;
}

export interface RewardLedgerEntryDto {
  id: string;
  /** Signed: positive credits, negative debits. */
  deltaPoints: number;
  reason: string;
  sourceType: string;
  sourceId: string | null;
  balanceAfter: number;
  createdAt: string;
  metadata: unknown;
}

export interface RewardLedgerPageDto {
  entries: RewardLedgerEntryDto[];
  /** OPAQUE. Pass back verbatim; `null` at the end of the history. */
  nextCursor: string | null;
}

export type RewardRedemptionStatusDto = 'PENDING' | 'FULFILLED' | 'FAILED' | 'REVERSED';

export interface RedeemResponseDto {
  redemptionId: string;
  offerId: string;
  costPoints: number;
  grantsDays: number;
  status: RewardRedemptionStatusDto;
  /**
   * `true` when this request replayed an earlier redemption made with the
   * same idempotency key: nothing was debited and no second entitlement was
   * granted, and the original receipt is returned.
   */
  replayed: boolean;
  wallet: RewardWalletDto;
  entitlementExpiresAt: string | null;
  /**
   * The ad perk this redemption issued, or `null` for a `PREMIUM_DAYS` offer.
   * EXACTLY ONE of `entitlementExpiresAt` / `perk` is non-null on a fulfilled
   * receipt.
   */
  perk: RewardPerkDto | null;
}

/**
 * ---------------------------------------------------------------------------
 * MISSIONS - the truthful two-step social flow, and the watch milestones.
 * ---------------------------------------------------------------------------
 */

/** Response of `POST /rewards/missions/:missionId/open`. */
export interface MissionOpenResponseDto {
  missionId: string;
  /** The URL to open externally. SERVER-OWNED - see `openSocialMission`. */
  destinationUrl: string;
  /** ISO-8601 UTC instant the server recorded the open. */
  openedAt: string;
  /**
   * ISO-8601 UTC instant from which `POST .../claim` will be accepted.
   *
   * Sent so the client can disable its confirm control for the interval
   * rather than letting a viewer tap it and receive an error. It is NOT a
   * security boundary - the server re-checks it, and a script can simply
   * wait - so the client must still handle `REWARD_MISSION_TOO_SOON`.
   */
  claimableAfter: string;
  /** The task tile, refreshed. Saves the client a snapshot round trip. */
  task: RewardTaskDto;
}

/** Response of `POST /rewards/missions/:missionId/claim`. */
export interface MissionClaimResponseDto {
  missionId: string;
  /** Points THIS call awarded. `0` on an idempotent replay. */
  awardedPoints: number;
  /**
   * `true` when the mission had already been claimed (for a daily mission,
   * already claimed TODAY) and nothing moved. 200 either way, for the same
   * reason check-in answers 200 on a repeat.
   */
  alreadyClaimed: boolean;
  ledgerEntryId: string | null;
  wallet: RewardWalletDto;
  task: RewardTaskDto;
}

/** Response of `POST /rewards/perks/:perkId/consume`. */
export interface PerkConsumeResponseDto {
  perkId: string;
  /** `true` when THIS call spent the perk. */
  consumed: boolean;
  /**
   * `true` when the perk had already been spent, so this call changed
   * nothing. 200, not 409: a retried consume after a dropped response is the
   * NORMAL case, and the client's correct reaction - "the perk is gone, show
   * ads again" - is the same either way.
   */
  alreadyConsumed: boolean;
  perks: ActivePerksDto;
}

/**
 * Error codes `/rewards/*` can return, from the contract's §9. Listed as a
 * const object rather than inlined at call sites so a typo becomes a
 * compile error instead of an error branch that silently never matches.
 */
export const REWARD_ERROR_CODES = {
  /** 503 - `REWARDS_ENABLED` is off in this deployment. */
  REWARDS_DISABLED: 'REWARDS_DISABLED',
  /** 409 - the debit would take the balance below zero. */
  INSUFFICIENT_REWARD_POINTS: 'INSUFFICIENT_REWARD_POINTS',
  /** 404 - no such offer in the server catalog. */
  REWARD_OFFER_NOT_FOUND: 'REWARD_OFFER_NOT_FOUND',
  /** 409 - the offer exists but is not purchasable. */
  REWARD_OFFER_UNAVAILABLE: 'REWARD_OFFER_UNAVAILABLE',
  /** 409 - key already used for a DIFFERENT offer. */
  REWARD_IDEMPOTENCY_KEY_REUSED: 'REWARD_IDEMPOTENCY_KEY_REUSED',
  /** 404 - mission id is not in the server catalog at all. */
  REWARD_MISSION_NOT_FOUND: 'REWARD_MISSION_NOT_FOUND',
  /** 409 - a real mission, but not configured in this deployment. */
  REWARD_MISSION_UNAVAILABLE: 'REWARD_MISSION_UNAVAILABLE',
  /** 409 - a watch milestone has nothing to open. */
  REWARD_MISSION_NOT_OPENABLE: 'REWARD_MISSION_NOT_OPENABLE',
  /** 409 - a social claim with no recorded `open`. */
  REWARD_MISSION_NOT_STARTED: 'REWARD_MISSION_NOT_STARTED',
  /** 409 - claimed inside the dwell window after opening. */
  REWARD_MISSION_TOO_SOON: 'REWARD_MISSION_TOO_SOON',
  /** 409 - the watch milestone has not been reached today. */
  REWARD_MISSION_NOT_COMPLETE: 'REWARD_MISSION_NOT_COMPLETE',
  /** 404 - no such perk, or it belongs to another account. */
  REWARD_PERK_NOT_FOUND: 'REWARD_PERK_NOT_FOUND',
  /** 409 - a time-based pass is spent by the clock, not by a call. */
  REWARD_PERK_NOT_CONSUMABLE: 'REWARD_PERK_NOT_CONSUMABLE',
  /** 409 - the perk's shelf life ran out before it was used. */
  REWARD_PERK_EXPIRED: 'REWARD_PERK_EXPIRED',
  /** 401 - missing, malformed or expired credential. */
  INVALID_ACCESS_TOKEN: 'INVALID_ACCESS_TOKEN',
} as const;

export type RewardErrorCode = (typeof REWARD_ERROR_CODES)[keyof typeof REWARD_ERROR_CODES];
