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

/**
 * `WATCH_EPISODES` counts DISTINCT EPISODES the server authorised playback
 * for within one reward day. It is a separate member from `WATCH_TIME`
 * because it is a separate UNIT: the backend cannot measure watch duration
 * and never claims to, so rendering an episode count under a "watch time"
 * label would be a wrong unit shown to a viewer.
 *
 * A TASK TYPE THIS BUILD DOES NOT KNOW IS DROPPED BY THE MAPPER, never
 * rendered and never crashed on. See `rewards-mapper.ts`.
 */
export type RewardTaskType =
  | 'DAILY_CHECK_IN'
  | 'SOCIAL_FOLLOW'
  | 'REWARDED_AD'
  | 'WATCH_TIME'
  | 'WATCH_EPISODES'
  | 'CAMPAIGN';

/**
 * How strong the evidence behind a claimable task is, carried into the view
 * model so the UI cannot accidentally overstate it.
 *
 * `USER_CONFIRMED` means the viewer said they did something the server could
 * not observe. THE UI MUST NOT CALL THIS A VERIFIED FOLLOW - no social
 * platform exposes an API that would let the backend check, and a label
 * claiming otherwise would be a lie the app tells on the server's behalf.
 * "Follow Instagram" as a CTA is fine; "Verified" beside it is not.
 */
export type RewardTaskVerification = 'USER_CONFIRMED' | 'SERVER_OBSERVED';

/**
 * Where a social mission has got to IN THIS SESSION.
 *
 * The two-step flow (`open` -> external profile -> come back -> `claim`) has
 * a middle state that exists only on the device: the server has recorded the
 * open and is waiting to be told the viewer came back. It is deliberately
 * NOT persisted - a claim is only offered to someone who opened the profile
 * in this sitting, and a restarted app correctly starts from "open" again.
 *
 * - `idle` - not started; the CTA opens the profile.
 * - `opened` - the server recorded the open; the CTA becomes a confirm.
 * - `claimed` - the server has paid it; there is no CTA left to press.
 */
export type SocialMissionStage = 'idle' | 'opened' | 'claimed';

export type RewardTaskStatus =
  | 'LOCKED'
  | 'AVAILABLE'
  | 'IN_PROGRESS'
  | 'CLAIMABLE'
  | 'COMPLETED';

/**
 * SERVER-COMPUTED progress toward a counted mission.
 *
 * `target` is the wire's `required`, renamed only because the rest of this
 * view model already says "target". Neither number is ever derived on the
 * device: a locally-counted "2 of 5 episodes" would be a client number
 * dressed as progress toward a reward only the server can pay.
 */
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
   * SERVER-OWNED. True for the missions the backend can actually pay. The
   * client reads it and never flips it - a task the server will not pay must
   * not be offered as if it would.
   */
  readonly isClaimSupported: boolean;
  /** Why `isClaimSupported` is false, when the server says. */
  readonly unsupportedReason?: RewardTaskUnsupportedReason;
  /**
   * The evidence class behind a claim, present exactly when
   * `isClaimSupported` is true. Rendered as an honest caption on social
   * tiles; never as a verification badge.
   */
  readonly verification?: RewardTaskVerification;
  /**
   * The Red Panda handle to show beside a social tile (`"@redpanda"`),
   * derived SERVER-side from the destination URL. Absent when the URL shape
   * carries no handle - fall back to the platform name, never invent one.
   */
  readonly accountHandle?: string;
  /**
   * Whether this mission has already been paid, straight from the server's
   * `claimedAt`. The claim CTA is withdrawn once this is true, so a viewer
   * cannot press a control the backend would answer `alreadyClaimed` to.
   */
  readonly isClaimed: boolean;
  /**
   * Human-readable "resets at ..." for a DAILY-resetting mission, built by
   * the mapper. Absent for one-time missions, whose completion is permanent.
   */
  readonly resetsAtLabel?: string;
  /**
   * Which step of the two-call social flow this tile is on, for THIS session.
   * `ctaLabel` already reflects it - this is here so the card can render the
   * matching hint without re-deriving the step from the label text.
   */
  readonly socialStage?: SocialMissionStage;
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

/**
 * What an offer hands over. V1 sells `AD_PERK` only: `PREMIUM_DAYS` offers
 * are withheld because every episode is already free, so charging coins to
 * "unlock premium" would take the coins and change nothing.
 */
export type RewardOfferKind = 'PREMIUM_DAYS' | 'AD_PERK';

export type RewardPerkType = 'SKIP_NEXT_INTERSTITIAL' | 'TEMPORARY_AD_PASS';

/** What an `AD_PERK` offer will issue. Every value here is the server's. */
export type RewardOfferPerk = {
  readonly type: RewardPerkType;
  /** `1` for a single-use skip; `null` for a duration pass. */
  readonly uses: number | null;
  readonly durationMinutes: number;
};

/**
 * One perk the account currently HOLDS, for the "you have 1 ad skip" line
 * beside the offer that sells one.
 *
 * Presentational only. The ad gate never reads this list - it reads the two
 * server-derived signals on `ActivePerks`, because deciding "is this perk
 * live?" from an array is exactly the rule duplication that drifts into
 * showing an ad to someone who spent coins not to see one.
 */
export type RewardPerk = {
  readonly id: string;
  readonly type: RewardPerkType;
  readonly title: string;
  readonly detail: string;
  /** Raw ISO-8601, kept so the caller can compare instants if it must. */
  readonly expiresAt: string;
  readonly expiresAtLabel: string;
  readonly remainingUses: number | null;
};

/**
 * What the viewer holds right now.
 *
 * `skipNextInterstitial` and `adFreeUntil` are SERVER-DERIVED and are the
 * only two values the ad layer may act on. `perks` is for display.
 */
export type ActivePerks = {
  readonly perks: readonly RewardPerk[];
  readonly skipNextInterstitial: boolean;
  /** ISO-8601 UTC, or `null` when no temporary pass is running. */
  readonly adFreeUntil: string | null;
};

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
  /**
   * What this offer hands over. V1 renders only `AD_PERK`; the mapper drops
   * `PREMIUM_DAYS` offers outright rather than showing a purchase the app
   * has nothing to deliver for.
   */
  readonly kind: RewardOfferKind;
  /** Present exactly when `kind` is `AD_PERK`. */
  readonly perk?: RewardOfferPerk;
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
  /**
   * A social mission payout. Named for what the server actually recorded -
   * an EXTERNAL SOCIAL ACTION the account holder confirmed - and
   * deliberately not `VERIFIED_FOLLOW`, which is a fact nothing in this
   * system can establish.
   */
  | 'EXTERNAL_SOCIAL_ACTION'
  | 'WATCH_MILESTONE'
  | 'AD_PERK_REDEMPTION'
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
  /** What the viewer already holds, rendered beside the offers that sell it. */
  readonly activePerks: ActivePerks;
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
