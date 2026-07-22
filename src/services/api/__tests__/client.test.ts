import { request } from '@/services/api/client';
import {
  __resetTokenStoreForTests,
  getTokens,
  onTokensChanged,
  setTokens,
} from '@/services/auth/token-store';
import type { AuthTokens } from '@/types/auth';

const ORIGINAL_TOKENS: AuthTokens = {
  accessToken: 'original-access-token',
  refreshToken: 'original-refresh-token',
};

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status text',
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * The refresh-on-401 interceptor hits the same `auth/refresh` endpoint
 * `auth-service.ts`'s `refresh()` would, via this module's own `request()`
 * (see client.ts's `attemptTokenRefresh` doc comment for why it isn't a
 * literal call into auth-service.ts). These tests therefore drive the
 * refresh step through the mocked `fetch` too, rather than mocking
 * `auth-service.ts`.
 */
function refreshFetchCall(index: number): [string, RequestInit] {
  return fetchMockCallsRef[index] as [string, RequestInit];
}

let fetchMockCallsRef: unknown[][] = [];

describe('request', () => {
  const fetchMock = jest.fn();
  const ORIGINAL_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

  beforeAll(() => {
    // No prior test in this codebase exercised the real getBaseUrl() path
    // (existing tests mock `request` itself), so nothing loads this at test
    // time otherwise. Set it explicitly rather than depending on .env.
    process.env.EXPO_PUBLIC_API_BASE_URL = 'https://api.test.local';
  });

  afterAll(() => {
    process.env.EXPO_PUBLIC_API_BASE_URL = ORIGINAL_BASE_URL;
  });

  beforeEach(() => {
    globalThis.fetch = fetchMock;
    fetchMock.mockReset();
    fetchMockCallsRef = fetchMock.mock.calls;
    __resetTokenStoreForTests();
  });

  describe('without requiresAuth', () => {
    it('does not attach an Authorization header even if tokens are set', async () => {
      setTokens(ORIGINAL_TOKENS);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const result = await request<{ ok: boolean }>('public/thing');

      expect(result).toEqual({ ok: true });
      const [, init] = refreshFetchCall(0);
      expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    });

    it('does not attempt a refresh on a 401 when auth is not required', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(401, { code: 'INVALID_ACCESS_TOKEN', message: 'nope' })
      );

      await expect(request('public/thing')).rejects.toMatchObject({
        status: 401,
        code: 'INVALID_ACCESS_TOKEN',
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('with requiresAuth: true', () => {
    it('attaches the current access token as a Bearer header', async () => {
      setTokens(ORIGINAL_TOKENS);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      await request('protected/thing', undefined, { requiresAuth: true });

      const [, init] = refreshFetchCall(0);
      expect((init.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${ORIGINAL_TOKENS.accessToken}`
      );
    });

    it('does not attempt a refresh for a non-auth-related error (e.g. 500)', async () => {
      setTokens(ORIGINAL_TOKENS);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(500, { code: 'INTERNAL_ERROR', message: 'boom' })
      );

      await expect(
        request('protected/thing', undefined, { requiresAuth: true })
      ).rejects.toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not attempt a refresh for a 401 with a different error code', async () => {
      setTokens(ORIGINAL_TOKENS);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(401, { code: 'INVALID_CREDENTIALS', message: 'nope' })
      );

      await expect(
        request('protected/thing', undefined, { requiresAuth: true })
      ).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('refreshes once and retries once on a 401 INVALID_ACCESS_TOKEN, succeeding with the new token', async () => {
      setTokens(ORIGINAL_TOKENS);
      const rotatedTokens: AuthTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      fetchMock
        .mockResolvedValueOnce(jsonResponse(401, { code: 'INVALID_ACCESS_TOKEN', message: 'expired' }))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            user: { id: 'user_1', email: 'jane@example.com' },
            ...rotatedTokens,
          })
        )
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      const result = await request<{ ok: boolean }>('protected/thing', undefined, {
        requiresAuth: true,
      });

      expect(result).toEqual({ ok: true });
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Call 0: original request, gets a 401. Call 1: the refresh POST to
      // auth/refresh. Call 2: the retried original request.
      const [refreshUrl, refreshInit] = refreshFetchCall(1);
      expect(refreshUrl).toBe('https://api.test.local/auth/refresh');
      expect(refreshInit.method).toBe('POST');
      expect(JSON.parse(refreshInit.body as string)).toEqual({
        refreshToken: ORIGINAL_TOKENS.refreshToken,
      });

      const [, retryInit] = refreshFetchCall(2);
      expect((retryInit.headers as Record<string, string>).Authorization).toBe(
        `Bearer ${rotatedTokens.accessToken}`
      );

      expect(getTokens()).toEqual(rotatedTokens);
    });

    it('notifies token-store subscribers with the rotated tokens on a successful refresh', async () => {
      setTokens(ORIGINAL_TOKENS);
      const listener = jest.fn();
      onTokensChanged(listener);
      const rotatedTokens: AuthTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      fetchMock
        .mockResolvedValueOnce(jsonResponse(401, { code: 'INVALID_ACCESS_TOKEN', message: 'expired' }))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            user: { id: 'user_1', email: 'jane@example.com' },
            ...rotatedTokens,
          })
        )
        .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

      await request('protected/thing', undefined, { requiresAuth: true });

      expect(listener).toHaveBeenCalledWith(rotatedTokens);
    });

    it('clears tokens and propagates the original 401 without a second retry when refresh fails', async () => {
      setTokens(ORIGINAL_TOKENS);
      const listener = jest.fn();
      onTokensChanged(listener);

      fetchMock
        .mockResolvedValueOnce(jsonResponse(401, { code: 'INVALID_ACCESS_TOKEN', message: 'expired' }))
        .mockResolvedValueOnce(
          jsonResponse(401, { code: 'INVALID_REFRESH_TOKEN', message: 'stale' })
        );

      await expect(
        request('protected/thing', undefined, { requiresAuth: true })
      ).rejects.toMatchObject({ status: 401, code: 'INVALID_ACCESS_TOKEN' });

      // Exactly 2 fetch calls: the original request, and the one failed
      // refresh attempt - no second retry of the original request.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(getTokens()).toBeNull();
      expect(listener).toHaveBeenCalledWith(null);
    });

    it('clears tokens and propagates the original 401 without attempting a refresh when there is no refresh token', async () => {
      setTokens(null);

      fetchMock.mockResolvedValueOnce(
        jsonResponse(401, { code: 'INVALID_ACCESS_TOKEN', message: 'expired' })
      );

      await expect(
        request('protected/thing', undefined, { requiresAuth: true })
      ).rejects.toMatchObject({ status: 401, code: 'INVALID_ACCESS_TOKEN' });

      // Only the original request - no refresh call was even attempted.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('does not loop if the retried request also gets a 401 INVALID_ACCESS_TOKEN', async () => {
      setTokens(ORIGINAL_TOKENS);
      const rotatedTokens: AuthTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      fetchMock
        .mockResolvedValueOnce(jsonResponse(401, { code: 'INVALID_ACCESS_TOKEN', message: 'expired' }))
        .mockResolvedValueOnce(
          jsonResponse(200, {
            user: { id: 'user_1', email: 'jane@example.com' },
            ...rotatedTokens,
          })
        )
        .mockResolvedValueOnce(
          jsonResponse(401, { code: 'INVALID_ACCESS_TOKEN', message: 'still bad' })
        );

      await expect(
        request('protected/thing', undefined, { requiresAuth: true })
      ).rejects.toMatchObject({ status: 401, code: 'INVALID_ACCESS_TOKEN' });

      // Original request, one refresh attempt, one retry - and stops there
      // even though the retry is also a 401 INVALID_ACCESS_TOKEN.
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
  });
});
