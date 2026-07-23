/**
 * Mirrors the real backend's entitlement response shape exactly (see
 * short-drama-backend `GET /users/me/entitlement`, Phase 10 work unit
 * 10-B4). Deliberately a single boolean with no expired/revoked
 * distinction, matching the backend's own contract.
 */
export type EntitlementStatus = {
  readonly isPremium: boolean;
  readonly expiresAt: string | null;
};
