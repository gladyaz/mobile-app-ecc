type ApiClientConfig = {
  readonly baseUrl: string;
};

export const apiClientConfig: ApiClientConfig = {
  baseUrl: '',
};

export async function apiGet<TResponse>(_path: string): Promise<TResponse> {
  // Future backend integration will route authenticated GET requests through this client.
  throw new Error('API client is not connected yet.');
}
