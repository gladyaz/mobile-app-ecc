import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useRewardsCenter } from '@/features/rewards/use-rewards-center';
import { ApiError } from '@/services/api/client';
import type {
  CheckInResponseDto,
  RedeemResponseDto,
  RewardLedgerEntryDto,
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
 * LEDGER ROW IDENTITY, end to end through the container.
 *
 * `TransactionHistoryPanel` keys its rows on `RewardLedgerEntry.id`. React
 * requires that key to be unique among siblings, and the ledger's own
 * contract makes `id` the right choice: append-only, server-generated, no
 * updates and no deletes, so one id names one immutable movement forever.
 *
 * What was missing was the other half - nothing ENFORCED uniqueness in the
 * list the panel was handed. `loadMoreLedger` concatenated pages blindly,
 * which is correct only while the server never re-serves a row the client
 * already holds. These tests hold the container to that invariant instead of
 * the server.
 */

jest.mock('@/services/rewards/rewards-service', () => ({
  fetchRewardsSnapshot: jest.fn(),
  claimDailyCheckIn: jest.fn(),
  fetchRewardsLedger: jest.fn(),
  redeemReward: jest.fn(),
}));

const mockUseAuth = jest.fn();

jest.mock('@/stores/auth', () => ({ useAuth: () => mockUseAuth() }));
jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => ({ isPremium: false, refresh: jest.fn().mockResolvedValue(undefined) }),
}));
/**
 * ONE `t` for the whole file, deliberately. The container's load effect
 * depends on `t`, so a factory that returned a fresh arrow per render would
 * re-fire that effect on every render and never settle - the identity of
 * this function is load-bearing, not incidental.
 */
const translate = (key: string) => key;

jest.mock('@/stores/language', () => ({
  useTranslation: () => ({ t: translate, language: 'id', setLanguage: jest.fn() }),
}));

const mockFetchSnapshot = fetchRewardsSnapshot as jest.MockedFunction<typeof fetchRewardsSnapshot>;
const mockCheckIn = claimDailyCheckIn as jest.MockedFunction<typeof claimDailyCheckIn>;
const mockFetchLedger = fetchRewardsLedger as jest.MockedFunction<typeof fetchRewardsLedger>;
const mockRedeem = redeemReward as jest.MockedFunction<typeof redeemReward>;

const OFFER_ID = 'redeem_vip_1d';

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
    redemptions: [
      {
        id: OFFER_ID,
        costPoints: 1000,
        grantsDays: 1,
        availability: 'AVAILABLE',
        isRedeemSupported: true,
      },
    ],
  };
}

function entryDto(id: string, createdAt: string): RewardLedgerEntryDto {
  return {
    id,
    deltaPoints: 10,
    reason: 'DAILY_CHECK_IN',
    sourceType: 'CHECK_IN',
    sourceId: null,
    balanceAfter: 100,
    createdAt,
    metadata: null,
  };
}

/** Ids double as the ordering, newest first, exactly as the server sends. */
function page(ids: string[], nextCursor: string | null): RewardLedgerPageDto {
  return {
    entries: ids.map((id, index) => entryDto(id, `2026-08-22T0${9 - index}:00:00.000Z`)),
    nextCursor,
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
    costPoints: 1000,
    grantsDays: 1,
    status: 'FULFILLED',
    replayed: false,
    wallet: snapshotDto(balancePoints, version).wallet,
    entitlementExpiresAt: '2026-08-23T03:00:00.000Z',
  };
}

const USER_A = { id: 'user_a', name: 'A', username: 'a', email: 'a@example.test' };

function offer(): RewardRedemption {
  return {
    id: OFFER_ID,
    title: 'VIP 1d',
    description: 'desc',
    costPoints: 1000,
    grantsDays: 1,
    availability: 'AVAILABLE',
    ctaLabel: 'redeem',
    isRedeemSupported: true,
  };
}

function ledgerIds(ledger: ReturnType<typeof useRewardsCenter>['ledger']): string[] {
  return ledger.status === 'ready' ? ledger.entries.map((entry) => entry.id) : [];
}

beforeEach(() => {
  mockUseAuth.mockReturnValue({ isAuthenticated: true, isHydrated: true, user: USER_A });
  mockFetchSnapshot.mockResolvedValue(snapshotDto(1250, 7));
  mockFetchLedger.mockResolvedValue(page(['led_2', 'led_1'], null));
  mockCheckIn.mockResolvedValue(checkInDto(1260, 8));
  mockRedeem.mockResolvedValue(redeemDto(250, 8));
});

describe('every ledger row on screen has a unique key', () => {
  it('renders two legitimate rows under two distinct keys', async () => {
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    const ids = ledgerIds(result.current.ledger);

    expect(ids).toEqual(['led_2', 'led_1']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('drops a row the next page re-serves instead of holding it twice', async () => {
    // The keyset-boundary overlap: page 2 restates the row page 1 ended on,
    // which is what two entries sharing one `createdAt` produce.
    mockFetchLedger
      .mockResolvedValueOnce(page(['led_3', 'led_2'], 'CURSOR_1'))
      .mockResolvedValueOnce(page(['led_2', 'led_1'], null));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    await act(async () => {
      result.current.loadMoreLedger();
    });

    await waitFor(() => expect(ledgerIds(result.current.ledger)).toHaveLength(3));

    const ids = ledgerIds(result.current.ledger);

    expect(ids).toEqual(['led_3', 'led_2', 'led_1']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('holds one row when a single page repeats an id', async () => {
    mockFetchLedger.mockResolvedValue(page(['led_1', 'led_1'], null));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    expect(ledgerIds(result.current.ledger)).toEqual(['led_1']);
  });

  it('does not duplicate the re-served row when the ledger refreshes after a check-in', async () => {
    mockFetchLedger
      .mockResolvedValueOnce(page(['led_2', 'led_1'], null))
      // The post-check-in head re-serves both existing rows plus the new one.
      .mockResolvedValueOnce(page(['led_new', 'led_2', 'led_1'], null));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    await act(async () => {
      result.current.checkIn();
    });

    await waitFor(() => expect(ledgerIds(result.current.ledger)).toContain('led_new'));

    const ids = ledgerIds(result.current.ledger);

    expect(ids).toEqual(['led_new', 'led_2', 'led_1']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not duplicate the re-served row when the ledger refreshes after a redemption', async () => {
    mockFetchLedger
      .mockResolvedValueOnce(page(['led_2', 'led_1'], null))
      .mockResolvedValue(page(['led_spend', 'led_2', 'led_1'], null));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    await act(async () => {
      result.current.redeem(offer());
    });

    await waitFor(() => expect(ledgerIds(result.current.ledger)).toContain('led_spend'));

    const ids = ledgerIds(result.current.ledger);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('creates no extra row when the server replays an earlier redemption', async () => {
    // A replay debits nothing and appends nothing, so the history it hands
    // back is the SAME history - which must not double on screen.
    mockRedeem.mockResolvedValue({ ...redeemDto(250, 8), replayed: true });
    mockFetchLedger.mockResolvedValue(page(['led_spend', 'led_2', 'led_1'], null));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    await act(async () => {
      result.current.redeem(offer());
    });

    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    const ids = ledgerIds(result.current.ledger);

    expect(ids).toEqual(['led_spend', 'led_2', 'led_1']);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('creates no extra row when a repeated check-in is answered as already claimed', async () => {
    mockCheckIn.mockResolvedValue({
      ...checkInDto(1250, 7),
      awardedPoints: 0,
      alreadyCheckedIn: true,
      ledgerEntryId: null,
    });

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    await act(async () => {
      result.current.checkIn();
    });

    await waitFor(() => expect(result.current.pendingActionId).toBeNull());

    expect(ledgerIds(result.current.ledger)).toEqual(['led_2', 'led_1']);
  });
});

describe('a page in flight cannot corrupt a ledger that was rebuilt underneath it', () => {
  it('discards a "load more" page that a post-check-in refresh has superseded', async () => {
    let resolveLoadMore: ((value: RewardLedgerPageDto) => void) | null = null;

    mockFetchLedger
      // First read: page one, more available.
      .mockResolvedValueOnce(page(['led_3', 'led_2'], 'CURSOR_1'))
      // The "load more" the user presses - held open on purpose.
      .mockImplementationOnce(
        () =>
          new Promise<RewardLedgerPageDto>((resolve) => {
            resolveLoadMore = resolve;
          })
      )
      // The post-check-in head refresh, which rebuilds the list from the top.
      .mockResolvedValue(page(['led_new', 'led_3'], 'CURSOR_2'));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    await act(async () => {
      result.current.loadMoreLedger();
    });

    await act(async () => {
      result.current.checkIn();
    });

    await waitFor(() => expect(ledgerIds(result.current.ledger)).toEqual(['led_new', 'led_3']));

    // Only now does the superseded page land. It was computed against a head
    // that no longer exists, so adopting it would splice rows into a list
    // built from a different cursor - and would overwrite the fresh cursor
    // with a stale one, permanently mis-paging the rest of the history.
    await act(async () => {
      resolveLoadMore?.(page(['led_2', 'led_1'], null));
    });

    const ids = ledgerIds(result.current.ledger);

    expect(ids).toEqual(['led_new', 'led_3']);
    expect(new Set(ids).size).toBe(ids.length);

    // The fresh cursor survived, so the history can still be paged.
    expect(result.current.ledger.status === 'ready' && result.current.ledger.hasMore).toBe(true);

    await act(async () => {
      result.current.loadMoreLedger();
    });

    await waitFor(() =>
      expect(mockFetchLedger).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: 'CURSOR_2' })
      )
    );
  });

  it('discards a "load more" page that an explicit reload has superseded', async () => {
    let resolveLoadMore: ((value: RewardLedgerPageDto) => void) | null = null;

    mockFetchLedger
      .mockResolvedValueOnce(page(['led_3', 'led_2'], 'CURSOR_1'))
      .mockImplementationOnce(
        () =>
          new Promise<RewardLedgerPageDto>((resolve) => {
            resolveLoadMore = resolve;
          })
      )
      .mockResolvedValue(page(['led_3', 'led_2'], null));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    await act(async () => {
      result.current.loadMoreLedger();
    });

    await act(async () => {
      result.current.reload();
    });

    await waitFor(() => expect(ledgerIds(result.current.ledger)).toEqual(['led_3', 'led_2']));

    await act(async () => {
      resolveLoadMore?.(page(['led_2', 'led_1'], null));
    });

    expect(ledgerIds(result.current.ledger)).toEqual(['led_3', 'led_2']);
  });
});

describe('the guards must not brick the history they protect', () => {
  it('can still page normally after a refresh cancelled a page in flight', async () => {
    // A cancelled page hands its pagination slot to the build that replaced
    // it. If it kept the slot instead, "load more" would be dead for good.
    let releaseHeld: ((value: RewardLedgerPageDto) => void) | null = null;

    mockFetchLedger
      .mockResolvedValueOnce(page(['led_3', 'led_2'], 'CURSOR_1'))
      .mockImplementationOnce(
        () =>
          new Promise<RewardLedgerPageDto>((resolve) => {
            releaseHeld = resolve;
          })
      )
      .mockResolvedValueOnce(page(['led_new', 'led_3'], 'CURSOR_2'))
      .mockResolvedValue(page(['led_0'], null));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    await act(async () => {
      result.current.loadMoreLedger();
    });
    await act(async () => {
      result.current.checkIn();
    });
    await waitFor(() => expect(ledgerIds(result.current.ledger)).toEqual(['led_new', 'led_3']));

    await act(async () => {
      releaseHeld?.(page(['led_2', 'led_1'], 'DEAD_CURSOR'));
    });

    expect(
      result.current.ledger.status === 'ready' && result.current.ledger.isLoadingMore
    ).toBe(false);

    await act(async () => {
      result.current.loadMoreLedger();
    });

    await waitFor(() =>
      expect(ledgerIds(result.current.ledger)).toEqual(['led_new', 'led_3', 'led_0'])
    );
    // The live cursor, not the cancelled page's dead one.
    expect(mockFetchLedger).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'CURSOR_2' })
    );
  });

  it('retries a failed page from the SAME cursor, without skipping it', async () => {
    mockFetchLedger
      .mockResolvedValueOnce(page(['led_2'], 'CURSOR_1'))
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'))
      .mockResolvedValue(page(['led_1'], null));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    await act(async () => {
      result.current.loadMoreLedger();
    });
    await waitFor(() =>
      expect(
        result.current.ledger.status === 'ready' && result.current.ledger.loadMoreError
      ).toBeTruthy()
    );

    // The rows already read stay on screen while the failure is reported.
    expect(ledgerIds(result.current.ledger)).toEqual(['led_2']);

    await act(async () => {
      result.current.loadMoreLedger();
    });

    await waitFor(() => expect(ledgerIds(result.current.ledger)).toEqual(['led_2', 'led_1']));
    expect(mockFetchLedger).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: 'CURSOR_1' })
    );
  });

  it('recovers through retryLedger after the first read failed', async () => {
    mockFetchLedger
      .mockRejectedValueOnce(new ApiError(500, 'SERVER_ERROR', 'boom'))
      .mockResolvedValue(page(['led_1'], null));

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('error'));

    await act(async () => {
      result.current.retryLedger();
    });

    await waitFor(() => expect(ledgerIds(result.current.ledger)).toEqual(['led_1']));
  });

  it('keeps two rows that differ ONLY by id', async () => {
    // The merge keys on `id` and nothing else, on purpose. Two manual
    // adjustments of the same size in the same minute are two real movements;
    // de-duplicating on content would erase one from a history the user reads
    // to reconcile their own balance.
    mockFetchLedger.mockResolvedValue({
      entries: [
        {
          id: 'led_x',
          deltaPoints: 10,
          reason: 'ADJUSTMENT',
          sourceType: 'ADJUSTMENT',
          sourceId: null,
          balanceAfter: 20,
          createdAt: '2026-08-22T01:00:00.000Z',
          metadata: null,
        },
        {
          id: 'led_y',
          deltaPoints: 10,
          reason: 'ADJUSTMENT',
          sourceType: 'ADJUSTMENT',
          sourceId: null,
          balanceAfter: 10,
          createdAt: '2026-08-22T01:00:00.000Z',
          metadata: null,
        },
      ],
      nextCursor: null,
    });

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));
    expect(ledgerIds(result.current.ledger)).toEqual(['led_x', 'led_y']);
  });
});
