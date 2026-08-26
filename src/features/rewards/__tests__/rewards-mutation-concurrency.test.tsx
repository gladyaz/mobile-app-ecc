import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useRewardsCenter } from '@/features/rewards/use-rewards-center';
import { ApiError } from '@/services/api/client';
import type {
  CheckInResponseDto,
  RedeemResponseDto,
  RewardLedgerPageDto,
  RewardsSnapshotDto,
} from '@/services/rewards/rewards-dto';
import {
  claimDailyCheckIn,
  fetchRewardsLedger,
  fetchRewardsSnapshot,
  redeemReward,
} from '@/services/rewards/rewards-service';
import type { RewardRedemption } from '@/types/rewards';

/**
 * ONE USER ACTION, AT MOST ONE LOGICAL MUTATION.
 *
 * Everything here is about a press that lands while something is already in
 * flight - a double-tap on a slow connection, a second offer pressed before
 * the first settles, a retry after a dropped socket, a sign-out mid-request.
 * None of it is observable from a test that presses once and waits, and all
 * of it spends the user's points.
 *
 * The properties being held:
 *
 *  - a second press during a mutation reaches no network at all;
 *  - the balance is never computed on this side, in success OR failure;
 *  - a replay is reported as a replay rather than as a second purchase;
 *  - a request that outlives its account can neither write that account's
 *    data into another one nor strand the other's UI;
 *  - the account that DID NOT make a request is never blocked by it.
 */

jest.mock('@/services/rewards/rewards-service', () => ({
  fetchRewardsSnapshot: jest.fn(),
  claimDailyCheckIn: jest.fn(),
  fetchRewardsLedger: jest.fn(),
  redeemReward: jest.fn(),
}));

const mockUseAuth = jest.fn();
const mockRefreshEntitlement = jest.fn();

jest.mock('@/stores/auth', () => ({ useAuth: () => mockUseAuth() }));
jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => ({ isPremium: false, refresh: mockRefreshEntitlement }),
}));

/** Stable identity: a fresh `t` per render would re-fire the load effect. */
const translate = (key: string) => key;

jest.mock('@/stores/language', () => ({
  useTranslation: () => ({ t: translate, language: 'id', setLanguage: jest.fn() }),
}));

const mockFetchSnapshot = fetchRewardsSnapshot as jest.MockedFunction<typeof fetchRewardsSnapshot>;
const mockCheckIn = claimDailyCheckIn as jest.MockedFunction<typeof claimDailyCheckIn>;
const mockFetchLedger = fetchRewardsLedger as jest.MockedFunction<typeof fetchRewardsLedger>;
const mockRedeem = redeemReward as jest.MockedFunction<typeof redeemReward>;

const OFFER_ID = 'redeem_vip_1d';
const OFFER_COST = 1000;
const START_BALANCE = 1250;

function snapshotDto(balancePoints: number, version: number): RewardsSnapshotDto {
  return {
    wallet: {
      balancePoints,
      lifetimeEarnedPoints: 8400,
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
    redemptions: [
      {
        id: OFFER_ID,
        costPoints: OFFER_COST,
        grantsDays: 1,
        availability: 'AVAILABLE',
        isRedeemSupported: true,
        kind: 'PREMIUM_DAYS' as const,
      },
    ],
    activePerks: { perks: [], skipNextInterstitial: false, adFreeUntil: null },
  };
}

function checkInDto(balancePoints: number, version: number): CheckInResponseDto {
  const base = snapshotDto(balancePoints, version);

  return {
    awardedPoints: 10,
    alreadyCheckedIn: false,
    ledgerEntryId: 'led_new',
    wallet: base.wallet,
    dailyCheckIn: { ...base.dailyCheckIn, isTodayClaimed: true },
  };
}

function redeemDto(balancePoints: number, version: number): RedeemResponseDto {
  return {
    redemptionId: 'rdm_1',
    offerId: OFFER_ID,
    costPoints: OFFER_COST,
    grantsDays: 1,
    status: 'FULFILLED',
    replayed: false,
    wallet: snapshotDto(balancePoints, version).wallet,
    entitlementExpiresAt: '2026-08-23T03:00:00.000Z',
    perk: null,
  };
}

const LEDGER: RewardLedgerPageDto = {
  entries: [
    {
      id: 'led_1',
      deltaPoints: 10,
      reason: 'DAILY_CHECK_IN',
      sourceType: 'CHECK_IN',
      sourceId: null,
      balanceAfter: START_BALANCE,
      createdAt: '2026-08-22T01:00:00.000Z',
      metadata: null,
    },
  ],
  nextCursor: null,
};

const USER_A = { id: 'user_a', name: 'A', username: 'a', email: 'a@example.test' };
const USER_B = { id: 'user_b', name: 'B', username: 'b', email: 'b@example.test' };

function signedInAs(user: typeof USER_A) {
  mockUseAuth.mockReturnValue({ isAuthenticated: true, isHydrated: true, user });
}

function offer(overrides: Partial<RewardRedemption> = {}): RewardRedemption {
  return {
    id: OFFER_ID,
    title: 'VIP 1d',
    description: 'desc',
    costPoints: OFFER_COST,
    grantsDays: 1,
    availability: 'AVAILABLE',
    ctaLabel: 'redeem',
    isRedeemSupported: true,
    kind: 'PREMIUM_DAYS' as const,
    ...overrides,
  };
}

function balanceOf(view: ReturnType<typeof useRewardsCenter>['view']): number | null {
  return view.status === 'ready' ? view.snapshot.wallet.balancePoints : null;
}

/** A request the test holds open, so a second press lands mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

beforeEach(() => {
  signedInAs(USER_A);
  mockFetchSnapshot.mockResolvedValue(snapshotDto(START_BALANCE, 7));
  mockFetchLedger.mockResolvedValue(LEDGER);
  mockCheckIn.mockResolvedValue(checkInDto(START_BALANCE + 10, 8));
  mockRedeem.mockResolvedValue(redeemDto(START_BALANCE - OFFER_COST, 8));
  mockRefreshEntitlement.mockResolvedValue(undefined);
});

describe('A. a double-tapped check-in claims once', () => {
  it('reaches the backend exactly once for two presses in one window', async () => {
    const gate = deferred<CheckInResponseDto>();

    mockCheckIn.mockReturnValue(gate.promise);

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
      result.current.checkIn();
      result.current.checkIn();
    });

    expect(mockCheckIn).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(checkInDto(START_BALANCE + 10, 8));
    });

    await waitFor(() => expect(result.current.pendingActionId).toBeNull());
    expect(mockCheckIn).toHaveBeenCalledTimes(1);
    // Adopted from the response, never `START_BALANCE + 10 + 10`.
    expect(balanceOf(result.current.view)).toBe(START_BALANCE + 10);
  });

  it('accepts a second, deliberate press only after the first has settled', async () => {
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(mockCheckIn).toHaveBeenCalledTimes(2);
  });
});

describe('B. a double-tapped redemption spends once', () => {
  it('sends one request, under one idempotency key, for three presses', async () => {
    const gate = deferred<RedeemResponseDto>();

    mockRedeem.mockReturnValue(gate.promise);

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.redeem(offer());
      result.current.redeem(offer());
      result.current.redeem(offer());
    });

    expect(mockRedeem).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(redeemDto(START_BALANCE - OFFER_COST, 8));
    });

    await waitFor(() => expect(result.current.pendingActionId).toBeNull());
    expect(mockRedeem).toHaveBeenCalledTimes(1);
    expect(balanceOf(result.current.view)).toBe(START_BALANCE - OFFER_COST);
  });

  it('buys twice under DIFFERENT keys when the user deliberately redeems twice', async () => {
    // Redeeming the same offer twice is legitimate. Only a retry of ONE
    // attempt may reuse a key; two settled intents must not.
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.redeem(offer());
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    await act(async () => {
      result.current.redeem(offer());
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(mockRedeem).toHaveBeenCalledTimes(2);
    expect(mockRedeem.mock.calls[0][0].idempotencyKey).not.toBe(
      mockRedeem.mock.calls[1][0].idempotencyKey
    );
  });
});

describe('C. one mutation at a time, across actions', () => {
  it('refuses a redemption while a check-in is still in flight', async () => {
    const gate = deferred<CheckInResponseDto>();

    mockCheckIn.mockReturnValue(gate.promise);

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });
    await act(async () => {
      result.current.redeem(offer());
    });

    expect(mockRedeem).not.toHaveBeenCalled();
    expect(result.current.pendingActionId).toBe('check-in');

    await act(async () => {
      gate.resolve(checkInDto(START_BALANCE + 10, 8));
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());
  });

  it('refuses a check-in while a redemption is still in flight', async () => {
    const gate = deferred<RedeemResponseDto>();

    mockRedeem.mockReturnValue(gate.promise);

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.redeem(offer());
    });
    await act(async () => {
      result.current.checkIn();
    });

    expect(mockCheckIn).not.toHaveBeenCalled();
    expect(result.current.pendingActionId).toBe(OFFER_ID);

    await act(async () => {
      gate.resolve(redeemDto(START_BALANCE - OFFER_COST, 8));
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());
  });
});

describe('D. an unaffordable offer never reaches the network', () => {
  it('refuses server-marked INSUFFICIENT_POINTS without a request or a balance change', async () => {
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.redeem(offer({ availability: 'INSUFFICIENT_POINTS' }));
    });

    expect(mockRedeem).not.toHaveBeenCalled();
    expect(balanceOf(result.current.view)).toBe(START_BALANCE);
    expect(result.current.notice?.tone).toBe('error');
    expect(result.current.pendingActionId).toBeNull();
  });

  it('leaves the balance exactly where it was when the SERVER refuses for insufficient points', async () => {
    mockRedeem.mockRejectedValue(
      new ApiError(409, 'INSUFFICIENT_REWARD_POINTS', 'not enough points')
    );

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.redeem(offer());
    });

    await waitFor(() => expect(result.current.pendingActionId).toBeNull());
    expect(balanceOf(result.current.view)).toBe(START_BALANCE);
    expect(result.current.notice?.tone).toBe('error');
  });

  it('never redeems an offer the server has not enabled', async () => {
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.redeem(offer({ isRedeemSupported: false }));
    });

    expect(mockRedeem).not.toHaveBeenCalled();
    expect(balanceOf(result.current.view)).toBe(START_BALANCE);
  });
});

describe('E. a replayed redemption is reported as a replay', () => {
  it('adopts the receipt once and says nothing was bought twice', async () => {
    mockRedeem.mockResolvedValue({
      ...redeemDto(START_BALANCE - OFFER_COST, 8),
      replayed: true,
    });

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.redeem(offer());
    });

    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    // Truthful, not celebratory: nothing was debited by THIS request.
    expect(result.current.notice).toEqual({
      tone: 'info',
      message: 'rewards.redeemReplayed',
    });
    // Still the server's number - a replay carries the original wallet.
    expect(balanceOf(result.current.view)).toBe(START_BALANCE - OFFER_COST);
  });
});

describe('F. a repeated check-in is a successful no-op', () => {
  it('reports "already claimed" and credits nothing when the server replays', async () => {
    mockCheckIn.mockResolvedValue({
      ...checkInDto(START_BALANCE, 7),
      awardedPoints: 0,
      alreadyCheckedIn: true,
      ledgerEntryId: null,
    });

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });

    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(result.current.notice).toEqual({ tone: 'info', message: 'rewards.checkInAlready' });
    expect(balanceOf(result.current.view)).toBe(START_BALANCE);
  });
});

describe('G. an account switch mid-request', () => {
  it('never writes account A’s response into account B’s state', async () => {
    const gate = deferred<CheckInResponseDto>();

    mockCheckIn.mockReturnValue(gate.promise);

    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });

    // B's reads never settle, so anything of A's that survived would show.
    mockFetchSnapshot.mockImplementation(() => new Promise(() => {}));
    mockFetchLedger.mockImplementation(() => new Promise(() => {}));
    signedInAs(USER_B);
    await act(async () => {
      rerender({});
    });

    await act(async () => {
      gate.resolve(checkInDto(START_BALANCE + 10, 8));
    });

    expect(result.current.view.status).toBe('loading');
    expect(balanceOf(result.current.view)).toBeNull();
  });

  it('shows account B no spinner for a press account A made', async () => {
    const gate = deferred<CheckInResponseDto>();

    mockCheckIn.mockReturnValue(gate.promise);

    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });
    expect(result.current.pendingActionId).toBe('check-in');

    mockFetchSnapshot.mockImplementation(() => new Promise(() => {}));
    mockFetchLedger.mockImplementation(() => new Promise(() => {}));
    signedInAs(USER_B);
    await act(async () => {
      rerender({});
    });

    // A's request is STILL in flight here. B pressed nothing, so B's
    // check-in button must not be busy while someone else's call finishes.
    expect(result.current.pendingActionId).toBeNull();

    await act(async () => {
      gate.resolve(checkInDto(START_BALANCE + 10, 8));
    });
    expect(result.current.pendingActionId).toBeNull();
  });

  it('shows account B no notice earned by account A', async () => {
    const gate = deferred<CheckInResponseDto>();

    mockCheckIn.mockReturnValue(gate.promise);

    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });

    mockFetchSnapshot.mockImplementation(() => new Promise(() => {}));
    mockFetchLedger.mockImplementation(() => new Promise(() => {}));
    signedInAs(USER_B);
    await act(async () => {
      rerender({});
    });

    await act(async () => {
      gate.resolve(checkInDto(START_BALANCE + 10, 8));
    });

    expect(result.current.notice).toBeNull();
  });

  it('does not lock account B out of checking in while account A’s request is still open', async () => {
    // The lock exists to stop ONE user double-spending. Holding it across a
    // sign-out would make the next person's first tap silently do nothing.
    const stuck = deferred<CheckInResponseDto>();

    mockCheckIn.mockReturnValue(stuck.promise);

    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });
    expect(mockCheckIn).toHaveBeenCalledTimes(1);

    signedInAs(USER_B);
    await act(async () => {
      rerender({});
    });
    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    const gateB = deferred<CheckInResponseDto>();

    mockCheckIn.mockReturnValue(gateB.promise);

    await act(async () => {
      result.current.checkIn();
    });

    expect(mockCheckIn).toHaveBeenCalledTimes(2);
    expect(result.current.pendingActionId).toBe('check-in');

    // A's long-dead request lands last. It must not clear B's live spinner.
    await act(async () => {
      stuck.resolve(checkInDto(START_BALANCE + 10, 8));
    });
    expect(result.current.pendingActionId).toBe('check-in');

    await act(async () => {
      gateB.resolve(checkInDto(START_BALANCE + 10, 8));
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());
  });
});

describe('H. a sign-out mid-request', () => {
  it('renders the sign-in state and adopts nothing from the request in flight', async () => {
    const gate = deferred<CheckInResponseDto>();

    mockCheckIn.mockReturnValue(gate.promise);

    const { result, rerender } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });

    mockUseAuth.mockReturnValue({ isAuthenticated: false, isHydrated: true, user: null });
    await act(async () => {
      rerender({});
    });

    expect(result.current.view.status).toBe('signInRequired');

    await act(async () => {
      gate.resolve(checkInDto(START_BALANCE + 10, 8));
    });

    expect(result.current.view.status).toBe('signInRequired');
    expect(balanceOf(result.current.view)).toBeNull();
    expect(result.current.pendingActionId).toBeNull();
  });

  it('does not act at all once signed out', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isHydrated: true, user: null });

    const { result } = await renderHook(() => useRewardsCenter());

    await act(async () => {
      result.current.checkIn();
      result.current.redeem(offer());
    });

    expect(mockCheckIn).not.toHaveBeenCalled();
    expect(mockRedeem).not.toHaveBeenCalled();
  });
});

describe('I. a dropped connection, then a retry', () => {
  it('retries a redemption under the SAME key, so the server replays instead of charging twice', async () => {
    // Status 0 means the outcome is unknown: the debit may already have
    // committed. A fresh key would buy a second day for money already spent.
    mockRedeem.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.redeem(offer());
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(balanceOf(result.current.view)).toBe(START_BALANCE);

    mockRedeem.mockResolvedValue({ ...redeemDto(START_BALANCE - OFFER_COST, 8), replayed: true });

    await act(async () => {
      result.current.redeem(offer());
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(mockRedeem).toHaveBeenCalledTimes(2);
    expect(mockRedeem.mock.calls[0][0].idempotencyKey).toBe(
      mockRedeem.mock.calls[1][0].idempotencyKey
    );
  });

  it('starts a NEW key after a refusal the server actually decided', async () => {
    // A 409 is a decision, not an unknown: nothing was recorded, so the next
    // press is a genuinely new attempt and must not replay a dead key.
    mockRedeem.mockRejectedValueOnce(
      new ApiError(409, 'REWARD_OFFER_UNAVAILABLE', 'offer closed')
    );

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.redeem(offer());
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    await act(async () => {
      result.current.redeem(offer());
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(mockRedeem.mock.calls[0][0].idempotencyKey).not.toBe(
      mockRedeem.mock.calls[1][0].idempotencyKey
    );
  });

  it('leaves the balance untouched and the button usable after a failed check-in', async () => {
    mockCheckIn.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(balanceOf(result.current.view)).toBe(START_BALANCE);
    expect(result.current.notice?.tone).toBe('error');

    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(mockCheckIn).toHaveBeenCalledTimes(2);
    expect(balanceOf(result.current.view)).toBe(START_BALANCE + 10);
  });
});

describe('J. the ledger is re-read after a mutation, never composed', () => {
  it('re-reads the history head after a successful check-in', async () => {
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));
    const readsBefore = mockFetchLedger.mock.calls.length;

    await act(async () => {
      result.current.checkIn();
    });

    await waitFor(() => expect(mockFetchLedger.mock.calls.length).toBeGreaterThan(readsBefore));
    // The HEAD, not a page: the re-read carries no cursor at all.
    expect(mockFetchLedger).toHaveBeenLastCalledWith({ limit: 20 });
  });

  it('re-reads the history head after a successful redemption', async () => {
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));
    const readsBefore = mockFetchLedger.mock.calls.length;

    await act(async () => {
      result.current.redeem(offer());
    });

    await waitFor(() => expect(mockFetchLedger.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('does not re-read the history after a mutation the server refused', async () => {
    mockRedeem.mockRejectedValue(new ApiError(409, 'INSUFFICIENT_REWARD_POINTS', 'no'));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));
    const readsBefore = mockFetchLedger.mock.calls.length;

    await act(async () => {
      result.current.redeem(offer());
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(mockFetchLedger.mock.calls.length).toBe(readsBefore);
  });
});

describe('K. the mutation slot is never permanently lost', () => {
  it('frees the slot after a mutation that failed, so the next press works', async () => {
    mockCheckIn.mockRejectedValueOnce(new ApiError(500, 'SERVER_ERROR', 'boom'));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(mockCheckIn).toHaveBeenCalledTimes(2);
  });

  it('frees the slot when an explicit reload lands mid-mutation', async () => {
    // `reload()` tears the fetched state down under a request that is still
    // open. The slot has to survive that intact in BOTH directions: not stuck
    // held, and not handed to a second press before the first has settled.
    const gate = deferred<CheckInResponseDto>();

    mockCheckIn.mockReturnValue(gate.promise);

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE));

    await act(async () => {
      result.current.checkIn();
    });
    await act(async () => {
      result.current.reload();
    });

    // Still one call: a reload is not a licence to check in twice.
    expect(mockCheckIn).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve(checkInDto(START_BALANCE + 10, 8));
    });
    // The check-in DID commit server-side, and its wallet carries the newer
    // version, so adopting it over the reload's read is the truthful result -
    // a reload must not erase a credit the server already made.
    await waitFor(() => expect(balanceOf(result.current.view)).toBe(START_BALANCE + 10));

    mockCheckIn.mockResolvedValue(checkInDto(START_BALANCE + 10, 9));
    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(mockCheckIn).toHaveBeenCalledTimes(2);
  });
});
