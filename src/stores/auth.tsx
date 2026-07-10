import { PropsWithChildren, createContext, useCallback, useContext, useMemo, useState } from 'react';

type AuthUser = {
  readonly id: string;
  readonly name: string;
  readonly username: string;
  readonly email: string;
};

type AuthContextValue = {
  readonly isAuthenticated: boolean;
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

  const loginDummy = useCallback(() => {
    setUser(dummyUser);
  }, []);

  const logout = useCallback(() => {
    setUser(null);
  }, []);

  const contextValue = useMemo(
    () => ({
      isAuthenticated: Boolean(user),
      user,
      loginDummy,
      logout,
    }),
    [loginDummy, logout, user]
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
