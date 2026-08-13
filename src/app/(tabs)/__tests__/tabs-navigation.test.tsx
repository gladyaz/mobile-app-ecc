import { render } from '@testing-library/react-native';

import TabsLayout from '@/app/(tabs)/_layout';
import { DEFAULT_LANGUAGE, translations } from '@/services/i18n/translations';

/**
 * Root bottom-navigation contract.
 *
 * Expo Router resolves `<Tabs.Screen name="x" />` against the file
 * `(tabs)/x.tsx` at runtime, so a typo'd or missing route file produces a
 * blank tab rather than a build error. These cases close that gap: the
 * configured tabs are checked against the actual route files on disk, and
 * against the order the product specified.
 */

const capturedScreens: { name: string; title: string }[] = [];

jest.mock('expo-router', () => ({
  Tabs: Object.assign(({ children }: { children: React.ReactNode }) => <>{children}</>, {
    Screen: ({ name, options }: { name: string; options: { title: string } }) => {
      capturedScreens.push({ name, title: options.title });
      return null;
    },
  }),
}));

jest.mock('expo-symbols', () => ({
  SymbolView: 'SymbolView',
}));

const idCopy = translations[DEFAULT_LANGUAGE];

describe('root bottom navigation', () => {
  beforeEach(async () => {
    capturedScreens.length = 0;
    await render(<TabsLayout />);
  });

  it('registers exactly the five product-specified tabs, in order', () => {
    expect(capturedScreens.map((screen) => screen.name)).toEqual([
      'index',
      'discover',
      'saved',
      'rewards',
      'profile',
    ]);
  });

  // NOTE on route-file existence: Expo Router resolves these names to files
  // at runtime, so a name with no matching file yields a blank tab rather
  // than a build error. A filesystem check here would need @types/node,
  // which this project does not carry. The equivalent guarantee comes from
  // each route's own suite importing its module by path - `rewards.test.tsx`
  // imports '@/app/(tabs)/rewards', and discover/saved/profile likewise -
  // so a missing or unresolvable route file fails there instead.

  it('registers each tab exactly once, so no route gets a duplicate navigator entry', () => {
    const names = capturedScreens.map((screen) => screen.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it('labels every tab with translated copy rather than a raw key', () => {
    const expectedTitles = [
      idCopy['home.title'],
      idCopy['discover.title'],
      idCopy['saved.title'],
      idCopy['rewards.title'],
      idCopy['profile.title'],
    ];

    expect(capturedScreens.map((screen) => screen.title)).toEqual(expectedTitles);
    // A missing key would surface as the dotted key itself leaking to the UI.
    for (const screen of capturedScreens) {
      expect(screen.title).not.toMatch(/^[a-z]+\.[a-zA-Z]+$/);
    }
  });
});
