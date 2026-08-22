/**
 * Rewards Center domain contract (UI-facing view model only).
 *
 * SCOPE BOUNDARY - read before extending this file:
 *
 * These types describe what the Rewards Center *renders*. They are NOT the
 * wire format. The wire format is the backend's, documented in
 * `short-drama-backend/docs/rewards-api-contract.md`, mirrored on this side
 * in `src/services/rewards/rewards-dto.ts`, and translated into the types
 * below by `src/features/rewards/rewards-mapper.ts`.
 *
 * THE ONE INVARIANT, INHERITED FROM THE BACKEND CONTRACT:
 *
 *   A balance is a projection of a server-side ledger. The client renders
 *   what the server sends and never computes, increments, or predicts it.
 *
 * Nothing in this module issues, mutates, or persists a points balance. The
 * only writer is the backend; every number below arrives from a response.
 *
 * Two conventions carry trust through the type system rather than through
 * scattered UI copy:
 *
 * - `isClaimSupported` / `isRedeemSupported` - SERVER-OWNED. False whenever
 *   no server-verified path exists for that item, which is currently every
 *   task type except the daily check-in (the backend has no verifiable
 *   signal for social follows, rewarded ads or campaigns). The UI reads
 *   these flags; it never decides availability on its own, and it never
 *   re-enables one locally.
 * - `isServerAuthoritative` / `source` - whether the number shown came from
 *   a trusted backend. The real backend always sends `true`; the field
 *   exists so a client can tell real state from anything else.
 *
 * All economics (point values, costs, durations, thresholds) are supplied
 * as data on these types. No component may hardcode them - see
 * `__tests__/rewards-economics-boundary.test.ts`, which fails if a
 * presentational component reaches for the service or the mapper.
 */

// ---------------------------------------------------------------------------
// Wallet / balance
// ---------------------------------------------------------------------------

export type RewardWallet = {
  readonly balancePoints: number;
  readonly lifetimeEarnedPoints: number;
  /**
   * True only when `balancePoints` was read from a server-side ledger
   * projection. Anything else must report `false` so the UI can label it
   * honestly. There is no code path in this app that produces `true` from
   * anywhere but a `/rewards/*` response.
   */
  readonly isServerAuthoritative: boolean;
  /** Pre-formatted by the mapper; presentational components do no date work. */
  readonly updatedAtLabel: string | null;
};

// ---------------------------------------------------------------------------
// Daily check-in
// ---------------------------------------------------------------------------

export type DailyCheckInDayState = 'CLAIMED' | 'TODAY' | 'UPCOMING';

export type DailyCheckInDay = {
  readonly day: number;
  readonly rewardPoints: number;
  readonly state: DailyCheckInDayState;
  /** Renders the day chip with the streak-bonus accent (e.g. the day-7 chip). */
  readonly isBonus: boolean;
};

export type DailyCheckIn = {
  readonly currentStreakDays: number;
  readonly longestStreakDays: number;
  readonly todayRewardPoints: number;
  readonly isTodayClaimed: boolean;
  /** Any length - 7 is the backend's current cycle, not a structural limit. */
  readonly days: readonly DailyCheckInDay[];
  readonly ctaLabel: string;
  readonly isClaimSupported: boolean;
  /**
   * Human-readable description of when the streak day rolls over, built by
   * the mapper from the server's `resetsAt` + `timezone`. The daily boundary
   * itself is a server decision: this is a label to display, never a value
   * to compute against, and the device clock never defines "today".
   */
  readonly resetsAtLabel: string;
};

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type RewardTaskType =
  | 'DAILY_CHECK_IN'
  | 'SOCIAL_FOLLOW'
  | 'REWARDED_AD'
  | 'WATCH_TIME'
  | 'CAMPAIGN';

export type RewardTaskStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'CLAIMABLE'
  | 'COMPLETED';

export type RewardTaskProgress = {
  readonly current: number;
  readonly target: number;
};

export type SocialPlatform = 'FACEBOOK' | 'YOUTUBE' | 'TIKTOK' | 'INSTAGRAM';

/**
 * Machine-readable reason the server refuses to pay a task, so the client
 * can explain the state instead of rendering a dead button. Localised on
 * this side; never a user-facing string on the wire.
 */
export type RewardTaskUnsupportedReason = 'NO_VERIFIABLE_SIGNAL' | 'AWAITING_PRODUCT_DECISION';

export type RewardTask = {
  readonly id: string;
  readonly type: RewardTaskType;
  readonly title: string;
  readonly description: string;
  readonly rewardPoints: number;
  /** `null` for one-shot tasks that have no meaningful "x of y". */
  readonly progress: RewardTaskProgress | null;
  readonly status: RewardTaskStatus;
  readonly ctaLabel: string;
  /** Set only when `type` is `SOCIAL_FOLLOW`. */
  readonly socialPlatform?: SocialPlatform;
  /**
   * SERVER-OWNED. False until a server-verified claim exists for this task.
   * For social follows specifically this stays false until the platform
   * actually exposes a verifiable signal - "user tapped our link" is not
   * proof that anyone followed anything. The client must never flip it.
   */
  readonly isClaimSupported: boolean;
  /** Why `isClaimSupported` is false, when the server says. */
  readonly unsupportedReason?: RewardTaskUnsupportedReason;
};

// ---------------------------------------------------------------------------
// Watch-time
// ---------------------------------------------------------------------------

export type WatchTimeMilestoneStatus = 'LOCKED' | 'REACHED' | 'CLAIMED';

export type WatchTimeMilestone = {
  readonly id: string;
  readonly minutes: number;
  readonly rewardPoints: number;
  readonly status: WatchTimeMilestoneStatus;
};

/**
 * `source` deliberately has no `LOCAL_TIMER` member. A client-side stopwatch
 * is trivially manipulable (clock changes, background timers, a patched
 * bundle) and must never back a real award - production progress has to
 * arrive from server-side watch analytics.
 *
 * The backend currently sends `watchTime: null` outright, because its only
 * watch data is a per-series RESUME POSITION that decreases on a rewatch.
 * Summing it would not be watch time, it would be a number that looks like
 * watch time. `null` renders this section's empty state honestly.
 */
export type WatchTimeProgressSource = 'SERVER' | 'PLACEHOLDER';

export type WatchTimeProgress = {
  readonly watchedMinutes: number;
  readonly milestones: readonly WatchTimeMilestone[];
  readonly source: WatchTimeProgressSource;
  readonly isClaimSupported: boolean;
};

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

export type RewardRedemptionAvailability = 'AVAILABLE' | 'INSUFFICIENT_POINTS' | 'COMING_SOON';

export type RewardRedemption = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly costPoints: number;
  /** Length of the benefit this redemption grants, in whole days. */
  readonly grantsDays: number;
  /**
   * SERVER-COMPUTED against the server's own balance. The client renders
   * this; it never recomputes affordability from the number in the hero,
   * which would let a stale balance authorise a debit the server refuses.
   */
  readonly availability: RewardRedemptionAvailability;
  readonly ctaLabel: string;
  /**
   * SERVER-OWNED. Redeeming never touches the entitlement system from the
   * client - the backend debits the ledger and issues the entitlement in
   * one transaction, and this app only re-reads the result.
   */
  readonly isRedeemSupported: boolean;
};

// ---------------------------------------------------------------------------
// Ledger / transaction history
// ---------------------------------------------------------------------------

/**
 * `RewardLedgerEntry.reason` narrowed to the members this backend can
 * produce, plus `OTHER` so a reason added server-side renders as a generic
 * movement instead of crashing or, worse, being silently dropped from a
 * history the user is reading to reconcile their own balance.
 */
export type RewardLedgerReason =
  | 'DAILY_CHECK_IN'
  | 'VIP_REDEMPTION'
  | 'ADJUSTMENT'
  | 'REVERSAL'
  | 'OTHER';

export type RewardLedgerEntry = {
  readonly id: string;
  /** Signed. Positive is a credit (EARN), negative is a debit (REDEEM). */
  readonly deltaPoints: number;
  readonly reason: RewardLedgerReason;
  /** The server's balance immediately after this entry - never recomputed here. */
  readonly balanceAfter: number;
  /** Raw ISO-8601 from the server, kept for ordering and as a stable key. */
  readonly createdAt: string;
  /** Pre-formatted by the mapper. */
  readonly createdAtLabel: string;
};

/**
 * A page of history, plus the OPAQUE cursor that fetches the next one.
 *
 * Cursor, not offset: the ledger is append-only and grows while a user pages
 * through it, so `skip`/`take` would shift entries between pages. `null`
 * means the end of the history, which is what stops the "load more" control
 * from being offered forever.
 */
export type RewardLedgerPage = {
  readonly entries: readonly RewardLedgerEntry[];
  readonly nextCursor: string | null;
};

export type RewardsLedgerState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | {
      readonly status: 'ready';
      readonly entries: readonly RewardLedgerEntry[];
      readonly hasMore: boolean;
      readonly isLoadingMore: boolean;
      /** A failed "load more" leaves the already-loaded page on screen. */
      readonly loadMoreError: string | null;
    };

// ---------------------------------------------------------------------------
// Screen-level view model
// ---------------------------------------------------------------------------

export type RewardsSnapshot = {
  readonly wallet: RewardWallet;
  /** `null` renders the section's empty state rather than hiding it silently. */
  readonly dailyCheckIn: DailyCheckIn | null;
  readonly watchTime: WatchTimeProgress | null;
  readonly tasks: readonly RewardTask[];
  readonly redemptions: readonly RewardRedemption[];
};

/**
 * Every state the Rewards Center can be in.
 *
 * `signInRequired` and `unavailable` are separate members rather than error
 * strings on purpose: both are EXPECTED, non-failure outcomes with their own
 * correct affordance (sign in / come back later), and collapsing them into
 * `error` would offer a retry button for a condition retrying cannot fix.
 * Neither one may fall back to preview data.
 */
export type RewardsViewState =
  | { readonly status: 'loading' }
  /** Rewards is account state; the backend has no anonymous rewards surface. */
  | { readonly status: 'signInRequired' }
  /** `REWARDS_ENABLED=false` upstream: a bounded, truthful dead end. */
  | { readonly status: 'unavailable'; readonly message: string }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: RewardsSnapshot };

/**
 * Emitted when the user taps a CTA the SERVER has marked unsupported. This
 * reports the tap and nothing else: it never awards points, never claims a
 * task, and never activates an entitlement. The supported CTAs (check-in,
 * redeem) do not go through this type - they call the backend.
 */
export type RewardsUnavailableAction = {
  readonly kind: 'DAILY_CHECK_IN' | 'TASK' | 'WATCH_TIME' | 'REDEMPTION';
  readonly id: string;
  readonly label: string;
};

/** Transient, non-blocking feedback for a completed action. */
export type RewardsNotice = {
  readonly tone: 'success' | 'info' | 'error';
  readonly message: string;
};
