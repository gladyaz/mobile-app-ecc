import * as nativeAdapter from '@/services/auth/google-sign-in';
import * as webAdapter from '@/services/auth/google-sign-in.web';

/**
 * The runtime half of the Google web boundary, mirroring
 * `services/ads/__tests__/interstitial-adapter.web.test.ts` exactly.
 *
 * `google-web-import-boundary.test.ts` scans source TEXT, which catches a
 * direct import but can never see an INDIRECT edge (a module the web adapter
 * imports that itself pulls in the SDK) - module resolution is transitive,
 * and a grep is not. The tripwire below is: it throws instead of returning a
 * stub, so if `google-sign-in.web.ts` or anything it imports ever reaches
 * the native SDK, this file fails at import time with the reason.
 *
 * The export-parity check at the bottom guards the other failure this pair
 * is prone to: an export added to one platform file and forgotten in the
 * other compiles cleanly (TypeScript resolves the extensionless specifier to
 * the `.ts` only, and never structurally compares the `.web.ts`) and passes
 * every native Jest suite, then fails only in the web bundle at runtime.
 */
jest.mock('@react-native-google-signin/google-signin', () => {
  throw new Error(
    '@react-native-google-signin/google-signin was pulled into the web adapter module graph. ' +
      'google-sign-in.web.ts and everything it imports must stay free of it, or the ' +
      'Expo Web bundle breaks at resolution time.'
  );
});

describe('google-sign-in.web', () => {
  it('loads without pulling the native Google SDK into its module graph', () => {
    // Reaching this line at all is the assertion: the tripwire above would
    // have thrown during this file's imports otherwise.
    expect(typeof webAdapter.signInWithGoogle).toBe('function');
  });

  it('reports Google sign-in as unsupported so the button is hidden, not offered', () => {
    expect(webAdapter.isGoogleSignInSupported()).toBe(false);
    expect(webAdapter.isGoogleSignInConfigured()).toBe(false);
  });

  it('resolves to the "unsupported" outcome instead of throwing', async () => {
    await expect(webAdapter.signInWithGoogle()).resolves.toEqual({ status: 'unsupported' });
  });

  it('has nothing to sign out of, and says so without throwing', async () => {
    await expect(webAdapter.signOutFromGoogle()).resolves.toBeUndefined();
  });

  it('is safe to call repeatedly - it holds no state and starts no work', async () => {
    const results = await Promise.all([
      webAdapter.signInWithGoogle(),
      webAdapter.signInWithGoogle(),
      webAdapter.signInWithGoogle(),
    ]);

    expect(results).toEqual([
      { status: 'unsupported' },
      { status: 'unsupported' },
      { status: 'unsupported' },
    ]);
  });
});

describe('google sign-in platform contract', () => {
  /**
   * Metro resolves the two platform files interchangeably, so a caller must
   * not be able to tell which one it got.
   */
  it('exposes the identical public surface on both platforms', () => {
    expect(Object.keys(webAdapter).sort()).toEqual(Object.keys(nativeAdapter).sort());
  });

  it('keeps the same call signature for every shared function', () => {
    const sharedFunctionNames = Object.keys(webAdapter).filter(
      (name) => typeof (webAdapter as Record<string, unknown>)[name] === 'function'
    );

    // Guards the guard: an empty list would make the loop below vacuous.
    expect(sharedFunctionNames.length).toBeGreaterThan(0);

    for (const name of sharedFunctionNames) {
      const webFunction = (webAdapter as Record<string, unknown>)[name] as () => unknown;
      const nativeFunction = (nativeAdapter as Record<string, unknown>)[name] as () => unknown;

      expect(typeof nativeFunction).toBe('function');
      expect(webFunction).toHaveLength(nativeFunction.length);
    }
  });

  /**
   * Importing the native adapter under the tripwire above proves its
   * `require()` is still lazy: a module-scope import would have thrown while
   * this file's own imports were being evaluated.
   */
  it('leaves the native adapter importable without evaluating the native SDK', () => {
    expect(typeof nativeAdapter.signInWithGoogle).toBe('function');
  });
});
