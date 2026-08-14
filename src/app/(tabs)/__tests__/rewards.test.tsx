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

  it('states the preview status once, at the top of the page', async () => {
    const { getByTestId, getByText } = await render(<RewardsRoute />);

    expect(getByTestId('rewards-preview-banner')).toBeTruthy();
    expect(getByText(idCopy['rewards.previewBannerTitle'])).toBeTruthy();
    expect(getByText(idCopy['rewards.previewBannerBody'])).toBeTruthy();
  });

  it('labels the balance itself as a preview value', async () => {
    // The tag sits with the number, so the figure is never seen without its
    // qualifier even when the banner has scrolled off.
    const { getByTestId } = await render(<RewardsRoute />);

    expect(getByTestId('rewards-balance-preview-tag')).toBeTruthy();
  });

  it('does not put backend or SDK terminology in front of the user', async () => {
    // The old screen explained ledgers, backends and ad SDKs on six separate
    // cards. That detail belongs in docs and code comments, not in a
    // consumer rewards page.
    const { queryByText } = await render(<RewardsRoute />);
    const bannedFragments = ['backend', 'ledger', 'SDK', 'server', 'timer'];

    for (const fragment of bannedFragments) {
      expect(queryByText(new RegExp(fragment, 'i'))).toBeNull();
    }
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
