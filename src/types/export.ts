/**
 * Mirrors the real backend's personal-data export response shape exactly
 * (see short-drama-backend `GET /users/me/export`, Phase 12 work unit
 * 12C-B2/`src/export/export.types.ts`). Deliberately excludes every internal
 * database id, storage path/key, role, password hash, and session/security
 * metadata field - the backend's own `UserExportDto` never sends them, so
 * there is nothing to strip client-side; this type just describes what
 * actually arrives.
 */
export type ExportedProfile = {
  readonly email: string;
  readonly displayName: string | null;
  /** ISO 8601. When this account was created. */
  readonly memberSince: string;
};

/** One like/save interaction, transformed for export. */
export type ExportedInteraction = {
  /** Catalog id (`Video.id`), not an internal/surrogate row id. */
  readonly videoId: string;
  /** `null` if the video no longer exists in the catalog. */
  readonly videoTitle: string | null;
  readonly isLiked: boolean;
  readonly isSaved: boolean;
  /** ISO 8601. When this like/save state was last changed. */
  readonly updatedAt: string;
};

/** One watch-progress entry, transformed for export. */
export type ExportedWatchProgress = {
  /** Catalog id (`Series.id`/`Video.seriesId`). */
  readonly seriesId: string;
  /** Catalog id (`Video.id`). */
  readonly videoId: string;
  /** `null` under the same conditions as `ExportedInteraction.videoTitle`. */
  readonly videoTitle: string | null;
  readonly episodeNumber: number;
  readonly positionSeconds: number;
  readonly durationSeconds?: number;
  /** ISO 8601. When this progress row was last updated. */
  readonly updatedAt: string;
};

/** One entitlement-history entry, transformed for export. */
export type ExportedEntitlement = {
  readonly tier: string;
  readonly source: string;
  /** ISO 8601. */
  readonly grantedAt: string;
  /** ISO 8601, or `null` if this entitlement never expires. */
  readonly expiresAt: string | null;
  /** ISO 8601, or `null` if this entitlement has not been revoked. */
  readonly revokedAt: string | null;
};

/** Full response body for `GET /users/me/export`. */
export type UserExport = {
  /** ISO 8601. When this export was generated (this call, not a stored artifact). */
  readonly exportedAt: string;
  readonly profile: ExportedProfile;
  readonly interactions: readonly ExportedInteraction[];
  readonly watchProgress: readonly ExportedWatchProgress[];
  readonly entitlements: readonly ExportedEntitlement[];
};
