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
