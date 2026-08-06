import type { AuthResponse } from '@/types/auth';

/**
 * Inert placeholder tokens. These are not credentials and never leave the
 * device: a demo build has no backend to present them to. They exist only
 * because the rest of the app treats "there is an access token" as "the
 * user is signed in" - most visibly the playback gate in
 * `drama-feed-item.tsx`, which refuses to build a video source without
 * one.
 */
const DEMO_ACCESS_TOKEN = 'demo-mode-local-access-token';
const DEMO_REFRESH_TOKEN = 'demo-mode-local-refresh-token';

/**
 * Stable across logins on purpose. `video-interactions.tsx` scopes its
 * AsyncStorage keys by user id, so a fixed id means a demo viewer's likes
 * and saves survive signing out and back in - which is what someone
 * trying the app expects, and what a random id would silently break.
 */
const DEMO_USER_ID = 'demo-user';

const DEMO_FALLBACK_EMAIL = 'demo@example.com';

/**
 * Builds a local-only auth response for demo mode, mirroring the shape
 * `/auth/login` returns so everything downstream (`deriveAuthUser`, the
 * token store, AsyncStorage persistence) runs its normal path with no
 * special-casing.
 *
 * Any email and any password are accepted, deliberately: whoever is handed
 * the APK should be able to get in without being issued an account first.
 */
export function buildDemoAuthResponse(email: string): AuthResponse {
  const trimmedEmail = email.trim();

  return {
    accessToken: DEMO_ACCESS_TOKEN,
    refreshToken: DEMO_REFRESH_TOKEN,
    user: {
      id: DEMO_USER_ID,
      email: trimmedEmail.length > 0 ? trimmedEmail : DEMO_FALLBACK_EMAIL,
    },
  };
}
