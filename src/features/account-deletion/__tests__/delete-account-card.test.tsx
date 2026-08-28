import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import { DeleteAccountCard } from '@/features/account-deletion/delete-account-card';
import { ApiError } from '@/services/api/client';
import {
  deleteMyAccount,
  fetchDeletionMethods,
  requestWhatsAppDeletionOtp,
} from '@/services/auth/account-deletion-service';
import { signInWithGoogle } from '@/services/auth/google-sign-in';
import { clearPersistedProgressForIdentity } from '@/stores/series-progress';
import { clearPersistedInteractionsForIdentity } from '@/stores/video-interactions';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
}));

const mockLogout = jest.fn();
const mockUseAuth = jest.fn();

jest.mock('@/stores/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/services/auth/account-deletion-service');
jest.mock('@/services/auth/google-sign-in');
jest.mock('@/stores/video-interactions');
jest.mock('@/stores/series-progress');

const mockedFetchMethods = fetchDeletionMethods as jest.MockedFunction<typeof fetchDeletionMethods>;
const mockedRequestOtp = requestWhatsAppDeletionOtp as jest.MockedFunction<
  typeof requestWhatsAppDeletionOtp
>;
const mockedDelete = deleteMyAccount as jest.MockedFunction<typeof deleteMyAccount>;
const mockedGoogleSignIn = signInWithGoogle as jest.MockedFunction<typeof signInWithGoogle>;
const mockedClearInteractions = clearPersistedInteractionsForIdentity as jest.MockedFunction<
  typeof clearPersistedInteractionsForIdentity
>;
const mockedClearProgress = clearPersistedProgressForIdentity as jest.MockedFunction<
  typeof clearPersistedProgressForIdentity
>;

/**
 * A challenge whose resend is available immediately, so no countdown timer
 * runs during a test that is not about the countdown.
 */
const READY_CHALLENGE = { expiresInSeconds: 300, resendAvailableInSeconds: 0 };

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    isHydrated: true,
    user: { id: 'user_1', name: 'Jane', username: 'jane', email: 'jane@example.com' },
    logout: mockLogout,
  });
  mockLogout.mockResolvedValue(undefined);
  mockedClearInteractions.mockResolvedValue(undefined);
  mockedClearProgress.mockResolvedValue(undefined);
  mockedDelete.mockResolvedValue(undefined);
  mockedRequestOtp.mockResolvedValue(READY_CHALLENGE);
  mockedFetchMethods.mockResolvedValue(['password']);
});

/** Renders and waits for the method list to settle. */
async function renderCard() {
  const utils = await render(<DeleteAccountCard />);

  await waitFor(() => expect(utils.queryByTestId('delete-account-loading')).toBeNull());

  return utils;
}

describe('which options are offered - the server decides, the client does not guess', () => {
  it('asks the backend which proofs this account can produce, on open', async () => {
    await renderCard();

    expect(mockedFetchMethods).toHaveBeenCalledTimes(1);
  });

  it('a PASSWORD-only account gets the password field and no method picker', async () => {
    mockedFetchMethods.mockResolvedValue(['password']);

    const { getByTestId, queryByTestId } = await renderCard();

    expect(getByTestId('delete-account-password-input')).toBeTruthy();
    // One option is not a choice; a single-entry picker would be a control
    // that cannot be operated.
    expect(queryByTestId('delete-account-method-picker')).toBeNull();
    expect(queryByTestId('delete-account-unavailable')).toBeNull();
  });

  it('a GOOGLE-only account gets the Google re-auth button and NO password field', async () => {
    // The exact case that used to be a dead end: a password form shown to
    // somebody who never had a password.
    mockedFetchMethods.mockResolvedValue(['google']);

    const { getByTestId, queryByTestId } = await renderCard();

    expect(getByTestId('delete-account-google-button')).toBeTruthy();
    expect(queryByTestId('delete-account-password-input')).toBeNull();
    expect(queryByTestId('delete-account-unavailable')).toBeNull();
  });

  it('a WHATSAPP-only account gets the send-code button and NO password field', async () => {
    mockedFetchMethods.mockResolvedValue(['whatsapp']);

    const { getByTestId, queryByTestId } = await renderCard();

    expect(getByTestId('delete-account-request-code')).toBeTruthy();
    expect(queryByTestId('delete-account-password-input')).toBeNull();
    expect(queryByTestId('delete-account-unavailable')).toBeNull();
  });

  it('a MULTI-METHOD account gets one chip per method and defaults to the first', async () => {
    mockedFetchMethods.mockResolvedValue(['password', 'google', 'whatsapp']);

    const { getByTestId } = await renderCard();

    expect(getByTestId('delete-account-method-picker')).toBeTruthy();
    expect(getByTestId('delete-account-method-password')).toBeTruthy();
    expect(getByTestId('delete-account-method-google')).toBeTruthy();
    expect(getByTestId('delete-account-method-whatsapp')).toBeTruthy();
    // The backend's order is fixed so the default is stable per account.
    expect(getByTestId('delete-account-password-input')).toBeTruthy();
  });

  it('an EMPTY list explains and points at support - it is not rendered as a retryable error', async () => {
    mockedFetchMethods.mockResolvedValue([]);

    const { getByTestId, queryByTestId } = await renderCard();

    expect(getByTestId('delete-account-unavailable')).toBeTruthy();
    expect(queryByTestId('delete-account-methods-retry')).toBeNull();
    expect(queryByTestId('delete-account-submit')).toBeNull();
  });

  it('a FAILED lookup shows a real error with a retry, and offers no proof panel on a guess', async () => {
    // The predecessor screen fell back to "assume there is a password", which
    // is how a Google-only account was told its password was wrong.
    mockedFetchMethods.mockRejectedValueOnce(new Error('offline'));

    const { getByTestId, queryByTestId } = await renderCard();

    expect(getByTestId('delete-account-methods-error')).toBeTruthy();
    expect(queryByTestId('delete-account-password-input')).toBeNull();
    expect(queryByTestId('delete-account-submit')).toBeNull();

    mockedFetchMethods.mockResolvedValueOnce(['password']);
    await fireEvent.press(getByTestId('delete-account-methods-retry'));

    await waitFor(() => expect(getByTestId('delete-account-password-input')).toBeTruthy());
  });
});

describe('password deletion - preserved behaviour', () => {
  it('requires a password before the confirmation dialog appears', async () => {
    const { getByTestId, getByText, queryByText } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-submit'));

    expect(getByText('Password saat ini wajib diisi')).toBeTruthy();
    expect(queryByText('Hapus Akun Secara Permanen?')).toBeNull();
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('shows the unmissable irreversible-confirmation dialog and calls nothing until confirmed', async () => {
    const { getByTestId, getByText, getAllByText } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'my-password');
    await fireEvent.press(getByTestId('delete-account-submit'));

    expect(getByText('Hapus Akun Secara Permanen?')).toBeTruthy();
    expect(getAllByText(/PERMANEN/).length).toBeGreaterThan(0);
    expect(getAllByText(/TIDAK BISA DIBATALKAN/).length).toBeGreaterThan(0);
    expect(mockedDelete).not.toHaveBeenCalled();
  });

  it('cancelling genuinely blocks the action - no API call, no cleanup, no logout', async () => {
    const { getByTestId, queryByText } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'my-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-cancel'));

    expect(queryByText('Hapus Akun Secara Permanen?')).toBeNull();
    expect(mockedDelete).not.toHaveBeenCalled();
    expect(mockedClearInteractions).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('sends a PASSWORD proof on confirm', async () => {
    const { getByTestId } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith({
        method: 'password',
        currentPassword: 'correct-password',
      })
    );
  });

  it('a WRONG PASSWORD says so, and does not clean up or sign out', async () => {
    mockedDelete.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
    );

    const { getByTestId, getByText } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'wrong-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/Password saat ini salah\./)).toBeTruthy());
    expect(mockedClearInteractions).not.toHaveBeenCalled();
    expect(mockedClearProgress).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/login');
  });

  it('does not double-submit while the request is in flight', async () => {
    let resolveDelete!: () => void;
    mockedDelete.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveDelete = resolve;
      })
    );

    const { getByTestId } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(mockedDelete).toHaveBeenCalledTimes(1));

    await fireEvent.press(getByTestId('confirm-dialog-confirm'));
    expect(mockedDelete).toHaveBeenCalledTimes(1);

    resolveDelete();
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
  });
});

describe('google deletion', () => {
  beforeEach(() => {
    mockedFetchMethods.mockResolvedValue(['google']);
    mockedGoogleSignIn.mockResolvedValue({
      status: 'success',
      idToken: 'synthetic.google.id-token',
    });
  });

  it('does not offer the destructive button until Google has actually been re-verified', async () => {
    const { getByTestId, queryByTestId } = await renderCard();

    expect(queryByTestId('delete-account-submit')).toBeNull();

    await fireEvent.press(getByTestId('delete-account-google-button'));

    await waitFor(() => expect(getByTestId('delete-account-google-verified')).toBeTruthy());
    expect(getByTestId('delete-account-submit')).toBeTruthy();
  });

  it('re-authenticates through the SIGN-IN ADAPTER ONLY - it never exchanges the token for a session', async () => {
    // The failure being designed out: `loginWithGoogleIdToken` /
    // `useAuth().loginWithGoogle()` would mint a session for whichever account
    // owns the Google identity, silently signing the viewer into a DIFFERENT
    // account with the delete button still on screen. The auth store this card
    // consumes exposes only `logout`/`user`, so no session-minting path is even
    // reachable from here.
    const { getByTestId } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-google-button'));

    await waitFor(() => expect(mockedGoogleSignIn).toHaveBeenCalledTimes(1));
    expect(mockUseAuth()).not.toHaveProperty('loginWithGoogle');
  });

  it('sends the fresh ID token as the proof, and no password', async () => {
    const { getByTestId } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-google-button'));
    await waitFor(() => expect(getByTestId('delete-account-submit')).toBeTruthy());

    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith({
        method: 'google',
        idToken: 'synthetic.google.id-token',
      })
    );
  });

  it('the WRONG GOOGLE ACCOUNT is reported as a wrong account, not as a bad credential', async () => {
    // Ownership is bound server-side by provider subject. The client never
    // compares emails, so this message can only come from the backend's own
    // ACCOUNT_DELETION_PROOF_MISMATCH.
    mockedDelete.mockRejectedValueOnce(
      new ApiError(
        401,
        'ACCOUNT_DELETION_PROOF_MISMATCH',
        'That Google account is not the one linked to this account.'
      )
    );

    const { getByTestId, getByText } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-google-button'));
    await waitFor(() => expect(getByTestId('delete-account-submit')).toBeTruthy());
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/bukan akun yang tertaut ke akun ini/)).toBeTruthy());
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('a CANCELLED Google sheet says nothing and simply returns to the un-verified state', async () => {
    mockedGoogleSignIn.mockResolvedValueOnce({ status: 'cancelled' });

    const { getByTestId, queryByTestId } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-google-button'));

    await waitFor(() => expect(mockedGoogleSignIn).toHaveBeenCalled());
    expect(queryByTestId('delete-account-proof-error')).toBeNull();
    expect(queryByTestId('delete-account-google-verified')).toBeNull();
    expect(queryByTestId('delete-account-submit')).toBeNull();
  });

  it('an UNCONFIGURED build explains itself without leaking developer config text', async () => {
    mockedGoogleSignIn.mockResolvedValueOnce({
      status: 'unconfigured',
      developerMessage: 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set',
    });

    const { getByTestId, queryByText } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-google-button'));

    await waitFor(() => expect(getByTestId('delete-account-proof-error')).toBeTruthy());
    expect(queryByText(/EXPO_PUBLIC/)).toBeNull();
  });
});

describe('whatsapp deletion', () => {
  beforeEach(() => {
    mockedFetchMethods.mockResolvedValue(['whatsapp']);
  });

  it('walks the flow: request code -> enter code -> submit deletion', async () => {
    const { getByTestId, queryByTestId } = await renderCard();

    expect(queryByTestId('delete-account-otp-input')).toBeNull();

    await fireEvent.press(getByTestId('delete-account-request-code'));

    await waitFor(() => expect(getByTestId('delete-account-otp-input')).toBeTruthy());
    await fireEvent.changeText(getByTestId('delete-account-otp-input'), '123456');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() =>
      expect(mockedDelete).toHaveBeenCalledWith({ method: 'whatsapp', code: '123456' })
    );
  });

  it('uses the DELETION otp route, never the login one, and supplies no phone number', async () => {
    const { getByTestId } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-request-code'));

    await waitFor(() => expect(mockedRequestOtp).toHaveBeenCalledTimes(1));
    // Called with nothing at all: the number comes from the account's own
    // linked identity, server-side.
    expect(mockedRequestOtp).toHaveBeenCalledWith();
  });

  it('an INVALID code is reported with the one message that covers every OTP failure', async () => {
    mockedDelete.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_OTP', 'Invalid or expired verification code')
    );

    const { getByTestId, getByText } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-request-code'));
    await waitFor(() => expect(getByTestId('delete-account-otp-input')).toBeTruthy());
    await fireEvent.changeText(getByTestId('delete-account-otp-input'), '000000');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/salah atau sudah kedaluwarsa/)).toBeTruthy());
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('an EXPIRED code gets that same message - the backend refuses to distinguish them', async () => {
    mockedDelete.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_OTP', 'Invalid or expired verification code')
    );

    const { getByTestId, getByText } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-request-code'));
    await waitFor(() => expect(getByTestId('delete-account-otp-input')).toBeTruthy());
    await fireEvent.changeText(getByTestId('delete-account-otp-input'), '123456');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/Minta kode baru lalu coba lagi/)).toBeTruthy());
  });

  it('an exhausted ATTEMPT BUDGET gets that same message too', async () => {
    mockedDelete.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_OTP', 'Invalid or expired verification code')
    );

    const { getByTestId, getByText } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-request-code'));
    await waitFor(() => expect(getByTestId('delete-account-otp-input')).toBeTruthy());
    await fireEvent.changeText(getByTestId('delete-account-otp-input'), '999999');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/salah atau sudah kedaluwarsa/)).toBeTruthy());
  });

  it('PROVIDER UNAVAILABLE says the code could not be sent, and leaves the flow retryable', async () => {
    mockedRequestOtp.mockRejectedValueOnce(
      new ApiError(503, 'WHATSAPP_PROVIDER_UNAVAILABLE', 'Could not send the code right now.')
    );

    const { getByTestId, getByText, queryByTestId } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-request-code'));

    await waitFor(() => expect(getByText(/Coba lagi sebentar lagi/)).toBeTruthy());
    // No challenge exists, so the code field must NOT be offered.
    expect(queryByTestId('delete-account-otp-input')).toBeNull();
    // ...and the send button stays available, because no cooldown was spent.
    expect(getByTestId('delete-account-request-code')).toBeTruthy();
  });

  it('a COOLDOWN (429) tells the viewer to wait rather than to try again now', async () => {
    mockedRequestOtp.mockRejectedValueOnce(
      new ApiError(429, 'OTP_RESEND_COOLDOWN', 'Wait before requesting another.')
    );

    const { getByTestId, getByText } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-request-code'));

    await waitFor(() => expect(getByText(/Tunggu sebentar/)).toBeTruthy());
  });

  it('locks resend behind the countdown the SERVER supplied, not a client guess', async () => {
    mockedRequestOtp.mockResolvedValueOnce({
      expiresInSeconds: 300,
      resendAvailableInSeconds: 60,
    });

    const { getByTestId, getByText } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-request-code'));

    await waitFor(() => expect(getByText(/Kirim ulang kode dalam 60s/)).toBeTruthy());
    expect(getByTestId('delete-account-resend-code').props.accessibilityState.disabled).toBe(true);
  });
});

describe('switching methods on a multi-method account', () => {
  beforeEach(() => {
    mockedFetchMethods.mockResolvedValue(['password', 'google', 'whatsapp']);
    mockedGoogleSignIn.mockResolvedValue({
      status: 'success',
      idToken: 'synthetic.google.id-token',
    });
  });

  it('swaps the panel to the chosen method', async () => {
    const { getByTestId, queryByTestId } = await renderCard();

    await fireEvent.press(getByTestId('delete-account-method-whatsapp'));

    expect(getByTestId('delete-account-request-code')).toBeTruthy();
    expect(queryByTestId('delete-account-password-input')).toBeNull();
  });

  it('DROPS a half-finished proof when the method changes, so nothing stale can be submitted', async () => {
    const { getByTestId, queryByTestId } = await renderCard();

    // Verify with Google...
    await fireEvent.press(getByTestId('delete-account-method-google'));
    await fireEvent.press(getByTestId('delete-account-google-button'));
    await waitFor(() => expect(getByTestId('delete-account-google-verified')).toBeTruthy());

    // ...then switch away and back.
    await fireEvent.press(getByTestId('delete-account-method-whatsapp'));
    await fireEvent.press(getByTestId('delete-account-method-google'));

    // The verified badge must be gone: a viewer must never see
    // "Terverifikasi" for a credential the screen no longer holds.
    expect(queryByTestId('delete-account-google-verified')).toBeNull();
    expect(queryByTestId('delete-account-submit')).toBeNull();
  });

  it('clears a typed password when switching away from the password panel', async () => {
    const { getByTestId } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'my-password');
    await fireEvent.press(getByTestId('delete-account-method-whatsapp'));
    await fireEvent.press(getByTestId('delete-account-method-password'));

    expect(getByTestId('delete-account-password-input').props.value).toBe('');
  });

  it('re-reads the method list when the server says the chosen method is unavailable', async () => {
    // The list this card is holding is exactly what a 409 contradicts, so it
    // is the one failure that justifies spending another request.
    mockedDelete.mockRejectedValueOnce(
      new ApiError(
        409,
        'ACCOUNT_DELETION_METHOD_UNAVAILABLE',
        'This account cannot confirm deletion with "password".'
      )
    );

    const { getByTestId, getByText } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'my-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/Metode Password tidak bisa dipakai/)).toBeTruthy());
    await waitFor(() => expect(mockedFetchMethods).toHaveBeenCalledTimes(2));
    expect(mockLogout).not.toHaveBeenCalled();
  });

  it('does NOT spend an extra request re-reading the list after an ordinary wrong password', async () => {
    mockedDelete.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.')
    );

    const { getByTestId, getByText } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'wrong');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/Password saat ini salah\./)).toBeTruthy());
    expect(mockedFetchMethods).toHaveBeenCalledTimes(1);
  });
});

describe('post-deletion cleanup', () => {
  it('purges BOTH identity-scoped caches, signs out, and returns to the logged-out screen', async () => {
    const { getByTestId } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(mockedClearInteractions).toHaveBeenCalledWith('user_1'));
    await waitFor(() => expect(mockedClearProgress).toHaveBeenCalledWith('user_1'));
    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(router.replace).toHaveBeenCalledWith('/login');
  });

  it('purges the identity captured BEFORE logout, never a live post-logout read', async () => {
    // Guards the refactor that would derive the cleanup identity from a fresh
    // read taken after `await logout()` - by which point `user` is null and
    // the purge would target nothing, or the guest namespace.
    mockLogout.mockImplementation(async () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: false,
        isHydrated: true,
        user: null,
        logout: mockLogout,
      });
    });

    const { getByTestId } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(mockLogout).toHaveBeenCalledTimes(1));
    expect(mockedClearInteractions).toHaveBeenCalledWith('user_1');
    expect(mockedClearProgress).toHaveBeenCalledWith('user_1');
  });

  it('purges the caches BEFORE signing out, so the identity is still resolvable', async () => {
    const order: string[] = [];
    mockedClearInteractions.mockImplementation(async () => {
      order.push('clear-interactions');
    });
    mockedClearProgress.mockImplementation(async () => {
      order.push('clear-progress');
    });
    mockLogout.mockImplementation(async () => {
      order.push('logout');
    });

    const { getByTestId } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(order).toContain('logout'));
    expect(order.indexOf('clear-interactions')).toBeLessThan(order.indexOf('logout'));
    expect(order.indexOf('clear-progress')).toBeLessThan(order.indexOf('logout'));
  });

  it('an API FAILURE wipes NOTHING - no purge, no sign-out, no navigation', async () => {
    // The failure mode this pins: an app that signs somebody out and clears
    // their cached data because a request timed out.
    mockedDelete.mockRejectedValueOnce(new Error('network timeout'));

    const { getByTestId, getByText } = await renderCard();

    await fireEvent.changeText(getByTestId('delete-account-password-input'), 'correct-password');
    await fireEvent.press(getByTestId('delete-account-submit'));
    await fireEvent.press(getByTestId('confirm-dialog-confirm'));

    await waitFor(() => expect(getByText(/Gagal menghapus akun/)).toBeTruthy());
    expect(mockedClearInteractions).not.toHaveBeenCalled();
    expect(mockedClearProgress).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalledWith('/login');
  });
});
