import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { DeleteAccountCard } from '@/features/account-deletion/delete-account-card';
import { deleteMyAccount, fetchDeletionMethods } from '@/services/auth/account-deletion-service';
import { __SESSION_TOKENS_KEY } from '@/services/auth/session-secret-store';
import { persistSession } from '@/services/auth/session-store';
import { STORAGE_KEYS } from '@/services/storage/local-storage';
import { AuthProvider, useAuth } from '@/stores/auth';

/**
 * THE CLEANUP, PROVEN AGAINST REAL STORAGE.
 *
 * The sibling suite (`delete-account-card.test.tsx`) mocks `stores/auth` and
 * asserts that `logout()` is CALLED. That is the right shape for the flow
 * tests, and it is not enough for the claim this file makes: "a deleted
 * account leaves no session behind on the device". Whether the bearer pair
 * actually leaves the Keystore, and whether the account metadata actually
 * leaves AsyncStorage, is decided by `session-store.clearSession` and by what
 * `AuthProvider` does with it - none of which runs when the store is mocked.
 *
 * So everything from the card down to the storage layer is REAL here. Only
 * the network is mocked: `account-deletion-service` (the deletion routes) and
 * `auth-service` (the best-effort `POST /auth/logout`). The secure store is
 * the repository's in-memory `jest/expo-secure-store-mock`, which actually
 * stores, so `__peekSecureStore` reports what is genuinely at rest rather
 * than what a module claimed.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
}));

jest.mock('@/services/auth/account-deletion-service');
jest.mock('@/services/auth/auth-service');
// The native Google SDK is never reached by a password deletion, but
// `stores/auth.tsx`'s `logout()` calls `signOutFromGoogle()` unconditionally.
jest.mock('@/services/auth/google-sign-in');

/**
 * The controls the repository's `jest/expo-secure-store-mock` exposes, reached
 * through `jest.requireMock` exactly as `session-store.test.ts` does - the
 * module is mocked globally in `jest.setup.js`, so this is the same instance
 * the code under test writes to.
 */
type SecureStoreMockControls = {
  readonly __resetSecureStoreMock: () => void;
  readonly __peekSecureStore: (key: string) => string | null;
};

const secureStore = jest.requireMock<SecureStoreMockControls>('expo-secure-store');

const mockedFetchMethods = fetchDeletionMethods as jest.MockedFunction<typeof fetchDeletionMethods>;
const mockedDelete = deleteMyAccount as jest.MockedFunction<typeof deleteMyAccount>;

const ACCOUNT = {
  id: 'user_1',
  name: 'Jane',
  username: 'jane',
  email: 'jane@example.com',
} as const;

const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1' } as const;

/** The identity-scoped cache keys this account owns on this device. */
const INTERACTIONS_KEY = `${STORAGE_KEYS.videoInteractions}:${ACCOUNT.id}`;
const PROGRESS_KEY = `${STORAGE_KEYS.seriesProgress}:${ACCOUNT.id}`;

/** Reports whether the app currently considers anybody signed in. */
function AuthProbe() {
  const { isAuthenticated, isHydrated, user } = useAuth();

  return (
    <Text testID="auth-probe">
      {isHydrated ? (isAuthenticated ? `signed-in:${user?.id ?? ''}` : 'signed-out') : 'hydrating'}
    </Text>
  );
}

async function renderSignedIn() {
  const utils = await render(
    <AuthProvider>
      <AuthProbe />
      <DeleteAccountCard />
    </AuthProvider>
  );

  // Wait for the restore to finish AND the method list to settle.
  await waitFor(() =>
    expect(utils.getByTestId('auth-probe').props.children).toContain('signed-in')
  );
  await waitFor(() => expect(utils.queryByTestId('delete-account-loading')).toBeNull());

  return utils;
}

beforeEach(async () => {
  jest.clearAllMocks();
  secureStore.__resetSecureStoreMock();
  await AsyncStorage.clear();

  mockedFetchMethods.mockResolvedValue(['password']);
  mockedDelete.mockResolvedValue(undefined);

  // A real signed-in session, written through the real persistence boundary:
  // the bearer pair into the Keystore-backed store, the account metadata into
  // AsyncStorage.
  await persistSession(ACCOUNT, TOKENS);
  await AsyncStorage.setItem(INTERACTIONS_KEY, JSON.stringify({ version: 1, data: {} }));
  await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify({ version: 1, data: {} }));
});

describe('a successful deletion leaves nothing of the session behind', () => {
  it('seeds a session that really is at rest before the deletion (guards the test itself)', async () => {
    // Without this, every assertion below could pass because the seed never
    // worked - the classic way a cleanup test proves nothing.
    expect(secureStore.__peekSecureStore(__SESSION_TOKENS_KEY)).not.toBeNull();
    expect(await AsyncStorage.getItem(STORAGE_KEYS.auth)).not.toBeNull();
  });

  it('clears the SecureStore token pair', async () => {
    const { getByTestId } = await renderSignedIn();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(secureStore.__peekSecureStore(__SESSION_TOKENS_KEY)).toBeNull());
  });

  it('clears the persisted account metadata', async () => {
    const { getByTestId } = await renderSignedIn();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(async () => expect(await AsyncStorage.getItem(STORAGE_KEYS.auth)).toBeNull());
  });

  it("clears the deleted identity's own account-bound caches", async () => {
    const { getByTestId } = await renderSignedIn();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(async () => expect(await AsyncStorage.getItem(INTERACTIONS_KEY)).toBeNull());
    expect(await AsyncStorage.getItem(PROGRESS_KEY)).toBeNull();
  });

  it('leaves the app in a genuinely logged-out state', async () => {
    const { getByTestId } = await renderSignedIn();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByTestId('auth-probe').props.children).toContain('signed-out'));
  });
});

describe('a FAILED deletion leaves the local session completely intact', () => {
  beforeEach(() => {
    mockedDelete.mockRejectedValue(new Error('network timeout'));
  });

  it('does not clear the SecureStore token pair', async () => {
    // The failure being designed out: an app that signs somebody out and
    // destroys their credential because a request timed out. The account still
    // exists on the server; the device must still be able to use it.
    const { getByTestId, getByText } = await renderSignedIn();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/Gagal menghapus akun/)).toBeTruthy());
    expect(secureStore.__peekSecureStore(__SESSION_TOKENS_KEY)).not.toBeNull();
  });

  it('does not clear the persisted account metadata or the account-bound caches', async () => {
    const { getByTestId, getByText } = await renderSignedIn();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/Gagal menghapus akun/)).toBeTruthy());
    expect(await AsyncStorage.getItem(STORAGE_KEYS.auth)).not.toBeNull();
    expect(await AsyncStorage.getItem(INTERACTIONS_KEY)).not.toBeNull();
    expect(await AsyncStorage.getItem(PROGRESS_KEY)).not.toBeNull();
  });

  it('keeps the viewer signed in', async () => {
    const { getByTestId, getByText } = await renderSignedIn();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/Gagal menghapus akun/)).toBeTruthy());
    expect(getByTestId('auth-probe').props.children).toContain('signed-in:user_1');
  });
});
