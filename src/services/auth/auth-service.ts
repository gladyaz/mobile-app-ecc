import { request } from '@/services/api/client';
import type { AuthResponse, AuthTokens, AuthUser } from '@/types/auth';

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/**
 * Registers a new account. Throws ApiError with code
 * "EMAIL_ALREADY_REGISTERED" (status 409) if the email is already taken;
 * callers should surface that specific code as a user-facing message.
 */
export async function register(
  email: string,
  password: string,
  displayName?: string
): Promise<AuthResponse> {
  return request<AuthResponse>('auth/register', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({
      email,
      password,
      ...(displayName ? { displayName } : {}),
    }),
  });
}

/**
 * Logs in with email/password. Throws ApiError with code
 * "INVALID_CREDENTIALS" (status 401) for either a wrong password or a
 * nonexistent email; the backend intentionally does not distinguish the two.
 */
export async function login(email: string, password: string): Promise<AuthResponse> {
  return request<AuthResponse>('auth/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password }),
  });
}

/**
 * Rotates the refresh token, returning a new access/refresh token pair. The
 * previous refresh token becomes invalid once this call succeeds. Throws
 * ApiError with code "INVALID_REFRESH_TOKEN" (status 401) on any failure.
 */
export async function refresh(refreshToken: string): Promise<AuthTokens> {
  return request<AuthTokens>('auth/refresh', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ refreshToken }),
  });
}

/**
 * Revokes a refresh token. The backend treats this as idempotent and always
 * succeeds, even for an unknown/already-revoked token, so this never throws
 * for a "not found" case.
 */
export async function logout(refreshToken: string): Promise<void> {
  await request<unknown>('auth/logout', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ refreshToken }),
  });
}

/**
 * Fetches the current user for a given access token. Throws ApiError with
 * code "INVALID_ACCESS_TOKEN" (status 401) on any failure (expired, revoked,
 * or malformed token).
 */
export async function getCurrentUser(accessToken: string): Promise<AuthUser> {
  return request<AuthUser>('auth/me', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
}
