import { Asset } from 'expo-asset';

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

/**
 * Resolves media bundled into the app binary (via `require`) to a URI
 * string.
 *
 * Demo builds have no media server and no backend, but nothing downstream
 * should have to know that: docs/internal-storage.md fixes `playbackUrl`
 * and `thumbnailUrl` as the fields mobile playback reads, specifically so
 * the bytes can move between a backend endpoint, a CDN, or - here - the
 * app bundle without changing the data model. Resolving to a URI keeps
 * that promise, instead of adding a second media field for the demo case.
 */
export function resolveBundledMediaUri(assetModule: number): string {
  return Asset.fromModule(assetModule).uri;
}
