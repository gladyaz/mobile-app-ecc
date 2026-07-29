import { request } from '@/services/api/client';
import type { UserExport } from '@/types/export';

/**
 * Fetches a synchronous JSON export of the current user's own data (Phase 12,
 * work unit 12C-B2/12C-M1): profile, like/save interactions, watch progress,
 * and entitlement history. Requires auth (attaches the current access
 * token). Read-only - has no side effect on the account, and does not
 * consume the account-deletion rate limit (a separate, more generous
 * dedicated throttle applies here - see below).
 *
 * Throws `ApiError` with status 429 once the backend's dedicated 10-calls-
 * per-5-minutes export rate limit is exceeded. The backend's throttler does
 * not emit an endpoint-specific error code for this - only `response.status`
 * is reliable (`error.code` will be the generic `"HTTP_ERROR"`, not a
 * distinct rate-limit code), so callers must branch on `error.status`, not
 * `error.code`, to detect this case.
 */
export async function exportMyData(): Promise<UserExport> {
  return request<UserExport>('users/me/export', { method: 'GET' }, { requiresAuth: true });
}
