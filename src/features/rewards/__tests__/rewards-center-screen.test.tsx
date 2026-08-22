import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, render, within } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, StyleSheet } from 'react-native';

import { UNAVAILABLE_CTA_HINT_KEY } from '@/features/rewards/components/rewards-primitives';
import { RewardsCenterScreen } from '@/features/rewards/rewards-center-screen';
import { DEFAULT_LANGUAGE, LANGUAGES, translations } from '@/services/i18n/translations';
import type { RewardsLedgerState, RewardsSnapshot } from '@/types/rewards';

// Rewards is localized. These cases assert the Indonesian copy the screen
// renders by default, because `useTranslation()` falls back to
// DEFAULT_LANGUAGE when no LanguageProvider wraps the tree - which is
// exactly how this file renders the screen. Resolving through `translations`
// rather than re-typing the sentence keeps the assertion honest: if the copy
// is reworded, the test follows it instead of pinning a stale string.
const idCopy = translations[DEFAULT_LANGUAGE];
const UNAVAILABLE_CTA_HINT = idCopy[UNAVAILABLE_CTA_HINT_KEY];

/**
 * THE SCREEN ITSELF NEVER MOVES A BALANCE.
 *
 * Rewards is live now - a check-in really does credit points - but the
 * crediting happens on the SERVER, is reported back through `state`, and is
 * threaded in by the route. This screen is the presentational half, so the
 * property these tests pin down is unchanged and, if anything, more
 * important than it was in the preview slice: press every CTA with no
 * handlers attached, and the rendered balance, progress and streak must be
 * byte-identical afterwards. A screen that could move a number on its own
 * would be able to disagree with the ledger.
 *
 * The end-to-end behaviour - that check-in calls the backend, that the
 * balance follows the response and only the response, that redemption
 * refreshes the entitlement - is asserted against the wired route in
 * `src/app/(tabs)/__tests__/rewards.test.tsx`.
 *
 * The entitlement store is mocked purely as a tripwire. The screen does not
 * import it; if someone later wires "redeem" straight into the client-side
 * entitlement state, the not-called assertion below fails.
 */
const mockUseEntitlement = jest.fn();

jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => mockUseEntitlement(),
  EntitlementProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * Values here are deliberately odd, so a component that quietly hardcoded
 * an economic value would fail rather than coincidentally agree with the
 * model it was handed.
 */
function buildSnapshot(overrides?: Partial<RewardsSnapshot>): RewardsSnapshot {
  return {
    wallet: {
      balancePoints: 4242,
      lifetimeEarnedPoints: 90210,
      isServerAuthoritative: false,
      updatedAtLabel: null,
    },
    dailyCheckIn: {
      currentStreakDays: 6,
      longestStreakDays: 19,
      todayRewardPoints: 77,
      isTodayClaimed: false,
      days: [
        { day: 1, rewardPoints: 11, state: 'CLAIMED', isBonus: false },
        { day: 2, rewardPoints: 22, state: 'TODAY', isBonus: false },
        { day: 3, rewardPoints: 333, state: 'UPCOMING', isBonus: true },
      ],
      ctaLabel: 'Check-in Uji',
      isClaimSupported: false,
      resetsAtLabel: 'Reset pukul 00.00 uji',
    },
    watchTime: {
      watchedMinutes: 8,
      milestones: [
        { id: 'uji_m1', minutes: 4, rewardPoints: 44, status: 'REACHED' },
        { id: 'uji_m2', minutes: 12, rewardPoints: 144, status: 'LOCKED' },
      ],
      source: 'PLACEHOLDER',
      isClaimSupported: false,
    },
    tasks: [
      {
        id: 'uji_fb',
        type: 'SOCIAL_FOLLOW',
        socialPlatform: 'FACEBOOK',
        title: 'Facebook Uji',
        description: 'Ikuti halaman uji',
        rewardPoints: 66,
        progress: null,
        status: 'AVAILABLE',
        ctaLabel: 'Follow Uji',
        isClaimSupported: false,
      },
      {
        id: 'uji_ad',
        type: 'REWARDED_AD',
        title: 'Iklan Uji',
        description: 'Tonton sampai selesai uji',
        rewardPoints: 88,
        progress: { current: 2, target: 9 },
        status: 'IN_PROGRESS',
        ctaLabel: 'Tonton Uji',
        isClaimSupported: false,
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
        isRedeemSupported: false,
      },
    ],
    ...overrides,
  };
}

/**
 * An empty, settled ledger. These cases are about the reward surfaces, not
 * the history, and an empty page is the honest neutral: it asserts nothing
 * about transactions that did not happen. The history's own states are
 * covered in `transaction-history-panel.test.tsx`.
 */
const EMPTY_LEDGER: RewardsLedgerState = {
  status: 'ready',
  entries: [],
  hasMore: false,
  isLoadingMore: false,
  loadMoreError: null,
};

function renderReady(
  overrides?: Partial<RewardsSnapshot>,
  onUnavailableAction?: jest.Mock,
  ledger: RewardsLedgerState = EMPTY_LEDGER
) {
  return render(
    <RewardsCenterScreen
      ledger={ledger}
      onUnavailableAction={onUnavailableAction}
      state={{ status: 'ready', snapshot: buildSnapshot(overrides) }}
    />
  );
}

/** Minimum touch target, in points, required of every interactive control. */
const MIN_TOUCH_TARGET = 44;

/**
 * Vocabulary that belongs in code comments, tests and the domain contract -
 * never in a consumer rewards screen.
 */
const BANNED_FRAGMENTS = ['backend', 'ledger', 'SDK', 'server', 'timer', 'entitlement'] as const;

/**
 * Which block each section title belongs to. Heading assertions are scoped
 * through this rather than searching the whole page, because a title can
 * legitimately appear twice - the hero's jump button reads "Tukar koin"
 * precisely because it scrolls to the "Tukar koin" section.
 */
const SECTION_TEST_ID = {
  'rewards.sectionDaily': 'rewards-section-daily',
  'rewards.sectionEarn': 'rewards-section-earn',
  'rewards.sectionWatch': 'rewards-section-watch',
  'rewards.sectionRedeem': 'rewards-section-redeem',
} as const;

describe('RewardsCenterScreen - information architecture', () => {
  it('renders the screen shell with its preview marker', async () => {
    const { getByTestId, getByText } = await renderReady();

    expect(getByTestId('rewards-screen')).toBeTruthy();
    expect(getByText(idCopy['rewards.title'])).toBeTruthy();
    expect(getByText(idCopy['rewards.previewBadge'])).toBeTruthy();
  });

  it('renders all five blocks on one scroll, with no tabs to hide any of them', async () => {
    const { getByTestId, queryByTestId } = await renderReady();

    expect(getByTestId('rewards-balance')).toBeTruthy();
    expect(getByTestId('rewards-section-daily')).toBeTruthy();
    expect(getByTestId('rewards-section-earn')).toBeTruthy();
    expect(getByTestId('rewards-section-watch')).toBeTruthy();
    expect(getByTestId('rewards-section-redeem')).toBeTruthy();

    // Redeem used to sit behind a tab, one tap out of sight.
    expect(queryByTestId('rewards-tab-earn')).toBeNull();
    expect(queryByTestId('rewards-tab-redeem')).toBeNull();
  });

  it('orders the sections balance -> daily -> earn -> watch -> redeem', async () => {
    const { toJSON } = await renderReady();
    const tree = JSON.stringify(toJSON());
    const positionOf = (testID: string) => tree.indexOf(`"${testID}"`);

    expect(positionOf('rewards-preview-banner')).toBeGreaterThan(-1);
    expect(positionOf('rewards-balance')).toBeGreaterThan(positionOf('rewards-preview-banner'));
    expect(positionOf('rewards-section-daily')).toBeGreaterThan(positionOf('rewards-balance'));
    expect(positionOf('rewards-section-earn')).toBeGreaterThan(positionOf('rewards-section-daily'));
    expect(positionOf('rewards-section-watch')).toBeGreaterThan(positionOf('rewards-section-earn'));
    expect(positionOf('rewards-section-redeem')).toBeGreaterThan(
      positionOf('rewards-section-watch')
    );
  });

  it('titles every section from the translation table, not a hardcoded string', async () => {
    const { getByText, getByTestId } = await renderReady();

    expect(getByText(idCopy['rewards.sectionDaily'])).toBeTruthy();
    expect(getByText(idCopy['rewards.sectionEarn'])).toBeTruthy();
    expect(getByText(idCopy['rewards.sectionWatch'])).toBeTruthy();
    // Scoped: the hero's jump button deliberately reads "Tukar koin" too,
    // because it points AT this section - so the heading is asserted inside
    // the section rather than anywhere on the page.
    expect(
      within(getByTestId('rewards-section-redeem')).getByText(idCopy['rewards.sectionRedeem'])
    ).toBeTruthy();
  });

  it('marks each section heading as a header for screen-reader navigation', async () => {
    const { getByTestId } = await renderReady();

    for (const key of [
      'rewards.sectionDaily',
      'rewards.sectionEarn',
      'rewards.sectionWatch',
      'rewards.sectionRedeem',
    ] as const) {
      expect(
        within(getByTestId(SECTION_TEST_ID[key])).getByText(idCopy[key]).props.accessibilityRole
      ).toBe('header');
    }
  });
});

describe('RewardsCenterScreen - balance hero', () => {
  it('renders the point balance from the supplied model', async () => {
    const { getByText } = await renderReady();

    expect(getByText('4.242')).toBeTruthy();
  });

  it('tags the balance as a preview value while it is not server-authoritative', async () => {
    const { getByTestId, getByText } = await renderReady();

    expect(getByTestId('rewards-balance-preview-tag')).toBeTruthy();
    expect(getByText(idCopy['rewards.balancePreviewTag'])).toBeTruthy();
  });

  it('drops the preview tag once the wallet is server-authoritative', async () => {
    const { queryByTestId } = await renderReady({
      wallet: {
        balancePoints: 4242,
        lifetimeEarnedPoints: 90210,
        isServerAuthoritative: true,
        updatedAtLabel: null,
      },
    });

    expect(queryByTestId('rewards-balance-preview-tag')).toBeNull();
  });

  it('surfaces the streak beside the balance, from the check-in model', async () => {
    const { getByTestId } = await renderReady();

    expect(getByTestId('rewards-streak-chip')).toBeTruthy();
    expect(getByTestId('rewards-streak-chip').props.accessibilityLabel).toContain('6');
  });

  it('hides the streak chip when there is no streak to show', async () => {
    const baseline = buildSnapshot();
    const { queryByTestId } = await renderReady({
      dailyCheckIn: { ...baseline.dailyCheckIn!, currentStreakDays: 0 },
    });

    expect(queryByTestId('rewards-streak-chip')).toBeNull();
  });

  it('announces the balance together with its preview status', async () => {
    // Built from `rewards.balanceA11y`, which names the figure AND says it
    // is a preview - the number is never announced bare.
    const { getByLabelText } = await renderReady();

    expect(getByLabelText(/4\.242/)).toBeTruthy();
  });
});

describe('RewardsCenterScreen - daily reward', () => {
  it('renders every configured day, the today reward and the CTA', async () => {
    const { getByTestId } = await renderReady();

    expect(getByTestId('rewards-check-in-day-1')).toBeTruthy();
    expect(getByTestId('rewards-check-in-day-2')).toBeTruthy();
    expect(getByTestId('rewards-check-in-day-3')).toBeTruthy();
    expect(getByTestId('check-in-today-reward')).toBeTruthy();
    expect(getByTestId('rewards-check-in')).toBeTruthy();
  });

  it('renders a day strip of whatever length the model supplies', async () => {
    const baseline = buildSnapshot();
    const longCurve = {
      ...baseline.dailyCheckIn!,
      days: Array.from({ length: 14 }, (_, index) => ({
        day: index + 1,
        rewardPoints: (index + 1) * 5,
        state: 'UPCOMING' as const,
        isBonus: false,
      })),
    };
    const { getByTestId } = await renderReady({ dailyCheckIn: longCurve });

    // 7 is a fixture choice, not a structural limit of the component.
    expect(getByTestId('rewards-check-in-day-14')).toBeTruthy();
  });

  it('labels each day chip state in words, never by colour alone', async () => {
    const baseline = buildSnapshot();
    const { getByTestId } = await renderReady({
      dailyCheckIn: {
        ...baseline.dailyCheckIn!,
        days: [
          { day: 1, rewardPoints: 11, state: 'CLAIMED', isBonus: false },
          { day: 2, rewardPoints: 22, state: 'UPCOMING', isBonus: true },
          { day: 3, rewardPoints: 33, state: 'UPCOMING', isBonus: false },
          // Both today AND a bonus day: the today cue must survive.
          { day: 4, rewardPoints: 44, state: 'TODAY', isBonus: true },
        ],
      },
    });

    expect(within(getByTestId('rewards-check-in-day-1')).getByText(idCopy['rewards.dayDone'])).toBeTruthy();
    expect(within(getByTestId('rewards-check-in-day-2')).getByText(idCopy['rewards.dayBonus'])).toBeTruthy();
    expect(within(getByTestId('rewards-check-in-day-3')).getByText(idCopy['rewards.dayLater'])).toBeTruthy();
    expect(within(getByTestId('rewards-check-in-day-4')).getByText(idCopy['rewards.dayToday'])).toBeTruthy();
  });

  it('reports an already-claimed check-in', async () => {
    const baseline = buildSnapshot();
    const { getByTestId, queryByTestId } = await renderReady({
      dailyCheckIn: {
        ...baseline.dailyCheckIn!,
        isTodayClaimed: true,
        // Claiming IS supported here, so the only thing standing the control
        // down is the already-claimed fact - which is the point of the case.
        isClaimSupported: true,
      },
    });

    // The claimed state is stated in words by the CTA (whose label the MAPPER
    // swaps to "sudah check-in hari ini"), and the control stands down. The
    // "today pays" row is gone rather than restating a past event.
    const cta = getByTestId('rewards-check-in');

    expect(cta.props.accessibilityHint).toBe(idCopy['rewards.unavailableCtaHint']);
    expect(queryByTestId('check-in-today-reward')).toBeNull();
  });

  it('offers the check-in control while today is still unclaimed', async () => {
    const baseline = buildSnapshot();
    const { getByTestId } = await renderReady({
      dailyCheckIn: { ...baseline.dailyCheckIn!, isTodayClaimed: false, isClaimSupported: true },
    });

    // No unavailable hint, and today's payout is on screen so the user can
    // see what the button is worth before pressing it.
    expect(getByTestId('rewards-check-in').props.accessibilityHint).toBeUndefined();
    expect(getByTestId('check-in-today-reward')).toBeTruthy();
  });
});

describe('RewardsCenterScreen - earn points', () => {
  it('renders one scannable row per task: mark, title, task, reward and CTA', async () => {
    const { getByTestId, getByText } = await renderReady();

    expect(getByTestId('rewards-task-uji_fb')).toBeTruthy();
    expect(getByText('Facebook Uji')).toBeTruthy();
    expect(getByText('Ikuti halaman uji')).toBeTruthy();
    expect(getByTestId('rewards-task-points-uji_fb')).toBeTruthy();
    expect(getByTestId('rewards-task-cta-uji_fb')).toBeTruthy();
  });

  it('renders the reward amount from the model', async () => {
    const { getByTestId } = await renderReady();

    expect(getByTestId('rewards-task-points-uji_fb').props.children).toContain('66');
    expect(getByTestId('rewards-task-points-uji_ad').props.children).toContain('88');
  });

  it('renders rewarded-ad progress as "current/target" plus an accessible bar', async () => {
    const { getByTestId } = await renderReady();

    expect(getByTestId('rewards-task-progress-uji_ad').props.children).toContain('2');
    expect(getByTestId('rewards-task-progress-bar-uji_ad').props.accessibilityValue).toEqual({
      min: 0,
      max: 9,
      now: 2,
    });
  });

  it('clamps an over-completed progress bar instead of overflowing it', async () => {
    const baseline = buildSnapshot();
    const { getByTestId } = await renderReady({
      tasks: [{ ...baseline.tasks[1], progress: { current: 150, target: 100 } }],
    });

    expect(getByTestId('rewards-task-progress-bar-uji_ad').props.accessibilityValue).toEqual({
      min: 0,
      max: 100,
      now: 100,
    });
  });

  it('shows no progress block for a task that has no progress', async () => {
    const { queryByTestId } = await renderReady();

    expect(queryByTestId('rewards-task-progress-uji_fb')).toBeNull();
  });
});

describe('RewardsCenterScreen - watch rewards', () => {
  it('renders progress, then milestones, then each milestone reward', async () => {
    const { getByTestId } = await renderReady();

    expect(getByTestId('watch-time-watched-minutes')).toBeTruthy();
    expect(getByTestId('watch-time-progress-bar').props.accessibilityValue).toEqual({
      min: 0,
      max: 12,
      now: 8,
    });
    expect(getByTestId('watch-time-milestone-uji_m1')).toBeTruthy();
    expect(getByTestId('watch-time-milestone-uji_m2')).toBeTruthy();
  });

  it('labels each milestone state in words, never by colour alone', async () => {
    const { getByTestId } = await renderReady();

    expect(
      within(getByTestId('watch-time-milestone-uji_m1')).getByText(
        idCopy['rewards.milestoneReached']
      )
    ).toBeTruthy();
    expect(
      within(getByTestId('watch-time-milestone-uji_m2')).getByText(
        idCopy['rewards.milestoneLocked']
      )
    ).toBeTruthy();
  });

  it('handles a model with no milestones configured', async () => {
    const baseline = buildSnapshot();
    const { getByTestId } = await renderReady({
      watchTime: { ...baseline.watchTime!, milestones: [] },
    });

    expect(getByTestId('watch-time-progress-bar').props.accessibilityValue).toEqual({
      min: 0,
      max: 0,
      now: 0,
    });
  });

  it('never renders a "of 0 minutes" target when no milestone is configured', async () => {
    const baseline = buildSnapshot();
    const { getByTestId } = await renderReady({
      watchTime: { ...baseline.watchTime!, milestones: [] },
    });

    // Self-contradictory copy: the target half is dropped, not zeroed.
    const summary = getByTestId('watch-time-watched-minutes').props.children;

    expect(summary).not.toContain('0 menit');
    expect(summary).toContain('8');
  });
});

describe('RewardsCenterScreen - redeem', () => {
  it('renders each offer with a comparable cost and a CTA', async () => {
    const { getByTestId, getByText } = await renderReady();

    expect(getByTestId('rewards-redemption-uji_vip')).toBeTruthy();
    expect(getByText('VIP Uji')).toBeTruthy();
    expect(getByTestId('rewards-redemption-cost-uji_vip').props.children).toContain('3.333');
    expect(getByTestId('rewards-redeem-button-uji_vip')).toBeTruthy();
  });

  it('never calls an offer redeemable while redemption is unsupported', async () => {
    // The fixture ships a 1.000-point offer under a 1.250-point preview
    // balance. Rendering "Bisa ditukar" there would read as a real,
    // affordable redemption - the grey button alone is too quiet to correct
    // an affirmative word.
    const { getByTestId } = await renderReady();

    expect(getByTestId('rewards-redemption-availability-uji_vip').props.children).toBe(
      idCopy['rewards.availComingSoon']
    );
    expect(getByTestId('rewards-redemption-availability-uji_vip').props.children).not.toBe(
      idCopy['rewards.availAvailable']
    );
  });

  it('does call it redeemable once redemption is actually supported', async () => {
    const baseline = buildSnapshot();
    const { getByTestId } = await renderReady({
      redemptions: [{ ...baseline.redemptions[0], isRedeemSupported: true }],
    });

    expect(getByTestId('rewards-redemption-availability-uji_vip').props.children).toBe(
      idCopy['rewards.availAvailable']
    );
  });

  it('states availability in words', async () => {
    const baseline = buildSnapshot();
    const { getByTestId } = await renderReady({
      redemptions: [
        { ...baseline.redemptions[0], id: 'av_poor', availability: 'INSUFFICIENT_POINTS' },
        { ...baseline.redemptions[0], id: 'av_soon', availability: 'COMING_SOON' },
      ],
    });

    expect(getByTestId('rewards-redemption-availability-av_poor').props.children).toBe(
      idCopy['rewards.availInsufficient']
    );
    expect(getByTestId('rewards-redemption-availability-av_soon').props.children).toBe(
      idCopy['rewards.availComingSoon']
    );
  });
});

describe('RewardsCenterScreen - preview safety is stated once, not everywhere', () => {
  it('shows exactly one page-level preview banner', async () => {
    const { queryAllByTestId } = await renderReady();

    expect(queryAllByTestId('rewards-preview-banner')).toHaveLength(1);
  });

  it('states the preview message in the banner', async () => {
    const { getByText } = await renderReady();

    expect(getByText(idCopy['rewards.previewBannerTitle'])).toBeTruthy();
    expect(getByText(idCopy['rewards.previewBannerBody'])).toBeTruthy();
  });

  it('no longer renders a per-card disclaimer anywhere', async () => {
    // Six stacked caveat boxes were the single biggest source of the
    // "engineering dashboard" feel. They are replaced by one banner.
    const { queryByTestId } = await renderReady();

    expect(queryByTestId('rewards-balance-notice')).toBeNull();
    expect(queryByTestId('check-in-notice')).toBeNull();
    expect(queryByTestId('watch-time-notice')).toBeNull();
    expect(queryByTestId('rewards-task-notice-uji_fb')).toBeNull();
    expect(queryByTestId('rewards-task-notice-uji_ad')).toBeNull();
    expect(queryByTestId('redeem-notice-uji_vip')).toBeNull();
  });

  it('keeps engineering vocabulary out of the rendered copy', async () => {
    const { queryByText } = await renderReady();

    for (const fragment of BANNED_FRAGMENTS) {
      expect(queryByText(new RegExp(fragment, 'i'))).toBeNull();
    }
  });

  it('uses each language own thousands separator, never a hardcoded one', async () => {
    // Device QA caught this in English: "1.250 points" reads as one point
    // two five, understating the balance by three orders of magnitude.
    // Indonesian groups with "." and English/Chinese with ",".
    expect(translations.id['rewards.groupSeparator']).toBe('.');
    expect(translations.en['rewards.groupSeparator']).toBe(',');
    expect(translations.zh['rewards.groupSeparator']).toBe(',');

    // The default render is Indonesian, so the dot form is what appears here.
    const { getByText } = await renderReady();

    expect(getByText('4.242')).toBeTruthy();
  });

  it('keeps engineering vocabulary out of EVERY language, not just the default', async () => {
    // The rendered check above can only see the fallback language. This one
    // reads the tables directly, so an English or Chinese string carrying
    // forbidden vocabulary cannot slip through untested.
    for (const language of LANGUAGES) {
      const copy = translations[language];
      const rewardsKeys = Object.keys(copy).filter((key) => key.startsWith('rewards.'));

      for (const key of rewardsKeys) {
        const value = copy[key as keyof typeof copy];

        for (const fragment of BANNED_FRAGMENTS) {
          expect(`${language}/${key}: ${value}`.slice(`${language}/${key}: `.length)).not.toMatch(
            new RegExp(fragment, 'i')
          );
        }
      }
    }
  });

  it('still announces the unavailable state on every server-unsupported CTA', async () => {
    // The SERVER marks these unsupported; the screen only renders that
    // fact. Removing the visual paragraphs must not remove the
    // screen-reader signal, which costs no visual density at all.
    const { getByTestId } = await renderReady();

    for (const testID of [
      'rewards-check-in',
      'rewards-task-cta-uji_fb',
      'rewards-task-cta-uji_ad',
      'watch-time-cta',
      'rewards-redeem-button-uji_vip',
    ]) {
      expect(getByTestId(testID).props.accessibilityHint).toBe(UNAVAILABLE_CTA_HINT);
    }
  });

  it('drops the hint once an action is genuinely supported', async () => {
    const baseline = buildSnapshot();
    const { getByTestId } = await renderReady({
      tasks: [{ ...baseline.tasks[0], isClaimSupported: true }],
    });

    expect(getByTestId('rewards-task-cta-uji_fb').props.accessibilityHint).toBeUndefined();
  });
});

describe('RewardsCenterScreen - no CTA issues a reward', () => {
  it('does not grant points when a social task CTA is pressed', async () => {
    const onUnavailableAction = jest.fn();
    const { getByTestId, getByText, queryByText } = await renderReady(undefined, onUnavailableAction);

    const balanceBefore = getByTestId('rewards-balance-value').props.children;

    await fireEvent.press(getByTestId('rewards-task-cta-uji_fb'));

    expect(getByTestId('rewards-balance-value').props.children).toBe(balanceBefore);
    expect(getByText('4.242')).toBeTruthy();
    expect(queryByText('4.308')).toBeNull(); // 4242 + 66, if it had paid out
    expect(onUnavailableAction).toHaveBeenCalledWith({
      kind: 'TASK',
      id: 'uji_fb',
      label: 'Facebook Uji',
    });
  });

  it('does not issue points or advance progress when the rewarded-ad CTA is pressed', async () => {
    const onUnavailableAction = jest.fn();
    const { getByTestId, getByText, queryByText } = await renderReady(undefined, onUnavailableAction);

    const progressBefore = getByTestId('rewards-task-progress-uji_ad').props.children;

    await fireEvent.press(getByTestId('rewards-task-cta-uji_ad'));

    expect(getByText('4.242')).toBeTruthy();
    expect(getByTestId('rewards-task-progress-uji_ad').props.children).toEqual(progressBefore);
    expect(queryByText('4.330')).toBeNull(); // 4242 + 88
    expect(onUnavailableAction).toHaveBeenCalledWith({
      kind: 'TASK',
      id: 'uji_ad',
      label: 'Iklan Uji',
    });
  });

  it('does not grant points or move the streak when the check-in CTA is pressed', async () => {
    const { getByTestId, getByText, queryByText } = await renderReady();
    const streakBefore = getByTestId('rewards-streak-chip').props.accessibilityLabel;

    await fireEvent.press(getByTestId('rewards-check-in'));

    expect(getByText('4.242')).toBeTruthy();
    expect(queryByText('4.319')).toBeNull(); // 4242 + 77
    expect(getByTestId('rewards-streak-chip').props.accessibilityLabel).toBe(streakBefore);
  });

  it('does not bank watch-time progress when its CTA is pressed', async () => {
    const { getByTestId, getByText } = await renderReady();
    const progressBefore = getByTestId('watch-time-progress-bar').props.accessibilityValue;

    await fireEvent.press(getByTestId('watch-time-cta'));

    expect(getByTestId('watch-time-progress-bar').props.accessibilityValue).toEqual(progressBefore);
    expect(getByText('4.242')).toBeTruthy();
  });

  it('does not advance watch-time progress on its own as a clock runs', async () => {
    // Watch-time must arrive from server-side analytics. If a local timer
    // were ever added, ten minutes of elapsed time would move the rendered
    // progress - it must not.
    const { getByTestId, getByText } = await renderReady();
    const progressBefore = getByTestId('watch-time-progress-bar').props.accessibilityValue;

    jest.useFakeTimers();
    try {
      jest.advanceTimersByTime(10 * 60 * 1000);
    } finally {
      jest.useRealTimers();
    }

    expect(getByTestId('watch-time-progress-bar').props.accessibilityValue).toEqual(progressBefore);
    expect(getByText('4.242')).toBeTruthy();
  });

  it('does not debit points or activate an entitlement when the redeem CTA is pressed', async () => {
    const onUnavailableAction = jest.fn();
    const { getByTestId, getByText } = await renderReady(undefined, onUnavailableAction);

    await fireEvent.press(getByTestId('rewards-redeem-button-uji_vip'));

    expect(getByText('4.242')).toBeTruthy();
    expect(mockUseEntitlement).not.toHaveBeenCalled();
    expect(onUnavailableAction).toHaveBeenCalledWith({
      kind: 'REDEMPTION',
      id: 'uji_vip',
      label: 'VIP Uji',
    });
  });

  it('announces the outcome to VoiceOver on iOS, which has no live region', async () => {
    // Android gets this through `accessibilityLiveRegion`. iOS has no
    // equivalent, so without this call a VoiceOver user who taps a CTA below
    // the fold gets no feedback at all - and nothing else would catch its
    // removal.
    const announce = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => undefined);
    const originalPlatform = Platform.OS;

    Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });

    try {
      const { getByTestId } = await renderReady();

      await fireEvent.press(getByTestId('rewards-task-cta-uji_fb'));

      expect(announce).toHaveBeenCalledTimes(1);
      expect(announce.mock.calls[0][0]).toContain('Facebook Uji');
    } finally {
      Object.defineProperty(Platform, 'OS', { configurable: true, value: originalPlatform });
      announce.mockRestore();
    }
  });

  it('acknowledges a press with one short sentence, and lets it be dismissed', async () => {
    const { getByTestId, queryByTestId } = await renderReady();

    expect(queryByTestId('rewards-action-banner')).toBeNull();

    await fireEvent.press(getByTestId('rewards-task-cta-uji_fb'));
    expect(getByTestId('rewards-action-banner')).toBeTruthy();

    await fireEvent.press(getByTestId('rewards-action-banner-dismiss'));
    expect(queryByTestId('rewards-action-banner')).toBeNull();
  });

  it('persists nothing when every CTA is pressed', async () => {
    // "Persist a streak" is explicitly forbidden. A check-in that quietly
    // wrote to storage would survive a reload and be indistinguishable from
    // a real one, so the guarantee is asserted at the storage boundary
    // rather than by import shape (the language store legitimately writes,
    // so an import tripwire could not tell the two apart).
    const { getByTestId } = await renderReady();

    (AsyncStorage.setItem as jest.Mock).mockClear();

    for (const testID of [
      'rewards-check-in',
      'rewards-task-cta-uji_fb',
      'rewards-task-cta-uji_ad',
      'watch-time-cta',
      'rewards-redeem-button-uji_vip',
    ]) {
      await fireEvent.press(getByTestId(testID));
    }

    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(AsyncStorage.mergeItem).not.toHaveBeenCalled();
  });

  it('keeps the balance untouched even after every CTA is pressed in turn', async () => {
    const { getByTestId, getByText } = await renderReady();

    for (const testID of [
      'rewards-check-in',
      'rewards-task-cta-uji_fb',
      'rewards-task-cta-uji_ad',
      'watch-time-cta',
      'rewards-redeem-button-uji_vip',
    ]) {
      await fireEvent.press(getByTestId(testID));
    }

    expect(getByText('4.242')).toBeTruthy();
    expect(mockUseEntitlement).not.toHaveBeenCalled();
  });
});

describe('RewardsCenterScreen - values come from the model, not the components', () => {
  it('renders none of the fixture economics when a different model is supplied', async () => {
    const { queryByText } = await renderReady();

    expect(queryByText('1.250')).toBeNull();
    expect(queryByText('8.400')).toBeNull();
  });

  it('renders no balance at all in a non-ready state, rather than a stand-in', async () => {
    // The preview slice defaulted to a fixture snapshot when no state was
    // supplied. That default is gone: `state` is required, and every
    // non-ready status renders its own affordance with NO number on screen.
    // A plausible stand-in balance is exactly what "the client never
    // fabricates a balance" forbids.
    const { queryByTestId } = await render(
      <RewardsCenterScreen ledger={EMPTY_LEDGER} state={{ status: 'loading' }} />
    );

    expect(queryByTestId('rewards-balance')).toBeNull();
    expect(queryByTestId('rewards-balance-value')).toBeNull();
  });

  it('shows the sign-in affordance to a guest instead of a zeroed wallet', async () => {
    // Rewards is account state: a wallet with no owner does not exist. A
    // "0 points" hero for a signed-out viewer would be a number the server
    // never sent.
    const { getByTestId, queryByTestId, getByText } = await render(
      <RewardsCenterScreen ledger={EMPTY_LEDGER} state={{ status: 'signInRequired' }} />
    );

    expect(getByTestId('rewards-sign-in-required')).toBeTruthy();
    expect(getByText(idCopy['rewards.signInTitle'])).toBeTruthy();
    expect(queryByTestId('rewards-balance-value')).toBeNull();
  });

  it('renders a bounded unavailable state when rewards is switched off upstream', async () => {
    // `REWARDS_ENABLED=false`. No retry (retrying cannot flip a server
    // flag), no balance, and above all no fallback to preview numbers.
    const { getByTestId, queryByTestId, getByText } = await render(
      <RewardsCenterScreen
        ledger={EMPTY_LEDGER}
        state={{ status: 'unavailable', message: 'Fitur ini belum aktif.' }}
      />
    );

    expect(getByTestId('rewards-unavailable')).toBeTruthy();
    expect(getByText(idCopy['rewards.unavailableTitle'])).toBeTruthy();
    expect(queryByTestId('rewards-balance-value')).toBeNull();
    expect(queryByTestId('rewards-retry-button')).toBeNull();
  });
});

describe('RewardsCenterScreen - accessibility', () => {
  it('gives every interactive control at least a 44pt touch target', async () => {
    const { getByTestId } = await renderReady();

    for (const testID of [
      'rewards-check-in',
      'rewards-task-cta-uji_fb',
      'rewards-task-cta-uji_ad',
      'watch-time-cta',
      'rewards-redeem-button-uji_vip',
    ]) {
      const style = StyleSheet.flatten(getByTestId(testID).props.style);

      expect(style?.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    }
  });

  it('gives the dismiss control a 44pt touch target too', async () => {
    const { getByTestId } = await renderReady();

    await fireEvent.press(getByTestId('rewards-check-in'));
    const style = StyleSheet.flatten(getByTestId('rewards-action-banner-dismiss').props.style);

    expect(style?.minHeight).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(style?.minWidth).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it('groups each day chip into one accessible node with a full description', async () => {
    const { getByTestId } = await renderReady();
    const chip = getByTestId('rewards-check-in-day-1');

    expect(chip.props.accessible).toBe(true);
    expect(chip.props.accessibilityLabel).toContain('1');
    expect(chip.props.accessibilityLabel).toContain('11');
  });

  it('groups each milestone chip into one accessible node', async () => {
    const { getByTestId } = await renderReady();
    const chip = getByTestId('watch-time-milestone-uji_m1');

    expect(chip.props.accessible).toBe(true);
    expect(chip.props.accessibilityLabel).toContain('4');
    expect(chip.props.accessibilityLabel).toContain('44');
  });

  it('hides the decorative platform mark from screen readers on both platforms', async () => {
    // "FB" carries no information the row title does not already give, and
    // one platform flag alone would leave the other reader announcing it.
    const { queryByTestId, getByTestId } = await renderReady();

    // The default queries respect the accessibility tree, so a mark that is
    // properly hidden is simply not there to be found.
    expect(queryByTestId('rewards-task-mark-uji_fb')).toBeNull();

    const markContainer = getByTestId('rewards-task-mark-uji_fb', { includeHiddenElements: true });

    expect(markContainer.props.accessibilityElementsHidden).toBe(true);
    expect(markContainer.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('exposes the progress bar as a progressbar with a value', async () => {
    const { getByTestId } = await renderReady();
    const bar = getByTestId('watch-time-progress-bar');

    // `accessible` matters as much as the role here: without it a plain View
    // is not an accessibility element on iOS, and the role, label and value
    // are all silently dropped.
    expect(bar.props.accessible).toBe(true);
    expect(bar.props.accessibilityRole).toBe('progressbar');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 12, now: 8 });
  });

  it('gives adjacent CTAs distinct accessible names even when their labels collide', async () => {
    // Two rows can legitimately read "Follow"; a rotor listing or a Voice
    // Control command has to be able to tell them apart.
    const baseline = buildSnapshot();
    const { getByTestId } = await renderReady({
      tasks: [
        { ...baseline.tasks[0], id: 'dup_a', title: 'Facebook Uji', ctaLabel: 'Follow Uji' },
        { ...baseline.tasks[0], id: 'dup_b', title: 'TikTok Uji', ctaLabel: 'Follow Uji' },
      ],
    });

    const first = getByTestId('rewards-task-cta-dup_a').props.accessibilityLabel;
    const second = getByTestId('rewards-task-cta-dup_b').props.accessibilityLabel;

    expect(first).not.toBe(second);
    expect(first).toContain('Facebook Uji');
    expect(second).toContain('TikTok Uji');
  });

  it('names the redeem CTA with the tier it belongs to', async () => {
    const { getByTestId } = await renderReady();

    expect(getByTestId('rewards-redeem-button-uji_vip').props.accessibilityLabel).toContain('VIP Uji');
  });

  it('announces the reward amount with its unit, not a bare "+50"', async () => {
    const { getByLabelText } = await renderReady();

    // The visible pill is "+66"; the accessible name carries "poin".
    expect(getByLabelText(idCopy['rewards.pointsPillA11y'].replace('{points}', '66'))).toBeTruthy();
  });

  it('marks the page title as a heading', async () => {
    const { getByText } = await renderReady();

    expect(getByText(idCopy['rewards.title']).props.accessibilityRole).toBe('header');
  });

  it('lets the balance wrap rather than clip when text is scaled up', async () => {
    // A long balance plus its unit must reflow, not overflow, at large
    // accessibility text sizes.
    const { getByTestId } = await renderReady({
      wallet: {
        balancePoints: 999999999,
        lifetimeEarnedPoints: 0,
        isServerAuthoritative: false,
        updatedAtLabel: null,
      },
    });
    const balanceRow = getByTestId('rewards-balance-value').parent;

    expect(StyleSheet.flatten(balanceRow?.props.style)?.flexWrap).toBe('wrap');
  });
});

describe('RewardsCenterScreen - loading / error / empty states', () => {
  it('renders the loading state without any reward content', async () => {
    const { getByTestId, queryByTestId } = await render(
      <RewardsCenterScreen ledger={EMPTY_LEDGER} state={{ status: 'loading' }} />
    );

    expect(getByTestId('rewards-loading')).toBeTruthy();
    expect(queryByTestId('rewards-balance')).toBeNull();
    expect(queryByTestId('rewards-section-earn')).toBeNull();
  });

  it('renders the error state and retries on demand', async () => {
    const onRetry = jest.fn();
    const { getByTestId, getByText, queryByTestId } = await render(
      <RewardsCenterScreen ledger={EMPTY_LEDGER} onRetry={onRetry} state={{ status: 'error', message: 'Gagal memuat.' }} />
    );

    expect(getByTestId('rewards-error')).toBeTruthy();
    expect(getByText('Gagal memuat.')).toBeTruthy();
    expect(queryByTestId('rewards-balance')).toBeNull();

    await fireEvent.press(getByTestId('rewards-retry-button'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an empty state per section rather than hiding the section', async () => {
    const { getByTestId } = await renderReady({
      dailyCheckIn: null,
      watchTime: null,
      tasks: [],
      redemptions: [],
    });

    // The headings stay, so the page still reads as five blocks.
    expect(getByTestId('rewards-section-daily')).toBeTruthy();
    expect(getByTestId('rewards-section-redeem')).toBeTruthy();
    expect(getByTestId('rewards-check-in-empty')).toBeTruthy();
    expect(getByTestId('rewards-watch-time-empty')).toBeTruthy();
    expect(getByTestId('rewards-tasks-empty')).toBeTruthy();
    expect(getByTestId('rewards-redemptions-empty')).toBeTruthy();
  });

  it('keeps the preview banner visible in the empty state', async () => {
    const { getByTestId } = await renderReady({
      dailyCheckIn: null,
      watchTime: null,
      tasks: [],
      redemptions: [],
    });

    expect(getByTestId('rewards-preview-banner')).toBeTruthy();
  });
});

describe('RewardsCenterScreen - navigation seam', () => {
  it('renders no back control unless the host supplies one', async () => {
    const { queryByTestId } = await renderReady();

    expect(queryByTestId('rewards-back-button')).toBeNull();
  });

  it('calls onClose from the back control when the host supplies one', async () => {
    const onClose = jest.fn();
    const { getByTestId } = await render(
      <RewardsCenterScreen
        ledger={EMPTY_LEDGER}
        onClose={onClose}
        state={{ status: 'ready', snapshot: buildSnapshot() }}
      />
    );

    await fireEvent.press(getByTestId('rewards-back-button'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
