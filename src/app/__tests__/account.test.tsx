import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import AccountScreen from '@/app/account';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

/**
 * MY ACCOUNT.
 *
 * The two real account destinations moved one level down, behind a plainly
 * named row. What matters is that BOTH survived the move and still reach the
 * same routes - a refactor that quietly dropped one would look identical on
 * the Settings screen.
 */
describe('AccountScreen', () => {
  it('exposes both existing account destinations, exactly once each', async () => {
    // Both survived the move, and neither was left behind as a duplicate - a
    // refactor that dropped or copied one would look identical from Settings.
    const { getAllByText } = await render(<AccountScreen />);

    expect(getAllByText('Keamanan Akun')).toHaveLength(1);
    expect(getAllByText('Data & Privasi')).toHaveLength(1);
  });

  it('reaches the unchanged Account Security and Data & Privacy routes', async () => {
    const { getByTestId } = await render(<AccountScreen />);

    fireEvent.press(getByTestId('account-security-row'));
    expect(router.push).toHaveBeenCalledWith('/account-security');

    fireEvent.press(getByTestId('account-data-row'));
    expect(router.push).toHaveBeenCalledWith('/account-data');
  });
});
