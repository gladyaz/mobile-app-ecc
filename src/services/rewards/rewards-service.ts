import { request } from '@/services/api/client';
import type {
  CheckInResponseDto,
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
