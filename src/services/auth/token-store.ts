import type { AuthTokens } from '@/types/auth';

/**
 * Plain (no-React) in-memory holder for the current access/refresh token
 * pair. This exists so `services/api/client.ts` (a low-level HTTP module)
 * and `stores/auth.tsx` (a React context) can share token state without
 * either one importing the other - `client.ts` must never import from
 * `stores/auth.tsx` (risk of a circular dependency, and it would couple a
 * low-level HTTP module to React).
 *
 * Design / responsibility split (intentional, see 8-M3 work unit notes):
 * - `stores/auth.tsx` remains the single source of truth for React-visible
 *   auth state (`user`, `isAuthenticated`) and for AsyncStorage persistence.
 *   It calls the silent `setTokens()` here to mirror its own state changes
 *   (login, hydration-restore, logout) into this module - no notification
 *   is needed because auth.tsx already knows about those changes itself.
 * - `services/api/client.ts`'s refresh-on-401 interceptor is the only
 *   caller of `setTokensAndNotify()` / `clearTokensAndNotify()`. Those are
 *   the two cases where a token change originates *outside* React (a
 *   background refresh, or a forced logout after a failed refresh), so
 *   `stores/auth.tsx` needs to be told about it via `onTokensChanged`.
 * - This module deliberately does NOT touch AsyncStorage. Persistence of
 *   interceptor-driven changes (refreshed tokens, or clearing on forced
 *   logout) stays the responsibility of `stores/auth.tsx`'s subscription
 *   handler, keeping this module a plain, storage-free, React-free holder.
 */

export type TokensChangeListener = (tokens: AuthTokens | null) => void;

let currentTokens: AuthTokens | null = null;
const listeners = new Set<TokensChangeListener>();

/**
 * Counts IDENTITY changes - not token changes.
 *
 * The distinction is the whole point. A background refresh REPLACES the access
 * token while the signed-in person stays the same; a sign-out (or a sign-out
 * followed by somebody else signing in) replaces the person. A request that is
 * in flight across the first must be allowed to finish under the new token; one
 * in flight across the second must NOT, or it is committed to the wrong
 * account.
 *
 * Comparing tokens cannot tell those two apart, because both change the token.
 * So the counter is bumped by exactly the writes that mean "a different
 * identity now owns this store" - `setTokens`, which only `stores/auth.tsx`
 * calls, and only on hydrate / sign-in / sign-out - and by
 * `clearTokensAndNotify`, which is a forced sign-out. It is deliberately NOT
 * bumped by `setTokensAndNotify`, which is the refresh interceptor rotating the
 * SAME session's pair.
 *
 * Consumed by `services/api/client.ts`; see the refresh branch there.
 */
let sessionGeneration = 0;

/** Returns the tokens currently held in memory, or null if signed out. */
export function getTokens(): AuthTokens | null {
  return currentTokens;
}

/**
 * A monotonically increasing marker for "which signed-in identity owns this
 * store". Pin it before an authenticated request and compare it afterwards to
 * tell a token rotation apart from an account change. See `sessionGeneration`.
 */
export function getSessionGeneration(): number {
  return sessionGeneration;
}

/**
 * Writes tokens (or clears them with `null`) without notifying subscribers.
 * Intended for `stores/auth.tsx` to mirror its own React-state changes into
 * this module.
 */
export function setTokens(tokens: AuthTokens | null): void {
  currentTokens = tokens;
  // Every caller of this function is an identity change: `stores/auth.tsx`
  // calls it on hydration, on sign-in, and on sign-out, and nowhere else. The
  // refresh interceptor uses `setTokensAndNotify` instead, precisely so a
  // rotation does not look like one.
  sessionGeneration += 1;
}

/**
 * Updates tokens and notifies subscribers. Intended for the HTTP client's
 * refresh-on-401 interceptor to call after a successful token refresh.
 */
export function setTokensAndNotify(tokens: AuthTokens): void {
  currentTokens = tokens;
  notifyListeners(tokens);
}

/**
 * Clears tokens and notifies subscribers. Intended for the HTTP client's
 * refresh-on-401 interceptor to call when a refresh attempt itself fails,
 * so `stores/auth.tsx` can force a client-side logout.
 */
export function clearTokensAndNotify(): void {
  currentTokens = null;
  // A forced sign-out is an identity change like any other.
  sessionGeneration += 1;
  notifyListeners(null);
}

function notifyListeners(tokens: AuthTokens | null): void {
  for (const listener of listeners) {
    listener(tokens);
  }
}

/**
 * Subscribes to interceptor-driven token changes (a successful background
 * refresh, or a forced clear after a failed refresh). Returns an
 * unsubscribe function.
 */
export function onTokensChanged(listener: TokensChangeListener): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

/** Test-only helper to reset module state between test files/cases. */
export function __resetTokenStoreForTests(): void {
  currentTokens = null;
  listeners.clear();
  sessionGeneration = 0;
}
