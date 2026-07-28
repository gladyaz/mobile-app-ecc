import { request } from '@/services/api/client';
import type { AuthResponse, SessionSummary } from '@/types/auth';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * Changes the current user's password (Phase 12, work unit 12B-B1).
 * Requires auth (attaches the current access token; see `RequestConfig` in
 * `services/api/client.ts`).
 *
 * CRITICAL: on success, the backend ROTATES the current session's
 * access/refresh token pair (and revokes every OTHER session for the
 * account) as a side effect of the password change. This function only
 * returns the new `AuthResponse` - it does NOT persist the rotated tokens
 * itself, mirroring `refresh()`'s existing "pure API call" precedent in
 * `auth-service.ts`. Callers MUST persist the returned `accessToken`/
 * `refreshToken` (e.g. via `tokenStore.setTokensAndNotify(...)`, the same
 * path the HTTP client's own refresh-on-401 interceptor uses), or this
 * device silently loses its session on the next refresh attempt.
 *
 * Throws ApiError with code "INVALID_CREDENTIALS" (status 401) for a wrong
 * `currentPassword` - the same generic code `login()` uses, by backend
 * design (this is an already-authenticated endpoint, so there's no email-
 * enumeration concern, but the error still isn't a distinct "current
 * password is wrong" oracle). Throws "INVALID_REFRESH_TOKEN" (status 401)
 * if `refreshToken` does not identify a usable session for this account.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  refreshToken: string
): Promise<AuthResponse> {
  return request<AuthResponse>(
    'auth/change-password',
    {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ currentPassword, newPassword, refreshToken }),
    },
    { requiresAuth: true }
  );
}

/**
 * Revokes EVERY session for the current account (Phase 12, work unit
 * 12B-B2) - INCLUDING the session/device that made this very request. There
 * is no "log out other devices only" variant; see the backend's
 * `AuthController.logoutAll` doc comment for why this is the frozen
 * contract. Callers MUST follow a successful call with a full local
 * sign-out (the same one `useAuth().logout()` already performs), since this
 * device's own session is revoked too.
 */
export async function logoutAll(): Promise<void> {
  await request<{ success: true }>(
    'auth/logout-all',
    { method: 'POST', headers: JSON_HEADERS },
    { requiresAuth: true }
  );
}

/**
 * Lists the current user's own active sessions (Phase 12, work unit
 * 12B-B2). Never includes another account's sessions, and never includes a
 * `refreshTokenHash`, `ipHash`, or `userId` - the backend's
 * `SessionSummaryDto` doesn't carry them.
 */
export async function listSessions(): Promise<readonly SessionSummary[]> {
  return request<readonly SessionSummary[]>(
    'auth/sessions',
    { method: 'GET' },
    { requiresAuth: true }
  );
}

/**
 * Revokes one of the current user's own sessions by id (Phase 12, work
 * unit 12B-B2). Resolves to `undefined` on success (backend responds `204
 * No Content`). Throws ApiError with code "SESSION_NOT_FOUND" (status 404)
 * both for a nonexistent id and for another account's id - the identical
 * response either way, by design, so this can never be used to probe which
 * session ids exist for other accounts.
 */
export async function revokeSession(sessionId: string): Promise<void> {
  await request<void>(
    `auth/sessions/${sessionId}`,
    { method: 'DELETE' },
    { requiresAuth: true }
  );
}
