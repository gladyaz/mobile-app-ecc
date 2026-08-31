import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import ProfileScreen from '@/app/(tabs)/profile';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
}));

const mockUseAuth = jest.fn();

jest.mock('@/stores/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

const mockShowToast = jest.fn();

jest.mock('@/stores/toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

jest.mock('@/stores/video-interactions', () => ({
  useVideoInteractions: () => ({ savedVideoIds: [], likedVideoIds: [] }),
}));

/**
 * PROFILE INFORMATION ARCHITECTURE.
 *
 * Profile used to BE the configuration surface: a row of language chips, a
 * "LEGAL" heading, and raw links to the privacy policy, the terms and the
 * account-deletion page, all visible before anybody asked for them. It is now
 * identity plus three doors, and these cases pin that - both what must appear
 * and, just as importantly, what must NOT.
 *
 * The destinations themselves are covered by their own suites
 * (`app/__tests__/language.test.tsx`, `settings.test.tsx`, `about.test.tsx`);
 * what is under test here is the hierarchy.
 */
describe('Profile information architecture', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, logout: jest.fn(), user: null });
  });

  it('renders exactly one Language row, not a list of languages', async () => {
    // The chips were the real problem: three configuration choices spent on a
    // screen before anybody asked to change one.
    const { getByTestId, queryByText } = await render(<ProfileScreen />);

    expect(getByTestId('profile-language-row')).toBeTruthy();
    expect(queryByText('English')).toBeNull();
    expect(queryByText('中文')).toBeNull();
  });

  it('shows the current language as the row value rather than as options', async () => {
    // The value stays visible at a glance, which is what the chips were
    // actually for - without spending the screen on the other two.
    const { getByTestId } = await render(<ProfileScreen />);

    // The row reads "Bahasa" (label) + "Bahasa Indonesia" (current value).
    expect(getByTestId('profile-language-row')).toHaveTextContent(/Bahasa Indonesia/);
  });

  it('opens the Language screen when the row is pressed', async () => {
    const { getByTestId } = await render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-language-row'));

    expect(router.push).toHaveBeenCalledWith('/language');
  });

  it('renders Account & Settings and opens Settings', async () => {
    const { getByTestId } = await render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-settings-row'));

    expect(router.push).toHaveBeenCalledWith('/settings');
  });

  it('renders Help & Feedback and opens the help screen', async () => {
    const { getByTestId } = await render(<ProfileScreen />);

    fireEvent.press(getByTestId('profile-help-row'));

    expect(router.push).toHaveBeenCalledWith('/help');
  });

  it('shows no LEGAL section, and no legal or ad-privacy row, on Profile itself', async () => {
    // All of it moved to About. A raw legal block on the main screen was the
    // specific thing this redesign set out to remove, so its absence is
    // asserted rather than assumed.
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = 'https://example.com/privacy';

    const { queryByTestId, queryByText } = await render(<ProfileScreen />);

    expect(queryByTestId('profile-legal-section')).toBeNull();
    expect(queryByTestId('profile-legal-privacy')).toBeNull();
    expect(queryByTestId('profile-ad-privacy-options')).toBeNull();
    expect(queryByText('Legal')).toBeNull();

    delete process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL;
  });

  it('gives a guest all three rows, and never redirects them anywhere on render', async () => {
    // Language, About (via Settings) and Help must stay reachable signed out -
    // a guest is exactly who is most likely to want to read the privacy policy
    // or change the app's language. Rendering must also not navigate.
    const { getByTestId } = await render(<ProfileScreen />);

    expect(getByTestId('profile-language-row')).toBeTruthy();
    expect(getByTestId('profile-settings-row')).toBeTruthy();
    expect(getByTestId('profile-help-row')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('gives a signed-in viewer the same three rows', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      logout: jest.fn(),
      user: { id: 'user_1', name: 'Jane', username: 'jane', email: 'jane@example.com' },
    });

    const { getByTestId } = await render(<ProfileScreen />);

    expect(getByTestId('profile-language-row')).toBeTruthy();
    expect(getByTestId('profile-settings-row')).toBeTruthy();
    expect(getByTestId('profile-help-row')).toBeTruthy();
  });

  it('no longer puts the account screens on Profile itself', async () => {
    // They live under Settings now. Asserted for a SIGNED-IN viewer, since
    // that is the state that used to render them here.
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      logout: jest.fn(),
      user: { id: 'user_1', name: 'Jane', username: 'jane', email: 'jane@example.com' },
    });

    const { queryByText } = await render(<ProfileScreen />);

    expect(queryByText('Keamanan Akun')).toBeNull();
    expect(queryByText('Data & Privasi')).toBeNull();
  });
});

describe('ProfileScreen identity', () => {
  it('still logs out and reports it', async () => {
    const logout = jest.fn();

    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      logout,
      user: { id: 'user_1', name: 'Jane', username: 'jane', email: 'jane@example.com' },
    });

    const { getByText } = await render(<ProfileScreen />);

    fireEvent.press(getByText('Logout'));

    expect(logout).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalledWith('Kamu telah logout');
  });

  describe('an account with no email address', () => {
    /**
     * A WhatsApp-only account always has `email: null`, and so does a Google
     * account whose token did not assert `email_verified`. The canonical
     * contract makes that a first-class state, so the profile has to render it
     * truthfully rather than blank or invented.
     */
    const phoneOnlyUser = { id: 'clx0000000000user003', name: null, username: null, email: null };

    beforeEach(() => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        logout: jest.fn(),
        user: phoneOnlyUser,
      });
    });

    it('never renders an empty email line', async () => {
      const { getByTestId } = await render(<ProfileScreen />);

      expect(getByTestId('profile-email')).toHaveTextContent('Akun ini masuk tanpa email.');
    });

    it('never fabricates an email address', async () => {
      const { queryByText } = await render(<ProfileScreen />);

      expect(queryByText(/@/)).toBeNull();
    });

    it('never shows the raw user id as a display name', async () => {
      // A cuid is a database key. Rendering one where a name goes looks like a
      // name the account actually has.
      const { getByTestId, queryByText } = await render(<ProfileScreen />);

      expect(queryByText('clx0000000000user003')).toBeNull();
      expect(getByTestId('profile-name')).toHaveTextContent('Akun kamu');
    });

    it('omits the @handle rather than rendering a bare @', async () => {
      const { queryByTestId } = await render(<ProfileScreen />);

      expect(queryByTestId('profile-username')).toBeNull();
    });
  });

  it('still renders an email account normally', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      logout: jest.fn(),
      user: { id: 'user_1', name: 'Jane', username: 'jane', email: 'jane@example.com' },
    });

    const { getByTestId } = await render(<ProfileScreen />);

    expect(getByTestId('profile-email')).toHaveTextContent('jane@example.com');
    expect(getByTestId('profile-name')).toHaveTextContent('Jane');
    expect(getByTestId('profile-username')).toHaveTextContent('@jane');
  });
});
