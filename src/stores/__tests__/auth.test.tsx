import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Text } from 'react-native';

import { ApiError } from '@/services/api/client';
import { login, logout, register } from '@/services/auth/auth-service';
import { signInWithGoogle, signOutFromGoogle } from '@/services/auth/google-sign-in';
import {
  loginWithGoogleIdToken,
  verifyWhatsAppOtp,
} from '@/services/auth/provider-auth-service';
import { getItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import {
  __resetTokenStoreForTests,
  clearTokensAndNotify,
  getTokens,
} from '@/services/auth/token-store';
import { AuthProvider, useAuth } from '@/stores/auth';
import type { AuthResponse } from '@/types/auth';

jest.mock('@/services/auth/auth-service');
// Both external providers are mocked at their own boundary and nowhere
// else. These tests prove that a provider response enters the SAME session
// store as an email login - they prove nothing about real Google sign-in or
// real WhatsApp message delivery.
jest.mock('@/services/auth/google-sign-in');
jest.mock('@/services/auth/provider-auth-service');

const mockedLogin = login as jest.MockedFunction<typeof login>;
const mockedRegister = register as jest.MockedFunction<typeof register>;
const mockedLogout = logout as jest.MockedFunction<typeof logout>;
const mockedSignInWithGoogle = signInWithGoogle as jest.MockedFunction<typeof signInWithGoogle>;
const mockedSignOutFromGoogle = signOutFromGoogle as jest.MockedFunction<
  typeof signOutFromGoogle
>;
const mockedLoginWithGoogleIdToken = loginWithGoogleIdToken as jest.MockedFunction<
  typeof loginWithGoogleIdToken
>;
const mockedVerifyWhatsAppOtp = verifyWhatsAppOtp as jest.MockedFunction<typeof verifyWhatsAppOtp>;

// Matches the version this store currently persists at - kept in sync via
// the same constant contract as stores/auth.tsx's own AUTH_STORAGE_VERSION.
// Bumped to 3 when `email`/`name`/`username` became nullable, so a v2
// payload (which coerced a missing email to '' and a missing name to the
// user id) is discarded rather than restored.
const AUTH_STORAGE_VERSION = 3;

function buildAuthResponse(overrides?: Partial<AuthResponse>): AuthResponse {
  return {
    user: { id: 'user_001', email: 'gladyaz@example.com', displayName: 'Gladyaz' },
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    ...overrides,
  };
}

afterEach(async () => {
  await AsyncStorage.clear();
  __resetTokenStoreForTests();
  jest.clearAllMocks();
});

function AuthProbe() {
  const {
    isAuthenticated,
    isHydrated,
    user,
    login: doLogin,
    registerWithEmail: doRegister,
    loginWithGoogle: doGoogleLogin,
    loginWithWhatsApp: doWhatsAppLogin,
    logout: doLogout,
  } = useAuth();
  const [googleOutcome, setGoogleOutcome] = useState('');

  // Every handler swallows its rejection: the assertions live on the mocked
  // service calls and the resulting state, and an unhandled rejection inside
  // a press handler would fail tests that deliberately exercise an error.
  const swallow = () => {};

  return (
    <>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Text testID="authenticated">{String(isAuthenticated)}</Text>
      <Text testID="username">{user?.username ?? ''}</Text>
      <Text testID="name">{user?.name ?? ''}</Text>
      <Text testID="email">{user?.email ?? ''}</Text>
      <Text testID="email-is-null">{String(user ? user.email === null : false)}</Text>
      <Text testID="google-outcome">{googleOutcome}</Text>
      <Text
        testID="login"
        onPress={() => {
          doLogin('gladyaz@example.com', 'password123').catch(swallow);
        }}
      >
        login
      </Text>
      <Text
        testID="register"
        onPress={() => {
          doRegister('gladyaz@example.com', 'password123').catch(swallow);
        }}
      >
        register
      </Text>
      <Text
        testID="google-login"
        onPress={() => {
          doGoogleLogin()
            .then((outcome) => setGoogleOutcome(outcome.status))
            .catch(() => setGoogleOutcome('threw'));
        }}
      >
        google
      </Text>
      <Text
        testID="whatsapp-login"
        onPress={() => {
          doWhatsAppLogin('+6281234567890', '123456').catch(swallow);
        }}
      >
        whatsapp
      </Text>
      <Text testID="logout" onPress={doLogout}>
        logout
      </Text>
    </>
  );
}

describe('AuthProvider', () => {
  it('restores a persisted user session on mount', async () => {
    const persisted = {
      user: {
        id: 'user_001',
        name: 'Gladyaz',
        username: 'gladyaz',
        email: 'gladyaz@example.com',
      },
      tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
    };
    await setItem(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION, persisted);

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    expect(getByTestId('authenticated').props.children).toBe('true');
    expect(getByTestId('username').props.children).toBe('gladyaz');
    expect(getTokens()).toEqual(persisted.tokens);
  });

  it('discards a version-2 payload instead of restoring its coerced fields', async () => {
    // Version 2 persisted `email: ''` and `name: <user id>` for an account
    // with no address. Restoring one would reintroduce exactly the two
    // states the current version exists to remove, so the version bump
    // drops it and the next authenticated response re-derives the user.
    await setItem(STORAGE_KEYS.auth, 2, {
      user: { id: 'user_003', name: 'user_003', username: '', email: '' },
      tokens: { accessToken: 'stale-access', refreshToken: 'stale-refresh' },
    });

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    expect(getByTestId('authenticated').props.children).toBe('false');
    expect(getTokens()).toBeNull();
  });

  it('starts as a guest when nothing is persisted', async () => {
    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    expect(getByTestId('authenticated').props.children).toBe('false');
  });

  it('logs in with email and password, never registering, and persists the session', async () => {
    mockedLogin.mockResolvedValueOnce(buildAuthResponse());

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('login'));
    await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

    expect(mockedLogin).toHaveBeenCalledWith('gladyaz@example.com', 'password123');
    expect(mockedRegister).not.toHaveBeenCalled();
    expect(getByTestId('username').props.children).toBe('gladyaz');
    expect(getByTestId('name').props.children).toBe('Gladyaz');

    const persisted = await getItem<{ user: unknown; tokens: unknown }>(
      STORAGE_KEYS.auth,
      AUTH_STORAGE_VERSION
    );
    expect(persisted).toEqual({
      user: { id: 'user_001', name: 'Gladyaz', username: 'gladyaz', email: 'gladyaz@example.com' },
      tokens: { accessToken: 'access-token-1', refreshToken: 'refresh-token-1' },
    });
  });

  it('does NOT create an account when login fails with INVALID_CREDENTIALS', async () => {
    // Phase 10B removed the login-or-register fallback. A wrong password or
    // an unknown email is now a failed login and nothing more - registering
    // is an explicit act on the register screen. This is the regression test
    // for that removal: if a register call ever reappears here, someone has
    // reintroduced silent account creation.
    mockedLogin.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
    );

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('login'));

    await waitFor(() => expect(mockedLogin).toHaveBeenCalledTimes(1));
    expect(mockedRegister).not.toHaveBeenCalled();
    expect(getByTestId('authenticated').props.children).toBe('false');
    expect(getTokens()).toBeNull();
    expect(await getItem(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION)).toBeUndefined();
  });

  it('registers only through the explicit registration entry point', async () => {
    mockedRegister.mockResolvedValueOnce(buildAuthResponse());

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('register'));
    await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

    expect(mockedRegister).toHaveBeenCalledWith('gladyaz@example.com', 'password123', undefined);
    expect(mockedLogin).not.toHaveBeenCalled();
    // Registration enters the same session as any other method.
    expect(getTokens()).toEqual({
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
    });
  });

  it('surfaces an EMAIL_ALREADY_REGISTERED failure instead of signing anyone in', async () => {
    mockedRegister.mockRejectedValueOnce(
      new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'Taken.')
    );

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('register'));

    await waitFor(() => expect(mockedRegister).toHaveBeenCalledTimes(1));
    expect(getByTestId('authenticated').props.children).toBe('false');
  });

  it('propagates a non-INVALID_CREDENTIALS login error without falling back to register', async () => {
    mockedLogin.mockRejectedValueOnce(new ApiError(500, 'SERVER_ERROR', 'Server error.'));

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('login'));

    await waitFor(() => expect(mockedLogin).toHaveBeenCalledTimes(1));
    expect(mockedRegister).not.toHaveBeenCalled();
    expect(getByTestId('authenticated').props.children).toBe('false');
  });

  it('clears the persisted session on logout', async () => {
    mockedLogin.mockResolvedValueOnce(buildAuthResponse());
    mockedLogout.mockResolvedValueOnce(undefined);

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('login'));
    await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('logout'));
    await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('false'));

    expect(mockedLogout).toHaveBeenCalledWith('refresh-token-1');
    expect(getByTestId('username').props.children).toBe('');
    expect(await getItem(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION)).toBeUndefined();
    expect(getTokens()).toBeNull();
  });

  it('still logs out client-side (best-effort) when the network logout call fails', async () => {
    mockedLogin.mockResolvedValueOnce(buildAuthResponse());
    mockedLogout.mockRejectedValueOnce(new Error('network unreachable'));

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('login'));
    await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('logout'));
    await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('false'));

    expect(mockedLogout).toHaveBeenCalledWith('refresh-token-1');
    expect(await getItem(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION)).toBeUndefined();
  });

  it('forces a logout when token-store reports a cleared token (interceptor-driven)', async () => {
    const persisted = {
      user: { id: 'user_001', name: 'Gladyaz', username: 'gladyaz', email: 'gladyaz@example.com' },
      tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
    };
    await setItem(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION, persisted);

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
    expect(getByTestId('authenticated').props.children).toBe('true');
    expect(getTokens()).toEqual(persisted.tokens);

    // Simulate the HTTP client's refresh-on-401 interceptor giving up after a
    // failed refresh - this is exactly what services/api/client.ts calls.
    await act(async () => {
      clearTokensAndNotify();
    });

    await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('false'));
    expect(getByTestId('username').props.children).toBe('');
    expect(await getItem(STORAGE_KEYS.auth, 2)).toBeUndefined();
  });

  describe('provider sign-in enters the existing session store', () => {
    it('exchanges a Google ID token for the app own tokens and persists them', async () => {
      mockedSignInWithGoogle.mockResolvedValueOnce({
        status: 'success',
        idToken: 'google-id-token',
      });
      mockedLoginWithGoogleIdToken.mockResolvedValueOnce(buildAuthResponse());

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('google-login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      expect(mockedLoginWithGoogleIdToken).toHaveBeenCalledWith('google-id-token');
      // The SESSION is the app's own token pair, in the one existing store.
      expect(getTokens()).toEqual({
        accessToken: 'access-token-1',
        refreshToken: 'refresh-token-1',
      });
      expect(await getItem(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION)).toEqual({
        user: {
          id: 'user_001',
          name: 'Gladyaz',
          username: 'gladyaz',
          email: 'gladyaz@example.com',
        },
        tokens: { accessToken: 'access-token-1', refreshToken: 'refresh-token-1' },
      });
    });

    it('never persists the Google ID token as the session', async () => {
      mockedSignInWithGoogle.mockResolvedValueOnce({
        status: 'success',
        idToken: 'google-id-token',
      });
      mockedLoginWithGoogleIdToken.mockResolvedValueOnce(buildAuthResponse());

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
      await fireEvent.press(getByTestId('google-login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      // The provider credential is one-shot: it must appear nowhere in the
      // token store or in what was written to AsyncStorage.
      const persisted = JSON.stringify(
        await getItem(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION)
      );
      expect(persisted).not.toContain('google-id-token');
      expect(JSON.stringify(getTokens())).not.toContain('google-id-token');
    });

    it('reports a cancelled Google sheet without touching the session', async () => {
      mockedSignInWithGoogle.mockResolvedValueOnce({ status: 'cancelled' });

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('google-login'));
      await waitFor(() => expect(getByTestId('google-outcome').props.children).toBe('cancelled'));

      expect(mockedLoginWithGoogleIdToken).not.toHaveBeenCalled();
      expect(getByTestId('authenticated').props.children).toBe('false');
      expect(getTokens()).toBeNull();
    });

    it('passes an unconfigured Google build through as an outcome, not an exception', async () => {
      mockedSignInWithGoogle.mockResolvedValueOnce({
        status: 'unconfigured',
        developerMessage: 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set.',
      });

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('google-login'));
      await waitFor(() =>
        expect(getByTestId('google-outcome').props.children).toBe('unconfigured')
      );

      expect(mockedLoginWithGoogleIdToken).not.toHaveBeenCalled();
    });

    it('throws (rather than silently failing) when the backend rejects the ID token', async () => {
      mockedSignInWithGoogle.mockResolvedValueOnce({
        status: 'success',
        idToken: 'google-id-token',
      });
      mockedLoginWithGoogleIdToken.mockRejectedValueOnce(
        new ApiError(401, 'INVALID_PROVIDER_TOKEN', 'Rejected.')
      );

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('google-login'));
      await waitFor(() => expect(getByTestId('google-outcome').props.children).toBe('threw'));

      expect(getByTestId('authenticated').props.children).toBe('false');
      expect(getTokens()).toBeNull();
    });

    it('enters the same session from a verified WhatsApp OTP', async () => {
      mockedVerifyWhatsAppOtp.mockResolvedValueOnce(
        buildAuthResponse({ user: { id: 'user_002', email: 'wa-user@example.com' } })
      );

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('whatsapp-login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      // The PHONE NUMBER is the challenge handle - there is no challenge id.
      expect(mockedVerifyWhatsAppOtp).toHaveBeenCalledWith('+6281234567890', '123456');
      expect(getByTestId('username').props.children).toBe('wa-user');
      expect(getTokens()).toEqual({
        accessToken: 'access-token-1',
        refreshToken: 'refresh-token-1',
      });
    });

    it('leaves the viewer signed out when OTP verification fails', async () => {
      mockedVerifyWhatsAppOtp.mockRejectedValueOnce(new ApiError(401, 'INVALID_OTP', 'Nope.'));

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('whatsapp-login'));

      await waitFor(() => expect(mockedVerifyWhatsAppOtp).toHaveBeenCalledTimes(1));
      expect(getByTestId('authenticated').props.children).toBe('false');
      expect(getTokens()).toBeNull();
    });
  });

  describe('logout after a provider login', () => {
    it('revokes the app session and clears the Google SDK account too', async () => {
      mockedSignInWithGoogle.mockResolvedValueOnce({
        status: 'success',
        idToken: 'google-id-token',
      });
      mockedLoginWithGoogleIdToken.mockResolvedValueOnce(buildAuthResponse());
      mockedLogout.mockResolvedValueOnce(undefined);

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
      await fireEvent.press(getByTestId('google-login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('logout'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('false'));

      // Same revocation path as an email session: the backend refresh token
      // is revoked, local state is cleared...
      expect(mockedLogout).toHaveBeenCalledWith('refresh-token-1');
      expect(getTokens()).toBeNull();
      expect(await getItem(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION)).toBeUndefined();
      // ...and the provider's own cached account is cleared, so the next
      // sign-in asks which account to use.
      expect(mockedSignOutFromGoogle).toHaveBeenCalled();
    });

    it('logs out after a WhatsApp login through the same single path', async () => {
      mockedVerifyWhatsAppOtp.mockResolvedValueOnce(buildAuthResponse());
      mockedLogout.mockResolvedValueOnce(undefined);

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
      await fireEvent.press(getByTestId('whatsapp-login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('logout'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('false'));

      expect(mockedLogout).toHaveBeenCalledWith('refresh-token-1');
      expect(await getItem(STORAGE_KEYS.auth, AUTH_STORAGE_VERSION)).toBeUndefined();
    });
  });

  describe('demo builds cannot reach real accounts', () => {
    const ORIGINAL_DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE;

    afterEach(() => {
      if (ORIGINAL_DEMO_MODE === undefined) {
        delete process.env.EXPO_PUBLIC_DEMO_MODE;
      } else {
        process.env.EXPO_PUBLIC_DEMO_MODE = ORIGINAL_DEMO_MODE;
      }
    });

    it('refuses to create an account in a demo build, even reached by deep link', async () => {
      // The login screen hides the register link in a demo build, but
      // `/register` is a real route and the app declares a URL scheme, so
      // `mobileappecc://register` reaches the screen regardless. The
      // "never create users" invariant therefore lives in the store, not in
      // whether a screen chose to render a link.
      process.env.EXPO_PUBLIC_DEMO_MODE = 'true';

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('register'));

      await waitFor(() => expect(mockedRegister).not.toHaveBeenCalled());
      expect(getByTestId('authenticated').props.children).toBe('false');
    });

    it('refuses to verify a WhatsApp OTP in a demo build', async () => {
      process.env.EXPO_PUBLIC_DEMO_MODE = 'true';

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('whatsapp-login'));

      await waitFor(() => expect(mockedVerifyWhatsAppOtp).not.toHaveBeenCalled());
      expect(getByTestId('authenticated').props.children).toBe('false');
    });

    it('reports Google as unsupported in a demo build without touching the SDK', async () => {
      process.env.EXPO_PUBLIC_DEMO_MODE = 'true';

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('google-login'));
      await waitFor(() =>
        expect(getByTestId('google-outcome').props.children).toBe('unsupported')
      );

      expect(mockedSignInWithGoogle).not.toHaveBeenCalled();
      expect(mockedLoginWithGoogleIdToken).not.toHaveBeenCalled();
    });

    it('still allows the local demo email login', async () => {
      process.env.EXPO_PUBLIC_DEMO_MODE = 'true';

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

      await fireEvent.press(getByTestId('login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      // Local-only: no backend call was made, and no account was created.
      expect(mockedLogin).not.toHaveBeenCalled();
      expect(mockedRegister).not.toHaveBeenCalled();
    });
  });

  describe('deriveAuthUser (via login)', () => {
    it('uses a trimmed displayName as name when present', async () => {
      mockedLogin.mockResolvedValueOnce(
        buildAuthResponse({
          user: { id: 'user_001', email: 'gladyaz@example.com', displayName: '  Gladyaz  ' },
        })
      );

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
      await fireEvent.press(getByTestId('login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      expect(getByTestId('name').props.children).toBe('Gladyaz');
      expect(getByTestId('username').props.children).toBe('gladyaz');
    });

    it('falls back to the email local-part as name when displayName is absent', async () => {
      mockedLogin.mockResolvedValueOnce(
        buildAuthResponse({
          user: { id: 'user_001', email: 'gladyaz@example.com' },
        })
      );

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
      await fireEvent.press(getByTestId('login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      expect(getByTestId('name').props.children).toBe('gladyaz');
      expect(getByTestId('username').props.children).toBe('gladyaz');
    });

    it('carries a phone-only account null email through, never an empty string', async () => {
      // The canonical contract makes `user.email` `string | null` with the
      // key ALWAYS present, and a WhatsApp-only account always has null.
      // Coercing that to '' is what rendered a blank email line on the
      // profile screen - a state indistinguishable from "still loading".
      mockedVerifyWhatsAppOtp.mockResolvedValueOnce(
        buildAuthResponse({ user: { id: 'user_003', email: null } })
      );

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
      await fireEvent.press(getByTestId('whatsapp-login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      expect(getByTestId('email-is-null').props.children).toBe('true');
    });

    it('never uses the raw user id as a display name for a phone-only account', async () => {
      // A cuid is a database key. Rendering one where a name goes looks
      // like a name the account actually has; the honest fallback is the
      // screen's own neutral label (profile.tsx), not the id.
      mockedVerifyWhatsAppOtp.mockResolvedValueOnce(
        buildAuthResponse({ user: { id: 'user_003', email: null } })
      );

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
      await fireEvent.press(getByTestId('whatsapp-login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      expect(getByTestId('name').props.children).not.toBe('user_003');
      expect(getByTestId('name').props.children).toBe('');
      expect(getByTestId('username').props.children).toBe('');
    });

    it('still derives a name for a Google account whose email was not verified', async () => {
      // `email: null` with a displayName present: the display name is used,
      // and the account still has no address to show anywhere.
      mockedLoginWithGoogleIdToken.mockResolvedValueOnce(
        buildAuthResponse({ user: { id: 'user_004', email: null, displayName: 'Jane' } })
      );
      mockedSignInWithGoogle.mockResolvedValueOnce({
        status: 'success',
        idToken: 'google-id-token',
      });

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
      await fireEvent.press(getByTestId('google-login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      expect(getByTestId('name').props.children).toBe('Jane');
      expect(getByTestId('email-is-null').props.children).toBe('true');
      expect(getByTestId('username').props.children).toBe('');
    });

    it('falls back to the email local-part as name when displayName is empty/whitespace', async () => {
      mockedLogin.mockResolvedValueOnce(
        buildAuthResponse({
          user: { id: 'user_001', email: 'gladyaz@example.com', displayName: '   ' },
        })
      );

      const { getByTestId } = await render(
        <AuthProvider>
          <AuthProbe />
        </AuthProvider>
      );

      await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));
      await fireEvent.press(getByTestId('login'));
      await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

      expect(getByTestId('name').props.children).toBe('gladyaz');
      expect(getByTestId('username').props.children).toBe('gladyaz');
    });
  });
});
