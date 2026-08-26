import { fireEvent, render, within } from '@testing-library/react-native';

import { EarnPanel } from '@/features/rewards/components/earn-panel';
import { ActivePerksCard } from '@/features/rewards/components/active-perks-card';
import { DEFAULT_LANGUAGE, LANGUAGES, translations } from '@/services/i18n/translations';
import type { ActivePerks, RewardTask } from '@/types/rewards';

/**
 * WHAT THE SOCIAL TILES MAY AND MAY NOT CLAIM.
 *
 * Instagram, TikTok and YouTube expose no API that answers "did user X follow
 * page Y" for an arbitrary user. The backend therefore cannot verify a follow
 * and never says it did: the wire field is `verification: "USER_CONFIRMED"`
 * and the ledger reason is `EXTERNAL_SOCIAL_ACTION`. The UI is the last place
 * that honesty can be lost, which is what this file guards.
 *
 * "Follow Instagram" as a CTA is fine - it describes what the viewer is being
 * asked to do. What is not fine is any copy implying the app or the server
 * CHECKED. That is asserted across all three shipped languages, because a
 * claim nothing can support is no better for being made in Chinese.
 */

const idCopy = translations[DEFAULT_LANGUAGE];

jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => ({ isPremium: false, refresh: jest.fn() }),
  EntitlementProvider: ({ children }: { children: React.ReactNode }) => children,
}));

function socialTask(overrides: Partial<RewardTask> = {}): RewardTask {
  return {
    id: 'task_social_instagram',
    type: 'SOCIAL_FOLLOW',
    socialPlatform: 'INSTAGRAM',
    title: 'Instagram',
    description: idCopy['rewards.taskInstagramDesc'],
    rewardPoints: 50,
    progress: null,
    status: 'AVAILABLE',
    ctaLabel: idCopy['rewards.ctaFollow'],
    isClaimSupported: true,
    verification: 'USER_CONFIRMED',
    accountHandle: '@redpanda',
    isClaimed: false,
    socialStage: 'idle',
    ...overrides,
  };
}

function watchTask(overrides: Partial<RewardTask> = {}): RewardTask {
  return {
    id: 'task_watch_5_episodes',
    type: 'WATCH_EPISODES',
    title: idCopy['rewards.taskWatchEpisodesTitle'],
    description: idCopy['rewards.taskWatchEpisodesDesc'],
    rewardPoints: 50,
    progress: { current: 3, target: 5 },
    status: 'IN_PROGRESS',
    ctaLabel: idCopy['rewards.ctaClaim'],
    isClaimSupported: true,
    verification: 'SERVER_OBSERVED',
    isClaimed: false,
    ...overrides,
  };
}

async function renderPanel(tasks: readonly RewardTask[], onTaskAction = jest.fn()) {
  const onAction = jest.fn();
  const utils = await render(
    <EarnPanel onAction={onAction} onTaskAction={onTaskAction} tasks={tasks} />
  );

  return { ...utils, onAction, onTaskAction };
}

describe('a social tile states the evidence class it actually has', () => {
  it('shows the user-confirmed note beside a claimable social mission', async () => {
    const { getByTestId } = await renderPanel([socialTask()]);

    expect(
      getByTestId('rewards-task-verification-task_social_instagram')
    ).toHaveTextContent(idCopy['rewards.userConfirmedNote']);
  });

  it('never renders the word "verified" in any shipped language', async () => {
    // A single word is the whole difference between describing what happened
    // and claiming something nobody can check.
    const forbidden = [/verifik/i, /verified/i, /已验证/, /认证/];

    for (const language of LANGUAGES) {
      const copy = translations[language];

      for (const key of [
        'rewards.userConfirmedNote',
        'rewards.socialOpenHint',
        'rewards.socialConfirmHint',
        'rewards.ctaConfirmFollow',
        'rewards.ctaFollow',
        'rewards.ctaSubscribe',
        'rewards.reasonSocialAction',
      ] as const) {
        for (const pattern of forbidden) {
          expect(copy[key]).not.toMatch(pattern);
        }
      }
    }
  });

  it('tells a first-time viewer that the flow leaves the app and comes back', async () => {
    const { getByTestId } = await renderPanel([socialTask()]);

    expect(getByTestId('rewards-task-hint-task_social_instagram')).toHaveTextContent(
      idCopy['rewards.socialOpenHint']
    );
  });

  it('switches the hint to the confirmation step once the profile was opened', async () => {
    const { getByTestId } = await renderPanel([socialTask({ socialStage: 'opened' })]);

    expect(getByTestId('rewards-task-hint-task_social_instagram')).toHaveTextContent(
      idCopy['rewards.socialConfirmHint']
    );
  });

  it('shows WHICH account the viewer is about to be sent to', async () => {
    const { getByTestId } = await renderPanel([socialTask()]);

    expect(getByTestId('rewards-task-handle-task_social_instagram')).toHaveTextContent(
      '@redpanda'
    );
  });

  it('drops the honesty note once the mission is paid - there is nothing left to claim', async () => {
    const { queryByTestId } = await renderPanel([
      socialTask({ isClaimed: true, ctaLabel: idCopy['rewards.ctaClaimed'] }),
    ]);

    expect(queryByTestId('rewards-task-verification-task_social_instagram')).toBeNull();
  });
});

describe('a claimed mission offers nothing to press', () => {
  it('routes a claimed tile to the acknowledgement branch, never to a request', async () => {
    const onTaskAction = jest.fn();
    const { getByTestId, onAction } = await renderPanel(
      [socialTask({ isClaimed: true, ctaLabel: idCopy['rewards.ctaClaimed'] })],
      onTaskAction
    );

    fireEvent.press(getByTestId('rewards-task-cta-task_social_instagram'));

    expect(onTaskAction).not.toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('still routes an unpaid, supported mission to the real handler', async () => {
    const onTaskAction = jest.fn();
    const { getByTestId, onAction } = await renderPanel([socialTask()], onTaskAction);

    fireEvent.press(getByTestId('rewards-task-cta-task_social_instagram'));

    expect(onTaskAction).toHaveBeenCalledTimes(1);
    expect(onAction).not.toHaveBeenCalled();
  });

  it('routes a task the SERVER marked unsupported to the acknowledgement branch', async () => {
    const onTaskAction = jest.fn();
    const { getByTestId, onAction } = await renderPanel(
      [
        socialTask({
          isClaimSupported: false,
          verification: undefined,
          unsupportedReason: 'NO_VERIFIABLE_SIGNAL',
          ctaLabel: idCopy['rewards.ctaUnavailable'],
        }),
      ],
      onTaskAction
    );

    fireEvent.press(getByTestId('rewards-task-cta-task_social_instagram'));

    expect(onTaskAction).not.toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('a watch mission names the unit it counts', () => {
  it('renders 3/5 with EPISODES as the unit, not minutes', async () => {
    // The backend counts episodes it authorised and cannot measure time. A
    // bare "3/5" beside a coin value is ambiguous; "3/5 episode" is not.
    const { getByTestId } = await renderPanel([watchTask()]);

    expect(getByTestId('rewards-task-progress-task_watch_5_episodes')).toHaveTextContent(
      '3/5 episode'
    );
  });

  it('renders the progress BAR from the same server pair', async () => {
    const { getByTestId } = await renderPanel([watchTask()]);

    expect(getByTestId('rewards-task-progress-bar-task_watch_5_episodes')).toBeTruthy();
  });

  it('does not attach the user-confirmed caveat to a server-observed mission', async () => {
    const { queryByTestId } = await renderPanel([watchTask()]);

    expect(queryByTestId('rewards-task-verification-task_watch_5_episodes')).toBeNull();
  });

  it('renders a WATCH_EPISODES tile without crashing on its mark', async () => {
    // The mark is a `Record` lookup over a closed union. Before
    // `WATCH_EPISODES` existed as a member, this row resolved `undefined` and
    // crashed the whole list on `mark.background`. The tile is hidden from
    // the accessibility tree (the title beside it names the task), so the ROW
    // rendering at all is what proves the lookup resolved.
    const { getByTestId } = await renderPanel([watchTask()]);

    expect(getByTestId('rewards-task-task_watch_5_episodes')).toBeTruthy();
  });
});

describe('active perks are shown beside what sells them', () => {
  function perks(overrides: Partial<ActivePerks> = {}): ActivePerks {
    return {
      perks: [
        {
          id: 'perk-1',
          type: 'SKIP_NEXT_INTERSTITIAL',
          title: idCopy['rewards.perkSkipTitle'],
          detail: 'Sisa 1 kali',
          expiresAt: '2026-08-27T09:00:00.000Z',
          expiresAtLabel: 'Berlaku sampai 27/08/2026 16:00',
          remainingUses: 1,
        },
      ],
      skipNextInterstitial: true,
      adFreeUntil: null,
      ...overrides,
    };
  }

  it('names what the viewer holds and when it stops working', async () => {
    const { getByTestId } = await render(<ActivePerksCard activePerks={perks()} />);
    const row = within(getByTestId('rewards-active-perk-perk-1'));

    expect(row.getByText(idCopy['rewards.perkSkipTitle'])).toBeTruthy();
    expect(row.getByText(/Berlaku sampai/)).toBeTruthy();
  });

  it('renders nothing at all for an account holding no perks', async () => {
    const { queryByTestId } = await render(
      <ActivePerksCard
        activePerks={{ perks: [], skipNextInterstitial: false, adFreeUntil: null }}
      />
    );

    expect(queryByTestId('rewards-active-perks')).toBeNull();
  });
});
