import { ApiError, request } from '@/services/api/client';
import {
  changePassword,
  listSessions,
  logoutAll,
  revokeSession,
} from '@/services/auth/account-security-service';
import type { AuthResponse, SessionSummary } from '@/types/auth';

jest.mock('@/services/api/client', () => {
  const actual = jest.requireActual('@/services/api/client');

  return {
    ...actual,
    request: jest.fn(),
  };
});

const mockedRequest = request as jest.MockedFunction<typeof request>;

function buildAuthResponse(overrides?: Partial<AuthResponse>): AuthResponse {
  return {
    user: { id: 'user_1', email: 'jane@example.com', displayName: 'Jane' },
    accessToken: 'rotated-access-token',
    refreshToken: 'rotated-refresh-token',
    ...overrides,
  };
}

describe('changePassword', () => {
  it('resolves with the rotated AuthResponse on success', async () => {
    const authResponse = buildAuthResponse();
    mockedRequest.mockResolvedValueOnce(authResponse);

    const result = await changePassword('old-password', 'new-password-123', 'refresh-token-1');

    expect(result).toEqual(authResponse);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/change-password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          currentPassword: 'old-password',
          newPassword: 'new-password-123',
          refreshToken: 'refresh-token-1',
        }),
      }),
      { requiresAuth: true }
    );
  });

  it('throws ApiError with INVALID_CREDENTIALS for a wrong current password', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
    );

    await expect(
      changePassword('wrong-password', 'new-password-123', 'refresh-token-1')
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('throws ApiError with INVALID_REFRESH_TOKEN for a stale/unknown refresh token', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token.')
    );

    await expect(
      changePassword('old-password', 'new-password-123', 'stale-refresh-token')
    ).rejects.toMatchObject({ status: 401, code: 'INVALID_REFRESH_TOKEN' });
  });
});

describe('logoutAll', () => {
  it('resolves on success and sends no request body', async () => {
    mockedRequest.mockResolvedValueOnce({ success: true });

    await expect(logoutAll()).resolves.toBeUndefined();
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/logout-all',
      expect.objectContaining({ method: 'POST' }),
      { requiresAuth: true }
    );
    const [, init] = mockedRequest.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBeUndefined();
  });

  it('propagates a failure (e.g. network error) to the caller', async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    await expect(logoutAll()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});

describe('listSessions', () => {
  it('resolves with the session list, including null userAgent/lastUsedAt', async () => {
    const sessions: readonly SessionSummary[] = [
      {
        id: 'session_1',
        userAgent: 'iPhone App/1.0',
        lastUsedAt: '2026-07-20T10:00:00.000Z',
        createdAt: '2026-07-01T10:00:00.000Z',
        expiresAt: '2026-08-01T10:00:00.000Z',
      },
      {
        id: 'session_2',
        userAgent: null,
        lastUsedAt: null,
        createdAt: '2026-07-05T10:00:00.000Z',
        expiresAt: '2026-08-05T10:00:00.000Z',
      },
    ];
    mockedRequest.mockResolvedValueOnce(sessions);

    const result = await listSessions();

    expect(result).toEqual(sessions);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/sessions',
      expect.objectContaining({ method: 'GET' }),
      { requiresAuth: true }
    );
  });

  it('throws ApiError with INVALID_ACCESS_TOKEN if unauthenticated', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Invalid access token.')
    );

    await expect(listSessions()).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_ACCESS_TOKEN',
    });
  });
});

describe('revokeSession', () => {
  it('resolves with undefined on a 204 success response', async () => {
    mockedRequest.mockResolvedValueOnce(undefined);

    await expect(revokeSession('session_1')).resolves.toBeUndefined();
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/sessions/session_1',
      expect.objectContaining({ method: 'DELETE' }),
      { requiresAuth: true }
    );
  });

  it('throws ApiError with SESSION_NOT_FOUND for a nonexistent or cross-account session id', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found.')
    );

    await expect(revokeSession('unknown-session')).rejects.toMatchObject({
      status: 404,
      code: 'SESSION_NOT_FOUND',
    });
  });
});
