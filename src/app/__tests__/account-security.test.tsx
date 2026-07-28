import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import AccountSecurityScreen from '@/app/account-security';
import { ApiError } from '@/services/api/client';
import {
  changePassword,
  listSessions,
  logoutAll,
  revokeSession,
} from '@/services/auth/account-security-service';
import { getTokens, setTokensAndNotify } from '@/services/auth/token-store';
import type { AuthResponse, SessionSummary } from '@/types/auth';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
}));

const mockLogout = jest.fn();
const mockUseAuth = jest.fn();

jest.mock('@/stores/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockShowToast = jest.fn();

jest.mock('@/stores/toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('@/services/auth/account-security-service');
jest.mock('@/services/auth/token-store');

const mockedChangePassword = changePassword as jest.MockedFunction<typeof changePassword>;
const mockedListSessions = listSessions as jest.MockedFunction<typeof listSessions>;
const mockedLogoutAll = logoutAll as jest.MockedFunction<typeof logoutAll>;
const mockedRevokeSession = revokeSession as jest.MockedFunction<typeof revokeSession>;
const mockedGetTokens = getTokens as jest.MockedFunction<typeof getTokens>;
const mockedSetTokensAndNotify = setTokensAndNotify as jest.MockedFunction<
  typeof setTokensAndNotify
>;

function buildAuthResponse(overrides?: Partial<AuthResponse>): AuthResponse {
  return {
    user: { id: 'user_1', email: 'jane@example.com', displayName: 'Jane' },
    accessToken: 'rotated-access-token',
    refreshToken: 'rotated-refresh-token',
    ...overrides,
  };
}

function buildSessions(): readonly SessionSummary[] {
  return [
    {
      id: 'session_1',
      userAgent: 'iPhone 15 / Mobile App 1.0',
      lastUsedAt: '2026-07-20T10:00:00.000Z',
      createdAt: '2026-07-01T09:00:00.000Z',
      expiresAt: '2026-08-01T09:00:00.000Z',
    },
    {
      id: 'session_2',
      userAgent: null,
      lastUsedAt: null,
      createdAt: '2026-07-05T09:00:00.000Z',
      expiresAt: '2026-08-05T09:00:00.000Z',
    },
  ];
}

/** A promise whose resolution/rejection is controlled from the test body,
 * so loading states can be asserted before the async call settles. */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    isHydrated: true,
    user: { id: 'user_1', name: 'Jane', username: 'jane', email: 'jane@example.com' },
    logout: mockLogout,
  });
  mockedGetTokens.mockReturnValue({
    accessToken: 'current-access-token',
    refreshToken: 'current-refresh-token',
  });
  mockedListSessions.mockResolvedValue(buildSessions());
});

describe('AccountSecurityScreen - auth guard', () => {
  it('redirects to /login and renders nothing when not authenticated', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: false,
      isHydrated: true,
      user: null,
      logout: mockLogout,
    });

    const { toJSON } = await render(<AccountSecurityScreen />);

    expect(router.replace).toHaveBeenCalledWith('/login');
    expect(toJSON()).toBeNull();
  });
});

describe('AccountSecurityScreen - change password', () => {
  it('shows validation errors and does not call the API for an empty/too-short form', async () => {
    const { getByText, getByTestId } = await render(<AccountSecurityScreen />);
    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());

    await fireEvent.press(getByText('Ubah Password'));

    await waitFor(() => expect(getByText('Password saat ini wajib diisi')).toBeTruthy());
    expect(getByText('Password baru wajib diisi')).toBeTruthy();
    expect(mockedChangePassword).not.toHaveBeenCalled();

    await fireEvent.changeText(getByTestId('current-password-input'), 'old-password');
    await fireEvent.changeText(getByTestId('new-password-input'), 'short');
    await fireEvent.changeText(getByTestId('confirm-new-password-input'), 'short');
    await fireEvent.press(getByText('Ubah Password'));

    await waitFor(() =>
      expect(getByText('Password baru harus 8-128 karakter')).toBeTruthy()
    );
    expect(mockedChangePassword).not.toHaveBeenCalled();
  });

  it('shows a mismatch error and does not call the API when confirmation does not match', async () => {
    const { getByText, getByTestId } = await render(<AccountSecurityScreen />);
    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());

    await fireEvent.changeText(getByTestId('current-password-input'), 'old-password');
    await fireEvent.changeText(getByTestId('new-password-input'), 'new-password-123');
    await fireEvent.changeText(getByTestId('confirm-new-password-input'), 'different-password');
    await fireEvent.press(getByText('Ubah Password'));

    await waitFor(() =>
      expect(getByText('Konfirmasi password baru tidak cocok')).toBeTruthy()
    );
    expect(mockedChangePassword).not.toHaveBeenCalled();
  });

  it('does not reject a long current password on length (only newPassword has a length policy)', async () => {
    const authResponse = buildAuthResponse();
    mockedChangePassword.mockResolvedValueOnce(authResponse);
    const longCurrentPassword = 'a'.repeat(200);

    const { getByText, getByTestId, queryByText } = await render(<AccountSecurityScreen />);
    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());

    await fireEvent.changeText(getByTestId('current-password-input'), longCurrentPassword);
    await fireEvent.changeText(getByTestId('new-password-input'), 'new-password-123');
    await fireEvent.changeText(getByTestId('confirm-new-password-input'), 'new-password-123');
    await fireEvent.press(getByText('Ubah Password'));

    await waitFor(() => expect(mockedChangePassword).toHaveBeenCalledTimes(1));
    expect(queryByText(/wajib diisi/)).toBeNull();
  });

  it('disables the submit button while the request is in flight (no double-submit)', async () => {
    const deferred = createDeferred<AuthResponse>();
    mockedChangePassword.mockReturnValueOnce(deferred.promise);

    const { getByTestId } = await render(<AccountSecurityScreen />);
    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());

    await fireEvent.changeText(getByTestId('current-password-input'), 'old-password');
    await fireEvent.changeText(getByTestId('new-password-input'), 'new-password-123');
    await fireEvent.changeText(getByTestId('confirm-new-password-input'), 'new-password-123');

    await fireEvent.press(getByTestId('change-password-submit'));
    await waitFor(() => expect(mockedChangePassword).toHaveBeenCalledTimes(1));

    // A second press while in flight must not fire a second request (the
    // button is disabled and shows a spinner instead of its label).
    await fireEvent.press(getByTestId('change-password-submit'));
    expect(mockedChangePassword).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(buildAuthResponse());
      await deferred.promise;
    });
  });

  it('persists the rotated token pair via setTokensAndNotify and shows a success toast on success', async () => {
    const authResponse = buildAuthResponse({
      accessToken: 'brand-new-access-token',
      refreshToken: 'brand-new-refresh-token',
    });
    mockedChangePassword.mockResolvedValueOnce(authResponse);

    const { getByText, getByTestId } = await render(<AccountSecurityScreen />);
    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());

    await fireEvent.changeText(getByTestId('current-password-input'), 'old-password');
    await fireEvent.changeText(getByTestId('new-password-input'), 'new-password-123');
    await fireEvent.changeText(getByTestId('confirm-new-password-input'), 'new-password-123');
    await fireEvent.press(getByText('Ubah Password'));

    await waitFor(() =>
      expect(mockedSetTokensAndNotify).toHaveBeenCalledWith({
        accessToken: 'brand-new-access-token',
        refreshToken: 'brand-new-refresh-token',
      })
    );
    expect(mockedChangePassword).toHaveBeenCalledWith(
      'old-password',
      'new-password-123',
      'current-refresh-token'
    );
    expect(mockShowToast).toHaveBeenCalledWith('Password berhasil diubah.');
  });

  it('shows a non-silent error with a retry affordance on failure, and does not persist any tokens', async () => {
    mockedChangePassword.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
    );

    const { getByText, getByTestId } = await render(<AccountSecurityScreen />);
    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());

    await fireEvent.changeText(getByTestId('current-password-input'), 'wrong-password');
    await fireEvent.changeText(getByTestId('new-password-input'), 'new-password-123');
    await fireEvent.changeText(getByTestId('confirm-new-password-input'), 'new-password-123');
    await fireEvent.press(getByText('Ubah Password'));

    await waitFor(() => expect(getByText('Password saat ini salah.')).toBeTruthy());
    expect(mockedSetTokensAndNotify).not.toHaveBeenCalled();

    // Retry affordance re-attempts the same request.
    mockedChangePassword.mockResolvedValueOnce(buildAuthResponse());
    await fireEvent.press(getByText('Coba Lagi'));

    await waitFor(() => expect(mockedChangePassword).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Password berhasil diubah.'));
  });
});

describe('AccountSecurityScreen - session list', () => {
  it('shows a loading spinner while sessions are being fetched', async () => {
    const deferred = createDeferred<readonly SessionSummary[]>();
    mockedListSessions.mockReturnValueOnce(deferred.promise);

    const { getByTestId } = await render(<AccountSecurityScreen />);

    // The loading spinner renders while the promise is unresolved.
    expect(getByTestId('sessions-loading')).toBeTruthy();

    await act(async () => {
      deferred.resolve(buildSessions());
      await deferred.promise;
    });
  });

  it('renders sessions, with fallback text for a null userAgent/lastUsedAt', async () => {
    const { getByText, getByTestId } = await render(<AccountSecurityScreen />);

    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());
    expect(getByText('iPhone 15 / Mobile App 1.0')).toBeTruthy();

    expect(getByTestId('session-row-session_2')).toBeTruthy();
    expect(getByText('Perangkat tidak diketahui')).toBeTruthy();
    expect(getByText(/Belum pernah digunakan/)).toBeTruthy();
  });

  it('shows an error with a retry affordance when fetching sessions fails', async () => {
    mockedListSessions.mockReset();
    mockedListSessions.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    const { getByText, getByTestId } = await render(<AccountSecurityScreen />);

    await waitFor(() =>
      expect(getByText('Gagal memuat daftar sesi. Periksa koneksi kamu dan coba lagi.')).toBeTruthy()
    );

    mockedListSessions.mockResolvedValueOnce(buildSessions());
    await fireEvent.press(getByText('Coba Lagi'));

    await waitFor(() => expect(mockedListSessions).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());
  });

  it('requires confirmation before revoking a session, then revokes it on confirm', async () => {
    const { getByText, getByTestId, queryByText } = await render(<AccountSecurityScreen />);

    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());

    await fireEvent.press(getByTestId('revoke-session-button-session_1'));

    // Confirm step: the destructive action has not happened yet.
    expect(getByText('Hapus Sesi Ini?')).toBeTruthy();
    expect(mockedRevokeSession).not.toHaveBeenCalled();

    mockedRevokeSession.mockResolvedValueOnce(undefined);
    await fireEvent.press(getByText('Ya, Hapus Sesi'));

    await waitFor(() => expect(mockedRevokeSession).toHaveBeenCalledWith('session_1'));
    await waitFor(() => expect(queryByText('Hapus Sesi Ini?')).toBeNull());
    expect(mockShowToast).toHaveBeenCalledWith('Sesi berhasil dihapus.');
  });

  it('cancels the revoke without calling the API when cancel is pressed', async () => {
    const { getByText, getByTestId, queryByText } = await render(<AccountSecurityScreen />);

    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());
    await fireEvent.press(getByTestId('revoke-session-button-session_1'));
    await fireEvent.press(getByText('Batal'));

    await waitFor(() => expect(queryByText('Hapus Sesi Ini?')).toBeNull());
    expect(mockedRevokeSession).not.toHaveBeenCalled();
  });

  it('shows a non-silent error with a retry affordance when revoking fails', async () => {
    const { getByText, getByTestId, queryByText } = await render(<AccountSecurityScreen />);

    await waitFor(() => expect(getByTestId('session-row-session_1')).toBeTruthy());
    await fireEvent.press(getByTestId('revoke-session-button-session_1'));

    mockedRevokeSession.mockRejectedValueOnce(
      new ApiError(404, 'SESSION_NOT_FOUND', 'Session not found.')
    );
    await fireEvent.press(getByText('Ya, Hapus Sesi'));

    await waitFor(() => expect(getByText(/Sesi ini sudah tidak aktif\./)).toBeTruthy());

    // Retry affordance: pressing confirm again re-attempts the same revoke.
    mockedRevokeSession.mockResolvedValueOnce(undefined);
    await fireEvent.press(getByText('Ya, Hapus Sesi'));

    await waitFor(() => expect(mockedRevokeSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queryByText('Hapus Sesi Ini?')).toBeNull());
  });
});

describe('AccountSecurityScreen - logout all', () => {
  it('requires confirmation before logging out of all devices', async () => {
    const { getByText } = await render(<AccountSecurityScreen />);

    await fireEvent.press(getByText('Keluar dari Semua Perangkat'));

    expect(getByText('Keluar dari Semua Perangkat?')).toBeTruthy();
    expect(mockedLogoutAll).not.toHaveBeenCalled();
  });

  it('performs a full local sign-out and navigates to /login on confirmed success', async () => {
    mockedLogoutAll.mockResolvedValueOnce(undefined);

    const { getByText } = await render(<AccountSecurityScreen />);

    await fireEvent.press(getByText('Keluar dari Semua Perangkat'));
    await fireEvent.press(getByText('Ya, Keluar dari Semua Perangkat'));

    await waitFor(() => expect(mockedLogoutAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith('/login');
  });

  it('shows a non-silent error with a retry affordance on failure, without signing out locally', async () => {
    mockedLogoutAll.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    const { getByText } = await render(<AccountSecurityScreen />);

    await fireEvent.press(getByText('Keluar dari Semua Perangkat'));
    await fireEvent.press(getByText('Ya, Keluar dari Semua Perangkat'));

    await waitFor(() =>
      expect(
        getByText(/Gagal keluar dari semua perangkat\. Periksa koneksi kamu dan coba lagi\./)
      ).toBeTruthy()
    );
    expect(mockLogout).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/login');

    // Retry affordance: pressing confirm again re-attempts logout-all.
    mockedLogoutAll.mockResolvedValueOnce(undefined);
    await fireEvent.press(getByText('Ya, Keluar dari Semua Perangkat'));

    await waitFor(() => expect(mockedLogoutAll).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });
});

describe('AccountSecurityScreen - no dev-only controls reachable', () => {
  it('never renders a dev-token / password-reset control, regardless of __DEV__', async () => {
    const originalDev = (globalThis as { __DEV__?: boolean }).__DEV__;

    (globalThis as { __DEV__?: boolean }).__DEV__ = true;
    const devRender = await render(<AccountSecurityScreen />);
    await waitFor(() => expect(devRender.getByTestId('session-row-session_1')).toBeTruthy());
    expect(devRender.queryByText(/devToken/i)).toBeNull();
    expect(devRender.queryByText(/dev token/i)).toBeNull();
    expect(devRender.queryByText(/reset password/i)).toBeNull();
    expect(devRender.queryByText(/lupa password/i)).toBeNull();
    await devRender.unmount();

    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    const prodRender = await render(<AccountSecurityScreen />);
    await waitFor(() => expect(prodRender.getByTestId('session-row-session_1')).toBeTruthy());
    expect(prodRender.queryByText(/devToken/i)).toBeNull();
    expect(prodRender.queryByText(/dev token/i)).toBeNull();
    expect(prodRender.queryByText(/reset password/i)).toBeNull();
    expect(prodRender.queryByText(/lupa password/i)).toBeNull();
    await prodRender.unmount();

    (globalThis as { __DEV__?: boolean }).__DEV__ = originalDev;
  });
});
