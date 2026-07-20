import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { getItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { AuthProvider, useAuth } from '@/stores/auth';

afterEach(async () => {
  await AsyncStorage.clear();
});

function AuthProbe() {
  const { isAuthenticated, isHydrated, user, loginDummy, logout } = useAuth();

  return (
    <>
      <Text testID="hydrated">{String(isHydrated)}</Text>
      <Text testID="authenticated">{String(isAuthenticated)}</Text>
      <Text testID="username">{user?.username ?? ''}</Text>
      <Text testID="login" onPress={loginDummy}>
        login
      </Text>
      <Text testID="logout" onPress={logout}>
        logout
      </Text>
    </>
  );
}

describe('AuthProvider', () => {
  it('restores a persisted user session on mount', async () => {
    await setItem(STORAGE_KEYS.auth, 1, {
      user: { id: 'user_001', name: 'Gladyaz', username: 'gladyaz', email: 'gladyaz@example.com' },
    });

    const { getByTestId } = await render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(getByTestId('hydrated').props.children).toBe('true'));

    expect(getByTestId('authenticated').props.children).toBe('true');
    expect(getByTestId('username').props.children).toBe('gladyaz');
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

  it('clears the persisted session on logout', async () => {
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

    expect(await getItem(STORAGE_KEYS.auth, 1)).toBeUndefined();
  });
});
