import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import LoginScreen from '@/app/login';
import { ApiError } from '@/services/api/client';
import { isGoogleSignInConfigured, isGoogleSignInSupported } from '@/services/auth/google-sign-in';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
}));

const mockLogin = jest.fn();
const mockLoginWithGoogle = jest.fn();
const mockAuthState = { isAuthenticated: false, isHydrated: true };

jest.mock('@/stores/auth', () => ({
  useAuth: () => ({
    login: mockLogin,
    loginWithGoogle: mockLoginWithGoogle,
    isAuthenticated: mockAuthState.isAuthenticated,
    isHydrated: mockAuthState.isHydrated,
    user: null,
  }),
}));

const mockShowToast = jest.fn();

jest.mock('@/stores/toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// Mocked at the provider boundary only: these tests describe how the screen
// reacts to each Google outcome, and prove nothing about real Google.
jest.mock('@/services/auth/google-sign-in', () => ({
  isGoogleSignInSupported: jest.fn(() => true),
  isGoogleSignInConfigured: jest.fn(() => true),
}));

const mockedIsSupported = isGoogleSignInSupported as jest.MockedFunction<
  typeof isGoogleSignInSupported
>;
const mockedIsConfigured = isGoogleSignInConfigured as jest.MockedFunction<
  typeof isGoogleSignInConfigured
>;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState.isAuthenticated = false;
  mockAuthState.isHydrated = true;
  mockedIsSupported.mockReturnValue(true);
  mockedIsConfigured.mockReturnValue(true);
  mockLogin.mockResolvedValue(undefined);
  mockLoginWithGoogle.mockResolvedValue({ status: 'success' });
});

describe('LoginScreen semantics', () => {
  it('exposes the stable identifiers automation depends on', async () => {
    // These ids are a product commitment, not a test convenience: the login
    // screen previously had no stable selectors at all.
    const { getByTestId } = await render(<LoginScreen />);

    expect(getByTestId('login-email-input')).toBeTruthy();
    expect(getByTestId('login-password-input')).toBeTruthy();
    expect(getByTestId('login-submit')).toBeTruthy();
    expect(getByTestId('login-google')).toBeTruthy();
    expect(getByTestId('login-whatsapp')).toBeTruthy();
    expect(getByTestId('login-register-email')).toBeTruthy();
  });

  it('labels the fields and buttons for screen readers', async () => {
    const { getByLabelText } = await render(<LoginScreen />);

    expect(getByLabelText('Email')).toBeTruthy();
    expect(getByLabelText('Password')).toBeTruthy();
    expect(getByLabelText('Lanjutkan dengan Google')).toBeTruthy();
    expect(getByLabelText('Lanjutkan dengan WhatsApp')).toBeTruthy();
  });
});

describe('email + password login', () => {
  it('logs in with the trimmed email and navigates to the profile', async () => {
    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.changeText(getByTestId('login-email-input'), '  jane@example.com  ');
    await fireEvent.changeText(getByTestId('login-password-input'), 'password123');
    await fireEvent.press(getByTestId('login-submit'));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('jane@example.com', 'password123'));
    expect(router.replace).toHaveBeenCalledWith('/profile');
    expect(mockShowToast).toHaveBeenCalledWith('Selamat datang!');
  });

  it('never registers an account as a side effect of a failed login', async () => {
    // The removed behaviour: an INVALID_CREDENTIALS response used to create
    // an account. It must now surface as a failed login and nothing else.
    mockLogin.mockRejectedValueOnce(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid.'));

    const { getByTestId, queryByTestId } = await render(<LoginScreen />);

    await fireEvent.changeText(getByTestId('login-email-input'), 'jane@example.com');
    await fireEvent.changeText(getByTestId('login-password-input'), 'wrong-password');
    await fireEvent.press(getByTestId('login-submit'));

    await waitFor(() => expect(queryByTestId('login-error')).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  it('offers registration as a possibility without claiming the email is unknown', async () => {
    mockLogin.mockRejectedValueOnce(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid.'));

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.changeText(getByTestId('login-email-input'), 'jane@example.com');
    await fireEvent.changeText(getByTestId('login-password-input'), 'wrong-password');
    await fireEvent.press(getByTestId('login-submit'));

    const banner = await waitFor(() => getByTestId('login-error'));
    // The backend does not distinguish "wrong password" from "no such
    // account", so neither may the copy.
    expect(banner).toHaveTextContent(/Email atau password salah/);
  });

  it('reports a non-credential failure as a generic error', async () => {
    mockLogin.mockRejectedValueOnce(new ApiError(500, 'SERVER_ERROR', 'Boom.'));

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.changeText(getByTestId('login-email-input'), 'jane@example.com');
    await fireEvent.changeText(getByTestId('login-password-input'), 'password123');
    await fireEvent.press(getByTestId('login-submit'));

    const banner = await waitFor(() => getByTestId('login-error'));
    expect(banner).toHaveTextContent(/Login gagal/);
  });
});

describe('email + password validation', () => {
  it('requires an email before calling the backend', async () => {
    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.changeText(getByTestId('login-password-input'), 'password123');
    await fireEvent.press(getByTestId('login-submit'));

    await waitFor(() => expect(getByTestId('login-email-input-error')).toBeTruthy());
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('rejects a malformed email before calling the backend', async () => {
    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.changeText(getByTestId('login-email-input'), 'not-an-email');
    await fireEvent.changeText(getByTestId('login-password-input'), 'password123');
    await fireEvent.press(getByTestId('login-submit'));

    await waitFor(() =>
      expect(getByTestId('login-email-input-error')).toHaveTextContent('Format email tidak valid')
    );
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('requires a password before calling the backend', async () => {
    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.changeText(getByTestId('login-email-input'), 'jane@example.com');
    await fireEvent.press(getByTestId('login-submit'));

    await waitFor(() => expect(getByTestId('login-password-input-error')).toBeTruthy());
    expect(mockLogin).not.toHaveBeenCalled();
  });
});

describe('registration entry point', () => {
  it('navigates to the explicit registration screen', async () => {
    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-register-email'));

    expect(router.push).toHaveBeenCalledWith('/register');
  });
});

describe('Google sign-in', () => {
  it('enters the session and navigates on success', async () => {
    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-google'));

    await waitFor(() => expect(mockLoginWithGoogle).toHaveBeenCalled());
    expect(router.replace).toHaveBeenCalledWith('/profile');
  });

  it('says nothing when the viewer dismisses the Google sheet', async () => {
    mockLoginWithGoogle.mockResolvedValueOnce({ status: 'cancelled' });

    const { getByTestId, queryByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-google'));

    await waitFor(() => expect(mockLoginWithGoogle).toHaveBeenCalled());
    expect(queryByTestId('login-error')).toBeNull();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('surfaces a clear message when the build has no Google client IDs', async () => {
    mockLoginWithGoogle.mockResolvedValueOnce({
      status: 'unconfigured',
      developerMessage: 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is not set.',
    });

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-google'));

    await waitFor(() => expect(getByTestId('login-error')).toBeTruthy());
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows a developer hint when Google is unconfigured, before anything is pressed', async () => {
    mockedIsConfigured.mockReturnValue(false);

    const { getByTestId } = await render(<LoginScreen />);

    expect(getByTestId('login-google-config-hint')).toBeTruthy();
  });

  it('shows no developer hint once Google is configured', async () => {
    mockedIsConfigured.mockReturnValue(true);

    const { queryByTestId } = await render(<LoginScreen />);

    expect(queryByTestId('login-google-config-hint')).toBeNull();
  });

  it('reports a provider failure as an error the viewer can act on', async () => {
    mockLoginWithGoogle.mockResolvedValueOnce({ status: 'failed', reason: 'no play services' });

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-google'));

    await waitFor(() =>
      expect(getByTestId('login-error')).toHaveTextContent(/Login Google gagal/)
    );
  });

  it('reports a rejected Google token distinctly', async () => {
    mockLoginWithGoogle.mockRejectedValueOnce(
      new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Bad token.')
    );

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-google'));

    await waitFor(() =>
      expect(getByTestId('login-error')).toHaveTextContent(/tidak bisa memverifikasi/)
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('points an account collision at the Account Security link control', async () => {
    // THE recovery path. The backend refuses to merge accounts on matching
    // email addresses and tells the person to sign in with their existing
    // method and link Google from account settings - so this message must
    // say that, and the control it names must exist (it does:
    // `auth-method-link-google` on the Account Security card). Reporting it
    // as a generic "Login Google gagal" is how a correct security boundary
    // gets reported as a bug and then weakened.
    mockLoginWithGoogle.mockRejectedValueOnce(
      new ApiError(409, 'AUTH_ACCOUNT_LINK_REQUIRED', 'Collides.')
    );

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-google'));

    await waitFor(() =>
      expect(getByTestId('login-error')).toHaveTextContent(/Keamanan Akun/)
    );
    expect(getByTestId('login-error')).not.toHaveTextContent(/^Login Google gagal/);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('reports a server with Google switched off as exactly that', async () => {
    mockLoginWithGoogle.mockRejectedValueOnce(
      new ApiError(503, 'GOOGLE_AUTH_DISABLED', 'Off.')
    );

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-google'));

    await waitFor(() =>
      expect(getByTestId('login-error')).toHaveTextContent(/belum aktif di server/)
    );
  });

  it('still reports an unexpected exchange failure generically', async () => {
    mockLoginWithGoogle.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'));

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-google'));

    await waitFor(() =>
      expect(getByTestId('login-error')).toHaveTextContent(/Login Google gagal/)
    );
  });

  it('hides the Google button entirely on a platform that cannot present it', async () => {
    mockedIsSupported.mockReturnValue(false);

    const { queryByTestId, getByTestId } = await render(<LoginScreen />);

    expect(queryByTestId('login-google')).toBeNull();
    // The other two methods are unaffected.
    expect(getByTestId('login-submit')).toBeTruthy();
    expect(getByTestId('login-whatsapp')).toBeTruthy();
  });
});

describe('already-signed-in guard', () => {
  it('redirects away instead of showing the login form to a signed-in viewer', async () => {
    // `/register` and `/login-whatsapp` are PUSHED on top of this screen and
    // replace only the top entry on success, so back-navigation can land
    // here while already authenticated. Signing in again from here would
    // mint a second session without revoking the first.
    mockAuthState.isAuthenticated = true;

    await render(<LoginScreen />);

    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/profile'));
  });

  it('does not redirect before auth has hydrated', async () => {
    mockAuthState.isAuthenticated = false;
    mockAuthState.isHydrated = false;

    await render(<LoginScreen />);

    expect(router.replace).not.toHaveBeenCalled();
  });

  it('shows the form normally to a signed-out viewer', async () => {
    const { getByTestId } = await render(<LoginScreen />);

    expect(getByTestId('login-submit')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('WhatsApp entry point', () => {
  it('navigates to the WhatsApp OTP flow', async () => {
    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-whatsapp'));

    expect(router.push).toHaveBeenCalledWith('/login-whatsapp');
  });
});
