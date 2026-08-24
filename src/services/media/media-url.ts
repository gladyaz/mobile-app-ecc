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
 *
 * `assetModule` is typed `unknown`, not `number`, because a build that
 * carries no bundled demo media does not receive an asset module id here at
 * all. That media is gitignored, so a production release build is made from
 * a checkout that does not have it, and `metro.config.js` resolves those
 * `require`s to Metro's inert empty module - making the argument `{}`.
 * Returning an empty URI puts that case on the app's existing "Video
 * unavailable" path (the same one a missing EXPO_PUBLIC_MEDIA_BASE_URL
 * already takes) instead of throwing at module-evaluation time, which would
 * take the whole app down at startup. It is never reached in a real build: a
 * production build resolves its catalog from the backend, and a demo/mock
 * build missing its media is refused at config time by `app.config.js`.
 */
export function resolveBundledMediaUri(assetModule: unknown): string {
  if (typeof assetModule !== 'number') {
    return '';
  }

  return Asset.fromModule(assetModule).uri;
}
