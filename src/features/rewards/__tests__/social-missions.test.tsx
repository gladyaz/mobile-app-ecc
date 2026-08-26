import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useRewardsCenter } from '@/features/rewards/use-rewards-center';
import { ApiError } from '@/services/api/client';
import type {
  MissionClaimResponseDto,
  MissionOpenResponseDto,
  RewardTaskDto,
  RewardsSnapshotDto,
} from '@/services/rewards/rewards-dto';
import { openExternalProfile } from '@/services/rewards/open-external-profile';
import {
  claimMission,
  fetchRewardsLedger,
  fetchRewardsSnapshot,
  openSocialMission,
} from '@/services/rewards/rewards-service';
import type { RewardTask } from '@/types/rewards';

/**
 * THE TRUTHFUL TWO-STEP SOCIAL FLOW.
 *
 * What the server actually knows is: it handed this account a destination URL
 * at a recorded instant, and the account came back and confirmed at a later
 * one. It does NOT know a follow happened. These tests hold the client to
 * exactly that claim - the CTA becomes a confirmation the VIEWER makes, the
 * evidence class rides along as `USER_CONFIRMED`, and nothing anywhere says
 * "verified".
 *
 * The other half is duplicate-claim prevention: once the server reports a
 * mission paid, the UI must offer nothing to press. Relying on the backend's
 * `alreadyClaimed` no-op instead would show the viewer a reward that appears
 * to fail.
 */

jest.mock('@/services/rewards/rewards-service', () => ({
  fetchRewardsSnapshot: jest.fn(),
  fetchRewardsLedger: jest.fn(),
  claimDailyCheckIn: jest.fn(),
  redeemReward: jest.fn(),
  openSocialMission: jest.fn(),
  claimMission: jest.fn(),
}));

jest.mock('@/services/rewards/open-external-profile', () => ({
  openExternalProfile: jest.fn(),
}));

jest.mock('@/hooks/use-reward-ad-perks', () => ({
  syncRewardAdPerks: jest.fn().mockResolvedValue(undefined),
}));

const mockUseAuth = jest.fn();
jest.mock('@/stores/auth', () => ({ useAuth: () => mockUseAuth() }));
jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => ({ isPremium: false, refresh: jest.fn().mockResolvedValue(undefined) }),
}));
/**
 * A STABLE `t` identity, module-level on purpose.
 *
 * The container's load effect lists `t` in its dependencies, because a
 * language change genuinely has to re-render the snapshot's copy. A mock that
 * returned a fresh arrow from every `useTranslation()` call would therefore
 * re-fire that effect on every render and spin forever - which is a test-harness
 * bug, not a container one.
 */
const translate = (key: string) => key;

jest.mock('@/stores/language', () => ({
  useTranslation: () => ({ t: translate, language: 'id', setLanguage: jest.fn() }),
}));
jest.mock('@/services/demo/demo-mode', () => ({ isDemoMode: () => false }));

const mockFetchSnapshot = fetchRewardsSnapshot as jest.MockedFunction<typeof fetchRewardsSnapshot>;
const mockFetchLedger = fetchRewardsLedger as jest.MockedFunction<typeof fetchRewardsLedger>;
const mockOpenMission = openSocialMission as jest.MockedFunction<typeof openSocialMission>;
const mockClaimMission = claimMission as jest.MockedFunction<typeof claimMission>;
const mockOpenProfile = openExternalProfile as jest.MockedFunction<typeof openExternalProfile>;

const WALLET = {
  balancePoints: 100,
  lifetimeEarnedPoints: 100,
  isServerAuthoritative: true,
  updatedAt: '2026-08-26T09:00:00.000Z',
  version: 1,
};

const CHECK_IN = {
  currentStreakDays: 1,
  longestStreakDays: 1,
  totalCheckInDays: 1,
  todayRewardPoints: 10,
  isTodayClaimed: false,
  days: [{ day: 1, rewardPoints: 10, state: 'TODAY' as const, isBonus: false }],
  isClaimSupported: true,
  periodKey: '2026-08-26',
  timezone: 'Asia/Jakarta',
  resetsAt: '2026-08-26T17:00:00.000Z',
};

type Platform = 'INSTAGRAM' | 'TIKTOK' | 'YOUTUBE' | 'FACEBOOK';

function socialTask(platform: Platform, overrides: Partial<RewardTaskDto> = {}): RewardTaskDto {
  return {
    id: `task_social_${platform.toLowerCase()}`,
    type: 'SOCIAL_FOLLOW',
    socialPlatform: platform,
    rewardPoints: 50,
    status: 'AVAILABLE',
    isClaimSupported: true,
    verification: 'USER_CONFIRMED',
    destinationUrl: `https://www.${platform.toLowerCase()}.com/redpanda`,
    accountHandle: '@redpanda',
    claimedAt: null,
    ...overrides,
  };
}

function snapshotDto(tasks: RewardTaskDto[], version = 1): RewardsSnapshotDto {
  return {
    wallet: { ...WALLET, version },
    dailyCheckIn: CHECK_IN,
    watchTime: null,
    tasks,
    redemptions: [],
    activePerks: { perks: [], skipNextInterstitial: false, adFreeUntil: null },
  };
}

function openResponse(task: RewardTaskDto): MissionOpenResponseDto {
  return {
    missionId: task.id,
    destinationUrl: task.destinationUrl ?? '',
    openedAt: '2026-08-26T09:00:00.000Z',
    claimableAfter: '2026-08-26T09:00:05.000Z',
    task,
  };
}

function claimResponse(
  task: RewardTaskDto,
  overrides: Partial<MissionClaimResponseDto> = {}
): MissionClaimResponseDto {
  return {
    missionId: task.id,
    awardedPoints: 50,
    alreadyClaimed: false,
    ledgerEntryId: 'ledger-1',
    wallet: { ...WALLET, balancePoints: 150, version: 2 },
    task: { ...task, status: 'COMPLETED', claimedAt: '2026-08-26T09:00:10.000Z' },
    ...overrides,
  };
}

function taskOf(result: { current: { view: unknown } }, id: string): RewardTask {
  const view = result.current.view as { status: string; snapshot: { tasks: RewardTask[] } };

  if (view.status !== 'ready') {
    throw new Error(`Expected a ready snapshot, got "${view.status}"`);
  }

  const task = view.snapshot.tasks.find((candidate) => candidate.id === id);

  if (!task) {
    throw new Error(`Expected task ${id} in the snapshot`);
  }

  return task;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    isHydrated: true,
    user: { id: 'user-a', email: 'a@example.com' },
  });
  mockFetchLedger.mockResolvedValue({ entries: [], nextCursor: null });
  mockOpenProfile.mockResolvedValue(true);
});

async function renderReady(tasks: RewardTaskDto[]) {
  mockFetchSnapshot.mockResolvedValue(snapshotDto(tasks));

  const { result } = await renderHook(() => useRewardsCenter());

  await waitFor(() => {
    expect(result.current.view.status).toBe('ready');
  });

  return result;
}

describe.each<[Platform]>([['INSTAGRAM'], ['TIKTOK'], ['YOUTUBE']])(
  'social mission - %s',
  (platform) => {
    it('opens the SERVER-supplied profile URL and records the open first', async () => {
      const task = socialTask(platform);
      const result = await renderReady([task]);

      mockOpenMission.mockResolvedValue(openResponse(task));

      await act(async () => {
        result.current.pressTask(taskOf(result, task.id));
      });

      // The URL is never client-held: a route that ACCEPTED a destination
      // would let a caller choose where the app opens an external browser
      // with Red Panda's branding on it.
      expect(mockOpenMission).toHaveBeenCalledWith(task.id);
      expect(mockOpenProfile).toHaveBeenCalledWith(task.destinationUrl);
      expect(mockClaimMission).not.toHaveBeenCalled();
    });

    it('turns the CTA into the viewer’s own confirmation after the open', async () => {
      const task = socialTask(platform);
      const result = await renderReady([task]);

      mockOpenMission.mockResolvedValue(openResponse(task));

      await act(async () => {
        result.current.pressTask(taskOf(result, task.id));
      });

      await waitFor(() => {
        expect(taskOf(result, task.id).socialStage).toBe('opened');
      });
      expect(taskOf(result, task.id).ctaLabel).toBe('rewards.ctaConfirmFollow');
    });

    it('claims only on the SECOND press, once the viewer confirms', async () => {
      const task = socialTask(platform);
      const result = await renderReady([task]);

      mockOpenMission.mockResolvedValue(openResponse(task));
      mockClaimMission.mockResolvedValue(claimResponse(task));

      await act(async () => {
        result.current.pressTask(taskOf(result, task.id));
      });
      await waitFor(() => {
        expect(taskOf(result, task.id).socialStage).toBe('opened');
      });

      await act(async () => {
        result.current.pressTask(taskOf(result, task.id));
      });

      // No body: the amount, the reward day and the idempotency key are all
      // the server's, derived from the mission id in the path.
      expect(mockClaimMission).toHaveBeenCalledWith(task.id);
      expect(mockClaimMission).toHaveBeenCalledTimes(1);
    });

    it('adopts the server wallet rather than adding the awarded points', async () => {
      const task = socialTask(platform);
      const result = await renderReady([task]);

      mockOpenMission.mockResolvedValue(openResponse(task));
      mockClaimMission.mockResolvedValue(claimResponse(task));

      await act(async () => {
        result.current.pressTask(taskOf(result, task.id));
      });
      await waitFor(() => {
        expect(taskOf(result, task.id).socialStage).toBe('opened');
      });
      await act(async () => {
        result.current.pressTask(taskOf(result, task.id));
      });

      await waitFor(() => {
        const view = result.current.view as { snapshot: { wallet: { balancePoints: number } } };
        expect(view.snapshot.wallet.balancePoints).toBe(150);
      });
    });

    it('carries USER_CONFIRMED as the evidence class, never a verification claim', async () => {
      const task = socialTask(platform);
      const result = await renderReady([task]);

      expect(taskOf(result, task.id).verification).toBe('USER_CONFIRMED');
    });
  }
);

describe('social mission - the open must actually happen', () => {
  it('stays on the first step when no app or browser would take the URL', async () => {
    const task = socialTask('INSTAGRAM');
    const result = await renderReady([task]);

    mockOpenMission.mockResolvedValue(openResponse(task));
    mockOpenProfile.mockResolvedValue(false);

    await act(async () => {
      result.current.pressTask(taskOf(result, task.id));
    });

    // Asking someone to confirm they followed, when the app never took them
    // anywhere, is asking them to confirm something that did not happen.
    await waitFor(() => {
      expect(result.current.notice?.tone).toBe('error');
    });
    expect(taskOf(result, task.id).socialStage).toBe('idle');
  });
});

describe('social mission - an already-claimed mission offers nothing to press', () => {
  it('renders the claimed CTA and never reaches the network', async () => {
    const task = socialTask('INSTAGRAM', {
      status: 'COMPLETED',
      claimedAt: '2026-08-25T09:00:00.000Z',
    });
    const result = await renderReady([task]);

    expect(taskOf(result, task.id).isClaimed).toBe(true);
    expect(taskOf(result, task.id).ctaLabel).toBe('rewards.ctaClaimed');

    await act(async () => {
      result.current.pressTask(taskOf(result, task.id));
    });

    // A second claim would be answered `alreadyClaimed: true` by the backend,
    // which a viewer reads as a reward that silently failed.
    expect(mockOpenMission).not.toHaveBeenCalled();
    expect(mockClaimMission).not.toHaveBeenCalled();
  });

  it('reports a server-side replay as the truthful no-op it is', async () => {
    const task = socialTask('TIKTOK');
    const result = await renderReady([task]);

    mockOpenMission.mockResolvedValue(openResponse(task));
    mockClaimMission.mockResolvedValue(
      claimResponse(task, {
        alreadyClaimed: true,
        awardedPoints: 0,
        wallet: { ...WALLET, version: 2 },
      })
    );

    await act(async () => {
      result.current.pressTask(taskOf(result, task.id));
    });
    await waitFor(() => {
      expect(taskOf(result, task.id).socialStage).toBe('opened');
    });
    await act(async () => {
      result.current.pressTask(taskOf(result, task.id));
    });

    await waitFor(() => {
      expect(result.current.notice?.message).toBe('rewards.missionClaimAlready');
    });
    expect(result.current.notice?.tone).toBe('info');
  });
});

describe('social mission - server refusals get their own advice', () => {
  it('sends the viewer back to step one when the server has no record of an open', async () => {
    const task = socialTask('YOUTUBE');
    const result = await renderReady([task]);

    mockOpenMission.mockResolvedValue(openResponse(task));
    mockClaimMission.mockRejectedValue(
      new ApiError(409, 'REWARD_MISSION_NOT_STARTED', 'no open recorded')
    );

    await act(async () => {
      result.current.pressTask(taskOf(result, task.id));
    });
    await waitFor(() => {
      expect(taskOf(result, task.id).socialStage).toBe('opened');
    });
    await act(async () => {
      result.current.pressTask(taskOf(result, task.id));
    });

    await waitFor(() => {
      expect(result.current.notice?.message).toBe('rewards.missionNotStarted');
    });
    // Back to the CTA that would actually help, rather than re-offering the
    // one that just failed.
    expect(taskOf(result, task.id).socialStage).toBe('idle');
  });

  it('names the dwell window rather than reporting a generic failure', async () => {
    const task = socialTask('INSTAGRAM');
    const result = await renderReady([task]);

    mockOpenMission.mockResolvedValue(openResponse(task));
    mockClaimMission.mockRejectedValue(new ApiError(409, 'REWARD_MISSION_TOO_SOON', 'too soon'));

    await act(async () => {
      result.current.pressTask(taskOf(result, task.id));
    });
    await waitFor(() => {
      expect(taskOf(result, task.id).socialStage).toBe('opened');
    });
    await act(async () => {
      result.current.pressTask(taskOf(result, task.id));
    });

    await waitFor(() => {
      expect(result.current.notice?.message).toBe('rewards.missionTooSoon');
    });
    // Still confirmable - waiting is exactly what resolves this one.
    expect(taskOf(result, task.id).socialStage).toBe('opened');
  });

  it('explains a mission this deployment does not configure', async () => {
    const task = socialTask('FACEBOOK');
    const result = await renderReady([task]);

    mockOpenMission.mockRejectedValue(
      new ApiError(409, 'REWARD_MISSION_UNAVAILABLE', 'not configured')
    );

    await act(async () => {
      result.current.pressTask(taskOf(result, task.id));
    });

    await waitFor(() => {
      expect(result.current.notice?.message).toBe('rewards.missionUnavailable');
    });
  });
});

describe('watch mission', () => {
  const watchTask: RewardTaskDto = {
    id: 'task_watch_5_episodes',
    type: 'WATCH_EPISODES',
    rewardPoints: 50,
    status: 'IN_PROGRESS',
    isClaimSupported: true,
    verification: 'SERVER_OBSERVED',
    progress: { current: 3, required: 5 },
    claimedAt: null,
    resetsAt: '2026-08-26T17:00:00.000Z',
  };

  it('renders 3/5 from the SERVER pair, never a device count', async () => {
    const result = await renderReady([watchTask]);

    expect(taskOf(result, watchTask.id).progress).toEqual({ current: 3, target: 5 });
  });

  it('refuses to claim a milestone the server has not seen completed', async () => {
    const result = await renderReady([watchTask]);

    await act(async () => {
      result.current.pressTask(taskOf(result, watchTask.id));
    });

    // The server would refuse it anyway; refusing here means the viewer gets
    // the progress bar as the answer instead of an error.
    expect(mockClaimMission).not.toHaveBeenCalled();
    expect(result.current.notice?.message).toBe('rewards.missionNotComplete');
  });

  it('claims directly - there is nothing to open - once the target is reached', async () => {
    const reached: RewardTaskDto = {
      ...watchTask,
      status: 'CLAIMABLE',
      progress: { current: 5, required: 5 },
    };
    const result = await renderReady([reached]);

    mockClaimMission.mockResolvedValue(claimResponse(reached));

    await act(async () => {
      result.current.pressTask(taskOf(result, reached.id));
    });

    expect(mockOpenMission).not.toHaveBeenCalled();
    expect(mockClaimMission).toHaveBeenCalledWith(reached.id);
  });

  it('withdraws the CTA once the milestone has been paid today', async () => {
    const claimed: RewardTaskDto = {
      ...watchTask,
      status: 'COMPLETED',
      progress: { current: 5, required: 5 },
      claimedAt: '2026-08-26T10:00:00.000Z',
    };
    const result = await renderReady([claimed]);

    expect(taskOf(result, claimed.id).isClaimed).toBe(true);
    expect(taskOf(result, claimed.id).ctaLabel).toBe('rewards.ctaClaimed');
  });
});

describe('account switching', () => {
  it('never offers one account’s half-finished mission to the next account', async () => {
    // The middle step of the flow ("the server recorded an open and is
    // waiting to be told you came back") is device state belonging to the
    // account that started it. Carrying it across a switch would offer B a
    // confirm control for an open recorded against A - which the backend
    // refuses, but only after B has pressed a button they should never have
    // been shown.
    const task = socialTask('INSTAGRAM');

    mockFetchSnapshot.mockResolvedValue(snapshotDto([task]));

    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => {
      expect(result.current.view.status).toBe('ready');
    });

    mockOpenMission.mockResolvedValue(openResponse(task));

    await act(async () => {
      result.current.pressTask(taskOf(result, task.id));
    });
    await waitFor(() => {
      expect(taskOf(result, task.id).socialStage).toBe('opened');
    });

    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isHydrated: true,
      user: { id: 'user-b', email: 'b@example.com' },
    });
    mockFetchSnapshot.mockResolvedValue(snapshotDto([task], 1));
    rerender(undefined);

    await waitFor(() => {
      expect(result.current.view.status).toBe('ready');
    });
    await waitFor(() => {
      expect(taskOf(result, task.id).socialStage).toBe('idle');
    });
    expect(taskOf(result, task.id).ctaLabel).toBe('rewards.ctaFollow');
  });

  it('shows the next account a loading state rather than the previous balance', async () => {
    mockFetchSnapshot.mockResolvedValue(snapshotDto([socialTask('INSTAGRAM')]));

    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => {
      expect(result.current.view.status).toBe('ready');
    });

    let resolveB: (value: RewardsSnapshotDto) => void = () => {};
    mockFetchSnapshot.mockReturnValue(
      new Promise<RewardsSnapshotDto>((resolve) => {
        resolveB = resolve;
      })
    );
    mockUseAuth.mockReturnValue({
      isAuthenticated: true,
      isHydrated: true,
      user: { id: 'user-b', email: 'b@example.com' },
    });
    await rerender(undefined);

    // Tagged state: anything held for a different id is not trusted at all,
    // so B waits rather than briefly reading A's balance.
    expect(result.current.view.status).toBe('loading');

    await act(async () => {
      resolveB(snapshotDto([socialTask('INSTAGRAM')], 5));
    });
  });
});

describe('unknown mission types', () => {
  it('drops a task type this build cannot render, without crashing the screen', async () => {
    const result = await renderReady([
      socialTask('INSTAGRAM'),
      { ...socialTask('INSTAGRAM'), id: 'task_future', type: 'TIME_TRAVEL' as never },
    ]);

    const view = result.current.view as { snapshot: { tasks: readonly RewardTask[] } };

    expect(view.snapshot.tasks).toHaveLength(1);
    expect(view.snapshot.tasks[0].id).toBe('task_social_instagram');
  });
});
