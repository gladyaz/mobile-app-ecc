import { fireEvent, render, within } from '@testing-library/react-native';

import { UNAVAILABLE_CTA_HINT } from '@/features/rewards/components/rewards-primitives';
import { RewardsCenterScreen } from '@/features/rewards/rewards-center-screen';
import { FIXTURE_REWARDS_SNAPSHOT } from '@/features/rewards/rewards-fixtures';
import type { RewardsSnapshot } from '@/types/rewards';

/**
 * The Rewards Center must never issue a reward. These tests pin that down
 * behaviourally: every CTA is pressed, and after each press the rendered
 * balance, task progress and task status must be identical to what they
 * were before.
 *
 * The entitlement store is mocked purely as a tripwire. The screen does not
 * import it today; if someone later wires "redeem" straight into the
 * client-side entitlement state, the not-called assertion below fails.
 */
const mockUseEntitlement = jest.fn();

jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => mockUseEntitlement(),
  EntitlementProvider: ({ children }: { children: React.ReactNode }) => children,
}));

/**
 * Values here are intentionally unlike anything in `rewards-fixtures.ts`,
 * so a component that quietly hardcoded a fixture number would fail rather
 * than coincidentally agree with the model.
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
        title: 'Follow Facebook Uji',
        description: 'Deskripsi follow uji.',
        rewardPoints: 66,
        progress: null,
        status: 'AVAILABLE',
        ctaLabel: 'Follow Uji',
        isClaimSupported: false,
      },
      {
        id: 'uji_ad',
        type: 'REWARDED_AD',
        title: 'Iklan Berhadiah Uji',
        description: 'Deskripsi iklan uji.',
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
        description: 'Deskripsi VIP uji.',
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

function renderReady(overrides?: Partial<RewardsSnapshot>, onPrototypeAction?: jest.Mock) {
  return render(
    <RewardsCenterScreen
      onPrototypeAction={onPrototypeAction}
      state={{ status: 'ready', snapshot: buildSnapshot(overrides) }}
    />
  );
}

describe('RewardsCenterScreen - rendering', () => {
  it('renders the screen shell with its preview marker', async () => {
    const { getByTestId, getByText } = await renderReady();

    expect(getByTestId('rewards-center-screen')).toBeTruthy();
    expect(getByText('Rewards')).toBeTruthy();
    // The screen must never look like a live reward surface.
    expect(getByText('PRATINJAU')).toBeTruthy();
  });

  it('renders the point balance from the supplied model', async () => {
    const { getByText } = await renderReady();

    expect(getByText('4.242')).toBeTruthy();
    expect(getByText('90.210')).toBeTruthy();
  });

  it('labels a non-authoritative balance instead of presenting it as real', async () => {
    const { getByTestId } = await renderReady();

    expect(getByTestId('rewards-balance-notice')).toBeTruthy();
  });

  it('renders the daily check-in model, including every configured day', async () => {
    const { getByTestId, getByText } = await renderReady();

    expect(getByTestId('check-in-current-streak').props.children).toBe(6);
    expect(getByTestId('check-in-longest-streak').props.children).toBe(19);
    expect(getByText('+77 poin')).toBeTruthy();
    expect(getByText('Reset pukul 00.00 uji')).toBeTruthy();
    expect(getByTestId('check-in-day-1')).toBeTruthy();
    expect(getByTestId('check-in-day-2')).toBeTruthy();
    expect(getByTestId('check-in-day-3')).toBeTruthy();
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
    expect(getByTestId('check-in-day-14')).toBeTruthy();
  });

  it('renders reward tasks from the model', async () => {
    const { getByText, getByTestId } = await renderReady();

    expect(getByText('Follow Facebook Uji')).toBeTruthy();
    expect(getByText('+66 poin')).toBeTruthy();
    expect(getByText('Iklan Berhadiah Uji')).toBeTruthy();
    expect(getByText('+88 poin')).toBeTruthy();
    expect(getByTestId('reward-task-cta-uji_fb')).toBeTruthy();
    expect(getByTestId('reward-task-cta-uji_ad')).toBeTruthy();
  });

  it('renders progress states as "current / target" plus an accessible progress bar', async () => {
    const { getByTestId, getByText } = await renderReady();

    expect(getByText('2 / 9')).toBeTruthy();
    expect(getByTestId('reward-task-progress-bar-uji_ad').props.accessibilityValue).toEqual({
      min: 0,
      max: 9,
      now: 2,
    });
    expect(getByTestId('reward-task-status-uji_ad').props.children).toBe('Berjalan');
  });

  it('renders watch-time progress against the largest configured milestone', async () => {
    const { getByTestId, getByText } = await renderReady();

    expect(getByText('8 menit')).toBeTruthy();
    expect(getByTestId('watch-time-progress-bar').props.accessibilityValue).toEqual({
      min: 0,
      max: 12,
      now: 8,
    });
    expect(getByTestId('watch-time-milestone-uji_m1')).toBeTruthy();
    expect(getByTestId('watch-time-milestone-uji_m2')).toBeTruthy();
  });

  it('warns that watch-time progress is not server-tracked', async () => {
    const { getByTestId } = await renderReady();

    expect(getByTestId('watch-time-notice')).toBeTruthy();
  });
});

describe('RewardsCenterScreen - values come from the model, not the components', () => {
  it('renders none of the fixture economics when a different model is supplied', async () => {
    const { queryByText } = await renderReady();

    expect(queryByText('1.250')).toBeNull();
    expect(queryByText('8.400')).toBeNull();
    expect(queryByText('Follow Facebook')).toBeNull();
    expect(queryByText('+50 poin')).toBeNull();
    expect(queryByText('0 / 5')).toBeNull();
  });

  it('falls back to the clearly-labelled fixture snapshot when no state is supplied', async () => {
    const { getByText } = await render(<RewardsCenterScreen />);

    expect(getByText('1.250')).toBeTruthy();
    expect(FIXTURE_REWARDS_SNAPSHOT.wallet.balancePoints).toBe(1250);
  });
});

describe('RewardsCenterScreen - no CTA issues a reward', () => {
  it('does not grant points when a social task CTA is pressed', async () => {
    const onPrototypeAction = jest.fn();
    const { getByTestId, getByText, queryByText } = await renderReady(undefined, onPrototypeAction);

    const balanceBefore = getByTestId('rewards-balance-value').props.children;
    const statusBefore = getByTestId('reward-task-status-uji_fb').props.children;

    await fireEvent.press(getByTestId('reward-task-cta-uji_fb'));

    expect(getByTestId('rewards-balance-value').props.children).toBe(balanceBefore);
    expect(getByTestId('reward-task-status-uji_fb').props.children).toBe(statusBefore);
    expect(getByText('4.242')).toBeTruthy();
    expect(queryByText('4.308')).toBeNull(); // 4242 + 66, if it had paid out
    expect(onPrototypeAction).toHaveBeenCalledWith({
      kind: 'TASK',
      id: 'uji_fb',
      label: 'Follow Facebook Uji',
    });
  });

  it('never claims that a social follow can be verified', async () => {
    const { getByTestId } = await renderReady();

    expect(getByTestId('reward-task-notice-uji_fb')).toBeTruthy();
    expect(getByTestId('reward-task-cta-uji_fb').props.accessibilityHint).toBe(UNAVAILABLE_CTA_HINT);
  });

  it('does not issue points or advance progress when the rewarded-ad CTA is pressed', async () => {
    const onPrototypeAction = jest.fn();
    const { getByTestId, getByText, queryByText } = await renderReady(undefined, onPrototypeAction);

    await fireEvent.press(getByTestId('reward-task-cta-uji_ad'));

    expect(getByText('4.242')).toBeTruthy();
    expect(getByText('2 / 9')).toBeTruthy();
    expect(queryByText('3 / 9')).toBeNull();
    expect(queryByText('4.330')).toBeNull(); // 4242 + 88
    expect(onPrototypeAction).toHaveBeenCalledWith({
      kind: 'TASK',
      id: 'uji_ad',
      label: 'Iklan Berhadiah Uji',
    });
  });

  it('does not grant points when the daily check-in CTA is pressed', async () => {
    const { getByTestId, getByText, queryByText } = await renderReady();

    await fireEvent.press(getByTestId('check-in-cta'));

    expect(getByText('4.242')).toBeTruthy();
    expect(queryByText('4.319')).toBeNull(); // 4242 + 77
    expect(getByTestId('check-in-current-streak').props.children).toBe(6);
  });

  it('does not activate an entitlement when the redeem CTA is pressed', async () => {
    const onPrototypeAction = jest.fn();
    const { getByTestId, getByText } = await renderReady(undefined, onPrototypeAction);

    await fireEvent.press(getByTestId('rewards-tab-redeem'));
    expect(getByTestId('redeem-cost-uji_vip')).toBeTruthy();

    await fireEvent.press(getByTestId('redeem-cta-uji_vip'));

    // Balance is not debited and no entitlement state is touched.
    expect(getByText('4.242')).toBeTruthy();
    expect(mockUseEntitlement).not.toHaveBeenCalled();
    expect(getByTestId('redeem-notice-uji_vip')).toBeTruthy();
    expect(onPrototypeAction).toHaveBeenCalledWith({
      kind: 'REDEMPTION',
      id: 'uji_vip',
      label: 'VIP Uji',
    });
  });

  it('does not advance watch-time progress on its own as a clock runs', async () => {
    // Watch-time must arrive from server-side analytics. If a local timer
    // were ever added here, ten minutes of elapsed time would move the
    // rendered progress - it must not.
    const { getByText } = await renderReady();

    jest.useFakeTimers();
    try {
      jest.advanceTimersByTime(10 * 60 * 1000);
    } finally {
      jest.useRealTimers();
    }

    expect(getByText('8 menit')).toBeTruthy();
    expect(getByText('4.242')).toBeTruthy();
  });

  it('explains why nothing happened after a CTA press', async () => {
    const { getByTestId, queryByTestId } = await renderReady();

    expect(queryByTestId('rewards-action-banner')).toBeNull();

    await fireEvent.press(getByTestId('reward-task-cta-uji_fb'));
    expect(getByTestId('rewards-action-banner')).toBeTruthy();

    await fireEvent.press(getByTestId('rewards-action-banner-dismiss'));
    expect(queryByTestId('rewards-action-banner')).toBeNull();
  });
});

describe('RewardsCenterScreen - tabs', () => {
  it('shows the earn panel first and swaps panels on tab press', async () => {
    const { getByTestId, queryByTestId } = await renderReady();

    expect(getByTestId('rewards-earn-panel')).toBeTruthy();
    expect(queryByTestId('rewards-redeem-panel')).toBeNull();
    expect(getByTestId('rewards-tab-earn').props.accessibilityState).toEqual({ selected: true });

    await fireEvent.press(getByTestId('rewards-tab-redeem'));

    expect(getByTestId('rewards-redeem-panel')).toBeTruthy();
    expect(queryByTestId('rewards-earn-panel')).toBeNull();
    expect(getByTestId('rewards-tab-redeem').props.accessibilityState).toEqual({ selected: true });
  });
});

describe('RewardsCenterScreen - loading / error / empty states', () => {
  it('renders the loading state without any reward content', async () => {
    const { getByTestId, queryByTestId } = await render(
      <RewardsCenterScreen state={{ status: 'loading' }} />
    );

    expect(getByTestId('rewards-loading')).toBeTruthy();
    expect(queryByTestId('rewards-balance-card')).toBeNull();
    expect(queryByTestId('rewards-earn-panel')).toBeNull();
  });

  it('renders the error state and retries on demand', async () => {
    const onRetry = jest.fn();
    const { getByTestId, getByText, queryByTestId } = await render(
      <RewardsCenterScreen onRetry={onRetry} state={{ status: 'error', message: 'Gagal memuat.' }} />
    );

    expect(getByTestId('rewards-error')).toBeTruthy();
    expect(getByText('Gagal memuat.')).toBeTruthy();
    expect(queryByTestId('rewards-balance-card')).toBeNull();

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

    expect(getByTestId('rewards-check-in-empty')).toBeTruthy();
    expect(getByTestId('rewards-watch-time-empty')).toBeTruthy();
    expect(getByTestId('rewards-tasks-empty')).toBeTruthy();

    await fireEvent.press(getByTestId('rewards-tab-redeem'));
    expect(getByTestId('rewards-redemptions-empty')).toBeTruthy();
  });
});

describe('RewardsCenterScreen - caveats are stated once per task type', () => {
  it('shows one social caveat for a group of social tasks, not one per card', async () => {
    const baseline = buildSnapshot();
    const [social, ad] = baseline.tasks;
    const secondSocial = { ...social, id: 'uji_fb2', title: 'Follow TikTok Uji' };
    const { getByTestId, queryByTestId } = await renderReady({
      tasks: [social, secondSocial, ad],
    });

    // First of the type carries the message; the rest of the group is clean.
    expect(getByTestId('reward-task-notice-uji_fb')).toBeTruthy();
    expect(queryByTestId('reward-task-notice-uji_fb2')).toBeNull();
    // A different type states its own, different caveat.
    expect(getByTestId('reward-task-notice-uji_ad')).toBeTruthy();

    // Deduping the notice must not dedupe the guarantee: the second card's
    // CTA still announces that it pays nothing.
    expect(getByTestId('reward-task-cta-uji_fb2').props.accessibilityHint).toBe(
      UNAVAILABLE_CTA_HINT
    );
  });
});

describe('RewardsCenterScreen - server-backed states (what the backend will send)', () => {
  it('drops the balance caveat and shows the update time once the wallet is authoritative', async () => {
    const { getByText, queryByTestId } = await renderReady({
      wallet: {
        balancePoints: 4242,
        lifetimeEarnedPoints: 90210,
        isServerAuthoritative: true,
        updatedAtLabel: '13/08/2026 09:30',
      },
    });

    expect(queryByTestId('rewards-balance-notice')).toBeNull();
    expect(getByText('13/08/2026 09:30')).toBeTruthy();
  });

  it('renders a claimable task without the unavailable hint or caveat', async () => {
    const baseline = buildSnapshot();
    const claimable = { ...baseline.tasks[0], isClaimSupported: true, status: 'CLAIMABLE' as const };
    const { getByTestId, queryByTestId } = await renderReady({ tasks: [claimable] });

    expect(getByTestId('reward-task-cta-uji_fb').props.accessibilityHint).toBeUndefined();
    expect(queryByTestId('reward-task-notice-uji_fb')).toBeNull();
    expect(getByTestId('reward-task-status-uji_fb').props.children).toBe('Siap diklaim');
  });

  it('renders a redeemable offer without its caveat', async () => {
    const baseline = buildSnapshot();
    const { getByTestId, queryByTestId } = await renderReady({
      redemptions: [{ ...baseline.redemptions[0], isRedeemSupported: true }],
    });

    await fireEvent.press(getByTestId('rewards-tab-redeem'));

    expect(queryByTestId('redeem-notice-uji_vip')).toBeNull();
    expect(getByTestId('redeem-cta-uji_vip').props.accessibilityHint).toBeUndefined();
  });

  it('drops the watch-time caveat only when progress is server-sourced AND claimable', async () => {
    const baseline = buildSnapshot();
    const serverSourced = { ...baseline.watchTime!, source: 'SERVER' as const };

    const stillUnclaimable = await renderReady({ watchTime: serverSourced });
    // Server-sourced but not yet claimable still warrants the caveat.
    expect(stillUnclaimable.getByTestId('watch-time-notice')).toBeTruthy();

    const live = await renderReady({
      watchTime: { ...serverSourced, isClaimSupported: true },
    });
    expect(live.queryByTestId('watch-time-notice')).toBeNull();
  });
});

describe('RewardsCenterScreen - remaining model states render', () => {
  it('renders every task status label', async () => {
    const baseline = buildSnapshot();
    const [social] = baseline.tasks;
    const { getByTestId } = await renderReady({
      tasks: [
        { ...social, id: 'st_locked', status: 'LOCKED' },
        { ...social, id: 'st_claimable', status: 'CLAIMABLE' },
        { ...social, id: 'st_completed', status: 'COMPLETED' },
      ],
    });

    expect(getByTestId('reward-task-status-st_locked').props.children).toBe('Terkunci');
    expect(getByTestId('reward-task-status-st_claimable').props.children).toBe('Siap diklaim');
    expect(getByTestId('reward-task-status-st_completed').props.children).toBe('Selesai');
  });

  it('renders every redemption availability label', async () => {
    const baseline = buildSnapshot();
    const [offer] = baseline.redemptions;
    const { getByTestId } = await renderReady({
      redemptions: [
        { ...offer, id: 'av_poor', availability: 'INSUFFICIENT_POINTS' },
        { ...offer, id: 'av_soon', availability: 'COMING_SOON' },
      ],
    });

    await fireEvent.press(getByTestId('rewards-tab-redeem'));

    expect(getByTestId('redeem-availability-av_poor').props.children).toBe('Poin belum cukup');
    expect(getByTestId('redeem-availability-av_soon').props.children).toBe('Segera hadir');
  });

  it('labels each day chip state, and lets "today" win over "bonus"', async () => {
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

    expect(within(getByTestId('check-in-day-1')).getByText('Selesai')).toBeTruthy();
    expect(within(getByTestId('check-in-day-2')).getByText('Bonus')).toBeTruthy();
    expect(within(getByTestId('check-in-day-3')).getByText('Nanti')).toBeTruthy();
    expect(within(getByTestId('check-in-day-4')).getByText('Hari ini')).toBeTruthy();
  });

  it('labels each watch-time milestone state', async () => {
    const { getByTestId } = await renderReady();

    expect(within(getByTestId('watch-time-milestone-uji_m1')).getByText('Tercapai')).toBeTruthy();
    expect(within(getByTestId('watch-time-milestone-uji_m2')).getByText('Terkunci')).toBeTruthy();
  });

  it('reports an already-claimed check-in', async () => {
    const baseline = buildSnapshot();
    const { getByText } = await renderReady({
      dailyCheckIn: { ...baseline.dailyCheckIn!, isTodayClaimed: true },
    });

    expect(getByText('Sudah check-in hari ini')).toBeTruthy();
  });

  it('clamps an over-completed progress bar instead of overflowing it', async () => {
    const baseline = buildSnapshot();
    const { getByTestId } = await renderReady({
      tasks: [{ ...baseline.tasks[1], progress: { current: 150, target: 100 } }],
    });

    const bar = getByTestId('reward-task-progress-bar-uji_ad');
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 100 });
    // The label carries the subject only, so it can never contradict the
    // announced value.
    expect(bar.props.accessibilityLabel).toBe('Progres Iklan Berhadiah Uji');
  });

  it('omits the watch-time target when no milestone is configured', async () => {
    const baseline = buildSnapshot();
    const { getByText, queryByText } = await renderReady({
      watchTime: { ...baseline.watchTime!, milestones: [] },
    });

    expect(getByText('8 menit')).toBeTruthy();
    expect(queryByText('dari 0 menit')).toBeNull();
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
        onClose={onClose}
        state={{ status: 'ready', snapshot: buildSnapshot() }}
      />
    );

    await fireEvent.press(getByTestId('rewards-back-button'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
