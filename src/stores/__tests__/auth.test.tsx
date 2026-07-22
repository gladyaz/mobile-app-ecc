import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ApiError } from '@/services/api/client';
import { login, logout, register } from '@/services/auth/auth-service';
import { getItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import {
  __resetTokenStoreForTests,
  clearTokensAndNotify,
  getTokens,
} from '@/services/auth/token-store';
import { AuthProvider, useAuth } from '@/stores/auth';
import type { AuthResponse } from '@/types/auth';

jest.mock('@/services/auth/auth-service');

const mockedLogin = login as jest.MockedFunction<typeof login>;
const mockedRegister = register as jest.MockedFunction<typeof register>;
const mockedLogout = logout as jest.MockedFunction<typeof logout>;

// Matches the version this store currently persists at - kept in sync via
// the same constant contract as stores/auth.tsx's own AUTH_STORAGE_VERSION.
const AUTH_STORAGE_VERSION = 2;

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
  const { isAuthenticated, isHydrated, user, login: doLogin, logout: doLogout } = useAuth();

  return (
    <>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Text testID="authenticated">{String(isAuthenticated)}</Text>
      <Text testID="username">{user?.username ?? ''}</Text>
      <Text testID="name">{user?.name ?? ''}</Text>
      <Text
        testID="login"
        onPress={() => {
          doLogin('gladyaz@example.com', 'password123').catch(() => {
            // Surfaced via assertions on the mocked login/register calls
            // themselves; swallow here so the press handler doesn't throw
            // an unhandled rejection in tests that expect an error.
          });
        }}
      >
        login
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

  it('starts as a guest when nothing is persisted', async () => {
    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    expect(getByTestId('authenticated').props.children).toBe('false');
  });

  it('logs in directly (no register fallback) on valid credentials and persists the session', async () => {
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

  it('falls back to register when login fails with INVALID_CREDENTIALS', async () => {
    mockedLogin.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
    );
    mockedRegister.mockResolvedValueOnce(buildAuthResponse());

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    await fireEvent.press(getByTestId('login'));
    await waitFor(() => expect(getByTestId('authenticated').props.children).toBe('true'));

    expect(mockedLogin).toHaveBeenCalledWith('gladyaz@example.com', 'password123');
    expect(mockedRegister).toHaveBeenCalledWith('gladyaz@example.com', 'password123');
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
    await setItem(STORAGE_KEYS.auth, 2, persisted);

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
