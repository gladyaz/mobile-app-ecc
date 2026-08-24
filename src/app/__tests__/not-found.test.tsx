import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import NotFoundScreen from '@/app/+not-found';

/**
 * The custom unmatched-route screen.
 *
 * These assertions are about what a DEMO BUILD must never show, not about
 * styling. Expo Router's built-in `Unmatched` screen renders untranslated
 * English, echoes the raw deep-link URL back, and offers a "Sitemap" link
 * whose `href="/_sitemap"` is hardcoded - it does not read
 * `extra.router.sitemap`, so turning the sitemap off does not remove the
 * link. Owning the route is the only way to remove it.
 */

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => false },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/stores/language', () => ({
  useTranslation: () => ({ t: (key: string) => key, language: 'id', setLanguage: jest.fn() }),
}));

const mockReplace = router.replace as jest.MockedFunction<typeof router.replace>;
const mockPush = router.push as jest.MockedFunction<typeof router.push>;

describe('unmatched route screen', () => {
  it('renders localized copy rather than the built-in English page', async () => {
    const { getByText } = await render(<NotFoundScreen />);

    expect(getByText('notFound.title')).toBeTruthy();
    expect(getByText('notFound.body')).toBeTruthy();
    expect(getByText('notFound.action')).toBeTruthy();
  });

  it('offers no route out except Home', async () => {
    // Specifically: no "Sitemap" affordance, which is what the built-in
    // screen provides and what must not reach a demo viewer.
    const { queryByText } = await render(<NotFoundScreen />);

    expect(queryByText(/sitemap/i)).toBeNull();
  });

  it('replaces rather than pushes, so the dead route leaves the stack', async () => {
    const { getByTestId } = await render(<NotFoundScreen />);

    fireEvent.press(getByTestId('not-found-home'));

    expect(mockReplace).toHaveBeenCalledWith('/');
    expect(mockPush).not.toHaveBeenCalled();
  });
});
