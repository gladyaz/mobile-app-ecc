import { ApiError, request } from '@/services/api/client';
import type { AuthProviderId, AuthResponse, LinkedAuthMethod, OtpChallenge } from '@/types/auth';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * The ONE place the app talks to the backend's provider-auth surface
 * (Google, WhatsApp OTP, account linking). Screens never call `fetch` or
 * `request` for these flows - they call `stores/auth.tsx` or this module -
 * so when the backend worktree lands its final contract, reconciliation is
 * bounded to this file plus the endpoint table in docs/api-contract.md.
 *
 * PROVISIONAL CONTRACT. Every path, request body and error code below is
 * the mobile side's proposal, mirrored from the shapes the already-landed
 * `/auth/*` endpoints use (`AuthResponse` in `types/auth.ts`). None of it
 * is confirmed by a deployed backend yet, so:
 * - nothing here fabricates a success path when the network fails - each
 *   function propagates `ApiError` exactly as `auth-service.ts` does, and
 *   callers surface a real error state;
 * - no endpoint here is called anywhere outside this module.
 *
 * Anti-enumeration rule (WhatsApp): `startWhatsAppOtp` must answer
 * identically for a phone number that has an account and one that does
 * not. This module therefore returns only a challenge handle - never an
 * "account exists" flag - and callers must not branch their UI on
 * anything that could reconstruct one.
 */

/**
 * Exchanges a Google ID token (obtained natively by
 * `services/auth/google-sign-in.ts`) for a normal Short Drama session.
 *
 * The Google token is a one-shot credential: it is sent once, here, and is
 * never persisted. The `AuthResponse` returned is the app's own
 * access/refresh pair and remains the only session authority - see
 * `stores/auth.tsx`.
 *
 * Expected error codes: "INVALID_PROVIDER_TOKEN" (401) for a token the
 * backend cannot verify, "PROVIDER_ACCOUNT_CONFLICT" (409) when the Google
 * account's email already belongs to an account it may not auto-link to.
 */
export async function loginWithGoogleIdToken(idToken: string): Promise<AuthResponse> {
  return request<AuthResponse>('auth/providers/google', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ idToken }),
  });
}

/**
 * Asks the backend to deliver a one-time code over WhatsApp to `phoneE164`
 * (already normalized by `services/auth/phone-number.ts`).
 *
 * Returns only a challenge handle plus timing hints. Deliberately no
 * "this number is registered" signal - see the anti-enumeration rule in
 * this module's header.
 *
 * Expected error codes: "INVALID_PHONE_NUMBER" (400), and status 429 when
 * the send rate limit is hit (the backend's throttler emits no
 * endpoint-specific code, so callers check `error.status`, matching the
 * account-deletion precedent in docs/api-contract.md).
 */
export async function startWhatsAppOtp(phoneE164: string): Promise<OtpChallenge> {
  const payload = await request<unknown>('auth/providers/whatsapp/start', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phoneE164 }),
  });

  return parseOtpChallenge(payload);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates the OTP challenge payload instead of casting it.
 *
 * This is the one place in the provider surface where an unchecked cast had
 * teeth: the two timing fields feed arithmetic in
 * `features/auth/use-otp-resend-countdown.ts`, so a backend that omitted
 * `resendAvailableInSeconds` produced NaN, a countdown that never finished,
 * and a permanently disabled "resend" button - a dead end for the viewer,
 * from a payload that looked fine to TypeScript. The contract behind this
 * endpoint is still PROVISIONAL, which is exactly why it is checked at the
 * boundary rather than trusted.
 *
 * Throws (rather than substituting defaults) on a malformed payload: an
 * invented countdown would hide the contract mismatch, and the caller
 * already renders a real "code could not be sent" error state. Follows the
 * same shape-validation precedent as `parseAdsConfig` in
 * `services/ads/ads-config-service.ts`, which differs only in that ads
 * pacing has a safe default and a login challenge does not.
 */
function parseOtpChallenge(payload: unknown): OtpChallenge {
  if (typeof payload !== 'object' || payload === null) {
    throw new ApiError(
      0,
      'INVALID_RESPONSE',
      '[provider-auth-service] WhatsApp OTP challenge payload is not an object.'
    );
  }

  const { challengeId, expiresInSeconds, resendAvailableInSeconds } = payload as Record<
    string,
    unknown
  >;

  if (
    typeof challengeId !== 'string' ||
    challengeId.length === 0 ||
    !isFiniteNumber(expiresInSeconds) ||
    !isFiniteNumber(resendAvailableInSeconds)
  ) {
    throw new ApiError(
      0,
      'INVALID_RESPONSE',
      '[provider-auth-service] WhatsApp OTP challenge payload has an invalid shape.'
    );
  }

  return { challengeId, expiresInSeconds, resendAvailableInSeconds };
}

/**
 * Verifies a WhatsApp OTP and returns a normal Short Drama session.
 *
 * Expected error codes: "OTP_INVALID" (401) for a wrong code,
 * "OTP_EXPIRED" (410) once the challenge is past its `expiresInSeconds`,
 * "OTP_TOO_MANY_ATTEMPTS" (429) after the per-challenge attempt cap.
 */
export async function verifyWhatsAppOtp(challengeId: string, code: string): Promise<AuthResponse> {
  return request<AuthResponse>('auth/providers/whatsapp/verify', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ challengeId, code }),
  });
}

/**
 * Lists the login methods attached to the signed-in account, for the
 * Account Security screen's "Metode Login" card. Requires auth.
 */
export async function listLinkedAuthMethods(): Promise<readonly LinkedAuthMethod[]> {
  return request<readonly LinkedAuthMethod[]>(
    'auth/methods',
    { method: 'GET' },
    { requiresAuth: true }
  );
}

/**
 * Detaches one login method from the signed-in account. Requires auth.
 *
 * The client refuses to call this for the account's last usable method
 * (`features/auth/linked-methods.ts`'s `canUnlinkAuthMethod`), which keeps
 * a user from locking themselves out through the UI. That client-side rule
 * is a usability guard, NOT the security boundary: the backend is expected
 * to enforce the same invariant and answer "LAST_AUTH_METHOD" (409) if it
 * is ever asked to remove the final one.
 */
export async function unlinkAuthMethod(provider: AuthProviderId): Promise<void> {
  await request<void>(`auth/methods/${provider}`, { method: 'DELETE' }, { requiresAuth: true });
}
