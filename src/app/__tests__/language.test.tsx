import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import LanguageScreen from '@/app/language';
import { getItem, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';
import { LanguageProvider } from '@/stores/language';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

/** The version `stores/language.tsx` reads and writes under. */
const LANGUAGE_STORAGE_VERSION = 1;

/**
 * THE LANGUAGE SCREEN.
 *
 * This replaced the chips that used to sit on Profile, and it is a
 * PRESENTATION change only - so these cases run the REAL `LanguageProvider`
 * and the REAL storage layer rather than mocking either. That is the point:
 * what has to be proven is that the new screen drives the SAME state and the
 * SAME persistence the chips did, with no second copy of language anywhere.
 */
function renderLanguageScreen() {
  return render(
    <LanguageProvider>
      <LanguageScreen />
    </LanguageProvider>
  );
}

afterEach(async () => {
  await AsyncStorage.clear();
});

describe('LanguageScreen', () => {
  it('offers Indonesian, English and Chinese - the three V1 languages', async () => {
    const { getByText } = await renderLanguageScreen();

    expect(getByText('Bahasa Indonesia')).toBeTruthy();
    expect(getByText('English')).toBeTruthy();
    expect(getByText('中文')).toBeTruthy();
  });

  it('marks the current language as selected, and the others as not', async () => {
    const { getByTestId } = await renderLanguageScreen();

    expect(getByTestId('language-option-id').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('language-option-en').props.accessibilityState.selected).toBe(false);
    expect(getByTestId('language-option-zh').props.accessibilityState.selected).toBe(false);
  });

  it('moves the selection when a different language is chosen', async () => {
    const { getByTestId } = await renderLanguageScreen();

    fireEvent.press(getByTestId('language-option-en'));

    await waitFor(() => {
      expect(getByTestId('language-option-en').props.accessibilityState.selected).toBe(true);
    });
    expect(getByTestId('language-option-id').props.accessibilityState.selected).toBe(false);
  });

  it('translates the screen itself into the language just chosen', async () => {
    // Proof the choice drives the SHARED translation context rather than a
    // local highlight: the header is rendered through `t()`, so it has to
    // change too.
    const { getByTestId, getByText } = await renderLanguageScreen();

    fireEvent.press(getByTestId('language-option-zh'));

    await waitFor(() => {
      expect(getByText('语言')).toBeTruthy();
    });
  });

  it('persists the choice through the EXISTING storage key, not a new one', async () => {
    // `stores/language.tsx` writes STORAGE_KEYS.language at version 1. If the
    // screen had introduced its own persistence this read would come back
    // empty while the UI still looked correct.
    const { getByTestId } = await renderLanguageScreen();

    fireEvent.press(getByTestId('language-option-en'));

    await waitFor(async () => {
      expect(await getItem(STORAGE_KEYS.language, LANGUAGE_STORAGE_VERSION)).toBe('en');
    });
  });

  it('restores a previously stored language on mount', async () => {
    // The other half of the persistence contract, and the one a viewer
    // actually feels: the choice survives a relaunch.
    await setItem(STORAGE_KEYS.language, LANGUAGE_STORAGE_VERSION, 'zh');

    const { getByTestId } = await renderLanguageScreen();

    await waitFor(() => {
      expect(getByTestId('language-option-zh').props.accessibilityState.selected).toBe(true);
    });
  });

  it('is reachable with no session - language is a device preference', async () => {
    // The screen reads no auth state at all, which is the strongest form of "a
    // guest can open this": there is nothing here that could gate it.
    const { getByTestId } = await renderLanguageScreen();

    expect(getByTestId('language-option-id')).toBeTruthy();
  });
});
