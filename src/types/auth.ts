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
