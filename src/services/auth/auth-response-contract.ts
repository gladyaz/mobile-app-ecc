import type { AuthResponse } from '@/types/auth';

/**
 * THE BOUNDARY CHECK FOR AN AUTH SESSION RESPONSE.
 *
 * `POST /auth/google`, `POST /auth/whatsapp/otp/verify` and
 * `POST /auth/refresh` all answer the identical `AuthResponseDto`, and all
 * three feed `adoptSession` in `stores/auth.tsx`, which writes the pair into
 * Keystore-backed secure storage. Until this module existed they were the
 * only V1 wire boundary with NO runtime validation - a bare
 * `request<AuthResponse>` cast - while the very same file already validated
 * the OTP challenge (`parseOtpChallenge`) and the identity list
 * (`parseAuthIdentities`).
 *
 * ## What the missing check actually cost
 *
 * A response that lost `refreshToken` - a rename, a partial rollout, a
 * gateway that strips a field - type-checks perfectly and then:
 *
 *   1. `adoptSession` persists `{ accessToken, refreshToken: undefined }`,
 *   2. the app renders as signed in,
 *   3. the first 401 reaches `runTokenRefresh`, which finds no refresh token,
 *      calls `clearTokensAndNotify()` and signs the viewer out,
 *
 * with no error anywhere in between. The viewer sees a successful login that
 * silently becomes a logout, and nothing in the app ever says why. That is
 * exactly the class of failure the V1 contract lock exists to make loud.
 *
 * ## Why a PREDICATE and not a throwing parser
 *
 * `services/api/client.ts` needs this on its refresh path, and `ApiError`
 * lives in that same module. A parser that constructed one would make
 * `client.ts -> auth-response-contract.ts -> client.ts` a real load-time
 * cycle - the identical trap documented on `attemptTokenRefresh`, which was
 * confirmed broken two separate ways. A predicate imports only a TYPE from
 * `@/types/auth`, which erases at compile time, so there is no cycle to
 * have. Each caller then raises the failure in its own idiom: the provider
 * service throws its existing `INVALID_RESPONSE` `ApiError`, and the refresh
 * path returns `false`, which it already treats as "this session is over".
 *
 * ## What it deliberately does NOT do
 *
 * It never repairs, defaults or narrows a payload. An invented token would
 * hide the drift, and there is no safe value to invent for a credential.
 * Unknown extra fields are ACCEPTED without comment: the backend adds fields
 * additively, and a client that refused one would break on the next release.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Whether `value` is a usable session response.
 *
 * `email` is checked for PRESENCE, not truthiness: the contract is that the
 * key is ALWAYS there and its value is `string | null` (null for a
 * WhatsApp-only account, and for a Google account whose token did not assert
 * `email_verified`). An omitted key is drift, and substituting `null` for it
 * here would silently absorb exactly that drift.
 */
export function isValidAuthResponse(value: unknown): value is AuthResponse {
  if (!isRecord(value)) {
    return false;
  }

  if (!isNonEmptyString(value.accessToken) || !isNonEmptyString(value.refreshToken)) {
    return false;
  }

  const user = value.user;

  if (!isRecord(user)) {
    return false;
  }

  if (!isNonEmptyString(user.id)) {
    return false;
  }

  if (!('email' in user) || (user.email !== null && typeof user.email !== 'string')) {
    return false;
  }

  return user.displayName === undefined || typeof user.displayName === 'string';
}
