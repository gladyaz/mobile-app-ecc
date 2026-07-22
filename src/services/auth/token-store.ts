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

/** Returns the tokens currently held in memory, or null if signed out. */
export function getTokens(): AuthTokens | null {
  return currentTokens;
}

/**
 * Writes tokens (or clears them with `null`) without notifying subscribers.
 * Intended for `stores/auth.tsx` to mirror its own React-state changes into
 * this module.
 */
export function setTokens(tokens: AuthTokens | null): void {
  currentTokens = tokens;
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
}
