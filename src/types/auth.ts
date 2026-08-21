/**
 * Mirrors the real backend's auth response shapes exactly (see
 * short-drama-backend `/auth/*` endpoints, canonical contract
 * `docs/auth-identity-api-contract.md` @ a695a9c). Any UI-layer conveniences
 * (e.g. a combined display name fallback) belong in the store/screen layer,
 * not here.
 */

/**
 * `email` is `string | null`, and the KEY IS ALWAYS PRESENT. That is a
 * contract decision, not a defensive widening: one shape for every account
 * means a consumer destructures unconditionally and only its TYPE has to
 * admit null. It is null for a WhatsApp-only account, and for a Google
 * account whose token did not assert `email_verified`.
 *
 * The backend never invents a synthetic address (`+62…@whatsapp.local` or
 * anything like it) for a phone-only account, because a fake address would
 * be indistinguishable from a real one to password reset and to the
 * account-collision check. Neither may this client: the human-readable label
 * for such an account is the MASKED `identifier` on `GET /auth/identities`.
 */
export type AuthUser = {
  readonly id: string;
  readonly email: string | null;
  readonly displayName?: string;
};

export type AuthTokens = {
  readonly accessToken: string;
  readonly refreshToken: string;
};

export type AuthResponse = AuthTokens & {
  readonly user: AuthUser;
};

/**
 * Mirrors the backend's `SessionSummaryDto` exactly (`GET /auth/sessions`,
 * Phase 12 work unit 12B-B2). Deliberately just the fields a "manage your
 * logged-in devices" UI needs - never a token hash, IP hash, or `userId`.
 * `userAgent`/`lastUsedAt` are nullable because a session created before
 * that work unit (or without request-context info) has neither.
 */
export type SessionSummary = {
  readonly id: string;
  readonly userAgent: string | null;
  readonly lastUsedAt: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
};

/**
 * Every login method the app can present. `email` is the built-in
 * email+password credential; `google` and `whatsapp` are the provider
 * logins added in Phase 10B. Deliberately a closed union - the Account
 * Security screen renders one row per member, so an unknown value from the
 * backend is a contract mismatch to surface, not a row to invent.
 */
export const AUTH_PROVIDER_IDS = ['email', 'google', 'whatsapp'] as const;

export type AuthProviderId = (typeof AUTH_PROVIDER_IDS)[number];

/**
 * Providers this client can attach to an already-authenticated account.
 *
 * `email` is deliberately absent: an email identity is inseparable from
 * `User.email`/`User.passwordHash`, whose lifecycle belongs to register /
 * change-password / password-reset / account-deletion. The backend rejects
 * `email` on the identity routes with a 400, so offering a control for it
 * would be offering an action that cannot succeed.
 */
export const LINKABLE_AUTH_PROVIDER_IDS = ['google', 'whatsapp'] as const;

export type LinkableAuthProviderId = (typeof LINKABLE_AUTH_PROVIDER_IDS)[number];

/**
 * One identity attached to the signed-in account - the backend's
 * `AuthIdentitySummaryDto`, mirrored field for field (`GET /auth/identities`,
 * and the body every link/unlink call returns).
 *
 * `identifier` is what the backend considers safe to SHOW for that identity:
 * the caller's own email address, a phone masked to its last four digits, or
 * `null` when the provider asserted nothing displayable (a Google account
 * whose email was not verified). The raw `providerSubject` - a Google `sub`,
 * an unmasked number - is never returned, so nothing here can identify
 * another account.
 *
 * `canBeUnlinked` is computed server-side by the exact rule `DELETE`
 * enforces, which makes it AUTHORITATIVE: a client that renders its button
 * off this flag and the server can never disagree. `features/auth/linked-methods.ts`
 * keeps a local recomputation as a fail-closed fallback only.
 *
 * `usable` reports whether the identity can currently be signed in with. No
 * path in the current backend produces an unusable one, so render it
 * defensively rather than as a state a viewer is expected to meet.
 */
export type AuthIdentitySummary = {
  readonly provider: AuthProviderId;
  readonly identifier: string | null;
  readonly usable: boolean;
  readonly canBeUnlinked: boolean;
  readonly createdAt: string;
  readonly verifiedAt: string | null;
};

/**
 * The result of asking the backend to send a WhatsApp OTP
 * (`POST /auth/whatsapp/otp/request`).
 *
 * There is NO challenge id, by design: a challenge is keyed by the phone
 * number and at most one is live per number (a database `UNIQUE` invariant),
 * so the number the screen already holds IS the handle. A second lookup key
 * for the same row would make it possible to address a challenge that is no
 * longer the live one.
 *
 * Carries no account-existence signal on purpose: an unregistered number and
 * a registered one must produce the identical response, so nothing here (or
 * in the UI that renders it) can be used to probe who has an account. Both
 * timing fields are fixed public constants, identical for every caller and
 * every number, for the same reason.
 */
export type OtpChallenge = {
  readonly expiresInSeconds: number;
  /**
   * Seconds until "Kirim ulang kode" may be pressed again.
   *
   * A MINIMUM WAIT, NOT PERMISSION TO SEND. It reports the per-number
   * cooldown only; a per-IP route throttle (3 per 10 min) and a rolling
   * per-number budget (5 per hour) sit beside it and can both make the real
   * wait longer. A finished countdown is therefore never a guarantee, and
   * the caller must keep handling 429 on resend.
   */
  readonly resendAvailableInSeconds: number;
};
