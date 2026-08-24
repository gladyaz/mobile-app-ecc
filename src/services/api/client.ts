import {
  clearTokensAndNotify,
  getTokens,
  setTokensAndNotify,
} from '@/services/auth/token-store';
import type { AuthResponse } from '@/types/auth';

const HTTP_NO_CONTENT = 204;

/**
 * How long a single request may wait before it is abandoned.
 *
 * `fetch` has no default timeout. Without one, a host that RESOLVES but never
 * answers - the LAN backend after the laptop sleeps, a captive portal, a
 * production origin behind a wedged load balancer - leaves the promise pending
 * forever, and every screen that awaited it keeps its spinner permanently. The
 * app has honest error states for a refused connection and shows none of them
 * for a silent one, which reads to a viewer as a frozen app rather than a
 * failed request.
 *
 * 20s is deliberately generous: it is a ceiling on hanging, not a latency
 * budget. A cold backend on a slow mobile connection must still be able to
 * answer inside it.
 */
const REQUEST_TIMEOUT_MS = 20_000;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function normalizePath(path: string): string {
  return path.replace(/^\/+/, '');
}

function getBaseUrl(): string {
  const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

  if (!baseUrl) {
    if (__DEV__) {
      console.warn(
        '[api-client] EXPO_PUBLIC_API_BASE_URL is not set. Copy .env.example to .env, ' +
          'set it to your backend URL, then restart with `npx expo start -c`.'
      );
    }

    return '';
  }

  if (__DEV__) {
    try {
      new URL(baseUrl);
    } catch {
      console.warn(`[api-client] EXPO_PUBLIC_API_BASE_URL is not a valid URL: "${baseUrl}"`);
    }
  }

  return normalizeBaseUrl(baseUrl);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function parseErrorBody(response: Response): Promise<{ code: string; message: string }> {
  try {
    const body: unknown = await response.json();

    if (isRecord(body) && typeof body.message === 'string') {
      return {
        code: typeof body.code === 'string' ? body.code : 'API_ERROR',
        message: body.message,
      };
    }
  } catch {
    // Response body was not valid JSON; fall through to the status-based message below.
  }

  return {
    code: 'API_ERROR',
    message: response.statusText || `Request failed with status ${response.status}`,
  };
}

export type RequestConfig = {
  /**
   * When true, attaches `Authorization: Bearer <accessToken>` (read from
   * `token-store.ts`) to the request, and - on a 401 response with code
   * `INVALID_ACCESS_TOKEN` - attempts exactly one token refresh (hitting
   * the same `auth/refresh` endpoint as `auth-service.ts`'s `refresh()`,
   * see `attemptTokenRefresh` below for why it's not literally called)
   * followed by exactly one retry of the original request with the new
   * access token. If the refresh itself fails, tokens are cleared (forcing
   * a client-side logout via `token-store.ts`'s subscription) and the
   * original 401 is propagated.
   */
  readonly requiresAuth?: boolean;
};

function readAccessToken(): string | undefined {
  return getTokens()?.accessToken;
}

function buildAuthHeader(accessToken: string | undefined): Record<string, string> {
  if (!accessToken) {
    return {};
  }

  return { Authorization: `Bearer ${accessToken}` };
}

function isInvalidAccessTokenError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401 && error.code === 'INVALID_ACCESS_TOKEN';
}

/**
 * Attempts a single token refresh using the current refresh token. Returns
 * true and updates `token-store.ts` (notifying subscribers, so
 * `stores/auth.tsx` can persist the rotated pair) on success. Returns false
 * and clears tokens (notifying subscribers, so `stores/auth.tsx` can force
 * a client-side logout) on any failure, including having no refresh token
 * to use in the first place.
 *
 * This hits the same `auth/refresh` endpoint with the same request shape as
 * `auth-service.ts`'s `refresh()`, by calling this module's own `request()`
 * directly (defined below) rather than importing `auth-service.ts`.
 * `auth-service.ts` itself calls `request()`, so a top-level import of its
 * `refresh()` here would create a load-time circular import
 * (client.ts -> auth-service.ts -> client.ts). That was tried and
 * confirmed broken two ways: a static import broke Jest's mocking of
 * `request` in auth-service.test.ts (a circular `jest.requireActual` re-
 * entered mid-evaluation), and a lazy `await import(...)` isn't usable in
 * this Jest environment at all (`A dynamic import callback was invoked
 * without --experimental-vm-modules`). Calling the already-in-scope
 * `request()` avoids the cycle entirely while keeping the exact same
 * network contract.
 */
async function attemptTokenRefresh(): Promise<boolean> {
  const currentRefreshToken = getTokens()?.refreshToken;

  if (!currentRefreshToken) {
    clearTokensAndNotify();

    return false;
  }

  try {
    const authResponse = await request<AuthResponse>('auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: currentRefreshToken }),
    });

    setTokensAndNotify({
      accessToken: authResponse.accessToken,
      refreshToken: authResponse.refreshToken,
    });

    return true;
  } catch {
    clearTokensAndNotify();

    return false;
  }
}

/**
 * Typed fetch wrapper for the NestJS backend. Throws ApiError for missing
 * config, network failures, non-2xx responses, and invalid JSON, so callers
 * (the video service / catalog provider) can surface a real error state
 * instead of silently falling back to mock data.
 *
 * Pass `{ requiresAuth: true }` for endpoints that need the current access
 * token attached, with automatic refresh-and-retry-once on a 401
 * `INVALID_ACCESS_TOKEN` response. See `RequestConfig` above for the exact
 * behavior. `isRetry` is an internal-only flag (not part of the public
 * signature) that guarantees at most one retry: it starts false, and the
 * one recursive call this function ever makes to itself always passes
 * `true`, which disables the refresh-and-retry branch entirely - so a
 * second 401 (even `INVALID_ACCESS_TOKEN` again) always propagates instead
 * of looping.
 */
export async function request<TResponse>(
  path: string,
  options?: RequestInit,
  config?: RequestConfig,
  isRetry = false
): Promise<TResponse> {
  const requiresAuth = config?.requiresAuth ?? false;
  const baseUrl = getBaseUrl();

  if (!baseUrl) {
    throw new ApiError(0, 'MISSING_BASE_URL', 'EXPO_PUBLIC_API_BASE_URL is not set.');
  }

  const url = `${baseUrl}/${normalizePath(path)}`;

  // Pinned BEFORE the request is sent, and compared again before any refresh:
  // this exact token is the identity this request was made under. See the
  // refresh branch below for what that comparison prevents.
  const sentAccessToken = requiresAuth ? readAccessToken() : undefined;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => {
    abortController.abort();
  }, REQUEST_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(url, {
      ...options,
      signal: abortController.signal,
      headers: {
        Accept: 'application/json',
        ...(requiresAuth ? buildAuthHeader(sentAccessToken) : {}),
        ...options?.headers,
      },
    });
  } catch (error) {
    // An abort is the timeout firing, not a refused connection. Both are
    // network failures to a caller, but only one of them is worth telling a
    // viewer to check their connection about, so they get distinct codes.
    if (abortController.signal.aborted) {
      throw new ApiError(
        0,
        'TIMEOUT',
        `Request timed out after ${REQUEST_TIMEOUT_MS}ms.`
      );
    }

    throw new ApiError(
      0,
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Network request failed.'
    );
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    const { code, message } = await parseErrorBody(response);
    const apiError = new ApiError(response.status, code, message);

    // The token-identity check is what stops a 401 arriving for one account
    // from being answered on behalf of another.
    //
    // `attemptTokenRefresh` and the retry both read the LIVE token store. If
    // the viewer signed out and back in - as a different user, or the same one
    // - while this request was in flight, the store now holds someone else's
    // pair. Refreshing then rotates THAT session, and the retry re-sends this
    // request with THAT access token: a like, a watch position, or an account
    // mutation issued by user A gets committed to user B's account, and both
    // sides look like ordinary successful requests.
    //
    // A 401 for a token that is no longer the current one is stale by
    // definition, so there is nothing to recover: propagate it.
    const isStillTheSameSession = readAccessToken() === sentAccessToken;

    if (requiresAuth && !isRetry && isInvalidAccessTokenError(apiError) && isStillTheSameSession) {
      const refreshed = await attemptTokenRefresh();

      if (refreshed) {
        return request<TResponse>(path, options, config, true);
      }
    }

    throw apiError;
  }

  // `204 No Content` (e.g. `DELETE /auth/sessions/:id`) has no body by HTTP
  // definition - calling `.json()` on it throws even though the request
  // succeeded, so it's handled before the JSON-parse attempt below rather
  // than being (mis)treated as an `INVALID_RESPONSE` failure.
  if (response.status === HTTP_NO_CONTENT) {
    return undefined as TResponse;
  }

  try {
    return (await response.json()) as TResponse;
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Response was not valid JSON.');
  }
}
