/**
 * Idempotency keys for `POST /rewards/redemptions`.
 *
 * WHY THE CLIENT SUPPLIES THIS ONE AND NOT THE CHECK-IN'S. The backend
 * derives the daily check-in's key from its own calendar date, so a client
 * cannot vary it and cannot buy a second payout for the same day. Redemption
 * is different: redeeming the same offer twice is a legitimate thing to do,
 * so only the caller can distinguish "retry of the attempt that timed out"
 * from "a second, deliberate purchase". That distinction IS the key.
 *
 * The server constrains it to `[A-Za-z0-9_:-]{8,128}` (it is stored in a
 * unique index and echoed into a ledger key), which every value produced
 * here satisfies.
 *
 * NOT CRYPTOGRAPHIC, AND IT DOES NOT NEED TO BE. The key is scoped to one
 * account - the server pairs it with the user id from the verified token,
 * so guessing another user's key achieves nothing. What it does need is to
 * not COLLIDE with a previous key from the same account, because a
 * collision would replay an earlier receipt instead of making the purchase
 * the user just asked for. Three independent sources make that vanishingly
 * unlikely:
 *
 *   - a monotonic per-process counter, which alone guarantees uniqueness
 *     within a single app run;
 *   - the wall clock in milliseconds, which separates one app run from the
 *     next even if the counter restarts at zero;
 *   - two random blocks, which separate two installs that start in the same
 *     millisecond.
 *
 * No dependency is added for this. `expo-crypto` is not in this project, and
 * pulling a UUID package in for one 20-character string would be a native
 * dependency added to the demo build for no gain in the property that
 * actually matters here.
 */

const KEY_PREFIX = 'rdm';

/**
 * Guarantees uniqueness within one app run on its own, so two presses in the
 * same millisecond can never produce the same key.
 */
let sequence = 0;

function randomBlock(): string {
  // `toString(36)` yields `0.` + digits/lowercase letters; dropping the
  // leading "0." leaves only characters the server's charset allows.
  return Math.random().toString(36).slice(2, 10);
}

/**
 * A fresh key for ONE redemption attempt.
 *
 * Call this once per user intent, not once per HTTP request: the caller is
 * expected to reuse the same key when retrying an attempt whose outcome is
 * unknown (a dropped connection), which is exactly when replaying rather
 * than double-charging is the correct behaviour.
 */
export function createRedemptionIdempotencyKey(): string {
  sequence += 1;

  return `${KEY_PREFIX}-${Date.now().toString(36)}-${sequence.toString(36)}-${randomBlock()}${randomBlock()}`;
}
