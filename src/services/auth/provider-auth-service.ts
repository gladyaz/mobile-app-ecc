import { request } from '@/services/api/client';
import { invalidOtpResponse, parseOtpChallenge } from '@/services/auth/otp-challenge';
import type {
  AuthIdentitySummary,
  AuthProviderId,
  AuthResponse,
  LinkableAuthProviderId,
  OtpChallenge,
} from '@/types/auth';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** Names this module in every boundary-validation failure it raises. */
const PARSE_SOURCE = 'provider-auth-service';

/**
 * The ONE place the app talks to the backend's provider-auth surface
 * (Google, WhatsApp OTP, identity listing and linking). Screens never call
 * `fetch` or `request` for these flows - they call `stores/auth.tsx` or this
 * module - so the whole surface reconciles inside this file plus the
 * endpoint table in docs/api-contract.md.
 *
 * CANONICAL CONTRACT, reconciled in Phase 10D against the backend's
 * `docs/auth-identity-api-contract.md` @ a695a9c, which is the single source
 * of truth for both sides. The provisional `/auth/providers/*` and
 * `/auth/methods` paths this module used to construct were never served by
 * any deployed backend and have been dropped outright - no aliases, because
 * two production paths for one action means two things to secure,
 * rate-limit and audit forever.
 *
 * Nothing here fabricates a success path when the network fails: each
 * function propagates `ApiError` exactly as `auth-service.ts` does, and
 * callers surface a real error state.
 *
 * Anti-enumeration rule (WhatsApp): `startWhatsAppOtp` must answer
 * identically for a phone number that has an account and one that does not.
 * This module therefore returns only fixed timing constants - never an
 * "account exists" flag - and callers must not branch their UI on anything
 * that could reconstruct one.
 *
 * SIGN-IN AND LINK ARE NOT INTERCHANGEABLE. `verifyWhatsAppOtp` and
 * `linkWhatsAppIdentity` consume the SAME OTP challenge for a number and
 * nothing binds a challenge to an intent, so calling the wrong one is a
 * silent behaviour swap rather than an error: verify REPLACES the current
 * session with the phone's own account, link ATTACHES the phone to the
 * account already signed in. Same for `loginWithGoogleIdToken` versus
 * `linkGoogleIdentity`. The `requiresAuth` flag below is the only visible
 * difference; keep the call sites separate.
 */

/**
 * Exchanges a Google ID token (obtained natively by
 * `services/auth/google-sign-in.ts`) for a normal Short Drama session.
 * `POST /auth/google`.
 *
 * The Google token is a one-shot credential: it is sent once, here, and is
 * never persisted. The `AuthResponse` returned is the app's own
 * access/refresh pair and remains the only session authority - see
 * `stores/auth.tsx`.
 *
 * Answers 200 whether it signed in or signed up; the status deliberately
 * does not vary by outcome, because a varying one would be an
 * account-existence oracle.
 *
 * Error codes: "INVALID_GOOGLE_TOKEN" (401) for any verification failure -
 * bad signature, wrong audience, expired, bad issuer - deliberately not
 * split; "AUTH_ACCOUNT_LINK_REQUIRED" (409) when the Google account's
 * verified email already belongs to an existing Short Drama account, which
 * is recoverable only by signing into that account and calling
 * `linkGoogleIdentity`; "GOOGLE_AUTH_DISABLED" (503) when the server has no
 * Google configuration.
 */
export async function loginWithGoogleIdToken(idToken: string): Promise<AuthResponse> {
  return request<AuthResponse>('auth/google', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ idToken }),
  });
}

/**
 * Asks the backend to deliver a one-time code over WhatsApp to `phoneE164`
 * (already normalized by `services/auth/phone-number.ts`).
 * `POST /auth/whatsapp/otp/request`.
 *
 * Returns timing constants only - deliberately no challenge id (the phone
 * number is the handle; see `OtpChallenge`) and no "this number is
 * registered" signal.
 *
 * Error codes: "INVALID_PHONE_NUMBER" (400) - a shape check with no
 * database access; "OTP_RESEND_COOLDOWN" (429) for the per-number cooldown
 * or the rolling per-hour budget; a generic 429 with code "HTTP_ERROR" from
 * the per-IP route throttle (3 per 10 minutes), which is the limit an
 * ordinary user actually reaches, so callers check `error.status` before
 * `error.code`; "WHATSAPP_AUTH_DISABLED" (503) when WhatsApp is not
 * configured on the server.
 */
export async function startWhatsAppOtp(phoneE164: string): Promise<OtpChallenge> {
  const payload = await request<unknown>('auth/whatsapp/otp/request', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone: phoneE164 }),
  });

  // Validated, not cast - and validated by the SHARED parser in
  // `services/auth/otp-challenge.ts`, because the account-deletion OTP route
  // answers this identical shape and two copies of the check are two things
  // that can drift. See that module for why a malformed payload throws
  // instead of defaulting.
  return parseOtpChallenge(payload, PARSE_SOURCE);
}

/**
 * Verifies a WhatsApp OTP and returns a normal Short Drama session.
 * `POST /auth/whatsapp/otp/verify`, body `{ phone, code }` - the number is
 * the challenge handle.
 *
 * SIGN-IN, NOT LINKING. This authenticates AS the phone's own account and
 * replaces whatever session is current. To attach a number to the account
 * already signed in, call `linkWhatsAppIdentity` instead.
 *
 * Error codes: "INVALID_OTP" (401) - one code covering wrong, expired,
 * attempts-exhausted, already-used and no-challenge alike. That is
 * deliberate and must not be worked around: splitting it would tell an
 * attacker whether their guessing is making progress, and distinguishing
 * "wrong code" from "no challenge for this number" would turn this endpoint
 * into a phone-number enumeration oracle. Also "INVALID_PHONE_NUMBER"
 * (400), a generic 429 ("HTTP_ERROR") from the per-IP verify throttle
 * (5/min), and "WHATSAPP_AUTH_DISABLED" (503).
 */
export async function verifyWhatsAppOtp(phoneE164: string, code: string): Promise<AuthResponse> {
  return request<AuthResponse>('auth/whatsapp/otp/verify', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ phone: phoneE164, code }),
  });
}

/**
 * Lists the identities attached to the signed-in account, for the Account
 * Security screen's "Metode Login" card. `GET /auth/identities`. Requires
 * auth.
 */
export async function listAuthIdentities(): Promise<readonly AuthIdentitySummary[]> {
  const payload = await request<unknown>(
    'auth/identities',
    { method: 'GET' },
    { requiresAuth: true }
  );

  return parseAuthIdentities(payload);
}

/**
 * Validates the identity list at the boundary, for the same reason
 * `parseOtpChallenge` does: two of these fields drive whether a destructive
 * control is offered. A missing `canBeUnlinked` would arrive as `undefined`
 * and read as "not unlinkable", which is the safe direction but hides the
 * mismatch; a missing `provider` would render a row for nothing at all.
 *
 * `provider` is checked as a non-empty STRING, not against the known union:
 * an unfamiliar provider (a future `apple`) is a row this client cannot
 * render, and `features/auth/linked-methods.ts` already drops it from both
 * the rendering and the unlink-guard count. Rejecting the whole payload
 * here would take out the identities the client CAN render along with it.
 */
function parseAuthIdentities(payload: unknown): readonly AuthIdentitySummary[] {
  if (!Array.isArray(payload)) {
    throw invalidOtpResponse(PARSE_SOURCE, 'Auth identity list payload is not an array.');
  }

  return payload.map((entry) => {
    if (typeof entry !== 'object' || entry === null) {
      throw invalidOtpResponse(PARSE_SOURCE, 'Auth identity entry is not an object.');
    }

    const { provider, identifier, usable, canBeUnlinked, createdAt, verifiedAt } = entry as Record<
      string,
      unknown
    >;

    if (
      typeof provider !== 'string' ||
      provider.length === 0 ||
      (identifier !== null && typeof identifier !== 'string') ||
      typeof usable !== 'boolean' ||
      typeof canBeUnlinked !== 'boolean' ||
      typeof createdAt !== 'string' ||
      (verifiedAt !== null && typeof verifiedAt !== 'string')
    ) {
      throw invalidOtpResponse(PARSE_SOURCE, 'Auth identity entry has an invalid shape.');
    }

    return {
      provider: provider as AuthProviderId,
      identifier,
      usable,
      canBeUnlinked,
      createdAt,
      verifiedAt,
    };
  });
}

/**
 * Attaches a Google identity to the ALREADY SIGNED-IN account.
 * `POST /auth/identities/google/link`. Requires auth.
 *
 * This is the recovery path for "AUTH_ACCOUNT_LINK_REQUIRED" on
 * `loginWithGoogleIdToken`: matching email addresses never merge accounts,
 * so proving control of the Short Drama account (the bearer token) and of
 * the Google account (the ID token) in one request is the only supported
 * way to join them.
 *
 * Returns the account's full, updated identity list.
 *
 * Error codes: "INVALID_GOOGLE_TOKEN" (401); "AUTH_IDENTITY_ALREADY_LINKED"
 * (409) when that Google account already belongs to a DIFFERENT Short Drama
 * account - never transferred, and the one refusal here a person can
 * actually act on; "AUTH_PROVIDER_ALREADY_LINKED" (409) when this account
 * already has a different Google identity; "GOOGLE_AUTH_DISABLED" (503).
 * Re-linking the identity this account already owns is an idempotent
 * success, not a 409.
 */
export async function linkGoogleIdentity(
  idToken: string
): Promise<readonly AuthIdentitySummary[]> {
  const payload = await request<unknown>(
    'auth/identities/google/link',
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ idToken }) },
    { requiresAuth: true }
  );

  return parseAuthIdentities(payload);
}

/**
 * Attaches a WhatsApp identity to the ALREADY SIGNED-IN account.
 * `POST /auth/identities/whatsapp/link`. Requires auth.
 *
 * NOT `verifyWhatsAppOtp`. Both consume the same challenge for a number, so
 * calling verify here would silently sign the viewer OUT of the account
 * they are trying to extend and INTO the phone's own account. Start the
 * challenge with `startWhatsAppOtp` exactly as the login flow does, then
 * finish it here.
 *
 * Returns the account's full, updated identity list.
 *
 * Error codes: "INVALID_OTP" (401, single generic code - see
 * `verifyWhatsAppOtp`); "INVALID_PHONE_NUMBER" (400);
 * "AUTH_IDENTITY_ALREADY_LINKED" (409) when that number already belongs to
 * a different account; "AUTH_PROVIDER_ALREADY_LINKED" (409) when this
 * account already has a different number; "WHATSAPP_AUTH_DISABLED" (503).
 */
export async function linkWhatsAppIdentity(
  phoneE164: string,
  code: string
): Promise<readonly AuthIdentitySummary[]> {
  const payload = await request<unknown>(
    'auth/identities/whatsapp/link',
    { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ phone: phoneE164, code }) },
    { requiresAuth: true }
  );

  return parseAuthIdentities(payload);
}

/**
 * Detaches one identity from the signed-in account.
 * `DELETE /auth/identities/:provider`. Requires auth.
 *
 * Answers 200 with the caller's full, updated identity list rather than 204
 * - after removing a sign-in method the very next thing the UI must know is
 * what remains and what is still removable, and a 204 would force a second
 * request and leave a window where every `canBeUnlinked` flag is stale.
 * Callers must REPLACE their list with the returned one, not mutate a copy.
 *
 * `provider` is narrowed to the linkable set because the backend rejects
 * `email` with a 400: an email identity's lifecycle belongs to register /
 * change-password / password-reset / account-deletion.
 *
 * The client also hides this action for an identity the server marked
 * `canBeUnlinked: false` (`features/auth/linked-methods.ts`), which keeps a
 * viewer from locking themselves out through the UI. That is a usability
 * guard, NOT the security boundary: the backend enforces the same invariant
 * and answers "AUTH_LAST_IDENTITY" (409) if a stale UI ever asks it to
 * remove the final usable one. "AUTH_IDENTITY_NOT_FOUND" (404) when the
 * caller has no identity for that provider.
 */
export async function unlinkAuthIdentity(
  provider: LinkableAuthProviderId
): Promise<readonly AuthIdentitySummary[]> {
  const payload = await request<unknown>(
    `auth/identities/${provider}`,
    { method: 'DELETE' },
    { requiresAuth: true }
  );

  return parseAuthIdentities(payload);
}
