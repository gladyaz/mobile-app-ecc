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

export type RewardTaskTypeDto =
  | 'DAILY_CHECK_IN'
  | 'SOCIAL_FOLLOW'
  | 'REWARDED_AD'
  | 'WATCH_TIME'
  | 'CAMPAIGN';

export type RewardTaskStatusDto =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'CLAIMABLE'
  | 'COMPLETED';

export type SocialPlatformDto = 'FACEBOOK' | 'YOUTUBE' | 'TIKTOK' | 'INSTAGRAM';

export interface RewardTaskDto {
  id: string;
  type: RewardTaskTypeDto;
  rewardPoints: number;
  status: RewardTaskStatusDto;
  socialPlatform?: SocialPlatformDto;
  /**
   * `false` for every task the backend currently serves, and it refuses to
   * pay any of them. The flag is SERVER-OWNED precisely so the day a
   * verifiable signal exists, flipping it server-side makes every already
   * installed client offer the claim with no mobile release.
   */
  isClaimSupported: boolean;
  unsupportedReason?: 'NO_VERIFIABLE_SIGNAL' | 'AWAITING_PRODUCT_DECISION';
}

export type RewardRedemptionAvailabilityDto =
  | 'AVAILABLE'
  | 'INSUFFICIENT_POINTS'
  | 'COMING_SOON';

export interface RewardRedemptionOfferDto {
  id: string;
  costPoints: number;
  grantsDays: number;
  /** Computed server-side against the server's balance, not the client's. */
  availability: RewardRedemptionAvailabilityDto;
  isRedeemSupported: boolean;
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
  /** 401 - missing, malformed or expired credential. */
  INVALID_ACCESS_TOKEN: 'INVALID_ACCESS_TOKEN',
} as const;

export type RewardErrorCode = (typeof REWARD_ERROR_CODES)[keyof typeof REWARD_ERROR_CODES];
