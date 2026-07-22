import { request } from '@/services/api/client';
import type { LikeResponse, SaveResponse, UserInteraction } from '@/types/interaction';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * Likes a video for the current user. Requires auth (attaches the access
 * token and retries once on a rotated token, see `RequestConfig` in
 * `services/api/client.ts`). Throws ApiError with code "VIDEO_NOT_FOUND"
 * (status 404) if the video doesn't exist, or "INVALID_ACCESS_TOKEN"
 * (status 401) if unauthenticated.
 */
export async function likeVideo(videoId: string): Promise<LikeResponse> {
  return request<LikeResponse>(
    `videos/${videoId}/like`,
    { method: 'POST', headers: JSON_HEADERS },
    { requiresAuth: true }
  );
}

/**
 * Unlikes a video for the current user. Same auth/error behavior as
 * `likeVideo`.
 */
export async function unlikeVideo(videoId: string): Promise<LikeResponse> {
  return request<LikeResponse>(
    `videos/${videoId}/like`,
    { method: 'DELETE', headers: JSON_HEADERS },
    { requiresAuth: true }
  );
}

/**
 * Saves a video for the current user. Same auth/error behavior as
 * `likeVideo`.
 */
export async function saveVideo(videoId: string): Promise<SaveResponse> {
  return request<SaveResponse>(
    `videos/${videoId}/save`,
    { method: 'POST', headers: JSON_HEADERS },
    { requiresAuth: true }
  );
}

/**
 * Unsaves a video for the current user. Same auth/error behavior as
 * `likeVideo`.
 */
export async function unsaveVideo(videoId: string): Promise<SaveResponse> {
  return request<SaveResponse>(
    `videos/${videoId}/save`,
    { method: 'DELETE', headers: JSON_HEADERS },
    { requiresAuth: true }
  );
}

/**
 * Fetches every like/save interaction the current user has recorded, as a
 * flat list keyed by `videoId`. Reshaping this into the local store's
 * `Record<videoId, ...>` format is the store layer's job, not this one's.
 * Throws ApiError with code "INVALID_ACCESS_TOKEN" (status 401) if
 * unauthenticated.
 */
export async function getInteractions(): Promise<readonly UserInteraction[]> {
  return request<readonly UserInteraction[]>(
    'users/me/interactions',
    { method: 'GET' },
    { requiresAuth: true }
  );
}
