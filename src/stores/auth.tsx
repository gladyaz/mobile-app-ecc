import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { ApiError } from '@/services/api/client';
import { login as loginRequest, logout as logoutRequest, register as registerRequest } from '@/services/auth/auth-service';
import * as tokenStore from '@/services/auth/token-store';
import { getItem, removeItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import type { AuthResponse, AuthTokens, AuthUser as BackendAuthUser } from '@/types/auth';

/**
 * Public store-facing user shape, kept close to the previous dummy-auth
 * shape so existing consumers (e.g. profile.tsx) don't need to change.
 * `name`/`username` are derived client-side from the real backend
 * `AuthUser` (`{ id, email, displayName? }`) - see deriveAuthUser below.
 */
type AuthUser = {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly email: string;
};

type PersistedAuth = {
  readonly user: AuthUser | null;
  readonly tokens: AuthTokens | null;
};

const AUTH_STORAGE_VERSION = 2;

type AuthContextValue = {
  readonly isAuthenticated: boolean;
  readonly isHydrated: boolean;
  readonly user: AuthUser | null;
  readonly login: (email: string, password: string) => Promise<void>;
  readonly logout: () => Promise<void>;
};

/**
 * Derives the store's public AuthUser from the backend's real AuthUser.
 * `name` falls back to the email's local-part when there is no
 * (non-empty) `displayName`. `username` is always the email's local-part,
 * lowercased.
 */
function deriveAuthUser(backendUser: BackendAuthUser): AuthUser {
  const localPart = backendUser.email.split('@')[0] ?? backendUser.email;
  const trimmedDisplayName = backendUser.displayName?.trim();

  return {
    id: backendUser.id,
    name: trimmedDisplayName ? trimmedDisplayName : localPart,
    username: localPart.toLowerCase(),
    email: backendUser.email,
  };
}

function isInvalidCredentialsError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'INVALID_CREDENTIALS';
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tokens, setTokens] = useState<AuthTokens | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    getItem<PersistedAuth>(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION)
      .then((persisted) => {
        if (persisted?.user) {
          setUser(persisted.user);
        }

        if (persisted?.tokens) {
          setTokens(persisted.tokens);
          tokenStore.setTokens(persisted.tokens);
        }
      })
      .finally(() => {
        setIsHydrated(true);
      });
  }, []);

  /**
   * Reacts to token changes that originate outside React: the HTTP client's
   * refresh-on-401 interceptor (`services/api/client.ts`) calls
   * `token-store.ts`'s notifying setters after a background refresh
   * succeeds or fails. This keeps `stores/auth.tsx` as the single source of
   * truth for React-visible auth state and AsyncStorage persistence, while
   * `token-store.ts` itself stays a plain, storage-free holder (see
   * token-store.ts's module doc comment for the full responsibility split).
   *
   * Uses the functional form of `setUser` purely to read the latest user
   * without adding `user` as an effect dependency (which would otherwise
   * force an unsubscribe/resubscribe on every login/logout).
   */
  useEffect(() => {
    const unsubscribe = tokenStore.onTokensChanged((nextTokens) => {
      if (nextTokens) {
        setTokens(nextTokens);
        setUser((currentUser) => {
          if (currentUser) {
            setItem<PersistedAuth>(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION, {
              user: currentUser,
              tokens: nextTokens,
            }).catch(() => {
              // Best-effort persistence, matching setItem's own swallow-and-log-nothing contract.
            });
          }

          return currentUser;
        });

        return;
      }

      setUser(null);
      setTokens(null);
      removeItem(STORAGE_KEYS.auth).catch(() => {
        // Best-effort cleanup, matching removeItem's own swallow-and-log-nothing contract.
      });
    });

    return unsubscribe;
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    let authResponse: AuthResponse;

    try {
      authResponse = await loginRequest(email, password);
    } catch (error) {
      if (!isInvalidCredentialsError(error)) {
        throw error;
      }

      authResponse = await registerRequest(email, password);
    }

    const derivedUser = deriveAuthUser(authResponse.user);
    const nextTokens: AuthTokens = {
      accessToken: authResponse.accessToken,
      refreshToken: authResponse.refreshToken,
    };

    setUser(derivedUser);
    setTokens(nextTokens);
    tokenStore.setTokens(nextTokens);
    await setItem<PersistedAuth>(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION, {
      user: derivedUser,
      tokens: nextTokens,
    });
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = tokens?.refreshToken;

    if (refreshToken) {
      try {
        await logoutRequest(refreshToken);
      } catch {
        // Best-effort: a failed network logout should not prevent the user
        // from being logged out client-side.
      }
    }

    setUser(null);
    setTokens(null);
    tokenStore.setTokens(null);
    await removeItem(STORAGE_KEYS.auth);
  }, [tokens]);

  const contextValue = useMemo(
    () => ({
      isAuthenticated: Boolean(user),
      isHydrated,
      user,
      login,
      logout,
    }),
    [isHydrated, login, logout, user]
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const contextValue = useContext(AuthContext);

  if (!contextValue) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return contextValue;
}
