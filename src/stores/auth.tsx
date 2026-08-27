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
import type { PersistedAccount } from '@/services/auth/persisted-account';
import {
  clearSession,
  persistRotatedTokens,
  persistSession,
  restoreSession,
} from '@/services/auth/session-store';
import * as tokenStore from '@/services/auth/token-store';
import { buildDemoAuthResponse } from '@/services/demo/demo-auth';
import { isDemoMode } from '@/services/demo/demo-mode';
import type { AuthResponse, AuthTokens, AuthUser as BackendAuthUser } from '@/types/auth';

/**
 * Public store-facing user shape. `name`/`username` are derived client-side
 * from the real backend `AuthUser` (`{ id, email, displayName? }`) - see
 * deriveAuthUser below.
 *
 * ALL THREE DISPLAY FIELDS ARE NULLABLE, and that is the contract, not a
 * defensive widening. The canonical backend contract makes `user.email`
 * `string | null` (a WhatsApp-only account has no address, and neither does
 * a Google account whose token did not assert `email_verified`), and there
 * is nothing truthful to derive a name or handle from when it is null. A
 * consumer must therefore render its own fallback - see profile.tsx - which
 * is the only way the UI can stay honest about an account that genuinely
 * has no email address.
 *
 * ALIASED to the persisted shape rather than redeclared: what the store shows
 * and what is written to AsyncStorage are the same four fields, and two
 * identical declarations are two things that can drift.
 */
type AuthUser = PersistedAccount;

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
  /**
   * Final step of the WhatsApp OTP flow: verifies the code against the
   * challenge started by `provider-auth-service.startWhatsAppOtp`. The
   * normalized E.164 number IS the challenge handle - there is no challenge
   * id, because at most one challenge is live per number.
   *
   * SIGN-IN, NOT LINKING: this replaces the current session with the
   * phone's own account. Attaching a number to an account that is already
   * signed in goes through `provider-auth-service.linkWhatsAppIdentity`.
   */
  readonly loginWithWhatsApp: (phoneE164: string, code: string) => Promise<void>;
  readonly logout: () => Promise<void>;
};

/**
 * Derives the store's public AuthUser from the backend's real AuthUser.
 *
 * `email` is `string | null` under the canonical contract and is carried
 * through UNCHANGED. It is deliberately NOT coerced to `''`: an empty
 * string is a value the UI cannot tell apart from "we have not loaded it
 * yet", and it is what previously rendered a blank email line on a
 * phone-only account's profile.
 *
 * `name` prefers a non-blank `displayName`, then the email's local part,
 * and is otherwise `null`. It never falls back to `backendUser.id`: a cuid
 * is a database key, and showing one as a person's name is worse than
 * showing nothing, because it looks like a name the account actually has.
 * The human-readable label for an account with no address is the MASKED
 * `identifier` on `GET /auth/identities`; profile.tsx renders a neutral
 * fallback rather than inventing one here.
 *
 * `username` is the email's local part, lowercased, or `null` when there is
 * no address to take one from - never `''`, for the same reason as above.
 */
function deriveAuthUser(backendUser: BackendAuthUser): AuthUser {
  // Still guarded rather than trusted: this value crosses the network, and
  // a non-string here used to reach `.split()` and throw inside
  // `adoptSession` AFTER the backend had already issued a session - the
  // viewer was told their correct code failed while the server-side session
  // was orphaned.
  const email = typeof backendUser.email === 'string' && backendUser.email ? backendUser.email : null;
  const localPart = email ? (email.split('@')[0] ?? null) : null;
  const trimmedDisplayName = backendUser.displayName?.trim();

  return {
    id: backendUser.id,
    name: trimmedDisplayName || localPart || null,
    username: localPart ? localPart.toLowerCase() : null,
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

  /**
   * Rebuilds the session from storage at launch, and performs the one-time
   * move of a pre-upgrade plaintext payload into secure storage on the way.
   * All of that lives in `services/auth/session-store.ts`; see its
   * `restoreSession` for the full state table.
   *
   * BOTH HALVES OR NEITHER. `restoreSession` only ever answers `restored` when
   * it actually holds a secure credential, so there is no branch here that can
   * set a user without tokens - which is what stops a failed secure read from
   * presenting a signed-in shell whose every request would 401.
   */
  useEffect(() => {
    restoreSession()
      .then((restored) => {
        if (restored.status !== 'restored') {
          return;
        }

        setUser(restored.session.account);
        setTokens(restored.session.tokens);
        tokenStore.setTokens(restored.session.tokens);
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
   * truth for React-visible auth state and for session persistence, while
   * `token-store.ts` itself stays a plain, storage-free holder (see
   * token-store.ts's module doc comment for the full responsibility split).
   *
   * A ROTATION CHANGES THE CREDENTIAL, NOT WHO IS SIGNED IN, so only the
   * secure half is rewritten and the persisted account metadata is left alone.
   * That is also why the old functional-`setUser` trick for reading the
   * current user is gone: there is no longer anything about the user to
   * re-persist here.
   *
   * PERSISTING THE ROTATED PAIR IS BEST-EFFORT, and it is the one place that
   * is right. The new pair is already live in memory, so the rest of this run
   * works either way; if the write failed, the next cold start reads a spent
   * refresh token, the refresh fails, and the viewer is truthfully signed out
   * and asked to sign in - which is the correct end state, just later.
   */
  useEffect(() => {
    const unsubscribe = tokenStore.onTokensChanged((nextTokens) => {
      if (nextTokens) {
        setTokens(nextTokens);
        persistRotatedTokens(nextTokens).catch(() => {
          // See the doc comment above for why a failure here is survivable.
        });

        return;
      }

      setUser(null);
      setTokens(null);
      void clearSession();
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
   * storage: only the backend's own access/refresh pair does, and only into
   * Keystore-backed secure storage (see services/auth/session-store.ts).
   *
   * PERSIST FIRST, THEN SET STATE. `persistSession` throws when secure storage
   * is present but refuses the credential, and that throw propagates out of
   * `login()`/`loginWithGoogle()`/`loginWithWhatsApp()` for the screen to
   * report. Setting React state first would leave the viewer looking at a
   * signed-in app whose credential was never stored - signed out again at the
   * next launch with no explanation. A platform with no secure storage at all
   * (web) is NOT a failure and does not throw; that session simply lives for
   * the run.
   */
  const adoptSession = useCallback(async (authResponse: AuthResponse) => {
    const derivedUser = deriveAuthUser(authResponse.user);
    const nextTokens: AuthTokens = {
      accessToken: authResponse.accessToken,
      refreshToken: authResponse.refreshToken,
    };

    await persistSession(derivedUser, nextTokens);

    setUser(derivedUser);
    setTokens(nextTokens);
    tokenStore.setTokens(nextTokens);
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
   * verifies the code against the same NUMBER and adopts whatever session
   * the backend returns. Throws on a rejected code (`INVALID_OTP`, one
   * deliberately generic code) so the OTP step can show its own error.
   */
  const loginWithWhatsApp = useCallback(
    async (phoneE164: string, code: string) => {
      assertBackendAuthAvailable('loginWithWhatsApp');

      await adoptSession(await verifyWhatsAppOtp(phoneE164, code));
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
    // Clears BOTH halves - the Keystore-backed credential and the persisted
    // account metadata. Never throws; see session-store.ts's clearSession.
    await clearSession();

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
