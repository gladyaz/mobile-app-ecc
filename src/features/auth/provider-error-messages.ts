import { ApiError } from '@/services/api/client';
import type { TranslationKey } from '@/services/i18n/translations';
import type { LinkableAuthProviderId } from '@/types/auth';

/**
 * The canonical backend error vocabulary, mapped to the one thing a viewer
 * can act on. Kept in a single pure module so the three surfaces that meet
 * these codes - the login screen, the WhatsApp login screen and the Account
 * Security card - cannot drift into three different answers for one code,
 * and so the mapping can be tested without rendering anything.
 *
 * Two rules run through all of it:
 *
 * 1. **A code the backend was specific about gets a specific message.** The
 *    server distinguishes "that Google account belongs to someone else"
 *    from "you already linked a different one" precisely so a person can
 *    tell them apart; collapsing either into "gagal" turns a correct,
 *    actionable refusal into an unexplained dead end.
 *
 * 2. **A code the backend was deliberately vague about stays vague.**
 *    `INVALID_OTP` covers wrong / expired / attempts-exhausted /
 *    already-used / no-such-challenge, and `INVALID_GOOGLE_TOKEN` covers
 *    every verification failure. Splitting either client-side would be
 *    inventing a distinction the server refuses to make - the OTP one would
 *    turn verification into a phone-number enumeration oracle.
 *
 * STATUS IS CHECKED BEFORE CODE for 429. The per-IP route throttles are
 * applied by the framework and carry the generic `HTTP_ERROR` code, not
 * `OTP_RESEND_COOLDOWN`, so status is the only reliable signal there.
 */

const HTTP_TOO_MANY_REQUESTS = 429;

function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === HTTP_TOO_MANY_REQUESTS;
}

function codeOf(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/**
 * `POST /auth/google` failures, as the login screen reports them.
 *
 * `AUTH_ACCOUNT_LINK_REQUIRED` is the one that must not be generic: it
 * means an account already exists for this email address, and the ONLY
 * supported way forward is to sign in with the existing method and link
 * Google from Account Security. The copy says exactly that, and the control
 * it points at exists (`linked-methods-card.tsx`). Matching email addresses
 * never merge accounts - a message that implied otherwise would send people
 * to demand the boundary be weakened.
 */
export function describeGoogleLoginError(error: unknown): TranslationKey {
  switch (codeOf(error)) {
    case 'AUTH_ACCOUNT_LINK_REQUIRED':
      return 'login.googleLinkRequired';
    case 'GOOGLE_AUTH_DISABLED':
      return 'login.googleDisabled';
    case 'INVALID_GOOGLE_TOKEN':
      return 'login.googleRejected';
    default:
      return 'login.googleFailed';
  }
}

/**
 * `POST /auth/whatsapp/otp/request` failures.
 *
 * The 429 branch comes first and covers both limiters that can produce one:
 * the per-number cooldown (`OTP_RESEND_COOLDOWN`) and the per-IP route
 * throttle (3 per 10 minutes, generic `HTTP_ERROR`) - the latter being the
 * one an ordinary user actually reaches after one send and two resends.
 * They get the same copy because the honest advice is identical, and
 * because a "next acceptance" estimate would require reading the number's
 * recent request history back to the caller.
 */
export function describeOtpRequestError(error: unknown): TranslationKey {
  if (isRateLimited(error)) {
    return 'whatsapp.tooManyRequests';
  }

  switch (codeOf(error)) {
    case 'WHATSAPP_AUTH_DISABLED':
      return 'whatsapp.disabled';
    /**
     * DELIVERY DEFINITIVELY FAILED, and it is not about this number.
     *
     * The backend returns this for a transport error, a 5xx, an expired
     * access token, or a template that does not exist or is paused - causes
     * that answer identically for every recipient, which is why it can be
     * reported specifically without becoming a phone-number oracle the way a
     * per-number reason would.
     *
     * IT GETS ITS OWN COPY BECAUSE THE ADVICE IS DIFFERENT. No challenge
     * survives this response - the backend withdraws the row before throwing,
     * so no cooldown is spent and no slot is taken from the number's hourly
     * budget. "Try again" is therefore true and immediate here, where for a
     * 429 it would be a lie. The screen leaves resend enabled for exactly
     * this reason: only the 429 branch re-locks the countdown.
     */
    case 'WHATSAPP_PROVIDER_UNAVAILABLE':
      return 'whatsapp.providerUnavailable';
    case 'INVALID_PHONE_NUMBER':
      return 'whatsapp.phoneInvalid';
    default:
      return 'whatsapp.sendFailed';
  }
}

/**
 * `POST /auth/whatsapp/otp/verify` (and the WhatsApp LINK route, which
 * answers the same codes) failures.
 *
 * One message for `INVALID_OTP`, deliberately. It has to cover a wrong
 * code, an expired one, an exhausted attempt budget and a challenge that
 * never existed, without implying which - so it names the two causes a
 * person can do something about and offers the action that resolves all of
 * them: request a new code.
 *
 * The 429 branch is NOT dead and must not be removed with the collapse
 * above: a 429 seen here is the per-IP VERIFY throttle (5/min), a genuinely
 * different condition from a rejected code, and waiting is the only thing
 * that helps. The resend cooldown is a separate 429 on the START route,
 * handled by `describeOtpRequestError`.
 */
export function describeOtpVerifyError(error: unknown): TranslationKey {
  if (isRateLimited(error)) {
    return 'whatsapp.verifyTooMany';
  }

  switch (codeOf(error)) {
    case 'INVALID_OTP':
      return 'whatsapp.otpRejected';
    case 'WHATSAPP_AUTH_DISABLED':
      return 'whatsapp.disabled';
    case 'INVALID_PHONE_NUMBER':
      return 'whatsapp.phoneInvalid';
    default:
      return 'whatsapp.verifyFailed';
  }
}

/**
 * `POST /auth/identities/:provider/link` failures.
 *
 * The two 409s are different facts and get different copy:
 *
 * - `AUTH_IDENTITY_ALREADY_LINKED` - that Google account / phone number
 *   already belongs to a DIFFERENT Short Drama account. The backend never
 *   transfers an identity, so the resolution is on the other account, not
 *   this one. This is the security-relevant refusal and the message says
 *   what actually happened.
 * - `AUTH_PROVIDER_ALREADY_LINKED` - THIS account already has a different
 *   identity for that provider. Nothing is wrong with the credential just
 *   proved; the account simply cannot hold two.
 *
 * Re-linking the identity the account already owns is an idempotent
 * success on the backend, so it never reaches here.
 */
export function describeIdentityLinkError(
  error: unknown,
  provider: LinkableAuthProviderId
): TranslationKey {
  if (isRateLimited(error)) {
    return provider === 'whatsapp' ? 'whatsapp.verifyTooMany' : 'authMethods.linkFailed';
  }

  switch (codeOf(error)) {
    case 'AUTH_IDENTITY_ALREADY_LINKED':
      return 'authMethods.identityOwnedByAnotherAccount';
    case 'AUTH_PROVIDER_ALREADY_LINKED':
      return 'authMethods.providerAlreadyLinked';
    case 'INVALID_GOOGLE_TOKEN':
      return 'login.googleRejected';
    case 'GOOGLE_AUTH_DISABLED':
      return 'login.googleDisabled';
    case 'WHATSAPP_AUTH_DISABLED':
      return 'whatsapp.disabled';
    case 'INVALID_OTP':
      return 'whatsapp.otpRejected';
    case 'INVALID_PHONE_NUMBER':
      return 'whatsapp.phoneInvalid';
    default:
      return 'authMethods.linkFailed';
  }
}

/**
 * `DELETE /auth/identities/:provider` failures.
 *
 * `AUTH_LAST_IDENTITY` is reachable even though the card hides the control
 * for an identity the server marked `canBeUnlinked: false`: the list a
 * client is holding can be one action out of date. When it happens, the
 * message must be the truthful one - this is the only way in - and never
 * imply the app could remove it if it tried again.
 */
export function describeUnlinkError(error: unknown): TranslationKey {
  switch (codeOf(error)) {
    case 'AUTH_LAST_IDENTITY':
      return 'authMethods.lastMethod';
    case 'AUTH_IDENTITY_NOT_FOUND':
      return 'authMethods.identityNotFound';
    default:
      return 'authMethods.unlinkFailed';
  }
}
