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

jest.mock('@/stores/toast', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

jest.mock('@/stores/video-interactions', () => ({
  useVideoInteractions: () => ({ savedVideoIds: [], likedVideoIds: [] }),
}));

describe('ProfileScreen', () => {
  it('navigates to the Account Security screen when "Keamanan Akun" is pressed', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      logout: jest.fn(),
      user: { id: 'user_1', name: 'Jane', username: 'jane', email: 'jane@example.com' },
    });

    const { getByText } = await render(<ProfileScreen />);

    fireEvent.press(getByText('Keamanan Akun'));

    expect(router.push).toHaveBeenCalledWith('/account-security');
  });

  it('does not render the Account Security entry for a guest', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, logout: jest.fn(), user: null });

    const { queryByText } = await render(<ProfileScreen />);

    expect(queryByText('Keamanan Akun')).toBeNull();
  });

  it('navigates to the Data & Privasi screen when "Data & Privasi" is pressed', async () => {
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      logout: jest.fn(),
      user: { id: 'user_1', name: 'Jane', username: 'jane', email: 'jane@example.com' },
    });

    const { getByText } = await render(<ProfileScreen />);

    fireEvent.press(getByText('Data & Privasi'));

    expect(router.push).toHaveBeenCalledWith('/account-data');
  });

  it('does not render the Data & Privasi entry for a guest', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, logout: jest.fn(), user: null });

    const { queryByText } = await render(<ProfileScreen />);

    expect(queryByText('Data & Privasi')).toBeNull();
  });
  describe('an account with no email address', () => {
    /**
     * A WhatsApp-only account always has `email: null`, and so does a Google
     * account whose token did not assert `email_verified`. The canonical
     * contract makes that a first-class state, so the profile has to render
     * it truthfully rather than blank or invented.
     */
    const phoneOnlyUser = { id: 'clx0000000000user003', name: null, username: null, email: null };

    it('never renders an empty email line', async () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        logout: jest.fn(),
        user: phoneOnlyUser,
      });

      const { getByTestId } = await render(<ProfileScreen />);

      expect(getByTestId('profile-email')).toHaveTextContent(
        'Akun ini masuk tanpa email.'
      );
    });

    it('never fabricates an email address', async () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        logout: jest.fn(),
        user: phoneOnlyUser,
      });

      const { queryByText } = await render(<ProfileScreen />);

      expect(queryByText(/@/)).toBeNull();
    });

    it('never shows the raw user id as a display name', async () => {
      // A cuid is a database key. Rendering one where a name goes looks
      // like a name the account actually has.
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        logout: jest.fn(),
        user: phoneOnlyUser,
      });

      const { getByTestId, queryByText } = await render(<ProfileScreen />);

      expect(queryByText('clx0000000000user003')).toBeNull();
      expect(getByTestId('profile-name')).toHaveTextContent('Akun kamu');
    });

    it('omits the @handle rather than rendering a bare @', async () => {
      mockUseAuth.mockReturnValue({
        isAuthenticated: true,
        logout: jest.fn(),
        user: phoneOnlyUser,
      });

      const { queryByTestId } = await render(<ProfileScreen />);

      expect(queryByTestId('profile-username')).toBeNull();
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
});

describe('ProfileScreen legal links', () => {
  const KEYS = [
    'EXPO_PUBLIC_PRIVACY_POLICY_URL',
    'EXPO_PUBLIC_TERMS_URL',
    'EXPO_PUBLIC_ACCOUNT_DELETION_URL',
  ] as const;
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of KEYS) {
      saved.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      const value = saved.get(key);

      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('renders no legal section at all when no URL is configured', async () => {
    // Which is every build today. A row that opens a page nobody has published
    // is worse than the absence of the row.
    const { queryByTestId } = await render(<ProfileScreen />);

    expect(queryByTestId('profile-legal-section')).toBeNull();
  });

  it('renders only the rows whose URL the build actually has', async () => {
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = 'https://example.com/privacy';

    const { getByTestId, queryByTestId } = await render(<ProfileScreen />);

    expect(getByTestId('profile-legal-privacy')).toBeTruthy();
    expect(queryByTestId('profile-legal-terms')).toBeNull();
    expect(queryByTestId('profile-legal-deletion')).toBeNull();
  });
});
