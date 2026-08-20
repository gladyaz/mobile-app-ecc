import {
  PropsWithChildren,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from '@/services/auth/auth-service';
import { signInWithGoogle, signOutFromGoogle } from '@/services/auth/google-sign-in';
import type { GoogleSignInResult } from '@/services/auth/google-sign-in-contract';
import {
  loginWithGoogleIdToken,
  verifyWhatsAppOtp,
} from '@/services/auth/provider-auth-service';
import * as tokenStore from '@/services/auth/token-store';
import { buildDemoAuthResponse } from '@/services/demo/demo-auth';
import { isDemoMode } from '@/services/demo/demo-mode';
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

/**
 * What a Google button press produced, from the app's point of view.
 *
 * Everything here is an EXPECTED outcome that leaves the viewer signed out
 * without anything having gone wrong technically, so the screen can pick
 * its own copy per branch. A genuine failure - the backend rejecting the
 * ID token, the network being down - is THROWN instead, exactly like
 * `login()` does, so both paths surface through one catch.
 */
export type GoogleLoginOutcome =
  | { readonly status: 'success' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'unsupported' }
  | { readonly status: 'unconfigured'; readonly developerMessage: string }
  | { readonly status: 'failed'; readonly reason: string };

type AuthContextValue = {
  readonly isAuthenticated: boolean;
  readonly isHydrated: boolean;
  readonly user: AuthUser | null;
  /**
   * Email + password sign-in, and ONLY that. It never creates an account:
   * a wrong password and an unregistered email both surface as the
   * backend's `INVALID_CREDENTIALS` error for the screen to report. See
   * `registerWithEmail` for the explicit account-creation path.
   */
  readonly login: (email: string, password: string) => Promise<void>;
  /** Explicit account creation. Throws ApiError "EMAIL_ALREADY_REGISTERED"
   * (409) when the email is taken, which the register screen turns into a
   * "sign in instead" prompt. */
  readonly registerWithEmail: (
    email: string,
    password: string,
    displayName?: string
  ) => Promise<void>;
  /** Runs the native Google sheet, then exchanges the resulting ID token
   * for a Short Drama session. See `GoogleLoginOutcome`. */
  readonly loginWithGoogle: () => Promise<GoogleLoginOutcome>;
  /** Final step of the WhatsApp OTP flow: verifies the code against a
   * challenge started by `provider-auth-service.startWhatsAppOtp`. */
  readonly loginWithWhatsApp: (challengeId: string, code: string) => Promise<void>;
  readonly logout: () => Promise<void>;
};

/**
 * Derives the store's public AuthUser from the backend's real AuthUser.
 * `name` falls back to the email's local-part when there is no
 * (non-empty) `displayName`. `username` is always the email's local-part,
 * lowercased.
 */
function deriveAuthUser(backendUser: BackendAuthUser): AuthUser {
  // `email` is REQUIRED by the backend's `AuthUser` contract, and for every
  // email/Google account it is always present. WhatsApp OTP, added in Phase
  // 10B, introduces a login path where a phone-only account is a plausible
  // backend outcome - and this ran `backendUser.email.split(...)` directly,
  // so a missing email threw a TypeError inside `adoptSession` AFTER the
  // backend had already issued a session: the viewer was told their correct
  // code failed, and the server-side session was orphaned. It now degrades
  // instead of throwing. A missing email remains a contract violation worth
  // reconciling - it is just no longer a dead end for the person holding
  // the phone.
  const email = typeof backendUser.email === 'string' ? backendUser.email : '';
  const localPart = email.split('@')[0] ?? '';
  const trimmedDisplayName = backendUser.displayName?.trim();

  return {
    id: backendUser.id,
    name: trimmedDisplayName || localPart || backendUser.id,
    username: localPart.toLowerCase(),
    email,
  };
}

/**
 * A demo build has no account store and no backend, so nothing that would
 * create or fetch a real account may run in one.
 *
 * This is enforced HERE, in the store, rather than only by hiding the entry
 * points on the login screen: `_layout.tsx` registers `/register` and
 * `/login-whatsapp` as real routes and `app.json` declares a URL scheme, so
 * `mobileappecc://register` reaches the screen whatever the login screen
 * chose to render. A build configured with both EXPO_PUBLIC_DEMO_MODE=true
 * and a real EXPO_PUBLIC_API_BASE_URL would otherwise be able to create a
 * genuine backend account from a build whose `login()` is entirely fake.
 */
function assertBackendAuthAvailable(entryPoint: string): void {
  if (isDemoMode()) {
    throw new Error(
      `[auth] ${entryPoint} is not available in a demo build: a demo build has no backend ` +
        'and no account store. See services/demo/demo-mode.ts.'
    );
  }
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

  /**
   * The single place an `AuthResponse` becomes a signed-in session, shared
   * by email login, explicit registration, Google, and WhatsApp OTP.
   *
   * Every provider therefore lands in the SAME session state, persisted the
   * same way, with the same tokens - there is no second token store and no
   * provider-specific session shape. A provider's own credential (a Google
   * ID token, an OTP) is consumed before this point and never reaches
   * storage: only the backend's own access/refresh pair does.
   */
  const adoptSession = useCallback(async (authResponse: AuthResponse) => {
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

  /**
   * Logs in with email and password, and NOTHING else.
   *
   * Phase 10B removed the login-or-register fallback that used to call
   * `POST /auth/register` whenever `POST /auth/login` answered
   * `INVALID_CREDENTIALS`. That fallback silently created an account for
   * anyone who mistyped their email or password, which is not a production
   * login: a typo is now a failed login, and creating an account is an
   * explicit act the viewer performs on the register screen. Do not
   * reintroduce a register call here.
   */
  const login = useCallback(
    async (email: string, password: string) => {
      if (isDemoMode()) {
        // No backend exists in a demo build, so there is nothing to
        // authenticate against. Any credentials are accepted; see
        // services/demo/demo-auth.ts for why the tokens are synthetic and
        // why the user id is fixed. This is not the removed auto-register
        // fallback: no account is created anywhere, because a demo build
        // has no account store at all.
        await adoptSession(buildDemoAuthResponse(email));

        return;
      }

      await adoptSession(await loginRequest(email, password));
    },
    [adoptSession]
  );

  /**
   * Creates an account, then signs it in. Deliberately a separate entry
   * point from `login` so account creation can never be a side effect of a
   * failed sign-in attempt.
   *
   * Not demo-gated: a demo build has no account store, and the register
   * entry point is hidden there (see login.tsx) rather than faked.
   */
  const registerWithEmail = useCallback(
    async (email: string, password: string, displayName?: string) => {
      assertBackendAuthAvailable('registerWithEmail');

      await adoptSession(await registerRequest(email, password, displayName));
    },
    [adoptSession]
  );

  /**
   * Google sign-in, end to end: native sheet -> Google ID token -> backend
   * exchange -> ordinary Short Drama session.
   *
   * The Google ID token is used exactly once, here, and is never persisted
   * or treated as the app's session - `provider-auth-service.ts` trades it
   * for the backend's own access/refresh pair, and only that pair reaches
   * `adoptSession`.
   */
  const loginWithGoogle = useCallback(async (): Promise<GoogleLoginOutcome> => {
    if (isDemoMode()) {
      // Reported as an outcome rather than thrown, matching every other
      // "this build cannot present Google" case. See
      // `assertBackendAuthAvailable` for why the guard is here at all.
      return { status: 'unsupported' };
    }

    const result: GoogleSignInResult = await signInWithGoogle();

    if (result.status !== 'success') {
      return result;
    }

    // Any failure below (network, rejected token, backend down) THROWS,
    // so the screen reports a real failure instead of a silent no-op.
    await adoptSession(await loginWithGoogleIdToken(result.idToken));

    return { status: 'success' };
  }, [adoptSession]);

  /**
   * Final step of the WhatsApp OTP flow. The challenge is started by
   * `provider-auth-service.startWhatsAppOtp` from the phone step; this
   * verifies the code and adopts whatever session the backend returns.
   * Throws on a wrong/expired code so the OTP step can show its own error.
   */
  const loginWithWhatsApp = useCallback(
    async (challengeId: string, code: string) => {
      assertBackendAuthAvailable('loginWithWhatsApp');

      await adoptSession(await verifyWhatsAppOtp(challengeId, code));
    },
    [adoptSession]
  );

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

    // Clears the Google SDK's own cached account so the next sign-in asks
    // which account to use instead of silently reusing the last one.
    //
    // Deliberately NOT awaited: it is a no-op on web and when Google is
    // unconfigured, and never throws, but on a device it is a native Play
    // Services round-trip - and callers that `await logout()` before
    // navigating (account-security.tsx, account-data.tsx) must not sit on a
    // spinner for it when the local session is already gone.
    void signOutFromGoogle();
  }, [tokens]);

  const contextValue = useMemo(
    () => ({
      isAuthenticated: Boolean(user),
      isHydrated,
      user,
      login,
      registerWithEmail,
      loginWithGoogle,
      loginWithWhatsApp,
      logout,
    }),
    [isHydrated, login, loginWithGoogle, loginWithWhatsApp, logout, registerWithEmail, user]
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
