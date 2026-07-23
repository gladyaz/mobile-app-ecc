import { request } from '@/services/api/client';
import type { EntitlementStatus } from '@/types/entitlement';

/**
 * Fetches the current user's premium entitlement status. Requires auth
 * (see `RequestConfig` in `services/api/client.ts`). Throws ApiError with
 * code "INVALID_ACCESS_TOKEN" (status 401) if unauthenticated.
 */
export async function getMyEntitlement(): Promise<EntitlementStatus> {
  return request<EntitlementStatus>(
    'users/me/entitlement',
    { method: 'GET' },
    { requiresAuth: true }
  );
}
