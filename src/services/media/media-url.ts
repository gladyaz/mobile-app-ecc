const DEV_FALLBACK_MEDIA_URL = '';

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function encodeRelativePath(relativePath: string): string {
  return relativePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Builds a playable URL for a video served by the local media server
 * (see EXPO_PUBLIC_MEDIA_BASE_URL / README "Local Company Video Playback").
 * relativePath is relative to the media server root and never an absolute
 * filesystem path (e.g. /Users/...), which must never reach the client.
 */
export function buildMediaUrl(relativePath: string): string {
  const baseUrl = process.env.EXPO_PUBLIC_MEDIA_BASE_URL;

  if (!baseUrl) {
    if (__DEV__) {
      console.warn(
        '[media-url] EXPO_PUBLIC_MEDIA_BASE_URL is not set. Copy .env.example to .env, ' +
          'set it to your local media server URL, then restart with `npx expo start -c`.'
      );
    }

    return DEV_FALLBACK_MEDIA_URL;
  }

  return `${normalizeBaseUrl(baseUrl)}/${encodeRelativePath(relativePath)}`;
}
