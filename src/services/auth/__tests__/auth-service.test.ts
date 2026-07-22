import { ApiError, request } from '@/services/api/client';
import {
  getCurrentUser,
  login,
  logout,
  refresh,
  register,
} from '@/services/auth/auth-service';
import type { AuthResponse, AuthTokens, AuthUser } from '@/types/auth';

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
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    ...overrides,
  };
}

describe('register', () => {
  it('resolves with the created user and tokens on success', async () => {
    const authResponse = buildAuthResponse();
    mockedRequest.mockResolvedValueOnce(authResponse);

    const result = await register('jane@example.com', 'password123', 'Jane');

    expect(result).toEqual(authResponse);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/register',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          email: 'jane@example.com',
          password: 'password123',
          displayName: 'Jane',
        }),
      })
    );
  });

  it('throws ApiError with EMAIL_ALREADY_REGISTERED when the email is taken', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'Email already registered.')
    );

    await expect(register('jane@example.com', 'password123')).rejects.toMatchObject({
      status: 409,
      code: 'EMAIL_ALREADY_REGISTERED',
    });
  });
});

describe('login', () => {
  it('resolves with the user and tokens on success', async () => {
    const authResponse = buildAuthResponse();
    mockedRequest.mockResolvedValueOnce(authResponse);

    const result = await login('jane@example.com', 'password123');

    expect(result).toEqual(authResponse);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/login',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ email: 'jane@example.com', password: 'password123' }),
      })
    );
  });

  it('throws ApiError with INVALID_CREDENTIALS for a wrong password or unknown email', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
    );

    await expect(login('jane@example.com', 'wrong-password')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
  });
});

describe('refresh', () => {
  it('resolves with a rotated token pair on success', async () => {
    const tokens: AuthTokens = { accessToken: 'access-token-2', refreshToken: 'refresh-token-2' };
    mockedRequest.mockResolvedValueOnce(tokens);

    const result = await refresh('refresh-token-1');

    expect(result).toEqual(tokens);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/refresh',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'refresh-token-1' }),
      })
    );
  });

  it('throws ApiError with INVALID_REFRESH_TOKEN on failure', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_REFRESH_TOKEN', 'Invalid refresh token.')
    );

    await expect(refresh('stale-refresh-token')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_REFRESH_TOKEN',
    });
  });
});

describe('logout', () => {
  it('always resolves, even for an unknown refresh token', async () => {
    mockedRequest.mockResolvedValueOnce({});

    await expect(logout('any-refresh-token')).resolves.toBeUndefined();
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/logout',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ refreshToken: 'any-refresh-token' }),
      })
    );
  });
});

describe('getCurrentUser', () => {
  it('resolves with the current user on success', async () => {
    const user: AuthUser = { id: 'user_1', email: 'jane@example.com', displayName: 'Jane' };
    mockedRequest.mockResolvedValueOnce(user);

    const result = await getCurrentUser('access-token-1');

    expect(result).toEqual(user);
    expect(mockedRequest).toHaveBeenCalledWith(
      'auth/me',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer access-token-1' },
      })
    );
  });

  it('throws ApiError with INVALID_ACCESS_TOKEN on failure', async () => {
    mockedRequest.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'Invalid access token.')
    );

    await expect(getCurrentUser('expired-token')).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_ACCESS_TOKEN',
    });
  });
});
