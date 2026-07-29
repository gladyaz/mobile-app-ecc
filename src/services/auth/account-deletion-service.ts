import { request } from '@/services/api/client';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * Permanently deletes the current user's account (Phase 12, work unit
 * 12C-B1/12C-M1). IMMEDIATE and IRREVERSIBLE - no grace period, no
 * cancellation endpoint. On success, every session for this account
 * (including this device's own current session) is revoked and the account
 * row itself is gone.
 *
 * `confirmDeletion` is ALWAYS sent as the literal boolean `true` - this
 * function has no parameter for it, by design: the backend's
 * `AccountDeletionDto` requires the exact boolean `true` (`@IsBoolean()` +
 * `@Equals(true)` - not merely a truthy value, and not the string `"true"`),
 * so there is no legitimate reason for this client to ever send anything
 * else. The human-facing confirmation gate belongs entirely in the calling
 * screen (an explicit, unmissable "this is permanent and cannot be undone"
 * dialog shown BEFORE this function is ever called) - this function itself
 * is simply the point past which the request is unconditionally sent with
 * the one value the backend will ever accept.
 *
 * Throws `ApiError` with:
 * - code "INVALID_CREDENTIALS" (status 401) for a wrong `currentPassword` on
 *   an account that still exists - the same generic code
 *   `login()`/`changePassword()` use.
 * - code "INVALID_ACCESS_TOKEN" (status 401), NOT "INVALID_CREDENTIALS", if
 *   the user no longer exists - including a repeated call on an
 *   already-deleted account (no distinct "account already deleted" oracle).
 *   This reuses the same generic "vanished user" code `exportMyData()`/`GET
 *   /users/me/export` throws for the identical condition, rather than
 *   collapsing it into the wrong-password code. Verified against backend
 *   source: `auth.service.ts`'s `deleteAccount` throws
 *   `AppErrorCode.INVALID_ACCESS_TOKEN` when `this.prisma.user.findUnique`
 *   returns null, pinned by that repo's own
 *   `account-deletion.service.spec.ts` ("is idempotent: a second call for an
 *   already-deleted account gets the same clean INVALID_ACCESS_TOKEN 401").
 * - code "ACCOUNT_DELETION_FORBIDDEN" (status 403) if this account's role is
 *   not a plain "user" (e.g. an admin/operator account) - self-service
 *   deletion is deliberately not available for those roles this phase.
 * - status 429 (generic "HTTP_ERROR" code - the backend's throttler does not
 *   emit an endpoint-specific error code for rate limiting, so `error.code`
 *   is not a reliable signal here, only `error.status`) once the dedicated
 *   5-calls-per-15-minutes rate limit is exceeded.
 */
export async function deleteMyAccount(currentPassword: string): Promise<void> {
  await request<{ success: true }>(
    'users/me/deletion',
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ currentPassword, confirmDeletion: true }),
    },
    { requiresAuth: true }
  );
}
