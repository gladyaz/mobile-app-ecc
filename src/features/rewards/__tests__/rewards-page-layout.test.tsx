import { fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { RewardsCenterScreen } from '@/features/rewards/rewards-center-screen';
import { DEFAULT_LANGUAGE, translations } from '@/services/i18n/translations';
import type { RewardsLedgerState, RewardsSnapshot } from '@/types/rewards';

/**
 * THE REWARDS CENTER IS ONE PAGE.
 *
 * The design reference for this surface is three screenshots, and they are
 * three SCROLL POSITIONS of a single vertical page - top, middle, bottom -
 * not three screens, three tabs or three pages of a pager. That is easy to
 * get wrong on a redesign and impossible to see from a per-block test, so
 * this file asserts the SHAPE of the page rather than the contents of any
 * one card:
 *
 *   - every block lives inside ONE scroll container
 *   - the blocks appear in the reference's order
 *   - the last block (redemption) and the footnote below it are both inside
 *     that scroll, with real clearance beneath them, so nothing at the
 *     bottom is stranded under the tab bar
 *   - nothing paginates, tabs or swipes between the three positions
 *
 * It also pins the two figures the redesign DERIVES rather than reads
 * straight off a field - the earn counter and the streak-bonus line - to the
 * server-supplied values they come from, because both are exactly the kind
 * of number a redesign is tempted to hardcode from a screenshot.
 *
 * Deliberately no pixel geometry: nothing here measures an x/y coordinate or
 * a rendered height, which would pin the test to one device and one text
 * size. Containment and order are what "one page" actually means.
 */

const idCopy = translations[DEFAULT_LANGUAGE];

jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => ({ isPremium: false, refresh: jest.fn() }),
  EntitlementProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/** Odd values, so a component that hardcoded one would disagree loudly. */
function buildSnapshot(overrides?: Partial<RewardsSnapshot>): RewardsSnapshot {
  return {
    wallet: {
      balancePoints: 4242,
      lifetimeEarnedPoints: 90210,
      isServerAuthoritative: true,
      updatedAtLabel: null,
    },
    dailyCheckIn: {
      currentStreakDays: 3,
      longestStreakDays: 9,
      todayRewardPoints: 77,
      isTodayClaimed: false,
      days: [
        { day: 1, rewardPoints: 11, state: 'CLAIMED', isBonus: false },
        { day: 2, rewardPoints: 22, state: 'TODAY', isBonus: false },
        { day: 3, rewardPoints: 333, state: 'UPCOMING', isBonus: true },
      ],
      ctaLabel: 'Check-in Uji',
      isClaimSupported: true,
      resetsAtLabel: 'Reset pukul 00.00 uji',
    },
    // What the real backend sends. There is no trusted watch-analytics feed,
    // so there is nothing for this section to render but its unavailability.
    watchTime: null,
    tasks: [
      {
        id: 'uji_fb',
        type: 'SOCIAL_FOLLOW',
        title: 'Facebook Uji',
        description: 'Ikuti uji',
        rewardPoints: 66,
        progress: null,
        status: 'AVAILABLE',
        ctaLabel: 'Belum Tersedia Uji',
        socialPlatform: 'FACEBOOK',
        isClaimSupported: false,
        unsupportedReason: 'NO_VERIFIABLE_SIGNAL',
      },
      {
        id: 'uji_done',
        type: 'CAMPAIGN',
        title: 'Misi Uji',
        description: 'Deskripsi uji',
        rewardPoints: 99,
        progress: null,
        status: 'COMPLETED',
        ctaLabel: 'Segera Uji',
        isClaimSupported: false,
        unsupportedReason: 'AWAITING_PRODUCT_DECISION',
      },
    ],
    redemptions: [
      {
        id: 'uji_vip',
        title: 'VIP Uji',
        description: 'Deskripsi VIP uji',
        costPoints: 3333,
        grantsDays: 2,
        availability: 'AVAILABLE',
        ctaLabel: 'Tukar Uji',
        isRedeemSupported: true,
      },
    ],
    ...overrides,
  };
}

const EMPTY_LEDGER: RewardsLedgerState = {
  status: 'ready',
  entries: [],
  hasMore: false,
  isLoadingMore: false,
  loadMoreError: null,
};

function renderReady(overrides?: Partial<RewardsSnapshot>) {
  return render(
    <RewardsCenterScreen
      ledger={EMPTY_LEDGER}
      state={{ status: 'ready', snapshot: buildSnapshot(overrides) }}
    />
  );
}

/** Section blocks, in the order the reference scrolls through them. */
const SECTION_IDS = [
  'rewards-section-daily',
  'rewards-section-earn',
  'rewards-section-watch',
  'rewards-section-redeem',
] as const;

describe('Rewards Center - one vertically scrollable page', () => {
  it('renders exactly one scroll container for the whole page', async () => {
    const { getAllByTestId } = await renderReady();

    // Two would mean the page had been split. (The day strip scrolls
    // horizontally inside its card, which is why this is keyed to the page
    // container's own testID rather than counting ScrollViews.)
    expect(getAllByTestId('rewards-scroll')).toHaveLength(1);
  });

  it('puts the balance, every section and the footnote inside that one scroll', async () => {
    const { getByTestId } = await renderReady();
    const scroll = within(getByTestId('rewards-scroll'));

    expect(scroll.getByTestId('rewards-balance')).toBeTruthy();
    for (const sectionID of SECTION_IDS) {
      expect(scroll.getByTestId(sectionID)).toBeTruthy();
    }
    expect(scroll.getByTestId('rewards-footnote')).toBeTruthy();
  });

  it('orders the blocks the way the reference scrolls through them', async () => {
    const { getByTestId, getAllByTestId } = await renderReady();
    // Query the whole page once and read positions out of the single result
    // list: order is a property of the rendered tree, not of any coordinate.
    const ordered = getAllByTestId(/^rewards-(balance|section-.*|footnote)$/).map(
      (node) => node.props.testID
    );

    expect(ordered).toEqual([
      'rewards-balance',
      ...SECTION_IDS,
      'rewards-footnote',
    ]);
    expect(getByTestId('rewards-screen')).toBeTruthy();
  });

  it('paginates nothing: no tab strip, pager or swipe between the three positions', async () => {
    const { queryByTestId } = await renderReady();

    // The blocks these ids belonged to are sections on one page now. If any
    // reappears, the three reference screenshots have been read as three
    // destinations again.
    for (const removed of ['rewards-tab-earn', 'rewards-tab-redeem', 'rewards-pager']) {
      expect(queryByTestId(removed)).toBeNull();
    }
  });
});

describe('Rewards Center - the bottom of the page is reachable', () => {
  it('keeps the redemption block and its CTA inside the scroll, not pinned outside it', async () => {
    const { getByTestId } = await renderReady();
    const scroll = within(getByTestId('rewards-scroll'));

    // If the catalog were rendered outside the scroll it could not move out
    // from under the tab bar at all.
    expect(scroll.getByTestId('rewards-redemption-uji_vip')).toBeTruthy();
    expect(scroll.getByTestId('rewards-redeem-button-uji_vip')).toBeTruthy();
  });

  it('leaves clearance below the last card so nothing sits flush against the tab bar', async () => {
    const { getByTestId } = await renderReady();
    const contentStyle = StyleSheet.flatten(
      getByTestId('rewards-scroll').props.contentContainerStyle
    );

    // A tolerance, not a pixel measurement: the tabs navigator lays its bar
    // out IN FLOW (see `use-feed-bottom-anchor`), so the screen box already
    // ends above it - what this pins is that the last card still gets real
    // breathing room rather than ending exactly on the boundary.
    expect(contentStyle?.paddingBottom).toBeGreaterThanOrEqual(24);
  });

  it('renders the footnote after the redemption block, never over it', async () => {
    const { getAllByTestId } = await renderReady();
    const ordered = getAllByTestId(/^rewards-(section-redeem|footnote)$/).map(
      (node) => node.props.testID
    );

    expect(ordered).toEqual(['rewards-section-redeem', 'rewards-footnote']);
  });

  it('offers a jump to the catalog from the hero, and only when there is a catalog', async () => {
    const { getByTestId } = await renderReady();

    // Pressing it must not throw and must not change anything about the
    // rendered balance - it is a scroll, not a transaction.
    const before = getByTestId('rewards-balance-value').props.children;

    fireEvent.press(getByTestId('rewards-balance-redeem'));

    expect(getByTestId('rewards-balance-value').props.children).toBe(before);
  });

  it('renders no jump button when the server sent no offers to jump to', async () => {
    const { queryByTestId } = await renderReady({ redemptions: [] });

    expect(queryByTestId('rewards-balance-redeem')).toBeNull();
  });
});

describe('Rewards Center - derived figures come from server fields', () => {
  it('counts the earn progress from the status the SERVER put on each task', async () => {
    const { getByTestId } = await renderReady();

    // One of the two fixture tasks is COMPLETED. The client does not decide
    // that - `status` is the backend's word - and today the real backend
    // sends none, so this line honestly reads "0/5".
    expect(getByTestId('rewards-earn-progress').props.children).toBe(
      idCopy['rewards.earnProgress'].replace('{done}', '1').replace('{total}', '2')
    );
  });

  it('reads the streak off the check-in model rather than counting days itself', async () => {
    const { getByTestId } = await renderReady();

    expect(getByTestId('rewards-streak-chip').props.accessibilityLabel).toBe(
      idCopy['rewards.streakChipA11y'].replace('{days}', '3')
    );
  });

  it('hides the streak chip entirely when the server reports no streak', async () => {
    const baseline = buildSnapshot();
    const { queryByTestId } = await renderReady({
      dailyCheckIn: { ...baseline.dailyCheckIn!, currentStreakDays: 0 },
    });

    expect(queryByTestId('rewards-streak-chip')).toBeNull();
  });

  it('builds the streak-bonus line from the day the SERVER flagged as the bonus', async () => {
    const { getByTestId } = await renderReady();

    // Day 3 pays 333 in the fixture. Neither number is copy: the reference's
    // "7 days for +200" would be a promise this deployment does not make.
    expect(getByTestId('rewards-check-in-bonus').props.children).toBe(
      idCopy['rewards.checkInBonusHint'].replace('{days}', '3').replace('{points}', '333')
    );
  });

  it('states no bonus at all when the cycle has no bonus day', async () => {
    const baseline = buildSnapshot();
    const { queryByTestId } = await renderReady({
      dailyCheckIn: {
        ...baseline.dailyCheckIn!,
        days: baseline.dailyCheckIn!.days.map((day) => ({ ...day, isBonus: false })),
      },
    });

    expect(queryByTestId('rewards-check-in-bonus')).toBeNull();
  });

  it('states what the balance buys using the server’s own offer, not an episode count', async () => {
    const { getByTestId } = await renderReady();

    // The reference reads "~4 premium episodes". There is no
    // episodes-per-coin rate in the contract, so the hint names the offer the
    // server already called affordable instead.
    expect(
      within(getByTestId('rewards-balance-hint')).getByText(
        idCopy['rewards.hintAffordable'].replace('{title}', 'VIP Uji')
      )
    ).toBeTruthy();
  });

  it('drops the value hint when the server supports no offer to name', async () => {
    const baseline = buildSnapshot();
    const { queryByTestId } = await renderReady({
      redemptions: [{ ...baseline.redemptions[0], isRedeemSupported: false }],
    });

    expect(queryByTestId('rewards-balance-hint')).toBeNull();
  });
});

describe('Rewards Center - watch-time stays a truthful placeholder', () => {
  it('renders the section without inventing minutes, milestones or a payout', async () => {
    const { getByTestId, queryByTestId, queryByText } = await renderReady();

    expect(getByTestId('rewards-section-watch')).toBeTruthy();
    expect(getByTestId('rewards-watch-time-empty')).toBeTruthy();
    // None of the reference's watch-time figures may appear: no progress bar
    // with a fabricated position, no milestone chips, no minute target.
    expect(queryByTestId('rewards-watch-time')).toBeNull();
    expect(queryByTestId('watch-time-progress-bar')).toBeNull();
    expect(queryByTestId('watch-time-target')).toBeNull();
    for (const referenceFigure of ['7 menit', '45 menit', '+250', '+120']) {
      expect(queryByText(referenceFigure)).toBeNull();
    }
  });

  it('says it is not open yet rather than showing an empty progress state', async () => {
    const { getByTestId } = await renderReady();
    const block = within(getByTestId('rewards-watch-time-empty'));

    expect(block.getByText(idCopy['rewards.watchTimeEmpty'])).toBeTruthy();
    expect(block.getByText(idCopy['rewards.ctaSoon'])).toBeTruthy();
  });
});

describe('Rewards Center - history is a detour, and still the ledger', () => {
  it('keeps the history closed until the header control is pressed', async () => {
    const { queryByTestId, getByTestId } = await renderReady();

    expect(getByTestId('rewards-history-button')).toBeTruthy();
    expect(queryByTestId('rewards-history-modal')).toBeNull();
    // Nothing from the ledger surface is on the page behind it either.
    expect(queryByTestId('rewards-history')).toBeNull();
  });

  it('opens the server ledger, and closes again without touching the page', async () => {
    const { findByTestId, getByTestId, queryByTestId } = await renderReady();

    fireEvent.press(getByTestId('rewards-history-button'));

    // `findBy*`: the sheet mounts on the state update the press schedules,
    // which lands a tick later.
    expect(await findByTestId('rewards-history-modal')).toBeTruthy();
    // Empty because the LEDGER is empty - not because the sheet composed its
    // own rows. The rows themselves are covered against the wired route.
    expect(getByTestId('rewards-history-empty')).toBeTruthy();

    fireEvent.press(getByTestId('rewards-history-close'));

    await waitFor(() => expect(queryByTestId('rewards-history-modal')).toBeNull());
    expect(getByTestId('rewards-balance-value').props.children).toBe('4.242');
  });

  it('offers no history control in a state that has no settled ledger', async () => {
    const { queryByTestId } = await render(
      <RewardsCenterScreen ledger={{ status: 'loading' }} state={{ status: 'loading' }} />
    );

    expect(queryByTestId('rewards-history-button')).toBeNull();
  });
});
