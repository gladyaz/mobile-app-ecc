import type { GoogleSignInResult } from '@/services/auth/google-sign-in-contract';

export type { GoogleSignInResult };

/**
 * The web counterpart to `google-sign-in.ts`. Metro picks this file for
 * `platform: web` (the same `*.web.ts` convention already used by
 * `services/ads/interstitial-adapter.web.ts`, `use-color-scheme.web.ts` and
 * `animated-icon.web.tsx`), so `@react-native-google-signin/google-signin`
 * is never RESOLVED into the web bundle at all.
 *
 * That build-time exclusion is the whole point of this file, and it is not
 * something a `Platform.OS === 'web'` guard inside the native adapter could
 * achieve: Metro resolves the `require()` under such a guard at BUILD time
 * whichever branch would actually run, and the package's entry point pulls
 * in native-only React Native internals that Expo's web resolver rejects
 * outright. The AdMob adapter learned this the hard way; see its web file's
 * header for the full account.
 *
 * Every import here is `import type`, so nothing survives into the emitted
 * web bundle beyond the three functions below. Adding a value import from
 * the native adapter would defeat the boundary -
 * `google-web-import-boundary.test.ts` fails loudly if that happens.
 */

/** Web has no native Google Sign-In, so the login screen hides the button
 * rather than offering something it would then have to refuse. */
export function isGoogleSignInSupported(): boolean {
  return false;
}

/** Always false on web: with no supported flow, "is it configured" cannot
 * be true in any useful sense, and reporting otherwise would light up a
 * dev hint about env keys that would change nothing here. */
export function isGoogleSignInConfigured(): boolean {
  return false;
}

/** Mirrors the native adapter's contract: an expected, non-throwing
 * outcome. `stores/auth.tsx` maps `unsupported` to "no session, no error
 * toast", exactly as it does for a cancelled sheet. */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  return { status: 'unsupported' };
}

/** No native SDK session to clear on web. */
export async function signOutFromGoogle(): Promise<void> {
  // Intentionally empty: nothing was ever signed in through a native SDK.
}
