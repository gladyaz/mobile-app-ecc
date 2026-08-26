import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useRewardsCenter } from '@/features/rewards/use-rewards-center';
import type {
  CheckInResponseDto,
  RewardLedgerPageDto,
  RewardsSnapshotDto,
} from '@/services/rewards/rewards-dto';
import {
  claimDailyCheckIn,
  fetchRewardsLedger,
  fetchRewardsSnapshot,
  redeemReward,
} from '@/services/rewards/rewards-service';

/**
 * The container's RACE behaviour, which the route-level suite cannot reach.
 *
 * Everything here is about ordering rather than rendering: a read that
 * outraces a write, an effect that re-fires for a reason unrelated to the
 * wallet, two taps inside one synchronous window, and a response that
 * outlives the account that asked for it. Each of these produced a wrong
 * number on screen at some point during review, and none of them is
 * observable from a test that only presses buttons and waits.
 */

jest.mock('@/services/rewards/rewards-service', () => ({
  fetchRewardsSnapshot: jest.fn(),
  claimDailyCheckIn: jest.fn(),
  fetchRewardsLedger: jest.fn(),
  redeemReward: jest.fn(),
}));

const mockUseAuth = jest.fn();
/**
 * Holds the CURRENT `t` function object.
 *
 * A test swaps `.current` for a different function and re-renders, which
 * changes `t`'s identity exactly the way switching app language does. That
 * identity change is what re-fires the container's load effect - the
 * "incidental re-run" the wallet-version guard has to survive. Swapping only
 * a jest.fn's implementation would not work: the reference stays equal, the
 * effect deps do not change, and the effect never re-runs.
 */
const mockTranslateHolder: { current: (key: string) => string } = {
  current: (key: string) => key,
};

jest.mock('@/stores/auth', () => ({ useAuth: () => mockUseAuth() }));
jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => ({ isPremium: false, refresh: jest.fn().mockResolvedValue(undefined) }),
}));
jest.mock('@/stores/language', () => ({
  useTranslation: () => ({
    t: mockTranslateHolder.current,
    language: 'id',
    setLanguage: jest.fn(),
  }),
}));

const mockFetchSnapshot = fetchRewardsSnapshot as jest.MockedFunction<typeof fetchRewardsSnapshot>;
const mockCheckIn = claimDailyCheckIn as jest.MockedFunction<typeof claimDailyCheckIn>;
const mockFetchLedger = fetchRewardsLedger as jest.MockedFunction<typeof fetchRewardsLedger>;
const mockRedeem = redeemReward as jest.MockedFunction<typeof redeemReward>;

function snapshotDto(balancePoints: number, version: number): RewardsSnapshotDto {
  return {
    wallet: {
      balancePoints,
      lifetimeEarnedPoints: balancePoints,
      isServerAuthoritative: true,
      updatedAt: '2026-08-22T03:00:00.000Z',
      version,
    },
    dailyCheckIn: {
      currentStreakDays: 1,
      longestStreakDays: 1,
      totalCheckInDays: 1,
      todayRewardPoints: 10,
      isTodayClaimed: false,
      days: [{ day: 1, rewardPoints: 10, state: 'TODAY', isBonus: false }],
      isClaimSupported: true,
      periodKey: '2026-08-22',
      timezone: 'Asia/Jakarta',
      resetsAt: '2026-08-22T17:00:00.000Z',
    },
    watchTime: null,
    tasks: [],
    redemptions: [],
    activePerks: { perks: [], skipNextInterstitial: false, adFreeUntil: null },
  };
}

function checkInDto(balancePoints: number, version: number): CheckInResponseDto {
  const base = snapshotDto(balancePoints, version);

  return {
    awardedPoints: 10,
    alreadyCheckedIn: false,
    ledgerEntryId: 'led_1',
    wallet: base.wallet,
    dailyCheckIn: { ...base.dailyCheckIn, isTodayClaimed: true },
  };
}

function ledgerPage(ids: string[], nextCursor: string | null): RewardLedgerPageDto {
  return {
    entries: ids.map((id, index) => ({
      id,
      deltaPoints: 10,
      reason: 'DAILY_CHECK_IN',
      sourceType: 'CHECK_IN',
      sourceId: null,
      balanceAfter: 10 * (index + 1),
      createdAt: '2026-08-22T01:00:00.000Z',
      metadata: null,
    })),
    nextCursor,
  };
}

const USER_A = { id: 'user_a', name: 'A', username: 'a', email: 'a@example.test' };
const USER_B = { id: 'user_b', name: 'B', username: 'b', email: 'b@example.test' };

function signedInAs(user: typeof USER_A) {
  mockUseAuth.mockReturnValue({ isAuthenticated: true, isHydrated: true, user });
}

function readBalance(view: ReturnType<typeof useRewardsCenter>['view']): number | null {
  return view.status === 'ready' ? view.snapshot.wallet.balancePoints : null;
}

beforeEach(() => {
  mockTranslateHolder.current = (key: string) => key;
  signedInAs(USER_A);
  mockFetchSnapshot.mockResolvedValue(snapshotDto(1250, 7));
  mockFetchLedger.mockResolvedValue(ledgerPage(['led_a'], null));
  mockCheckIn.mockResolvedValue(checkInDto(1260, 8));
  mockRedeem.mockResolvedValue({} as never);
});

describe('wallet version guard', () => {
  it('does not let a stale snapshot roll the balance back after a check-in', async () => {
    // The failure being designed out: a `GET /rewards/snapshot` can outrace a
    // `POST /rewards/check-in` that is waiting on a row lock, and would then
    // return the PRE-check-in wallet. Adopting it would silently erase a
    // credit the user was already told about, with no error shown.
    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(readBalance(result.current.view)).toBe(1250));

    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(readBalance(result.current.view)).toBe(1260));

    // An INCIDENTAL effect re-run - what a language change looks like from
    // here - whose snapshot read returns the older v7 wallet.
    mockFetchSnapshot.mockResolvedValue(snapshotDto(1250, 7));
    mockTranslateHolder.current = (key: string) => `en:${key}`;
    await act(async () => {
      rerender({});
    });

    await waitFor(() => expect(mockFetchSnapshot).toHaveBeenCalledTimes(2));
    // Still the credited balance. The older read was refused.
    expect(readBalance(result.current.view)).toBe(1260);
  });

  it('adopts a snapshot whose version has advanced', async () => {
    // The guard must not be so eager that it rejects genuinely newer data -
    // otherwise it would freeze the screen instead of protecting it.
    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(readBalance(result.current.view)).toBe(1250));

    mockFetchSnapshot.mockResolvedValue(snapshotDto(9999, 12));
    mockTranslateHolder.current = (key: string) => `en:${key}`;
    await act(async () => {
      rerender({});
    });

    await waitFor(() => expect(readBalance(result.current.view)).toBe(9999));
  });

  it('accepts a fresh read after an EXPLICIT reload, even at a lower version', async () => {
    // A user-initiated reload asks for whatever the server says now. Without
    // resetting the guard here, the fresh read would be refused as "older
    // than what we adopted" and the screen would stay stuck loading.
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(readBalance(result.current.view)).toBe(1250));

    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(readBalance(result.current.view)).toBe(1260));

    mockFetchSnapshot.mockResolvedValue(snapshotDto(555, 2));
    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => expect(readBalance(result.current.view)).toBe(555));
  });
});

describe('ledger pagination re-entrancy', () => {
  it('does not append the same page twice when "load more" is double-tapped', async () => {
    // `disabled={isLoadingMore}` only takes effect after the first tap has
    // RENDERED. Two presses in one synchronous window would otherwise both
    // read the same cursor and both append the same page.
    mockFetchLedger
      .mockResolvedValueOnce(ledgerPage(['led_1'], 'CURSOR_1'))
      .mockResolvedValue(ledgerPage(['led_2'], null));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    await act(async () => {
      result.current.loadMoreLedger();
      result.current.loadMoreLedger();
    });

    await waitFor(() => {
      const ledger = result.current.ledger;

      expect(ledger.status).toBe('ready');
      if (ledger.status === 'ready') {
        expect(ledger.entries.map((entry) => entry.id)).toEqual(['led_1', 'led_2']);
      }
    });
  });
});

describe('account isolation', () => {
  it('never shows account A’s balance to account B', async () => {
    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(readBalance(result.current.view)).toBe(1250));

    // B's read never settles, so if anything of A's survived the switch it
    // would still be on screen for B to see.
    mockFetchSnapshot.mockImplementation(() => new Promise(() => {}));
    mockFetchLedger.mockImplementation(() => new Promise(() => {}));
    signedInAs(USER_B);
    await act(async () => {
      rerender({});
    });

    expect(result.current.view.status).toBe('loading');
    expect(readBalance(result.current.view)).toBeNull();
  });

  it('discards a response that arrives for the previous account', async () => {
    let resolveA: ((value: RewardsSnapshotDto) => void) | null = null;

    mockFetchSnapshot.mockImplementationOnce(
      () =>
        new Promise<RewardsSnapshotDto>((resolve) => {
          resolveA = resolve;
        })
    );

    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(mockFetchSnapshot).toHaveBeenCalledTimes(1));

    mockFetchSnapshot.mockImplementation(() => new Promise(() => {}));
    signedInAs(USER_B);
    await act(async () => {
      rerender({});
    });

    // A's snapshot lands only now, after the switch.
    await act(async () => {
      resolveA?.(snapshotDto(1250, 7));
    });

    expect(readBalance(result.current.view)).toBeNull();
  });

  it('shows a signed-out viewer the sign-in state without calling the backend', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isHydrated: true, user: null });

    const { result } = await renderHook(() => useRewardsCenter());

    expect(result.current.view.status).toBe('signInRequired');
    expect(mockFetchSnapshot).not.toHaveBeenCalled();
    expect(mockFetchLedger).not.toHaveBeenCalled();
  });

  it('does not strand a spinner when a request outlives an account switch', async () => {
    let resolveCheckIn: ((value: CheckInResponseDto) => void) | null = null;

    mockCheckIn.mockImplementation(
      () =>
        new Promise<CheckInResponseDto>((resolve) => {
          resolveCheckIn = resolve;
        })
    );

    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(readBalance(result.current.view)).toBe(1250));

    await act(async () => {
      result.current.checkIn();
    });
    expect(result.current.pendingActionId).toBe('check-in');

    mockFetchSnapshot.mockImplementation(() => new Promise(() => {}));
    signedInAs(USER_B);
    await act(async () => {
      rerender({});
    });

    await act(async () => {
      resolveCheckIn?.(checkInDto(1260, 8));
    });

    // B never pressed anything, so B must not be looking at a busy button.
    expect(result.current.pendingActionId).toBeNull();
  });
});
