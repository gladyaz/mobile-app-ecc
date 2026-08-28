import { ApiError } from '@/services/api/client';
import type { OtpChallenge } from '@/types/auth';

/**
 * The boundary check for every WhatsApp OTP challenge payload this app
 * receives, wherever it came from.
 *
 * TWO ROUTES ISSUE THIS SHAPE, and they are NOT interchangeable:
 *   - `POST /auth/whatsapp/otp/request`        -> sign-in challenge
 *   - `POST /users/me/deletion/whatsapp/otp`   -> account-deletion challenge
 *
 * The backend deliberately answers both with the identical
 * `WhatsAppOtpRequestResponseDto` (`{ success, expiresInSeconds,
 * resendAvailableInSeconds }`) so a client needs ONE implementation of the
 * countdown, the resend rule and the failure copy. This module is that one
 * implementation. What must stay separate is the ENDPOINT and the resulting
 * challenge's purpose namespace - a deletion code lives in the backend's
 * `account_deletion` namespace and cannot mint a session - not the response
 * parsing, and duplicating the parser is how the two would drift.
 *
 * WHY IT VALIDATES INSTEAD OF CASTING. Both timing fields feed arithmetic in
 * `features/auth/use-otp-resend-countdown.ts`, so a backend that omitted
 * `resendAvailableInSeconds` produced NaN, a countdown that never finished,
 * and a permanently disabled "resend" button - a dead end for the viewer,
 * from a payload TypeScript was perfectly happy with. The canonical contract
 * now guarantees both fields, which is a reason to keep checking them at the
 * boundary rather than to stop: a boundary check is how a contract drift
 * surfaces as one legible error instead of as arithmetic on `undefined`.
 *
 * `success` is checked too, because the backend sends it and a payload
 * without it is not the response this function claims to return.
 *
 * It THROWS rather than substituting defaults: an invented countdown would
 * hide the contract mismatch, and every caller already renders a real "code
 * could not be sent" error state.
 */

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * `source` names the module that received the payload, so a contract drift
 * points at the endpoint that drifted rather than at this shared helper.
 */
export function invalidOtpResponse(source: string, detail: string): ApiError {
  return new ApiError(0, 'INVALID_RESPONSE', `[${source}] ${detail}`);
}

export function parseOtpChallenge(payload: unknown, source: string): OtpChallenge {
  if (typeof payload !== 'object' || payload === null) {
    throw invalidOtpResponse(source, 'WhatsApp OTP challenge payload is not an object.');
  }

  const { success, expiresInSeconds, resendAvailableInSeconds } = payload as Record<
    string,
    unknown
  >;

  if (
    success !== true ||
    !isFiniteNumber(expiresInSeconds) ||
    !isFiniteNumber(resendAvailableInSeconds)
  ) {
    throw invalidOtpResponse(source, 'WhatsApp OTP challenge payload has an invalid shape.');
  }

  return { expiresInSeconds, resendAvailableInSeconds };
}
