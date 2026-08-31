import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import SettingsScreen from '@/app/settings';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const mockUseAuth = jest.fn();

jest.mock('@/stores/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

/**
 * ACCOUNT & SETTINGS.
 *
 * The screen is reachable by anyone, because its job is to be the door to
 * About - and About carries the privacy policy and the account-deletion route,
 * neither of which may sit behind a sign-in. What stays gated is each
 * ACCOUNT-BOUND row, gated the way this app already gates one: tapping it
 * signed out routes to `/login` rather than hiding the feature.
 */
describe('SettingsScreen', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false });
  });

  it('opens for a guest, with no redirect on render', async () => {
    const { getByTestId } = await render(<SettingsScreen />);

    expect(getByTestId('settings-title')).toBeTruthy();
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('offers About to a guest, because the legal pages live behind it', async () => {
    const { getByTestId } = await render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-about'));

    expect(router.push).toHaveBeenCalledWith('/about');
  });

  it('shows ONE plainly-named account row, not the technical destinations', async () => {
    // The point of the refinement: `Account Security` and `Data & Privacy` are
    // two pieces of vocabulary that do not belong on the screen somebody opens
    // to change a setting. They moved behind /account; neither was lost.
    mockUseAuth.mockReturnValue({ isAuthenticated: true });

    const { getByTestId, queryByTestId, queryByText } = await render(<SettingsScreen />);

    expect(getByTestId('settings-my-account')).toBeTruthy();
    expect(queryByTestId('settings-account-security')).toBeNull();
    expect(queryByTestId('settings-account-data')).toBeNull();
    expect(queryByText('Keamanan Akun')).toBeNull();
    expect(queryByText('Data & Privasi')).toBeNull();
  });

  it('sends a guest to /login when My Account is tapped', async () => {
    // Gated, but not hidden: the viewer learns the feature exists and what it
    // costs, which is the behaviour the old Profile screen had.
    mockUseAuth.mockReturnValue({ isAuthenticated: false });

    const { getByTestId } = await render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-my-account'));

    expect(router.push).toHaveBeenCalledWith('/login');
    expect(router.push).not.toHaveBeenCalledWith('/account');
  });

  it('routes a signed-in viewer to My Account and About, never to /login', async () => {
    // Both halves asserted on ONE render: that each row reaches its real
    // destination, and that the sign-in gate never fires for somebody who is
    // already signed in.
    mockUseAuth.mockReturnValue({ isAuthenticated: true });

    const { getByTestId } = await render(<SettingsScreen />);

    fireEvent.press(getByTestId('settings-my-account'));
    expect(router.push).toHaveBeenCalledWith('/account');

    fireEvent.press(getByTestId('settings-about'));
    expect(router.push).toHaveBeenCalledWith('/about');

    expect(router.push).not.toHaveBeenCalledWith('/login');
  });

  it('shows no internal processing row in an ordinary build', async () => {
    // /processing renders bundled fixture rows including backend storage
    // paths. Moving it off Profile must not have loosened that gate.
    const { queryByTestId } = await render(<SettingsScreen />);

    expect(queryByTestId('settings-processing')).toBeNull();
  });
});
