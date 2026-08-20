/**
 * Mirrors the real backend's auth response shapes exactly (see
 * short-drama-backend `/auth/*` endpoints). Any UI-layer conveniences (e.g.
 * a combined display name fallback) belong in the store/screen layer, not
 * here.
 */
export type AuthUser = {
  readonly id: string;
  readonly email: string;
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
 * One login method currently attached to the signed-in account, as the
 * account-linking surface represents it.
 *
 * `label` is whatever the backend considers safe to show for that method
 * (a masked email, a masked phone number) and is nullable because a method
 * may have nothing to display. Never a token, and never another account's
 * identifier.
 *
 * PROVISIONAL: the backend contract for `GET /auth/methods` is being built
 * in a separate worktree and is not landed yet. See
 * `services/auth/provider-auth-service.ts` for the single place these
 * shapes are read from the network, and docs/api-contract.md for the
 * reconciliation checklist.
 */
export type LinkedAuthMethod = {
  readonly provider: AuthProviderId;
  readonly label: string | null;
  readonly linkedAt: string | null;
};

/**
 * The result of asking the backend to send a WhatsApp OTP. Carries no
 * account-existence signal on purpose: an unregistered number and a
 * registered one must produce the identical response, so nothing here (or
 * in the UI that renders it) can be used to probe who has an account.
 */
export type OtpChallenge = {
  readonly challengeId: string;
  readonly expiresInSeconds: number;
  /** Seconds until "Kirim ulang kode" may be pressed again. */
  readonly resendAvailableInSeconds: number;
};
