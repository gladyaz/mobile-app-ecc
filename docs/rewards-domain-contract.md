# Rewards Domain Contract (proposal — now largely IMPLEMENTED)

**Status: SUPERSEDED IN PART. This was written as a proposal; the model it
describes has since been built.** The authoritative description of what
actually exists is the backend's
`short-drama-backend/docs/rewards-api-contract.md`. Read that first; this
document is kept because it records *why* the model is shaped the way it is,
and because the backend contract answers it section by section.

What has changed since this was written:

| This document said | What is true now |
| --- | --- |
| "Nothing described here is implemented" | `RewardLedgerEntry`, `RewardWallet`, `RewardRedemption` and the `/rewards/*` routes exist and are live |
| One placeholder economics module, `rewards-fixtures.ts` | **Deleted.** Every number now arrives from the server; there is no fixture fallback left in the app |
| "no service call, and no reward issuance anywhere in the app" | `src/services/rewards/` calls the four canonical routes; issuance is entirely server-side |
| `RewardsPrototypeAction` (CTAs only report a tap) | Replaced by real check-in and redemption calls. The type survives, renamed `RewardsUnavailableAction`, for the CTAs the SERVER still marks unsupported |
| §5 social-follow / rewarded-ad / watch-time earning | Deliberately still NOT implemented — the backend has no verifiable signal and refuses to pay them. See the API contract §6 |
| §8 open product decisions | **Still open.** The values moved server-side and are now enforced, but they remain product-unapproved |

The one thing this document got exactly right, and which the implementation
kept, is §1.

---

## 1. Core principle

> A balance is a **projection of a ledger**, never a stored number that
> code is free to overwrite.

The failure mode to design out is this:

```
// NEVER
user.points = user.points + 50
```

A bare mutable counter has no answer to any of the questions that matter in
production: where did these points come from, was this reward already paid,
did the retry double-pay, why does this user have 900,000 points, and can we
reverse it. Every one of those is answerable if — and only if — each change
is an immutable ledger row.

Therefore:

- **`RewardLedgerEntry` is the source of truth.** Every point that comes into
  or leaves an account is one append-only row.
- **`RewardWallet.balancePoints` is a derived projection**, maintained by the
  same transaction that appends the entry, and reconcilable at any time by
  summing the ledger. If the projection and the ledger sum ever disagree, the
  ledger wins.
- **The client never computes a balance.** It renders what the server sends.
  The mobile view model carries `isServerAuthoritative` precisely so a
  non-server number can never masquerade as a real one.

---

## 2. Entities

### RewardWallet

One per user. The read-optimised projection.

| Field | Notes |
| --- | --- |
| `userId` | Owner; unique. |
| `balancePoints` | Derived, non-negative. Must equal the ledger sum. |
| `lifetimeEarnedPoints` | Sum of credits only; never decreases. |
| `version` | Optimistic-concurrency guard for concurrent claims. |
| `updatedAt` | ISO-8601 UTC. |

### RewardLedgerEntry

Append-only. **No updates, no deletes.** A correction is a new compensating
entry, not an edit.

| Field | Notes |
| --- | --- |
| `id` | Server-generated. |
| `userId` | Owner. |
| `deltaPoints` | Signed. Positive credit, negative debit. Never zero. |
| `reason` | See the transaction vocabulary below. |
| `sourceType` / `sourceId` | What produced it, e.g. `TASK` / `task_social_facebook`. |
| `idempotencyKey` | Unique per user. The duplicate-payout guard — see §4. |
| `balanceAfter` | Snapshot for audit and for cheap statement rendering. |
| `metadata` | Reason-specific context (streak day, milestone, ad network txn id). |
| `createdAt` | ISO-8601 UTC. |

### RewardTaskDefinition vs. RewardTask

Keep the **configuration** separate from the **per-user state**. This is what
makes economics tunable without a release, and it is why the mobile
components take every number as data.

- `RewardTaskDefinition` — id, type, copy, `rewardPoints`, `target`,
  cadence (once / daily / weekly), active window, and
  `verificationMode` (see §5). Product-owned configuration.
- `RewardTask` — per-user progress against a definition: `progress`,
  `status`, `lastClaimedAt`. Derived server-side.

The mobile `RewardTask` type is the flattened join of the two, which is all
the UI needs.

### RewardClaim

The record of an attempt to convert completed work into points. Distinct from
the ledger entry: a claim can be rejected, and a rejected claim must leave an
audit trail without moving any points.

| Field | Notes |
| --- | --- |
| `id`, `userId`, `taskId` | Identity. |
| `status` | `PENDING` / `VERIFIED` / `REJECTED` / `PAID`. |
| `idempotencyKey` | Supplied by the client, unique per user + task + period. |
| `ledgerEntryId` | Set only on `PAID`. Null everywhere else. |
| `rejectionReason` | Populated on `REJECTED`, for support and abuse analysis. |

### DailyCheckIn

| Field | Notes |
| --- | --- |
| `userId` | Owner. |
| `currentStreakDays`, `longestStreakDays` | Server-computed. |
| `lastCheckInDate` | A **date** in the service timezone, not a timestamp. |
| `checkInDates` | Retained window, for streak repair and dispute handling. |

### RewardRedemption

| Field | Notes |
| --- | --- |
| `id`, `userId`, `offerId` | Identity. |
| `costPoints` | Snapshotted at redemption time, so a later price change never rewrites history. |
| `status` | `PENDING` / `FULFILLED` / `FAILED` / `REVERSED`. |
| `ledgerEntryId` | The debit. |
| `entitlementGrantId` | The entitlement issued in the *same* transaction. |

---

## 3. Transaction vocabulary

`RewardLedgerEntry.reason` is a closed set. Adding a member is a deliberate
product decision, not an incidental code change.

| Reason | Sign | Source of truth |
| --- | --- | --- |
| `DAILY_CHECK_IN` | credit | Server-side date boundary + streak state |
| `SOCIAL_TASK` | credit | Only a verifiable platform signal — see §5 |
| `REWARDED_AD` | credit | Ad-network server-side verification callback |
| `WATCH_TIME` | credit | Server-side watch analytics |
| `VIP_REDEMPTION` | debit | Redemption transaction |
| `ADJUSTMENT` | either | Manual support action; requires an operator id |
| `REVERSAL` | either | Compensating entry; references the reversed entry |

---

## 4. Anti-abuse requirements

These are requirements, not suggestions. A rewards system without them is a
free-money faucet.

**Idempotency.** Every claim and redemption carries a client-supplied
`idempotencyKey`, unique per user and logical action. The key is enforced by
a unique database constraint, not by an application-level "check then
insert" — that check-then-act races under concurrency and will double-pay.
A repeat request returns the original result; it never creates a second
ledger entry.

**One-time claims.** A `once` task has at most one `PAID` claim per user,
enforced by a unique index on `(userId, taskId)`. A daily task is unique on
`(userId, taskId, periodKey)`.

**Daily boundary.** The server owns the definition of "today". Pin one
service timezone (Asia/Jakarta is the app's audience) and derive `periodKey`
from it server-side. Never trust a device clock or device timezone: both are
user-settable, and a client-derived boundary lets a user harvest several
"days" of check-ins in one evening.

**Streak handling.** Streak transitions are computed server-side from
`lastCheckInDate` against the current service date: same date is a no-op,
consecutive date increments, any gap resets. A missed day must not be
silently repairable by a client request. If a paid "streak repair" is ever
offered, it is a separate transaction with its own reason code.

**Server-authoritative balance.** The client displays; it never decides. No
endpoint accepts a balance, a delta, or a "points earned" figure from the
client. The client sends *intent* ("claim task X with key K"); the server
decides whether that intent is worth anything.

**Transaction ledger.** Balance mutation and ledger append happen in one
database transaction. Neither is possible without the other.

**Duplicate reward protection.** Beyond idempotency keys: rewarded-ad credits
are keyed on the ad network's own transaction id so a replayed callback
cannot pay twice, and watch-time milestones are keyed on
`(userId, milestoneId, periodKey)` so re-reported analytics are inert.

**Rate limiting and anomaly detection.** Per-user and per-device caps on
claims per hour. Because the ledger is append-only and fully attributed,
anomalous patterns are queryable after the fact and reversible via
`REVERSAL` entries.

---

## 5. Per-source verification notes

**Social follows — currently unverifiable.** This is the sharpest constraint
and the reason the shipped UI says so plainly. Opening a profile link proves
only that a link was opened. It does not prove a follow happened, that it was
the same person, or that the follow persisted for longer than it took to
collect the points. Facebook, YouTube, TikTok and Instagram do not offer a
"did user X follow page Y" check for arbitrary users.

Options, in descending order of honesty:

1. Do not pay for follows. Keep the link as a discovery affordance with no
   reward attached.
2. Pay once, for a one-time, capped, deliberately small amount, accepting
   that it is unverifiable — and price it as a marketing cost, not a task.
3. Pay only against a verifiable proxy the platform *does* expose (an
   OAuth-scoped signal, a campaign referral, a UGC submission).

**This is a founder decision.** Until it is made, `isClaimSupported` stays
`false` and the UI states that the follow cannot be verified.

**Rewarded ads.** Credit only from the ad network's server-side verification
callback, keyed on its transaction id. Never from a client "the ad finished"
message — that is a request from an untrusted device. The daily cap and the
reward value are both server config.

**Watch-time.** Must come from server-side watch analytics, not a local
timer. A client stopwatch is defeated by a changed system clock, a
backgrounded app, a scripted playback loop or a patched bundle. The mobile
`WatchTimeProgressSource` type deliberately offers only `SERVER` and
`PLACEHOLDER` — there is no `LOCAL_TIMER` member to reach for.

**Redemption.** The point debit and the entitlement grant are one atomic
transaction: both succeed or neither does. A client must never be able to
activate an entitlement locally. Correspondingly, the redemption UI in this
slice imports nothing from `@/stores/entitlement` or
`@/services/entitlement`, and a test asserts that stays true.

---

## 6. Client responsibilities

The mobile app may:

- render a server-supplied snapshot;
- send an intent (`claim task`, `check in`, `redeem`) with an idempotency key;
- render loading, error and empty states;
- render optimistic *pending* states, clearly marked as pending.

The mobile app must never:

- compute, cache-as-truth, or increment a balance;
- decide whether a task is claimable — it renders the server's flag;
- derive the daily boundary or the streak;
- measure watch time for reward purposes;
- grant an entitlement.

---

## 7. Mapping from this slice to the production model

| Today (`src/types/rewards.ts`) | Production |
| --- | --- |
| `RewardWallet` | `RewardWallet` projection over `RewardLedgerEntry` |
| `RewardTask` | `RewardTaskDefinition` joined with per-user `RewardTask` |
| `DailyCheckIn` | `DailyCheckIn` + its `DAILY_CHECK_IN` ledger entries |
| `WatchTimeProgress` | Server watch analytics + `WATCH_TIME` entries |
| `RewardRedemption` | `RewardRedemption` + debit + entitlement grant |
| `isClaimSupported` / `isRedeemSupported` | Server-computed claimability |
| `RewardsPrototypeAction` | Replaced by real claim/redeem calls |

The intended replacement path is a `src/services/rewards/` module returning a
`RewardsSnapshot` of the existing shape. Because no component holds an
economic value, that swap should need no component changes.

**That is what was built, and the prediction held.** `src/services/rewards/`
fetches the DTOs and `src/features/rewards/rewards-mapper.ts` turns them into
the same `RewardsSnapshot` the components already took. The presentational
components changed only to render two things they never had before — a busy
state on a CTA that now performs a real request, and the transaction history
the ledger made possible — not to accommodate a different data shape.

---

## 8. Open decisions (founder / product)

The numbers now live in the backend's `rewards.constants.ts` rather than in a
mobile fixture, and they are ENFORCED there — but they are still not product-
approved. Changing any of them is an edit to one server file with no mobile
release, and past ledger entries snapshot their values, so retuning never
rewrites history. Still required:

1. Daily check-in reward curve, cycle length, and whether a streak bonus exists.
2. Rewarded-ad reward value and daily cap.
3. Social-follow policy — the §5 decision — and a reward value if any.
4. Watch-time milestone thresholds and their reward values.
5. VIP redemption costs and benefit durations.
6. Point expiry: do points expire, and if so on what schedule.
7. Service timezone for the daily boundary (assumed Asia/Jakarta).
8. Whether points ever carry a stated monetary value. The current UI shows
   points only, with no rupiah equivalent, deliberately.
