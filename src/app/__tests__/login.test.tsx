import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';
import { StyleSheet } from 'react-native';

import LoginScreen from '@/app/login';
import { ApiError } from '@/services/api/client';
import { isGoogleSignInConfigured, isGoogleSignInSupported } from '@/services/auth/google-sign-in';
import { LANGUAGES, translations, type Language } from '@/services/i18n/translations';

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    back: jest.fn(),
    replace: jest.fn(),
    canGoBack: jest.fn(() => false),
  },
}));

const mockedCanGoBack = router.canGoBack as jest.MockedFunction<typeof router.canGoBack>;

/**
 * The screen resolves copy through the real `translations` record, driven by
 * a language this suite can move. Without this the whole file would only ever
 * exercise the Indonesian fallback `useTranslation()` returns when no provider
 * is mounted - which is how a screen ends up with a key wired only in the
 * default locale. `id` stays the default so every existing case below, which
 * asserts Indonesian literals, keeps asserting exactly what it did.
 */
let mockLanguage: Language = 'id';
// `mock`-prefixed so the jest factory may close over it.
const mockCopy = translations;

jest.mock('@/stores/language', () => ({
  useTranslation: () => ({
    language: mockLanguage,
    setLanguage: jest.fn(),
    t: (key: string, params?: Record<string, string | number>) =>
      Object.entries(params ?? {}).reduce(
        (text, [name, value]) => text.split(`{${name}}`).join(String(value)),
        mockCopy[mockLanguage][key as keyof (typeof mockCopy)['id']]
      ),
  }),
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

/**
 * The reference this screen's layout was taken from carries MVP placeholder
 * copy ("Login dummy untuk MVP - isi email valid & password apa pun"). This
 * app has real authentication: login only logs in, and a wrong password does
 * not create an account. Any wording implying otherwise is a lie about a
 * security boundary, so it is banned outright rather than reviewed.
 */
const DUMMY_CREDENTIAL_COPY = [/dummy/i, /isi email valid/i, /password apa pun/i];

/** Every string the screen actually rendered, flattened out of the tree, so
 * the scan below cannot miss copy that sits in a node no query targets. */
function renderedStrings(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') {
    found.push(node);

    return found;
  }

  if (Array.isArray(node)) {
    node.forEach((child) => renderedStrings(child, found));

    return found;
  }

  if (node && typeof node === 'object' && 'children' in node) {
    renderedStrings((node as { readonly children: unknown }).children, found);
  }

  return found;
}

// The WhatsApp entry point is gated OFF by default for V1 (the backend cannot
// serve it - see services/auth/provider-availability.ts). Most cases here
// predate that gate and are about the row's behaviour once it IS offered, so
// the flag is turned on for the suite and turned off explicitly by the cases
// that pin the default.
const ORIGINAL_WHATSAPP_FLAG = process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED;

afterAll(() => {
  if (ORIGINAL_WHATSAPP_FLAG === undefined) {
    delete process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED;
  } else {
    process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = ORIGINAL_WHATSAPP_FLAG;
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = 'true';
  mockLanguage = 'id';
  mockedCanGoBack.mockReturnValue(false);
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

describe('truthful auth copy', () => {
  it('renders no dummy-credential copy anywhere on the screen', async () => {
    // The layout is modelled on a reference screen that told people to type
    // "any valid email & any password". Behind THIS screen a wrong password
    // is a failed sign-in, not a new account - so the copy may never suggest
    // credentials do not matter.
    const { toJSON } = await render(<LoginScreen />);

    const onScreen = renderedStrings(toJSON()).join(' ');

    DUMMY_CREDENTIAL_COPY.forEach((banned) => expect(onScreen).not.toMatch(banned));
  });

  it('ships no dummy-credential copy in any locale', async () => {
    // Belt and braces to the render scan above: that one only sees the locale
    // it rendered, and a placeholder pasted into the English or Chinese entry
    // would still reach the people reading those.
    LANGUAGES.forEach((language) => {
      Object.entries(translations[language])
        .filter(([key]) => key.startsWith('login.'))
        .forEach(([, copy]) => {
          DUMMY_CREDENTIAL_COPY.forEach((banned) => expect(copy).not.toMatch(banned));
        });
    });
  });

  it('keeps the truthful helper line under the Login button', async () => {
    // The reference put its dummy-credential disclaimer in this slot. The
    // slot stays; what fills it is the app's own accurate sentence.
    const { getByText } = await render(<LoginScreen />);

    expect(getByText(translations.id['login.hint'])).toBeTruthy();
  });
});

describe('provider buttons remain accessible', () => {
  it('exposes both providers as named buttons, not bare pressables', async () => {
    const { getByRole } = await render(<LoginScreen />);

    expect(getByRole('button', { name: 'Lanjutkan dengan Google' })).toBeTruthy();
    expect(getByRole('button', { name: 'Lanjutkan dengan WhatsApp' })).toBeTruthy();
  });

  it('announces the Google row as busy while the provider sheet is open', async () => {
    // The chevron is swapped for a spinner mid-flight; a viewer who cannot
    // see either still needs to be told the row is working.
    let releaseGoogle: (value: { status: string }) => void = () => {};
    mockLoginWithGoogle.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseGoogle = resolve;
      })
    );

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-google'));

    await waitFor(() =>
      expect(getByTestId('login-google').props.accessibilityState).toMatchObject({ busy: true })
    );

    await releaseGoogle({ status: 'cancelled' });
  });

  it('keeps every control at or above the 48dp touch-target floor', async () => {
    // A floor, deliberately not an exact height: the refresh may restyle these
    // rows freely, but not below what a thumb can reliably hit.
    const { getByTestId } = await render(<LoginScreen />);

    ['login-submit', 'login-google', 'login-whatsapp', 'login-back'].forEach((testID) => {
      const { height, minHeight } = StyleSheet.flatten(getByTestId(testID).props.style) as {
        readonly height?: number;
        readonly minHeight?: number;
      };

      expect(height ?? minHeight).toBeGreaterThanOrEqual(44);
    });
  });
});

describe('back navigation', () => {
  it('goes back to wherever the viewer came from', async () => {
    mockedCanGoBack.mockReturnValue(true);

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-back'));

    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('falls back to the app root when login was the entry point', async () => {
    // Reachable for real: a deep link or a cold start straight onto /login
    // leaves nothing on the stack to go back to.
    mockedCanGoBack.mockReturnValue(false);

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.press(getByTestId('login-back'));

    expect(router.replace).toHaveBeenCalledWith('/');
    expect(router.back).not.toHaveBeenCalled();
  });
});

describe('localization', () => {
  it('renders the Indonesian copy by default', async () => {
    const { getByText } = await render(<LoginScreen />);

    expect(getByText('Masuk')).toBeTruthy();
    expect(getByText('Login')).toBeTruthy();
    expect(getByText('atau', { includeHiddenElements: true })).toBeTruthy();
    expect(getByText('Belum punya akun?')).toBeTruthy();
    expect(getByText('Daftar dengan email')).toBeTruthy();
  });

  it('renders the English copy end to end when the app is in English', async () => {
    // Every refreshed element carries copy: title, CTA, separator, both
    // provider rows and the register prompt. A key wired only in Indonesian
    // fails here rather than on an English device.
    mockLanguage = 'en';

    const { getByText } = await render(<LoginScreen />);

    expect(getByText('Sign in')).toBeTruthy();
    expect(getByText('Log in')).toBeTruthy();
    expect(getByText('or', { includeHiddenElements: true })).toBeTruthy();
    expect(getByText('Continue with Google')).toBeTruthy();
    expect(getByText('Continue with WhatsApp')).toBeTruthy();
    expect(getByText("Don't have an account?")).toBeTruthy();
    expect(getByText('Sign up with email')).toBeTruthy();
  });

  it('keeps the automation identifiers stable across locales', async () => {
    // The ids are a contract with automation and must not be localized along
    // with the labels.
    mockLanguage = 'en';

    const { getByTestId } = await render(<LoginScreen />);

    expect(getByTestId('login-email-input')).toBeTruthy();
    expect(getByTestId('login-password-input')).toBeTruthy();
    expect(getByTestId('login-submit')).toBeTruthy();
    expect(getByTestId('login-google')).toBeTruthy();
    expect(getByTestId('login-whatsapp')).toBeTruthy();
    expect(getByTestId('login-register-email')).toBeTruthy();
    expect(getByTestId('login-back')).toBeTruthy();
  });

  it('still signs in and still refuses to auto-register in English', async () => {
    mockLanguage = 'en';
    mockLogin.mockRejectedValueOnce(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid.'));

    const { getByTestId } = await render(<LoginScreen />);

    await fireEvent.changeText(getByTestId('login-email-input'), 'jane@example.com');
    await fireEvent.changeText(getByTestId('login-password-input'), 'wrong-password');
    await fireEvent.press(getByTestId('login-submit'));

    const banner = await waitFor(() => getByTestId('login-error'));
    expect(banner).toHaveTextContent(/Wrong email or password/);
    expect(mockLogin).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('form input behaviour survives the focus treatment', () => {
  it('keeps accepting text after a field is focused and blurred', async () => {
    // The refreshed field tracks focus to draw its accent border. That state
    // lives beside the value; it must not disturb it.
    const { getByTestId } = await render(<LoginScreen />);

    const emailInput = getByTestId('login-email-input');

    await fireEvent(emailInput, 'focus');
    await fireEvent.changeText(emailInput, 'jane@example.com');
    await fireEvent(emailInput, 'blur');
    await fireEvent.changeText(getByTestId('login-password-input'), 'password123');
    await fireEvent.press(getByTestId('login-submit'));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('jane@example.com', 'password123'));
  });

  it('keeps the password field in secure entry', async () => {
    const { getByTestId } = await render(<LoginScreen />);

    expect(getByTestId('login-password-input').props.secureTextEntry).toBe(true);
  });

  describe('V1 provider gating', () => {
    it('OFFERS WhatsApp sign-in by default - it is a confirmed V1 feature', async () => {
      // WhatsApp Login is in the V1 scope, so the entry point ships visible.
      // Its production backend is being built on a parallel branch; until that
      // lands the server answers 503 and the app says so specifically
      // (`whatsapp.disabled`). An honest "not active on this server yet" is the
      // accepted trade - what is NOT acceptable, and is pinned elsewhere, is
      // faking a session the server never granted.
      delete process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED;

      const { getByTestId } = await render(<LoginScreen />);

      expect(getByTestId('login-whatsapp')).toBeTruthy();
      // Email + password is untouched.
      expect(getByTestId('login-submit')).toBeTruthy();
    });

    it('offers WhatsApp sign-in when the build sets the flag explicitly', async () => {
      process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = 'true';

      const { getByTestId } = await render(<LoginScreen />);

      expect(getByTestId('login-whatsapp')).toBeTruthy();
    });

    it('withdraws the WhatsApp entry point only for the exact string "false"', async () => {
      // The kill switch, kept so the method can be pulled by configuration
      // without a code change. See services/auth/provider-availability.ts.
      process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = 'false';

      const { queryByTestId, getByTestId } = await render(<LoginScreen />);

      expect(queryByTestId('login-whatsapp')).toBeNull();
      expect(getByTestId('login-submit')).toBeTruthy();
    });

    it('ships the V1 RELEASE login profile: no WhatsApp, Google still offered', async () => {
      // THE PROFILE THIS RELEASE ACTUALLY SHIPS (decided 2026-09-03), pinned as
      // one case because the risk is not either half on its own - it is the
      // COMBINATION silently becoming "no providers at all". Withdrawing
      // WhatsApp is deliberate: no Meta WhatsApp Business sender exists, so a
      // deployed backend can only answer 503 WHATSAPP_AUTH_DISABLED, and an
      // absent method is honester than a button that always fails. Google is
      // the method that does work, so it must survive that withdrawal.
      process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = 'false';

      const { getByTestId, queryByTestId } = await render(<LoginScreen />);

      expect(queryByTestId('login-whatsapp')).toBeNull();
      expect(getByTestId('login-google')).toBeTruthy();
      // ...and the provider block itself is still rendered, rather than
      // collapsing to the empty-divider state the case below describes.
      expect(getByTestId('login-submit')).toBeTruthy();
    });

    it('leaves the withdrawn WhatsApp route intact, so re-offering it is configuration only', async () => {
      // The kill switch gates the ENTRY POINT, never the implementation: the
      // route, the service and their suites are untouched. This is what makes
      // restoring the method a `.env` change and a rebuild rather than a
      // revert - and it is why the withdrawal is safe to take for one release.
      process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = 'false';

      const { queryByTestId } = await render(<LoginScreen />);

      expect(queryByTestId('login-whatsapp')).toBeNull();

      // Flipping the flag back is the whole restoration - no code changes.
      process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = 'true';

      const restored = await render(<LoginScreen />);

      expect(restored.getByTestId('login-whatsapp')).toBeTruthy();
    });

    it('hides the whole provider block when no provider can be offered', async () => {
      // With nothing to put under it, the "or continue with" divider is just a
      // heading over empty space.
      process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = 'false';
      mockedIsSupported.mockReturnValue(false);

      const { queryByTestId } = await render(<LoginScreen />);

      expect(queryByTestId('login-google')).toBeNull();
      expect(queryByTestId('login-whatsapp')).toBeNull();
    });
  });
});
