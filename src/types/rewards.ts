/**
 * Rewards Center domain contract (UI-facing view model only).
 *
 * SCOPE BOUNDARY - read before extending this file:
 *
 * These types describe what the Rewards Center *renders*. They are NOT a
 * backend schema, and nothing in this slice issues, mutates, or persists a
 * points balance. The production model (RewardWallet / RewardLedger /
 * RewardClaim / RewardRedemption, plus the anti-abuse rules that make an
 * award safe to grant) is written up in `docs/rewards-domain-contract.md`
 * and is deliberately NOT implemented here.
 *
 * Two conventions carry the "this is not live yet" fact through the type
 * system instead of through scattered UI copy:
 *
 * - `isClaimSupported` / `isRedeemSupported` - false whenever no
 *   server-verified claim path exists for that item. Every fixture in this
 *   slice ships `false`, so every CTA renders in its unavailable state. The
 *   UI reads these flags; it never decides availability on its own.
 * - `isServerAuthoritative` / `source` - whether the number shown came from
 *   a trusted backend. A client-side timer or a bundled fixture must never
 *   report itself as server-authoritative.
 *
 * All economics (point values, costs, durations, thresholds) are supplied
 * as data on these types. No component may hardcode them - see
 * `src/features/rewards/rewards-fixtures.ts` for the single placeholder set.
 */

// ---------------------------------------------------------------------------
// Wallet / balance
// ---------------------------------------------------------------------------

export type RewardWallet = {
  readonly balancePoints: number;
  readonly lifetimeEarnedPoints: number;
  /**
   * True only when `balancePoints` was read from a server-side ledger
   * projection. A locally-accumulated total must report `false` so the UI
   * can label it honestly - see `docs/rewards-domain-contract.md`.
   */
  readonly isServerAuthoritative: boolean;
  /** Pre-formatted by the caller; this layer does no date formatting. */
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
  /** Any length - 7 is a fixture choice, not a structural limit. */
  readonly days: readonly DailyCheckInDay[];
  readonly ctaLabel: string;
  readonly isClaimSupported: boolean;
  /**
   * Human-readable description of when the streak day rolls over. The
   * daily boundary itself is a server decision (see the domain contract);
   * this is a label to display, never a value to compute against.
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
   * False until a server-verified claim exists for this task. For social
   * follows specifically this stays false until the platform actually
   * exposes a verifiable signal - "user tapped our link" is not proof that
   * anyone followed anything.
   */
  readonly isClaimSupported: boolean;
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
 * arrive from server-side watch analytics. `PLACEHOLDER` means "fixture
 * data, shown for layout only", and the UI labels it as such.
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
  /** Length of the benefit this redemption would grant, in whole days. */
  readonly grantsDays: number;
  readonly availability: RewardRedemptionAvailability;
  readonly ctaLabel: string;
  /**
   * False until redemption is server-authoritative. Redeeming must never
   * touch the entitlement system from the client - the backend issues the
   * entitlement change as part of the same ledger transaction.
   */
  readonly isRedeemSupported: boolean;
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

export type RewardsViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'ready'; readonly snapshot: RewardsSnapshot };

/**
 * Emitted when the user taps a CTA that has no backend behind it yet. This
 * is the ONLY thing a Rewards CTA does in this slice: it reports the tap.
 * It never awards points, never claims a task, and never activates an
 * entitlement.
 */
export type RewardsPrototypeAction = {
  readonly kind: 'DAILY_CHECK_IN' | 'TASK' | 'WATCH_TIME' | 'REDEMPTION';
  readonly id: string;
  readonly label: string;
};
