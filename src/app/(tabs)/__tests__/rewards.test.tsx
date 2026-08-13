import { fireEvent, render } from '@testing-library/react-native';

import RewardsRoute from '@/app/(tabs)/rewards';
import { DEFAULT_LANGUAGE, LANGUAGES, translations } from '@/services/i18n/translations';

/**
 * The Rewards TAB, as opposed to the screen component.
 *
 * `rewards-center-screen.test.tsx` already proves the screen never pays out.
 * What is new here is that the surface is now routed and therefore reachable
 * by an ordinary user, which raises two obligations this file pins down:
 * the preview status has to be visible without scrolling, and every string
 * has to exist in all three app languages.
 */

const idCopy = translations[DEFAULT_LANGUAGE];

describe('Rewards tab route', () => {
  it('renders the rewards centre', async () => {
    const { getByTestId } = await render(<RewardsRoute />);

    expect(getByTestId('rewards-center-screen')).toBeTruthy();
  });

  it('shows the preview badge in the header, before any card is read', async () => {
    const { getByText } = await render(<RewardsRoute />);

    expect(getByText(idCopy['rewards.previewBadge'])).toBeTruthy();
  });

  it('never renders a back control - a bottom-tab root has nowhere to go back to', async () => {
    const { queryByTestId } = await render(<RewardsRoute />);

    expect(queryByTestId('rewards-back-button')).toBeNull();
  });

  it('states that its figures are unapproved preview values', async () => {
    const { getByText } = await render(<RewardsRoute />);

    expect(getByText(idCopy['rewards.footerDisclaimer'])).toBeTruthy();
  });

  it('labels the balance as non-authoritative preview data', async () => {
    const { getByTestId } = await render(<RewardsRoute />);

    expect(getByTestId('rewards-balance-notice')).toBeTruthy();
  });

  it('leaves the balance untouched when a reward CTA is pressed', async () => {
    const { getByTestId, findByTestId } = await render(<RewardsRoute />);
    const balanceBefore = getByTestId('rewards-balance-value').props.children;

    fireEvent.press(getByTestId('check-in-cta'));

    // The press is acknowledged - findBy* rather than getBy* because the
    // banner arrives on the state update after the press commits.
    expect(await findByTestId('rewards-action-banner')).toBeTruthy();
    // ...and acknowledging it is ALL that happened. The routed preview must
    // not become a way to mint points.
    expect(getByTestId('rewards-balance-value').props.children).toBe(balanceBefore);
  });

  it('defines every rewards string in all three app languages', async () => {
    // Rewards is routed, so an untranslated key is a user-visible bug rather
    // than dead weight. `Copy` already makes a MISSING key a type error; this
    // catches the other half - a key present but left blank in en/zh.
    const rewardsKeys = Object.keys(idCopy).filter((key) => key.startsWith('rewards.'));

    expect(rewardsKeys.length).toBeGreaterThan(0);

    for (const language of LANGUAGES) {
      for (const key of rewardsKeys) {
        const value = translations[language][key as keyof typeof idCopy];

        expect(typeof value).toBe('string');
        expect(value.trim()).not.toBe('');
      }
    }
  });
});
