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

/**
 * Typed fetch wrapper for the NestJS backend. Throws ApiError for missing
 * config, network failures, non-2xx responses, and invalid JSON, so callers
 * (the video service / catalog provider) can surface a real error state
 * instead of silently falling back to mock data.
 */
export async function request<TResponse>(path: string, options?: RequestInit): Promise<TResponse> {
  const baseUrl = getBaseUrl();

  if (!baseUrl) {
    throw new ApiError(0, 'MISSING_BASE_URL', 'EXPO_PUBLIC_API_BASE_URL is not set.');
  }

  const url = `${baseUrl}/${normalizePath(path)}`;
  let response: Response;

  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...options?.headers,
      },
    });
  } catch (error) {
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      error instanceof Error ? error.message : 'Network request failed.'
    );
  }

  if (!response.ok) {
    const { code, message } = await parseErrorBody(response);

    throw new ApiError(response.status, code, message);
  }

  try {
    return (await response.json()) as TResponse;
  } catch {
    throw new ApiError(response.status, 'INVALID_RESPONSE', 'Response was not valid JSON.');
  }
}
