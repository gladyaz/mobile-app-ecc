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
});
