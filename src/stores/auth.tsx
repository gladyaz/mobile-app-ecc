import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { getItem, removeItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';

type AuthUser = {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly email: string;
};

/**
 * Dummy auth only: there is no password anywhere in this flow and nothing
 * here should be treated as secure production authentication. This will be
 * replaced by real backend auth and secure tokens later.
 */
type PersistedAuth = {
  readonly user: AuthUser | null;
};

const AUTH_STORAGE_VERSION = 1;

type AuthContextValue = {
  readonly isAuthenticated: boolean;
  readonly isHydrated: boolean;
  readonly user: AuthUser | null;
  readonly loginDummy: () => void;
  readonly logout: () => void;
};

const dummyUser: AuthUser = {
  id: 'user_001',
  name: 'Gladyaz',
  username: 'gladyaz',
  email: 'gladyaz@example.com',
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    getItem<PersistedAuth>(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION)
      .then((persisted) => {
        if (persisted?.user) {
          setUser(persisted.user);
        }
      })
      .finally(() => {
        setIsHydrated(true);
      });
  }, []);

  const loginDummy = useCallback(() => {
    setUser(dummyUser);
    void setItem<PersistedAuth>(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION, { user: dummyUser });
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    void removeItem(STORAGE_KEYS.auth);
  }, []);

  const contextValue = useMemo(
    () => ({
      isAuthenticated: Boolean(user),
      isHydrated,
      user,
      loginDummy,
      logout,
    }),
    [isHydrated, loginDummy, logout, user]
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
