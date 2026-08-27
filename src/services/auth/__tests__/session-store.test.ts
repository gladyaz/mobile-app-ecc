import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  ACCOUNT_STORAGE_VERSION,
  LEGACY_ACCOUNT_STORAGE_VERSION,
  type PersistedAccount,
} from '@/services/auth/persisted-account';
import {
  __SESSION_TOKENS_KEY,
  SessionSecretWriteError,
  readTokens,
} from '@/services/auth/session-secret-store';
import {
  clearSession,
  persistRotatedTokens,
  persistSession,
  restoreSession,
} from '@/services/auth/session-store';
import { setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import type { AuthTokens } from '@/types/auth';

/**
 * The persistence half of the secure-session work, tested at the boundary
 * rather than through React.
 *
 * WHAT THESE ASSERT AGAINST. Every "the token is/is not there" assertion reads
 * the RAW stored bytes - `AsyncStorage.getItem` for the plaintext store,
 * `__peekSecureStore` for the secure one - never the module's own report of
 * what it stored. A test that asks `restoreSession()` whether the token moved
 * would pass just as happily if nothing moved at all.
 *
 * NO REAL CREDENTIALS. Every value below is a synthetic string chosen to be
 * greppable in a failure message.
 */

type SecureStoreMockControls = {
  readonly __resetSecureStoreMock: () => void;
  readonly __setSecureStoreAvailable: (available: boolean) => void;
  readonly __failSecureStore: (
    operation: 'read' | 'write' | 'delete',
    mode?: 'throw' | 'drop',
    times?: number | 'always'
  ) => void;
  readonly __peekSecureStore: (key: string) => string | null;
  readonly __secureStoreKeys: () => string[];
};

const secureStore = jest.requireMock<SecureStoreMockControls>('expo-secure-store');

const ACCOUNT_A: PersistedAccount = {
  id: 'user_001',
  name: 'Account A',
  username: 'account-a',
  email: 'account-a@example.test',
};

const ACCOUNT_B: PersistedAccount = {
  id: 'user_002',
  name: 'Account B',
  username: 'account-b',
  email: 'account-b@example.test',
};

const TOKENS_A: AuthTokens = {
  accessToken: 'access-for-account-a',
  refreshToken: 'refresh-for-account-a',
};

const TOKENS_B: AuthTokens = {
  accessToken: 'access-for-account-b',
  refreshToken: 'refresh-for-account-b',
};

const LEGACY_TOKENS: AuthTokens = {
  accessToken: 'legacy-access',
  refreshToken: 'legacy-refresh',
};

/** Writes the pre-upgrade version-3 payload an installed build would hold. */
async function seedLegacyPayload(
  user: unknown = ACCOUNT_A,
  tokens: unknown = LEGACY_TOKENS
): Promise<void> {
  await setItem(STORAGE_KEYS.auth, LEGACY_ACCOUNT_STORAGE_VERSION, { user, tokens });
}

/** The raw AsyncStorage string under the auth key, or null. */
async function readRawAuthPayload(): Promise<string | null> {
  return AsyncStorage.getItem(STORAGE_KEYS.auth);
}

/** The raw secure-storage string under the session key, or null. */
function readRawSecretPayload(): string | null {
  return secureStore.__peekSecureStore(__SESSION_TOKENS_KEY);
}

/**
 * Asserts that no part of a token pair appears anywhere in the AsyncStorage
 * auth payload - neither the field names nor the values.
 *
 * Checks the SERIALIZED payload rather than a parsed object on purpose: a
 * token smuggled into a nested field, or under a renamed key, would still be
 * plaintext on disk, and a shape-based assertion would miss it.
 */
async function expectNoTokenMaterialInAsyncStorage(): Promise<void> {
  const raw = (await readRawAuthPayload()) ?? '';

  expect(raw).not.toContain('accessToken');
  expect(raw).not.toContain('refreshToken');

  for (const value of [
    TOKENS_A.accessToken,
    TOKENS_A.refreshToken,
    TOKENS_B.accessToken,
    TOKENS_B.refreshToken,
    LEGACY_TOKENS.accessToken,
    LEGACY_TOKENS.refreshToken,
  ]) {
    expect(raw).not.toContain(value);
  }
}

beforeEach(async () => {
  await AsyncStorage.clear();
  secureStore.__resetSecureStoreMock();
});

describe('session persistence boundary', () => {
  describe('a new sign-in', () => {
    // 1. new login writes tokens only to secure storage
    it('writes the token pair to secure storage and nowhere else', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);

      const secret = readRawSecretPayload();

      expect(secret).toContain(TOKENS_A.accessToken);
      expect(secret).toContain(TOKENS_A.refreshToken);
      expect(secureStore.__secureStoreKeys()).toEqual([__SESSION_TOKENS_KEY]);
    });

    // 2. AsyncStorage auth payload contains no token
    it('leaves no token material in the AsyncStorage auth payload', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);

      await expectNoTokenMaterialInAsyncStorage();
    });

    it('persists exactly the four non-secret account fields', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);

      const raw = await readRawAuthPayload();

      expect(JSON.parse(raw ?? '{}')).toEqual({
        version: ACCOUNT_STORAGE_VERSION,
        data: {
          id: 'user_001',
          name: 'Account A',
          username: 'account-a',
          email: 'account-a@example.test',
        },
      });
    });

    it('refuses to report success when secure storage rejects the write', async () => {
      secureStore.__failSecureStore('write', 'throw', 'always');

      await expect(persistSession(ACCOUNT_A, TOKENS_A)).rejects.toBeInstanceOf(
        SessionSecretWriteError
      );
    });

    it('refuses to report success when a write is accepted but stores nothing', async () => {
      // The read-back verification is the only thing that can catch this: the
      // write itself resolves, so a caller that trusted it would enter an
      // authenticated state with no credential stored anywhere.
      secureStore.__failSecureStore('write', 'drop', 'always');

      await expect(persistSession(ACCOUNT_A, TOKENS_A)).rejects.toBeInstanceOf(
        SessionSecretWriteError
      );
    });
  });

  describe('cold start', () => {
    // 3. cold-start hydration
    it('restores both halves of a previously persisted session', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);

      const restored = await restoreSession();

      expect(restored).toEqual({
        status: 'restored',
        session: { account: ACCOUNT_A, tokens: TOKENS_A },
      });
    });

    it('starts signed out when nothing is stored', async () => {
      expect(await restoreSession()).toEqual({ status: 'signed-out' });
    });

    it('starts signed out when the account metadata has no credential beside it', async () => {
      // Metadata alone must never authenticate anyone: this is what a wiped
      // Keystore entry (or a sign-out that cleared only half) looks like.
      await setItem(STORAGE_KEYS.auth, ACCOUNT_STORAGE_VERSION, ACCOUNT_A);

      expect(await restoreSession()).toEqual({ status: 'signed-out' });
    });

    it('clears an orphaned credential that has no account metadata', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);
      await AsyncStorage.clear();

      expect(await restoreSession()).toEqual({ status: 'signed-out' });
      expect(readRawSecretPayload()).toBeNull();
    });

    // 14. secure read failure
    it('stays signed out - and touches nothing - when the secure read fails', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);
      secureStore.__failSecureStore('read', 'throw', 'always');

      expect(await restoreSession()).toEqual({ status: 'signed-out' });
      // Nothing was deleted on the way: an unreadable credential is "we cannot
      // tell", not "there is nothing here", so a later launch can still recover.
      expect(readRawSecretPayload()).not.toBeNull();
      expect(await readRawAuthPayload()).not.toBeNull();
    });

    it('stays signed out when the platform has no secure storage at all', async () => {
      secureStore.__setSecureStoreAvailable(false);

      expect(await restoreSession()).toEqual({ status: 'signed-out' });
    });
  });

  describe('legacy migration', () => {
    // 8. successful legacy migration
    it('moves a version-3 payload into secure storage and restores the session', async () => {
      await seedLegacyPayload();

      const restored = await restoreSession();

      expect(restored).toEqual({
        status: 'restored',
        session: { account: ACCOUNT_A, tokens: LEGACY_TOKENS },
      });
      expect(readRawSecretPayload()).toContain(LEGACY_TOKENS.accessToken);
    });

    // 11. migrated legacy token removed afterward
    it('leaves no token material in AsyncStorage once the migration has run', async () => {
      await seedLegacyPayload();

      await restoreSession();

      await expectNoTokenMaterialInAsyncStorage();
    });

    it('keeps the non-secret account metadata across the migration', async () => {
      await seedLegacyPayload();

      await restoreSession();

      const raw = await readRawAuthPayload();

      expect(JSON.parse(raw ?? '{}')).toEqual({
        version: ACCOUNT_STORAGE_VERSION,
        data: ACCOUNT_A,
      });
    });

    it('is idempotent - a second launch changes nothing', async () => {
      await seedLegacyPayload();

      const first = await restoreSession();
      const afterFirst = await readRawAuthPayload();
      const second = await restoreSession();

      expect(second).toEqual(first);
      expect(await readRawAuthPayload()).toBe(afterFirst);
    });

    // 9. secure write failure leaves legacy token intact
    it('leaves the legacy payload untouched when the secure write fails', async () => {
      await seedLegacyPayload();
      secureStore.__failSecureStore('write', 'throw', 'always');

      const restored = await restoreSession();

      // Signed out rather than authenticated: continuing would mean running on
      // a plaintext credential that was supposed to be gone.
      expect(restored).toEqual({ status: 'signed-out' });

      const raw = (await readRawAuthPayload()) ?? '';

      expect(raw).toContain(LEGACY_TOKENS.accessToken);
      expect(raw).toContain(LEGACY_TOKENS.refreshToken);
      expect(JSON.parse(raw).version).toBe(LEGACY_ACCOUNT_STORAGE_VERSION);
    });

    it('leaves the legacy payload untouched when the write silently stores nothing', async () => {
      await seedLegacyPayload();
      secureStore.__failSecureStore('write', 'drop', 'always');

      expect(await restoreSession()).toEqual({ status: 'signed-out' });
      expect((await readRawAuthPayload()) ?? '').toContain(LEGACY_TOKENS.accessToken);
    });

    // 10. migration retry succeeds
    it('succeeds on the next launch after a failed attempt', async () => {
      await seedLegacyPayload();
      secureStore.__failSecureStore('write', 'throw', 1);

      expect(await restoreSession()).toEqual({ status: 'signed-out' });

      const retried = await restoreSession();

      expect(retried).toEqual({
        status: 'restored',
        session: { account: ACCOUNT_A, tokens: LEGACY_TOKENS },
      });
      await expectNoTokenMaterialInAsyncStorage();
    });

    it('does not delete the legacy payload on a platform with no secure storage', async () => {
      // Nothing can be migrated on web, ever. Deleting the only copy without a
      // successful secure write is the one thing the migration must never do.
      await seedLegacyPayload();
      secureStore.__setSecureStoreAvailable(false);

      expect(await restoreSession()).toEqual({ status: 'signed-out' });
      expect((await readRawAuthPayload()) ?? '').toContain(LEGACY_TOKENS.accessToken);
    });

    // 12. existing secure state wins appropriately
    it('prefers the secure credential over a stale legacy payload, and strips the legacy one', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);
      // A crash between the secure write and the rewrite would leave exactly
      // this: a good secure pair, and the old plaintext envelope still there.
      await seedLegacyPayload(ACCOUNT_A, LEGACY_TOKENS);

      const restored = await restoreSession();

      expect(restored).toEqual({
        status: 'restored',
        session: { account: ACCOUNT_A, tokens: TOKENS_A },
      });
      await expectNoTokenMaterialInAsyncStorage();
    });

    // 13. malformed legacy state
    it.each([
      ['a token pair that is not an object', ACCOUNT_A, 'not-an-object'],
      ['a pair missing its refresh token', ACCOUNT_A, { accessToken: 'legacy-access' }],
      ['an empty access token', ACCOUNT_A, { accessToken: '', refreshToken: 'legacy-refresh' }],
      ['a user with no id', { name: 'No Id' }, LEGACY_TOKENS],
      ['a null user', null, LEGACY_TOKENS],
    ])('stays signed out for %s', async (_label, user, tokens) => {
      await seedLegacyPayload(user, tokens);

      expect(await restoreSession()).toEqual({ status: 'signed-out' });
      // Nothing half-usable was promoted into secure storage.
      expect(readRawSecretPayload()).toBeNull();
    });

    it('ignores a version-2 payload rather than migrating a shape that was wrong', async () => {
      // Version 2 stored `email: ''` and `name: <account id>` for an account
      // with no address - the exact states version 3 existed to remove.
      await setItem(STORAGE_KEYS.auth, 2, {
        user: { id: 'user_003', name: 'user_003', username: '', email: '' },
        tokens: LEGACY_TOKENS,
      });

      expect(await restoreSession()).toEqual({ status: 'signed-out' });
      expect(readRawSecretPayload()).toBeNull();
    });
  });

  describe('token rotation', () => {
    // 6. refresh updates secure access token
    it('writes a refreshed access token to secure storage', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);

      await persistRotatedTokens({
        accessToken: 'rotated-access',
        refreshToken: TOKENS_A.refreshToken,
      });

      const secret = readRawSecretPayload() ?? '';

      expect(secret).toContain('rotated-access');
      expect(secret).not.toContain(TOKENS_A.accessToken);
    });

    // 7. refresh-token rotation updates secure refresh token
    it('writes a rotated refresh token too, so the pair stays usable together', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);

      await persistRotatedTokens({
        accessToken: 'rotated-access',
        refreshToken: 'rotated-refresh',
      });

      const restored = await restoreSession();

      expect(restored).toEqual({
        status: 'restored',
        session: {
          account: ACCOUNT_A,
          tokens: { accessToken: 'rotated-access', refreshToken: 'rotated-refresh' },
        },
      });
      // The spent pair is gone rather than lingering beside the new one.
      expect(readRawSecretPayload()).not.toContain(TOKENS_A.refreshToken);
    });

    it('does not rewrite the account metadata on a rotation', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);
      const before = await readRawAuthPayload();

      await persistRotatedTokens({ accessToken: 'rotated-access', refreshToken: 'rotated-refresh' });

      expect(await readRawAuthPayload()).toBe(before);
    });
  });

  describe('sign-out', () => {
    // 4. logout clears secure tokens
    it('clears the credential and the account metadata', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);

      await clearSession();

      expect(readRawSecretPayload()).toBeNull();
      expect(await readRawAuthPayload()).toBeNull();
      expect(await restoreSession()).toEqual({ status: 'signed-out' });
    });

    it('still finishes when the secure delete fails, and self-heals next launch', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);
      secureStore.__failSecureStore('delete', 'throw', 1);

      await expect(clearSession()).resolves.toBeUndefined();

      // The credential survived the failed delete, but with no metadata beside
      // it the next launch treats it as an orphan and removes it.
      expect(readRawSecretPayload()).not.toBeNull();
      expect(await restoreSession()).toEqual({ status: 'signed-out' });
      expect(readRawSecretPayload()).toBeNull();
    });
  });

  describe('account switching', () => {
    // 5. account switch clears old tokens
    // 15. no cross-user token leakage
    it('replaces the previous account credential rather than keeping both', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);
      await persistSession(ACCOUNT_B, TOKENS_B);

      const secret = readRawSecretPayload() ?? '';

      expect(secret).toContain(TOKENS_B.accessToken);
      expect(secret).not.toContain(TOKENS_A.accessToken);
      expect(secret).not.toContain(TOKENS_A.refreshToken);
      expect(secureStore.__secureStoreKeys()).toEqual([__SESSION_TOKENS_KEY]);
    });

    it('restores only the second account after a switch', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);
      await persistSession(ACCOUNT_B, TOKENS_B);

      expect(await restoreSession()).toEqual({
        status: 'restored',
        session: { account: ACCOUNT_B, tokens: TOKENS_B },
      });
      await expectNoTokenMaterialInAsyncStorage();
    });

    it('leaves nothing of the first account behind after sign-out and sign-in', async () => {
      await persistSession(ACCOUNT_A, TOKENS_A);
      await clearSession();
      await persistSession(ACCOUNT_B, TOKENS_B);

      const read = await readTokens();

      expect(read).toEqual({ status: 'found', tokens: TOKENS_B });
      expect(JSON.parse((await readRawAuthPayload()) ?? '{}').data.id).toBe(ACCOUNT_B.id);
    });
  });

  describe('a platform with no secure storage', () => {
    it('signs in for the run without persisting anything', async () => {
      secureStore.__setSecureStoreAvailable(false);

      await expect(persistSession(ACCOUNT_A, TOKENS_A)).resolves.toBe('unavailable');

      // No credential anywhere, and no orphaned metadata claiming a session
      // that cannot be restored.
      expect(readRawSecretPayload()).toBeNull();
      expect(await readRawAuthPayload()).toBeNull();
    });
  });
});
