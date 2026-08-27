import * as SecureStore from 'expo-secure-store';

import type { AuthTokens } from '@/types/auth';

/**
 * The ONE module in this app that is allowed to import `expo-secure-store`.
 *
 * Everything that needs bearer-token material at rest goes through
 * `services/auth/session-store.ts`, which goes through here. That single-import
 * rule is what `npm run release:preflight` enforces (see the
 * "secure session storage" rules in scripts/check-release-android.js): scattered
 * `SecureStore.setItemAsync` calls across screens would make "where do the
 * tokens live" unanswerable, and unenforceable.
 *
 * WHAT THIS BUYS ON ANDROID, verified against the INSTALLED implementation
 * (expo-secure-store@57.0.2, android/src/main/java/expo/modules/securestore/):
 *
 *  - `SecureStoreModule.kt` opens `KeyStore.getInstance("AndroidKeyStore")`, so
 *    the encryption key is generated and held by the Android Keystore rather
 *    than by this process. On hardware with a TEE or StrongBox the key material
 *    is not extractable from userspace at all.
 *  - `encryptors/AESEncryptor.kt` builds a `KeyGenParameterSpec` with
 *    `AES_KEY_SIZE_BITS = 256`, `BLOCK_MODE_GCM` and `ENCRYPTION_PADDING_NONE`,
 *    i.e. AES-256-GCM (`AES/GCM/NoPadding`) with a fresh IV per item.
 *  - The CIPHERTEXT lands in `context.getSharedPreferences("SecureStore",
 *    MODE_PRIVATE)`. So the bytes on disk are still inside this app's private
 *    data directory - what changed is that they are now ciphertext whose key
 *    lives in the Keystore, instead of the plaintext JSON that
 *    `stores/auth.tsx` used to hand AsyncStorage.
 *
 * WHAT THIS DOES NOT BUY, stated so no one reads more into it later:
 *
 *  - It is not protection against a viewer who has unlocked the device and is
 *    running a debugger against a debuggable build, and it is not protection
 *    against a rooted device where an attacker can ask the Keystore to decrypt
 *    on the app's behalf. Keystore binds the key to the DEVICE and to this
 *    app's signing identity; it does not bind it to a human.
 *  - `requireAuthentication` is deliberately NOT set. Turning it on would put a
 *    biometric prompt in front of every cold start and every background token
 *    refresh, and `expo-secure-store`'s own docs note that such keys are
 *    INVALIDATED when the enrolled biometrics change - which would silently and
 *    permanently sign people out for adding a fingerprint. That is a product
 *    decision this V1 has not taken.
 *  - AsyncStorage itself is NOT encrypted by any of this, and nothing here
 *    should ever be described as encrypting it. What this module does is stop
 *    token material from being put there at all.
 */

/**
 * SecureStore keys are validated by the library against `/^[\w.-]+$/`, so the
 * app's usual `@mobile-app-ecc/...` AsyncStorage key style is NOT legal here -
 * both `@` and `/` are rejected, and `setItemAsync` would throw. Hence a
 * separate, deliberately dotted name rather than a renamed AsyncStorage key.
 *
 * `.v1` is a schema marker for the JSON value below, not the app version.
 */
const SESSION_TOKENS_KEY = 'mobile-app-ecc.session-tokens.v1';

/**
 * The result of asking secure storage for the current pair.
 *
 * `empty` and `unusable` are kept apart on purpose, because they license
 * different actions. `empty` is a fact - secure storage answered, and there is
 * nothing stored - which is what makes a legacy migration safe to attempt.
 * `unusable` means the question could not be answered at all (no native module,
 * or the read threw), and the caller must NOT then go looking for a plaintext
 * copy to sign in from; see `session-store.ts`.
 */
export type SecureTokenRead =
  | { readonly status: 'found'; readonly tokens: AuthTokens }
  | { readonly status: 'empty' }
  | { readonly status: 'unusable' };

/**
 * Whether a write actually reached Keystore-backed storage.
 *
 * `unavailable` is NOT an error. On web `expo-secure-store`'s native module is
 * literally `{}` (see build/ExpoSecureStore.web.js), so there is no secure
 * place to put anything - the session stays in memory for that run and is gone
 * on reload. Making that throw would break `npm run web` sign-in outright,
 * which is a different bug from the one this work exists to fix.
 */
export type SecureWriteOutcome = 'persisted' | 'unavailable';

/**
 * A write that was supposed to work and did not.
 *
 * Distinct from `unavailable` so `stores/auth.tsx` can refuse to enter an
 * authenticated state on a real failure while still signing people in on a
 * platform that simply has no secure storage.
 */
export class SessionSecretWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionSecretWriteError';
  }
}

/**
 * Checked before every call rather than cached.
 *
 * `isAvailableAsync()` is a property check on the native module object, not a
 * device round-trip, so there is nothing to save by caching it - and a cached
 * value is one more piece of module state that has to be reset between tests
 * and can go stale after a reload.
 */
async function isSecureStoreUsable(): Promise<boolean> {
  try {
    return await SecureStore.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Parses a stored value back into a token pair, or null if it is not one.
 *
 * Anything that is not two non-empty strings is treated as absent rather than
 * repaired. A half-written or hand-edited value is not a session, and guessing
 * at one would produce requests that fail with a 401 forever instead of a
 * clean re-login.
 */
function parseTokens(raw: string): AuthTokens | null {
  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null) {
      return null;
    }

    const { accessToken, refreshToken } = parsed as Record<string, unknown>;

    if (typeof accessToken !== 'string' || !accessToken) {
      return null;
    }

    if (typeof refreshToken !== 'string' || !refreshToken) {
      return null;
    }

    return { accessToken, refreshToken };
  } catch {
    return null;
  }
}

/** Reads the stored pair. Never throws; see `SecureTokenRead`. */
export async function readTokens(): Promise<SecureTokenRead> {
  if (!(await isSecureStoreUsable())) {
    return { status: 'unusable' };
  }

  let raw: string | null;

  try {
    raw = await SecureStore.getItemAsync(SESSION_TOKENS_KEY);
  } catch {
    // A decrypt failure (key invalidated, ciphertext corrupted) is NOT "no
    // session" - it is "we cannot tell". Reporting it as `empty` would let a
    // caller conclude the store is clean and migrate a plaintext copy over the
    // top of a real, unreadable one.
    return { status: 'unusable' };
  }

  if (!raw) {
    return { status: 'empty' };
  }

  const tokens = parseTokens(raw);

  return tokens ? { status: 'found', tokens } : { status: 'empty' };
}

/**
 * Writes the pair as ONE value, then reads it back to confirm.
 *
 * ONE VALUE, NOT TWO KEYS: the access and refresh tokens must move together.
 * Two keys means a crash between the two writes leaves a new access token
 * beside a spent refresh token - a session that works until the first 401 and
 * then cannot be refreshed, which is the worst of both states.
 *
 * THE READ-BACK is what lets `session-store.ts` promise that a legacy plaintext
 * token is only ever removed after the secure copy demonstrably exists. A write
 * that resolves is not by itself proof the value can be read again (a wedged
 * Keystore alias decrypts to nothing on the way out), and the whole migration
 * turns on that distinction.
 *
 * @throws {SessionSecretWriteError} when secure storage is available but the
 * value could not be stored or could not be read back identically.
 */
export async function writeTokens(tokens: AuthTokens): Promise<SecureWriteOutcome> {
  if (!(await isSecureStoreUsable())) {
    return 'unavailable';
  }

  const serialized = JSON.stringify({
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  });

  try {
    await SecureStore.setItemAsync(SESSION_TOKENS_KEY, serialized);
  } catch (error) {
    throw new SessionSecretWriteError(
      `Could not write the session tokens to secure storage: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    );
  }

  const verification = await readTokens();

  if (
    verification.status !== 'found' ||
    verification.tokens.accessToken !== tokens.accessToken ||
    verification.tokens.refreshToken !== tokens.refreshToken
  ) {
    throw new SessionSecretWriteError(
      'Secure storage accepted the session tokens but did not read them back unchanged.'
    );
  }

  return 'persisted';
}

/**
 * Removes the stored pair. Best-effort and NEVER throws: sign-out has to
 * finish client-side whatever storage does, exactly like the network logout
 * call it sits next to.
 *
 * A delete that fails leaves tokens with no account metadata beside them, and
 * `session-store.ts`'s restore treats that orphan as signed-out and clears it
 * again on the next launch - so a failure here self-heals rather than
 * resurrecting a session.
 */
export async function clearTokens(): Promise<void> {
  if (!(await isSecureStoreUsable())) {
    return;
  }

  try {
    await SecureStore.deleteItemAsync(SESSION_TOKENS_KEY);
  } catch {
    // Deliberately swallowed; see the doc comment above.
  }
}

/** Exposed so tests can assert against the real key rather than a copy of it. */
export const __SESSION_TOKENS_KEY = SESSION_TOKENS_KEY;
