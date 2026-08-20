import { Platform } from 'react-native';

/**
 * The platform-independent half of the Google provider adapter: the result
 * shape both `google-sign-in.ts` (native) and `google-sign-in.web.ts` (web)
 * return, plus the configuration check they share.
 *
 * Nothing here imports the native SDK, so this module is safe on every
 * platform - see `google-sign-in.web.ts` for why that separation is what
 * keeps the Expo Web bundle building.
 */

/**
 * OAuth CLIENT IDs, which are public identifiers, not secrets - they ship
 * inside every app binary by design. They still come from the environment
 * rather than committed source, so a fork/build points at its own Google
 * project instead of inheriting one, and so this repository carries no
 * project-specific configuration at all.
 *
 * `webClientId` is the one that matters: Google issues the ID TOKEN this
 * app exchanges with its own backend against the *web* client, on both
 * Android and iOS. `iosClientId` is additionally required on iOS.
 */
const WEB_CLIENT_ID_ENV_KEY = 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID';
const IOS_CLIENT_ID_ENV_KEY = 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID';

/**
 * Read with STATIC property access, never `process.env[key]`.
 *
 * Expo's Babel plugin inlines `EXPO_PUBLIC_*` values into the bundle at
 * build time by matching the literal member expression. A dynamic lookup is
 * not matched, so it compiles to a read of an object that does not exist at
 * runtime on a device - the config would silently look "missing" in every
 * build, including one that is configured correctly. `expo/no-dynamic-env-var`
 * exists to catch exactly this.
 */
function readGoogleEnv(): { webClientId?: string; iosClientId?: string } {
  return {
    webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
    iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  };
}

export type GoogleConfig = {
  readonly webClientId: string;
  readonly iosClientId?: string;
};

export type GoogleConfigResolution =
  | { readonly status: 'ready'; readonly config: GoogleConfig }
  | { readonly status: 'missing'; readonly missingKeys: readonly string[] };

/**
 * What a sign-in attempt produced. Every branch is something a caller must
 * be able to tell apart, and none of them is an invented success:
 *
 * - `success`   - Google returned an ID token; it still has to be exchanged
 *                 with the Short Drama backend before any session exists.
 * - `cancelled` - the person dismissed the sheet. Not an error; show nothing.
 * - `unsupported` - this platform has no native Google Sign-In at all (web).
 * - `unconfigured` - the build has no Google client IDs. `developerMessage`
 *                 names the exact env keys and is for developers, not users.
 * - `failed`    - Play Services missing, no ID token returned, or the native
 *                 module threw. `reason` is for logging, never for UI copy.
 */
export type GoogleSignInResult =
  | { readonly status: 'success'; readonly idToken: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'unconfigured'; readonly developerMessage: string }
  | { readonly status: 'failed'; readonly reason: string };

export function resolveGoogleConfig(): GoogleConfigResolution {
  const { webClientId, iosClientId } = readGoogleEnv();

  // The iOS client ID is optional to the SDK only when a
  // `GoogleService-Info.plist` supplies it. This app deliberately ships no
  // Firebase config file (see app.config.js), so on iOS the ID must come
  // from the environment or sign-in fails inside the native SDK with a far
  // less legible error than the one this produces.
  const missingKeys = [
    ...(webClientId ? [] : [WEB_CLIENT_ID_ENV_KEY]),
    ...(Platform.OS === 'ios' && !iosClientId ? [IOS_CLIENT_ID_ENV_KEY] : []),
  ];

  if (!webClientId || missingKeys.length > 0) {
    return { status: 'missing', missingKeys };
  }

  return {
    status: 'ready',
    config: iosClientId ? { webClientId, iosClientId } : { webClientId },
  };
}

/**
 * The one message a developer sees when the build has no Google config. It
 * names the missing keys and the file to put them in, because "Google login
 * failed" with no explanation is exactly how this gets misdiagnosed as a
 * backend problem.
 */
export function describeMissingGoogleConfig(missingKeys: readonly string[]): string {
  return (
    `[google-sign-in] Google Sign-In is not configured: ${missingKeys.join(', ')} ` +
    'is not set. Copy .env.example to .env, fill in the client IDs from your ' +
    'Google Cloud / Firebase project, then restart with `npx expo start -c`. ' +
    'iOS additionally needs EXPO_PUBLIC_GOOGLE_IOS_URL_SCHEME set before ' +
    '`npx expo prebuild` so the config plugin can register the URL scheme.'
  );
}

export function buildUnconfiguredResult(missingKeys: readonly string[]): GoogleSignInResult {
  return { status: 'unconfigured', developerMessage: describeMissingGoogleConfig(missingKeys) };
}
