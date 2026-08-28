import { request } from '@/services/api/client';
import { invalidOtpResponse, parseOtpChallenge } from '@/services/auth/otp-challenge';
import type { OtpChallenge } from '@/types/auth';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** Names this module in every boundary-validation failure it raises. */
const PARSE_SOURCE = 'account-deletion-service';

/**
 * V1 PROVIDER ACCOUNT DELETION - the whole client half of the backend's
 * account-deletion surface, reconciled against that repository's
 * `docs/ACCOUNT_DELETION.md`, `src/auth/account-deletion.controller.ts`,
 * `src/auth/dto/account-deletion.dto.ts` and
 * `src/auth/deletion/deletion-authorization.service.ts` @ fd3c86c.
 *
 * ===================== WHAT THIS REPLACES =====================
 *
 * This module used to expose exactly one function taking exactly one thing:
 * `deleteMyAccount(currentPassword)`. Both of V1's headline sign-in methods
 * (Google Login, WhatsApp Login) create accounts with NO password, so the two
 * ways most viewers get in were also two ways to own an account this app
 * could not delete - and the screen rendered the backend's refusal as
 * "Password saat ini salah." to somebody who never had a password. The
 * backend now accepts a proof appropriate to the identity; this module is how
 * the app asks for one.
 *
 * ===================== THE THREE ROUTES =====================
 *
 *   GET  /users/me/deletion/methods       -> `fetchDeletionMethods`
 *   POST /users/me/deletion/whatsapp/otp  -> `requestWhatsAppDeletionOtp`
 *   POST /users/me/deletion               -> `deleteMyAccount`
 *
 * All three require auth. Nothing here fabricates a success path: every
 * function propagates `ApiError` untouched for the screen to report, exactly
 * as `provider-auth-service.ts` does.
 */

/**
 * The proofs the backend can verify, in the order it returns them. Mirrors
 * `DELETION_PROOF_METHODS` in the backend's
 * `auth/deletion/deletion-authorization.types.ts`.
 *
 * ORDER IS PART OF THE CONTRACT: the backend sorts its answer by this list
 * rather than by row order specifically so a client can render the first
 * entry as its default and get a stable one.
 */
export const DELETION_PROOF_METHODS = ['password', 'google', 'whatsapp'] as const;

export type DeletionProofMethod = (typeof DELETION_PROOF_METHODS)[number];

/**
 * ONE ENDPOINT, ONE DISCRIMINATED PROOF - the same shape the backend's
 * `AccountDeletionDto` uses, and for the same reason: the action, the
 * confirmation semantics, the rate limit and the role rule are identical for
 * all three methods, and only the evidence differs.
 *
 * A UNION, NOT AN OBJECT OF OPTIONAL FIELDS, so it is not representable for a
 * caller to send a Google deletion carrying a password, or a WhatsApp
 * deletion carrying no code. The backend ignores proof fields that do not
 * belong to `method` (it reads only the one the method names, so no request
 * can downgrade its own proof by including a weaker one) - this type means
 * this client never sends one in the first place.
 */
export type DeletionProof =
  | { readonly method: 'password'; readonly currentPassword: string }
  | { readonly method: 'google'; readonly idToken: string }
  | { readonly method: 'whatsapp'; readonly code: string };

/**
 * Which proofs THIS account can produce on THIS server, right now.
 * `GET /users/me/deletion/methods`.
 *
 * THE ROUTE THAT MAKES THE OTHER TWO USABLE. The app cannot know whether to
 * render a password field, a "continue with Google" button or a "send me a
 * code" button without asking, because the answer depends both on which
 * identities the account owns AND on which providers the server can currently
 * verify. Deriving it client-side from `GET /auth/identities` (the guess this
 * screen used to make - "does it have an `email` identity?") is a
 * re-derivation of a server-side policy, which is the exact class of
 * duplicated rule that produced the defect this work fixes. It also cannot
 * see the provider feature flags at all: a Google-only account on a server
 * with `GOOGLE_AUTH_ENABLED=false` genuinely has no verifiable proof, and
 * only the server knows that.
 *
 * AN EMPTY LIST IS A TRUTHFUL ANSWER, not an error, and callers must render
 * it as one - "this account has no in-app deletion proof available, here is
 * the support route" - rather than as a failure to retry.
 *
 * Returns only method NAMES. No email, no phone, no Google `sub`; a screen
 * that needs a display identifier reads the masked one from
 * `GET /auth/identities`.
 */
export async function fetchDeletionMethods(): Promise<readonly DeletionProofMethod[]> {
  const payload = await request<unknown>(
    'users/me/deletion/methods',
    { method: 'GET' },
    { requiresAuth: true }
  );

  return parseDeletionMethods(payload);
}

/**
 * Validates the method list at the boundary instead of casting it, for the
 * same reason `parseAuthIdentities` does: this payload decides which
 * destructive control is offered, and a malformed one must surface as one
 * legible error rather than as a screen that silently offers nothing.
 *
 * AN UNRECOGNIZED METHOD IS DROPPED, NOT REJECTED. A future fourth proof (an
 * `apple`) is one this build cannot render a panel for, and taking out the
 * whole list - including the methods this client CAN produce - would turn a
 * forward-compatible server into a broken screen. Same policy, and the same
 * reasoning, as `parseAuthIdentities`'s handling of an unfamiliar provider.
 *
 * The result is re-sorted into `DELETION_PROOF_METHODS` order rather than
 * trusted to arrive sorted: callers render the first entry as the default,
 * and a default that moved because a server changed its row order would be a
 * different screen for the same account.
 */
function parseDeletionMethods(payload: unknown): readonly DeletionProofMethod[] {
  if (typeof payload !== 'object' || payload === null) {
    throw invalidOtpResponse(PARSE_SOURCE, 'Deletion methods payload is not an object.');
  }

  const { methods } = payload as Record<string, unknown>;

  if (!Array.isArray(methods)) {
    throw invalidOtpResponse(PARSE_SOURCE, 'Deletion methods payload has no `methods` array.');
  }

  const known = new Set(
    methods.filter((entry): entry is DeletionProofMethod =>
      DELETION_PROOF_METHODS.includes(entry as DeletionProofMethod)
    )
  );

  return DELETION_PROOF_METHODS.filter((method) => known.has(method));
}

/**
 * Asks the backend to deliver an ACCOUNT-DELETION code over WhatsApp.
 * `POST /users/me/deletion/whatsapp/otp`. Requires auth. Answers `202`.
 *
 * NOT `startWhatsAppOtp`, AND THE DIFFERENCE IS THE SECURITY PROPERTY.
 * `POST /auth/whatsapp/otp/request` issues a code in the backend's `login`
 * purpose namespace - a code that can mint a SESSION. This route issues one
 * in the `account_deletion` namespace, which `POST /auth/whatsapp/otp/verify`
 * cannot even see. Submitting a login code as a deletion proof simply fails
 * (`INVALID_OTP`), because the deletion claim only ever looks in its own
 * namespace; submitting a deletion code to the login verify route would sign
 * the viewer in rather than delete anything. Keep the two call sites separate.
 *
 * THERE IS NO `phone` PARAMETER, and that absence is deliberate on both
 * sides. The number is read from the authenticated caller's own linked
 * `AuthIdentity`, which is what binds the challenge to this account and keeps
 * this authenticated route from becoming a way to send WhatsApp messages to
 * arbitrary numbers. This client therefore has nothing to pass and no way to
 * redirect the code.
 *
 * Returns the same timing constants the login challenge does, so
 * `features/auth/use-otp-resend-countdown.ts` drives the resend button
 * unchanged.
 *
 * Error codes: "ACCOUNT_DELETION_METHOD_UNAVAILABLE" (409) when the account
 * has no linked number or the server has WhatsApp disabled;
 * "OTP_RESEND_COOLDOWN" (429) for the per-number cooldown or rolling budget;
 * a generic 429 with code "HTTP_ERROR" from the per-IP route throttle (the
 * same 3-per-10-minutes budget the login route carries - callers check
 * `error.status` before `error.code`); "WHATSAPP_PROVIDER_UNAVAILABLE" (503)
 * when delivery itself failed.
 */
export async function requestWhatsAppDeletionOtp(): Promise<OtpChallenge> {
  const payload = await request<unknown>(
    'users/me/deletion/whatsapp/otp',
    { method: 'POST', headers: JSON_HEADERS },
    { requiresAuth: true }
  );

  return parseOtpChallenge(payload, PARSE_SOURCE);
}

/**
 * Permanently deletes the current user's account. `POST /users/me/deletion`.
 * IMMEDIATE and IRREVERSIBLE - no grace period, no cancellation endpoint. On
 * success every session for this account (including this device's own) is
 * revoked and the account row itself is gone.
 *
 * `confirmDeletion` is ALWAYS sent as the literal boolean `true` - this
 * function has no parameter for it, by design: the backend's
 * `AccountDeletionDto` requires the exact boolean (`@IsBoolean()` +
 * `@Equals(true)` - not a truthy value, and not the string `"true"`), so
 * there is no legitimate reason for this client to ever send anything else.
 * It is an INTENT flag and never a credential: it is required in ADDITION to
 * a real proof, never instead of one. The human-facing confirmation gate
 * belongs entirely in the calling screen (an explicit, unmissable "this is
 * permanent and cannot be undone" dialog shown BEFORE this is called).
 *
 * THE PASSWORD REQUEST IS BYTE-FOR-BYTE WHAT IT ALWAYS WAS: `{
 * currentPassword, confirmDeletion: true }`, with NO `method` field. The
 * backend defaults `method` to `password` precisely so every existing client
 * keeps working, and sending the field explicitly would gain nothing while
 * making this client's password path depend on a body shape older deployments
 * reject (their `ValidationPipe` runs `forbidNonWhitelisted` against a DTO
 * with no `method` property). Google and WhatsApp name their method, because
 * for them there is no default to inherit.
 *
 * Throws `ApiError` with:
 * - "INVALID_CREDENTIALS" (401) - wrong `currentPassword`. The same generic
 *   code `login()`/`changePassword()` use.
 * - "INVALID_GOOGLE_TOKEN" (401) - the Google credential did not verify (bad
 *   signature, wrong audience, expired, bad issuer - deliberately not split).
 * - "INVALID_OTP" (401) - the deletion code was wrong, expired, already used,
 *   or its attempt budget is exhausted. ONE code covering all four, by
 *   backend design; a client must not split it, because a client that could
 *   would be reporting a distinction the server refuses to make.
 * - "ACCOUNT_DELETION_PROOF_MISMATCH" (401) - the credential verified but
 *   belongs to a DIFFERENT identity than this account's. This is the Google
 *   "you signed in with the wrong Google account" case, and it is a distinct
 *   code from `INVALID_GOOGLE_TOKEN` precisely so it can be said plainly.
 * - "ACCOUNT_DELETION_METHOD_UNAVAILABLE" (409) - this account cannot produce
 *   the named proof (no password / no linked identity / provider disabled
 *   server-side). The honest answer that replaced the old, false
 *   "INVALID_CREDENTIALS" for passwordless accounts; the fix is to re-read
 *   `fetchDeletionMethods()` and offer what the account can actually use.
 * - "INVALID_ACCESS_TOKEN" (401) - the account no longer exists, including a
 *   repeated call on an already-deleted one (no distinct "already deleted"
 *   oracle, by design - the same generic "vanished user" code
 *   `GET /users/me/export` throws for the identical condition).
 * - "ACCOUNT_DELETION_FORBIDDEN" (403) - this account's role is not a plain
 *   "user" (e.g. an admin/operator account); self-service deletion is
 *   deliberately not available for those roles.
 * - status 429 (generic "HTTP_ERROR" code - the backend's throttler emits no
 *   endpoint-specific code, so `error.status` and not `error.code` is the
 *   only reliable signal here) once the dedicated 5-calls-per-15-minutes
 *   limit is exceeded.
 */
export async function deleteMyAccount(proof: DeletionProof): Promise<void> {
  await request<{ success: true }>(
    'users/me/deletion',
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ ...toProofBody(proof), confirmDeletion: true }),
    },
    { requiresAuth: true }
  );
}

/**
 * The one place a `DeletionProof` becomes wire fields. Exhaustive over the
 * union, so adding a fourth method fails to compile here rather than sending
 * a body with no proof in it.
 */
function toProofBody(proof: DeletionProof): Record<string, string> {
  switch (proof.method) {
    case 'password':
      // No `method` field - see the doc comment above for why the password
      // body stays exactly what it has always been.
      return { currentPassword: proof.currentPassword };
    case 'google':
      return { method: 'google', idToken: proof.idToken };
    case 'whatsapp':
      return { method: 'whatsapp', code: proof.code };
  }
}
