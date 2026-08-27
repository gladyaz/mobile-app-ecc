import {
  clearPersistedAccount,
  readLegacyAuthEnvelope,
  readPersistedAccount,
  toPersistedAccount,
  writePersistedAccount,
  type PersistedAccount,
} from '@/services/auth/persisted-account';
import {
  clearTokens,
  readTokens,
  writeTokens,
  type SecureWriteOutcome,
} from '@/services/auth/session-secret-store';
import type { AuthTokens } from '@/types/auth';

/**
 * The session persistence boundary `stores/auth.tsx` talks to, and the only
 * place that knows a session is stored in TWO places at once.
 *
 * THE SPLIT, and why it is not "put everything in the Keystore":
 *
 *  - The bearer pair is SECRET. It authenticates requests, so it goes to
 *    `session-secret-store.ts` (Android Keystore, AES-256-GCM).
 *  - The account metadata is PRIVATE BUT NOT SECRET. It renders a name and an
 *    avatar letter; it authorises nothing. It stays in AsyncStorage via
 *    `persisted-account.ts`.
 *
 * Moving the metadata into secure storage too would buy nothing (it is already
 * covered by the same deny-all backup policy, and it is not a credential) and
 * would cost a Keystore decrypt on the launch path of every cold start.
 * Everything ordinary - language, likes, saved videos, watch progress, ad
 * counters - is untouched by this module and stays exactly where it was.
 *
 * THE INVARIANT THIS MODULE EXISTS TO HOLD: an authenticated app state is only
 * ever produced when a secure credential was actually read or actually written.
 * Account metadata on its own is never enough. That is what makes "no fake
 * successful session when the secure token read fails" true by construction
 * rather than by remembering to check.
 */

/**
 * A session recovered from storage: both halves, or nothing.
 *
 * There is deliberately no "metadata only" variant. A caller that could see one
 * would have to decide what to do about it, and the only correct answer is
 * "treat it as signed out" - so it is not representable.
 */
export type RestoredSession = {
  readonly account: PersistedAccount;
  readonly tokens: AuthTokens;
};

export type SessionRestore =
  | { readonly status: 'restored'; readonly session: RestoredSession }
  | { readonly status: 'signed-out' };

const SIGNED_OUT: SessionRestore = { status: 'signed-out' };

/**
 * Validates a legacy version-3 `tokens` field into a usable pair.
 *
 * Deliberately strict: two non-empty strings or nothing. A payload with an
 * access token and no refresh token is not a session that can survive its
 * first expiry, and migrating one would move a dead session into secure
 * storage and call it a success.
 */
function toAuthTokens(value: unknown): AuthTokens | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const { accessToken, refreshToken } = value as Record<string, unknown>;

  if (typeof accessToken !== 'string' || !accessToken) {
    return null;
  }

  if (typeof refreshToken !== 'string' || !refreshToken) {
    return null;
  }

  return { accessToken, refreshToken };
}

/**
 * Finishes a migration whose secure half already landed.
 *
 * Called when secure storage HAS the pair but AsyncStorage still holds a
 * version-3 payload - i.e. the process died between the secure write and the
 * rewrite, or a previous run got exactly that far. Writing the version-4
 * envelope over the top is what actually removes the plaintext copy, and it is
 * safe to repeat because it does not depend on anything the interrupted run
 * left behind.
 */
async function completeInterruptedMigration(): Promise<PersistedAccount | null> {
  const legacy = await readLegacyAuthEnvelope();

  if (!legacy) {
    return null;
  }

  const account = toPersistedAccount(legacy.user);

  if (!account) {
    return null;
  }

  await writePersistedAccount(account);

  return account;
}

/**
 * Moves a version-3 payload's credentials into secure storage, then removes
 * them from AsyncStorage.
 *
 * ORDER IS THE WHOLE POINT and it is not negotiable: `writeTokens` both stores
 * AND reads back (see `session-secret-store.ts`), and only after it has
 * returned `persisted` is `writePersistedAccount` allowed to overwrite the
 * envelope that currently holds the only copy. A failure anywhere before that
 * line leaves the legacy payload exactly as it was, so the next launch tries
 * again from the same state - which is what makes this idempotent and
 * retryable rather than a one-shot that can strand someone signed out with
 * their credentials destroyed.
 */
async function migrateLegacySession(
  account: PersistedAccount,
  tokens: AuthTokens
): Promise<SessionRestore> {
  let outcome: SecureWriteOutcome;

  try {
    outcome = await writeTokens(tokens);
  } catch {
    // A real write failure. The legacy payload is untouched and still holds the
    // only copy, so a later launch can retry. This run stays SIGNED OUT rather
    // than running authenticated off a plaintext copy that was supposed to be
    // gone - see the module doc's invariant.
    return SIGNED_OUT;
  }

  if (outcome === 'unavailable') {
    // No secure storage on this platform at all (web). Nothing can be migrated,
    // now or ever, so there is no retry to protect. The legacy payload is left
    // ALONE rather than deleted: deleting it would destroy the only copy
    // without a secure write having succeeded, which is the one thing this
    // migration must never do. The viewer signs in again instead.
    return SIGNED_OUT;
  }

  await writePersistedAccount(account);

  return { status: 'restored', session: { account, tokens } };
}

/**
 * Reconstructs the session at app start, migrating a pre-upgrade payload on the
 * way if one is present.
 *
 * Every state an installed handset can actually be in, and what happens:
 *
 *  - Nothing stored anywhere                  -> signed out.
 *  - Secure pair + version-4 metadata         -> restored (the ordinary path).
 *  - Secure pair + version-3 payload          -> restored, and the interrupted
 *                                                migration is completed.
 *  - Secure pair + no metadata at all         -> signed out, and the orphaned
 *                                                pair is cleared. This is what
 *                                                a failed sign-out delete looks
 *                                                like on the next launch, and
 *                                                it self-heals here.
 *  - No secure pair + version-3 payload       -> migrated; see
 *                                                `migrateLegacySession`.
 *  - No secure pair + version-4 metadata      -> signed out. The credential is
 *                                                gone (sign-out, a wiped
 *                                                Keystore entry); metadata
 *                                                alone never authenticates.
 *  - Secure read UNUSABLE                     -> signed out, and NOTHING is
 *                                                touched. Not knowing whether a
 *                                                credential exists is not a
 *                                                licence to migrate a plaintext
 *                                                copy over the top of it, nor
 *                                                to delete anything.
 *  - Malformed legacy payload                 -> signed out, left in place. It
 *                                                is not a session, and there is
 *                                                nothing safe to derive.
 *
 * Never throws. A launch path that can throw is a launch path that can white-
 * screen the app over a storage problem, and every branch above has a truthful
 * signed-out answer available.
 */
export async function restoreSession(): Promise<SessionRestore> {
  const secure = await readTokens();

  if (secure.status === 'unusable') {
    return SIGNED_OUT;
  }

  if (secure.status === 'found') {
    const account = (await readPersistedAccount()) ?? (await completeInterruptedMigration());

    if (!account) {
      await clearTokens();

      return SIGNED_OUT;
    }

    return { status: 'restored', session: { account, tokens: secure.tokens } };
  }

  const legacy = await readLegacyAuthEnvelope();

  if (!legacy) {
    return SIGNED_OUT;
  }

  const account = toPersistedAccount(legacy.user);
  const tokens = toAuthTokens(legacy.tokens);

  if (!account || !tokens) {
    return SIGNED_OUT;
  }

  return migrateLegacySession(account, tokens);
}

/**
 * Persists a newly adopted session - a fresh sign-in, from any provider.
 *
 * SECRET FIRST, AND IT CAN THROW. `stores/auth.tsx` awaits this BEFORE it sets
 * any React state, so a storage failure surfaces as a failed sign-in rather
 * than as an app that looks signed in and is signed out again on next launch.
 *
 * ACCOUNT SWITCHING falls out of this for free: both destinations hold exactly
 * one value under one key, so writing account B's session overwrites account
 * A's in both places. There is no per-account key that could be left behind for
 * the next person to find.
 *
 * When secure storage is UNAVAILABLE (web), the metadata is cleared rather than
 * written. Persisting a name with no credential to go with it would leave a
 * launch reading metadata it must then refuse to act on; a session that cannot
 * be stored securely is simply not stored.
 *
 * @throws {SessionSecretWriteError} when secure storage is available but the
 * credential could not be stored.
 */
export async function persistSession(
  account: PersistedAccount,
  tokens: AuthTokens
): Promise<SecureWriteOutcome> {
  const outcome = await writeTokens(tokens);

  if (outcome === 'unavailable') {
    await clearPersistedAccount();

    return outcome;
  }

  await writePersistedAccount(account);

  return outcome;
}

/**
 * Persists a pair the refresh interceptor rotated, leaving the account
 * metadata alone (a rotation changes the credential, not who is signed in).
 *
 * @throws {SessionSecretWriteError} on a real write failure, for the caller to
 * decide about; see `stores/auth.tsx`, which treats it as best-effort because
 * the in-memory pair is still valid for the rest of the run.
 */
export async function persistRotatedTokens(tokens: AuthTokens): Promise<SecureWriteOutcome> {
  return writeTokens(tokens);
}

/**
 * Removes both halves of the session. Never throws, for the same reason the
 * network logout call is best-effort: a viewer who pressed sign out must end up
 * signed out regardless of what storage does.
 *
 * The credential is cleared FIRST. If the process dies between the two, what
 * survives is metadata with no credential - which `restoreSession` reads as
 * signed out. The opposite order would leave a live credential with no metadata
 * for a moment, which is also handled, but only one of the two orders fails
 * toward "signed out" at every instant.
 */
export async function clearSession(): Promise<void> {
  await clearTokens();
  await clearPersistedAccount();
}
