import { Platform } from 'react-native';

import {
  buildUnconfiguredResult,
  describeMissingGoogleConfig,
  resolveGoogleConfig,
  type GoogleSignInResult,
} from '@/services/auth/google-sign-in-contract';

export type { GoogleSignInResult };

/**
 * The native (iOS/Android) Google provider adapter, and the ONLY module
 * allowed to import `@react-native-google-signin/google-signin`.
 *
 * Web never reaches this file: `google-sign-in.web.ts` sits next to it and
 * Metro resolves that one for `platform: web`, so the native SDK is
 * excluded from the web bundle at BUILD time. This mirrors exactly what
 * `services/ads/interstitial-adapter.ts` does for the AdMob SDK, including
 * why the `require()` stays inside the function body: importing this module
 * on a device must not trigger the SDK's load-time side effects, and
 * `google-web-import-boundary.test.ts` fails loudly if the boundary is ever
 * broken.
 *
 * Library choice (researched 2026-08-20 against the current Expo docs, not
 * from memory): Expo's "Google authentication" guide names
 * `@react-native-google-signin/google-signin` and
 * `react-native-nitro-google-signin` as the current options and states that
 * neither runs in Expo Go - a development build is required. The older
 * `expo-auth-session` browser-redirect recipe is NOT what Expo points at for
 * native Google sign-in any more, so it is deliberately not used here.
 *
 * What this adapter is and is not: it obtains a Google ID TOKEN and hands it
 * back. It never becomes the app's session. `stores/auth.tsx` exchanges that
 * one-shot token for the app's own access/refresh pair through
 * `provider-auth-service.ts`, and only that pair is ever persisted.
 */

type GoogleSignInModule = typeof import('@react-native-google-signin/google-signin');

function loadModule(): GoogleSignInModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@react-native-google-signin/google-signin') as GoogleSignInModule;
}

/**
 * Whether this platform can present Google Sign-In at all. False on web,
 * where the button is hidden rather than offered and then refused.
 */
export function isGoogleSignInSupported(): boolean {
  return Platform.OS !== 'web';
}

/**
 * Whether the running build carries Google client IDs. The login screen
 * uses this to decide whether pressing the button can possibly work, and
 * the dev-only hint under it comes from the same source of truth.
 */
export function isGoogleSignInConfigured(): boolean {
  return resolveGoogleConfig().status === 'ready';
}

/**
 * Runs the native Google sign-in sheet and returns its ID token.
 *
 * Never throws for an expected outcome - a cancel, a missing config, or an
 * unavailable Play Services install each come back as their own
 * `GoogleSignInResult` branch, so the caller can react without a try/catch
 * around a control-flow exception.
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  if (!isGoogleSignInSupported()) {
    return { status: 'unsupported' };
  }

  const resolution = resolveGoogleConfig();

  if (resolution.status === 'missing') {
    if (__DEV__) {
      console.warn(describeMissingGoogleConfig(resolution.missingKeys));
    }

    return buildUnconfiguredResult(resolution.missingKeys);
  }

  const { GoogleSignin, isSuccessResponse, isCancelledResponse } = loadModule();

  try {
    GoogleSignin.configure({
      webClientId: resolution.config.webClientId,
      ...(resolution.config.iosClientId ? { iosClientId: resolution.config.iosClientId } : {}),
      // The app asks its own backend for a session; it never calls a Google
      // API on the user's behalf, so it needs neither extra scopes nor the
      // offline/serverAuthCode grant.
      offlineAccess: false,
    });

    // Resolves true on iOS unconditionally; on Android it is the difference
    // between a clear "this device can't do Google sign-in" and an opaque
    // native throw.
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

    const response = await GoogleSignin.signIn();

    if (isCancelledResponse(response)) {
      return { status: 'cancelled' };
    }

    if (!isSuccessResponse(response)) {
      return { status: 'failed', reason: 'Google returned an unrecognized response.' };
    }

    const { idToken } = response.data;

    if (!idToken) {
      // Documented as nullable by the SDK, and in practice this means the
      // webClientId is wrong for this Google project - a configuration
      // fault, not a user-facing one.
      return {
        status: 'failed',
        reason: 'Google returned no ID token; check that the web client ID matches this project.',
      };
    }

    return { status: 'success', idToken };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message : 'Google sign-in failed.',
    };
  }
}

/**
 * Clears the Google SDK's own cached account so the next sign-in shows the
 * account chooser again. Best-effort and deliberately silent: the app's
 * session has already been ended by `stores/auth.tsx` before this runs, and
 * a failure here must never make a logout look like it failed.
 */
export async function signOutFromGoogle(): Promise<void> {
  if (!isGoogleSignInSupported() || !isGoogleSignInConfigured()) {
    return;
  }

  try {
    await loadModule().GoogleSignin.signOut();
  } catch {
    // Nothing to recover: the app-side session is already gone.
  }
}
