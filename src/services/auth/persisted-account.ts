import { getItem, removeItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';

/**
 * The ONE module allowed to read or write the `@mobile-app-ecc/auth`
 * AsyncStorage key.
 *
 * WHAT IS PERSISTED HERE, AND WHY IT IS SAFE TO. Only the non-secret account
 * metadata the app needs to render a signed-in shell before any network call:
 * the account id and the three display fields. None of it authenticates
 * anything - it cannot be presented to the backend, and on its own it produces
 * a signed-out app (see `session-store.ts`'s restore, which refuses to call
 * anyone authenticated without a secure credential to go with it).
 *
 * WHAT IS DELIBERATELY NOT PERSISTED HERE: the bearer credentials. They live in
 * `session-secret-store.ts`, behind the Android Keystore. This module's source
 * is checked by `npm run release:preflight` for any mention of them, which is
 * what stops a future edit from quietly reintroducing the plaintext copy this
 * work exists to remove.
 *
 * THE KEY NAME IS UNCHANGED on purpose. Renaming it would strand every already
 * installed build's stored account behind a key nothing reads, turning a
 * migration into a silent data loss for no benefit - the VERSION field inside
 * the envelope is what distinguishes the old shape from the new one.
 */

/**
 * The persisted account metadata, and the exact shape of the `data` field of
 * the version-4 envelope.
 *
 * Structurally identical to `stores/auth.tsx`'s public `AuthUser` because it IS
 * that type - the store aliases this one rather than declaring a twin that
 * could drift from what is actually written to disk.
 *
 * All three display fields are nullable, carried over unchanged from the
 * version-3 shape: the backend's `user.email` is `string | null` (a
 * WhatsApp-only account has no address), and there is nothing truthful to
 * derive a name or handle from when it is null.
 */
export type PersistedAccount = {
  readonly id: string;
  readonly name: string | null;
  readonly username: string | null;
  readonly email: string | null;
};

/**
 * Version 4 is the credential-free shape: `{ id, name, username, email }` and
 * nothing else.
 *
 * Version 3 was `{ user, tokens }` - the same account metadata plus the
 * backend's bearer pair as plaintext JSON. That is the shape this work
 * removes, and the version bump is what lets a launch tell "already migrated"
 * apart from "still holds the old payload" without guessing from the contents.
 */
export const ACCOUNT_STORAGE_VERSION = 4;

/**
 * The last version whose payload carried credentials.
 *
 * Read ONLY by `session-store.ts`'s migration, and only for as long as
 * installed builds may still hold one. Versions 1 and 2 are deliberately not
 * readable: version 2 persisted `email: ''` and `name: <account id>` for an
 * account with no address, which is exactly the pair of wrong states version 3
 * existed to remove, so restoring one would reintroduce them.
 */
export const LEGACY_ACCOUNT_STORAGE_VERSION = 3;

/**
 * A version-3 payload, exactly as loosely as it can honestly be typed.
 *
 * Both fields are `unknown` because this is data that has been sitting on a
 * handset across app upgrades - it may be half-written, hand-edited, or from a
 * build that predates the current shape. `session-store.ts` validates both
 * before doing anything with either; nothing here is trusted on sight.
 */
export type LegacyAuthEnvelope = {
  readonly user: unknown;
  readonly tokens: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Validates a stored (or legacy) account object into a `PersistedAccount`, or
 * null when it is not usable.
 *
 * A non-empty `id` is the only hard requirement, because it is the one field
 * with a consumer that cannot fall back: `video-interactions.tsx` and
 * `series-progress.tsx` scope their own storage keys by it, so an account with
 * no id would silently share another account's likes and watch progress.
 * Everything else is display text that the profile screen already renders a
 * neutral fallback for.
 */
export function toPersistedAccount(value: unknown): PersistedAccount | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id } = value;

  if (typeof id !== 'string' || !id) {
    return null;
  }

  return {
    id,
    name: readNullableString(value.name),
    username: readNullableString(value.username),
    email: readNullableString(value.email),
  };
}

/** Reads the current (version-4) persisted account, or null if there is none. */
export async function readPersistedAccount(): Promise<PersistedAccount | null> {
  const stored = await getItem<unknown>(STORAGE_KEYS.auth, ACCOUNT_STORAGE_VERSION);

  return stored === undefined ? null : toPersistedAccount(stored);
}

/**
 * Reads a version-3 payload if one is still present, or null.
 *
 * Returns null - not a partial object - unless BOTH fields are present, so a
 * caller never has to distinguish "no legacy payload" from "a legacy payload
 * with pieces missing".
 */
export async function readLegacyAuthEnvelope(): Promise<LegacyAuthEnvelope | null> {
  const stored = await getItem<unknown>(STORAGE_KEYS.auth, LEGACY_ACCOUNT_STORAGE_VERSION);

  if (!isRecord(stored)) {
    return null;
  }

  if (!('user' in stored) || !('tokens' in stored)) {
    return null;
  }

  return { user: stored.user, tokens: stored.tokens };
}

/**
 * Writes the version-4 envelope.
 *
 * This is also the operation that COMPLETES a migration: the key holds one
 * envelope, so writing the credential-free version-4 shape over a version-3
 * payload is what removes the plaintext copy from AsyncStorage. There is no
 * separate delete step that could be missed, and no window in which both
 * shapes exist.
 */
export async function writePersistedAccount(account: PersistedAccount): Promise<void> {
  await setItem<PersistedAccount>(STORAGE_KEYS.auth, ACCOUNT_STORAGE_VERSION, account);
}

/** Removes the persisted account entirely. Used by sign-out. */
export async function clearPersistedAccount(): Promise<void> {
  await removeItem(STORAGE_KEYS.auth);
}
