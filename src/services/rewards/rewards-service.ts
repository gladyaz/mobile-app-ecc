import { request } from '@/services/api/client';
import type {
  ActivePerksDto,
  CheckInResponseDto,
  MissionClaimResponseDto,
  MissionOpenResponseDto,
  PerkConsumeResponseDto,
  RedeemResponseDto,
  RewardLedgerPageDto,
  RewardsSnapshotDto,
} from '@/services/rewards/rewards-dto';

/**
 * The `/rewards/*` client.
 *
 * Every route here is AUTHENTICATED - the backend has no anonymous rewards
 * surface, because a wallet without an account has no owner and an anonymous
 * streak has nothing to attach to. `requiresAuth: true` attaches the bearer
 * token and gives each call the shared refresh-and-retry-once behaviour from
 * `services/api/client.ts`; a caller that is signed out gets an `ApiError`
 * with code `INVALID_ACCESS_TOKEN` rather than a fabricated empty wallet.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO:
 *
 *  - It never sends an amount, a balance, a delta, a date, a period key or a
 *    payout idempotency key for an EARN. Every economic value is resolved
 *    server-side; the client sends intent only. `checkIn()` taking no
 *    arguments at all is that rule at its strongest.
 *  - It never falls back to fixture data. A failed call throws, so the
 *    caller renders a truthful error state instead of a plausible number.
 *  - It contains no dev-tools route. `POST /dev/rewards/grant` exists on the
 *    backend behind `DEV_TOOLS_ENABLED`, and preparing a demo balance is
 *    done with `scripts/dev-grant-reward-points.sh` against a local server -
 *    deliberately NOT from inside the app, so no build of this client can
 *    credit itself points.
 */

/**
 * The whole Rewards Center in one read.
 *
 * ONE CALL, NOT FOUR, and that is the backend's design rather than a
 * convenience: the balance, the streak strip and the redemption
 * availability must agree with each other, and four independent requests can
 * interleave with a check-in and render a balance that contradicts the strip
 * beside it. It is a pure read - polling it creates no wallet row and no
 * check-in row.
 */
export async function fetchRewardsSnapshot(): Promise<RewardsSnapshotDto> {
  return request<RewardsSnapshotDto>('rewards/snapshot', { method: 'GET' }, { requiresAuth: true });
}

/**
 * Claims today's check-in.
 *
 * TAKES NO ARGUMENTS, AND SENDS NO BODY. The date is the server's, the
 * amount is the server's, and the idempotency key is derived server-side
 * from that date - so there is nothing for this client to send and nothing
 * it could send that would change the outcome.
 *
 * Answers 200 in BOTH cases. A repeat, a double-tap or a retry comes back
 * with `alreadyCheckedIn: true` and `awardedPoints: 0`, which is a
 * successful no-op rather than an error to render as a failure.
 */
export async function claimDailyCheckIn(): Promise<CheckInResponseDto> {
  return request<CheckInResponseDto>('rewards/check-in', { method: 'POST' }, { requiresAuth: true });
}

export type FetchLedgerOptions = {
  /** Server clamps to 1..100; omitted means the server default of 20. */
  readonly limit?: number;
  /** OPAQUE cursor from the previous page's `nextCursor`. Never constructed here. */
  readonly cursor?: string | null;
};

/**
 * A page of transaction history, newest first.
 *
 * CURSOR, NOT OFFSET. The ledger is append-only and grows while a user pages
 * through it, so `skip`/`take` would shift entries between pages and show
 * the same movement twice (or skip one). The cursor is opaque: it is read
 * from a previous response and passed back verbatim, never parsed or built.
 */
export async function fetchRewardsLedger(
  options: FetchLedgerOptions = {}
): Promise<RewardLedgerPageDto> {
  const params = new URLSearchParams();

  if (typeof options.limit === 'number') {
    params.set('limit', String(options.limit));
  }

  if (options.cursor) {
    params.set('cursor', options.cursor);
  }

  const query = params.toString();

  return request<RewardLedgerPageDto>(
    query ? `rewards/ledger?${query}` : 'rewards/ledger',
    { method: 'GET' },
    { requiresAuth: true }
  );
}

export type RedeemRequest = {
  readonly offerId: string;
  /** From `createRedemptionIdempotencyKey()`; reused only to retry ONE attempt. */
  readonly idempotencyKey: string;
};

/**
 * Spends points on a catalog offer.
 *
 * NOTE WHAT IS ABSENT FROM THE BODY: no cost, no points, no duration. The
 * client sends INTENT ONLY, and every economic value is resolved server-side
 * from the offer catalog. The backend's validation runs with
 * `forbidNonWhitelisted`, so a request that invented a `costPoints` field
 * would be rejected outright rather than silently ignored - which is why
 * adding one here to "help" would break redemption rather than cheat it.
 *
 * The debit, the receipt and the entitlement grant are ONE server-side
 * transaction. This client grants nothing; it re-reads what the server did.
 */
export async function redeemReward(body: RedeemRequest): Promise<RedeemResponseDto> {
  return request<RedeemResponseDto>(
    'rewards/redemptions',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerId: body.offerId, idempotencyKey: body.idempotencyKey }),
    },
    { requiresAuth: true }
  );
}

/**
 * Records that the server is sending this account to a social profile, and
 * returns the URL to send them to. `POST /rewards/missions/:missionId/open`.
 *
 * THE DESTINATION COMES BACK IN THE RESPONSE; IT IS NEVER SENT. A route that
 * ACCEPTED a destination would let a caller nominate where the app opens an
 * external browser - a phishing primitive handed out with Red Panda's
 * branding on it. So this takes no body, and the only URL the app may open is
 * the one the server just answered with.
 *
 * `claimableAfter` is why the two halves are separate calls: the server
 * records the open at a recorded instant and refuses a claim that arrives
 * inside the dwell window, so the client disables its confirm control for the
 * interval rather than letting a viewer tap it into an error.
 *
 * Only SOCIAL missions can be opened. A watch milestone answers
 * `REWARD_MISSION_NOT_OPENABLE` - there is nothing to open, it progresses as
 * you watch.
 *
 * Error codes: `REWARD_MISSION_NOT_FOUND` (404) for an id not in the catalog;
 * `REWARD_MISSION_UNAVAILABLE` (409) for a real mission this deployment does
 * not configure; `REWARD_MISSION_NOT_OPENABLE` (409); `REWARDS_DISABLED`
 * (503).
 */
export async function openSocialMission(missionId: string): Promise<MissionOpenResponseDto> {
  return request<MissionOpenResponseDto>(
    `rewards/missions/${encodeURIComponent(missionId)}/open`,
    { method: 'POST' },
    { requiresAuth: true }
  );
}

/**
 * Claims a social mission or a watch milestone.
 * `POST /rewards/missions/:missionId/claim`.
 *
 * TAKES NO BODY, exactly like check-in and for the same reason: the amount is
 * the server's, the reward day is the server's, and the idempotency key is
 * derived from the mission id (plus the period, for a daily mission). Even
 * WHICH mission comes from the path and is resolved against the server
 * catalog before anything is paid.
 *
 * Answers 200 in BOTH cases. A repeat, a double-tap or a retry comes back
 * with `alreadyClaimed: true` and `awardedPoints: 0` - a successful no-op,
 * not an error to render as a failure.
 *
 * WHAT A SOCIAL CLAIM ACTUALLY ASSERTS: that the account holder confirmed
 * they performed an external action they were sent to. It is NOT a verified
 * follow, and no caller may present it as one - the server records the
 * evidence class as `USER_CONFIRMED` on the tile and
 * `EXTERNAL_SOCIAL_ACTION` in the ledger precisely so this cannot be
 * quietly upgraded in the UI.
 *
 * Error codes: `REWARD_MISSION_NOT_FOUND` (404); `REWARD_MISSION_UNAVAILABLE`
 * (409); `REWARD_MISSION_NOT_STARTED` (409) for a social claim with no
 * recorded open; `REWARD_MISSION_TOO_SOON` (409) inside the dwell window;
 * `REWARD_MISSION_NOT_COMPLETE` (409) for a watch milestone not reached
 * today; `REWARDS_DISABLED` (503).
 */
export async function claimMission(missionId: string): Promise<MissionClaimResponseDto> {
  return request<MissionClaimResponseDto>(
    `rewards/missions/${encodeURIComponent(missionId)}/claim`,
    { method: 'POST' },
    { requiresAuth: true }
  );
}

/**
 * The question the ad layer asks before showing an interstitial.
 * `GET /rewards/perks`.
 *
 * DELIBERATELY SEPARATE FROM THE SNAPSHOT: the ad gate consults this far more
 * often than anyone opens the Rewards Center, and it should not pay for a
 * wallet read, a streak read and a mission count every time.
 *
 * Callers read `skipNextInterstitial` / `adFreeUntil` and never re-derive
 * them from `perks[]` - that rule belongs to the server, and a second
 * implementation would drift on the one code path where drift means showing
 * an ad to someone who spent coins not to see one.
 */
export async function fetchActivePerks(): Promise<ActivePerksDto> {
  return request<ActivePerksDto>('rewards/perks', { method: 'GET' }, { requiresAuth: true });
}

/**
 * Records that a single-use ad skip was ACTUALLY spent.
 * `POST /rewards/perks/:perkId/consume`.
 *
 * THIS MUST BE CALLED WHEN THE APP REALLY SKIPS, AND ONLY THEN. A perk the
 * app "uses" by quietly not showing an ad is a perk the server still believes
 * the user holds - the next ad break would skip again for free, and the
 * receipt would stop describing what happened. Equally, calling it on a
 * transition where no ad would have been shown anyway BURNS a perk the viewer
 * paid for without giving them anything.
 *
 * Answers 200 with `alreadyConsumed: true` on a repeat rather than 409: a
 * retried consume after a dropped response is the ordinary case, and the
 * caller's correct reaction - "the perk is gone, show ads again" - is the
 * same either way. That is what makes a retry safe rather than a
 * double-spend.
 *
 * A `TEMPORARY_AD_PASS` is REFUSED here (`REWARD_PERK_NOT_CONSUMABLE`): it is
 * spent by the clock, and "consuming" one could only destroy time the viewer
 * paid for.
 *
 * Error codes: `REWARD_PERK_NOT_FOUND` (404); `REWARD_PERK_NOT_CONSUMABLE`
 * (409); `REWARD_PERK_EXPIRED` (409); `REWARDS_DISABLED` (503).
 */
export async function consumePerk(perkId: string): Promise<PerkConsumeResponseDto> {
  return request<PerkConsumeResponseDto>(
    `rewards/perks/${encodeURIComponent(perkId)}/consume`,
    { method: 'POST' },
    { requiresAuth: true }
  );
}
