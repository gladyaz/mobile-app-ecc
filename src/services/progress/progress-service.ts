import { request } from '@/services/api/client';
import type { UserSeriesProgress } from '@/types/progress';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * Upserts the current user's watch progress for a series. Requires auth
 * (attaches the access token and retries once on a rotated token, see
 * `RequestConfig` in `services/api/client.ts`). Throws ApiError with code
 * "VIDEO_NOT_FOUND" (status 404) if `videoId` doesn't exist, or
 * "INVALID_ACCESS_TOKEN" (status 401) if unauthenticated.
 */
export async function upsertProgress(
  seriesId: string,
  videoId: string,
  episodeNumber: number,
  positionSeconds: number,
  durationSeconds?: number
): Promise<UserSeriesProgress> {
  return request<UserSeriesProgress>(
    `series/${seriesId}/progress`,
    {
      method: 'PUT',
      headers: JSON_HEADERS,
      body: JSON.stringify({
        videoId,
        episodeNumber,
        // Backend requires integer seconds (`@IsInt()` on both fields); the
        // player reports fractional seconds, so round only the outbound wire
        // value here — local/UI state elsewhere keeps full float precision.
        positionSeconds: Math.round(positionSeconds),
        ...(durationSeconds != null ? { durationSeconds: Math.round(durationSeconds) } : {}),
      }),
    },
    { requiresAuth: true }
  );
}

/**
 * Fetches the current user's watch progress across every series they've
 * started, as a flat list keyed by `seriesId`. Reshaping this into the
 * local store's format is the store layer's job, not this one's. Throws
 * ApiError with code "INVALID_ACCESS_TOKEN" (status 401) if unauthenticated.
 */
export async function getProgress(): Promise<readonly UserSeriesProgress[]> {
  return request<readonly UserSeriesProgress[]>(
    'users/me/progress',
    { method: 'GET' },
    { requiresAuth: true }
  );
}
