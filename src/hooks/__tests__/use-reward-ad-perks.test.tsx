import { act, renderHook, waitFor } from '@testing-library/react-native';

import { toAdPerkState, useRewardAdPerks } from '@/hooks/use-reward-ad-perks';
import { ApiError } from '@/services/api/client';
import { __resetPerkRegistryForTests, getPerkConsumer } from '@/services/ads/ad-perk-registry';
import type { ActivePerksDto } from '@/services/rewards/rewards-dto';
import { consumePerk, fetchActivePerks } from '@/services/rewards/rewards-service';
import { __resetAdsStoreForTests, useAdsStore } from '@/stores/ads-store';

/**
 * The bridge that carries SERVER perk state to the ad gate.
 *
 * Three properties matter more than the plumbing, and each of them is a real
 * failure that has a name:
 *
 *  - AN OUTAGE GRANTS NOTHING. A rewards backend that is down, disabled or
 *    unreachable must leave the ad policy exactly as it was. The opposite
 *    default would hand every viewer a free ad-free session on one failed
 *    request.
 *  - ONE ACCOUNT'S PERK NEVER SUPPRESSES ANOTHER'S AD. Signing out and back
 *    in as somebody else must not carry a skip across.
 *  - A SPEND IS RECONCILED FROM THE RESPONSE, so a viewer holding two skips
 *    keeps the second one.
 */

jest.mock('@/services/rewards/rewards-service', () => ({
  fetchActivePerks: jest.fn(),
  consumePerk: jest.fn(),
}));

const mockUseAuth = jest.fn();
jest.mock('@/stores/auth', () => ({ useAuth: () => mockUseAuth() }));

jest.mock('@/services/demo/demo-mode', () => ({ isDemoMode: () => false }));

const mockFetchPerks = fetchActivePerks as jest.MockedFunction<typeof fetchActivePerks>;
const mockConsumePerk = consumePerk as jest.MockedFunction<typeof consumePerk>;

const FUTURE = '2099-01-01T00:00:00.000Z';

function perksDto(overrides: Partial<ActivePerksDto> = {}): ActivePerksDto {
  return {
    perks: [
      {
        id: 'perk-skip-1',
        perkType: 'SKIP_NEXT_INTERSTITIAL',
        expiresAt: FUTURE,
        remainingUses: 1,
        grantedAt: '2026-08-26T09:00:00.000Z',
      },
    ],
    skipNextInterstitial: true,
    adFreeUntil: null,
    ...overrides,
  };
}

function signedInAs(id: string) {
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    isHydrated: true,
    user: { id, email: `${id}@example.com` },
  });
}

beforeEach(() => {
  __resetAdsStoreForTests();
  __resetPerkRegistryForTests();
  mockFetchPerks.mockReset();
  mockConsumePerk.mockReset();
  mockUseAuth.mockReset();
});

describe('toAdPerkState', () => {
  it('COPIES the two server-derived signals rather than re-deriving them', () => {
    // The client must not reimplement "is this perk live?" - that rule is the
    // backend's, and two implementations drift on the one path where drift
    // means showing an ad to someone who paid not to see one.
    const state = toAdPerkState({
      perks: [],
      skipNextInterstitial: true,
      adFreeUntil: FUTURE,
    });

    expect(state.skipNextInterstitial).toBe(true);
    expect(state.adFreeUntil).toBe(Date.parse(FUTURE));
  });

  it('takes the skip perk id from the array, which is the only place it lives', () => {
    expect(toAdPerkState(perksDto()).skipPerkId).toBe('perk-skip-1');
  });

  it('spends the EARLIEST-expiring skip first, so neither lapses unused', () => {
    const state = toAdPerkState(
      perksDto({
        perks: [
          {
            id: 'perk-later',
            perkType: 'SKIP_NEXT_INTERSTITIAL',
            expiresAt: '2099-06-01T00:00:00.000Z',
            remainingUses: 1,
            grantedAt: '2026-08-26T09:00:00.000Z',
          },
          {
            id: 'perk-sooner',
            perkType: 'SKIP_NEXT_INTERSTITIAL',
            expiresAt: '2099-01-01T00:00:00.000Z',
            remainingUses: 1,
            grantedAt: '2026-08-26T09:00:00.000Z',
          },
        ],
      })
    );

    expect(state.skipPerkId).toBe('perk-sooner');
  });

  it('treats an unparseable expiry as NO pass rather than an unbounded one', () => {
    const state = toAdPerkState({
      perks: [],
      skipNextInterstitial: false,
      adFreeUntil: 'not-a-date',
    });

    expect(state.adFreeUntil).toBeNull();
  });
});

describe('useRewardAdPerks', () => {
  it('mirrors the account’s perks into the ads store', async () => {
    signedInAs('user-a');
    mockFetchPerks.mockResolvedValue(perksDto());

    await renderHook(() => useRewardAdPerks());

    await waitFor(() => {
      expect(useAdsStore.getState().skipNextInterstitial).toBe(true);
    });
    expect(useAdsStore.getState().skipPerkId).toBe('perk-skip-1');
  });

  it('mirrors a running ad pass as an epoch instant the gate can compare', async () => {
    signedInAs('user-a');
    mockFetchPerks.mockResolvedValue(
      perksDto({ perks: [], skipNextInterstitial: false, adFreeUntil: FUTURE })
    );

    await renderHook(() => useRewardAdPerks());

    await waitFor(() => {
      expect(useAdsStore.getState().adFreeUntil).toBe(Date.parse(FUTURE));
    });
  });

  it('GRANTS NOTHING when the rewards API fails', async () => {
    signedInAs('user-a');
    mockFetchPerks.mockRejectedValue(new ApiError(503, 'REWARDS_DISABLED', 'off'));

    await renderHook(() => useRewardAdPerks());

    // The store keeps its safe defaults, which is the state that preserves
    // the existing ad policy. A failed read is never a free ad skip.
    await waitFor(() => {
      expect(mockFetchPerks).toHaveBeenCalled();
    });
    expect(useAdsStore.getState().skipNextInterstitial).toBe(false);
    expect(useAdsStore.getState().adFreeUntil).toBeNull();
  });

  it('does not read perks at all for a signed-out viewer', async () => {
    mockUseAuth.mockReturnValue({ isAuthenticated: false, isHydrated: true, user: null });

    await renderHook(() => useRewardAdPerks());

    await waitFor(() => {
      expect(useAdsStore.getState().skipNextInterstitial).toBe(false);
    });
    expect(mockFetchPerks).not.toHaveBeenCalled();
  });

  it('clears a previous account’s perk on sign-out', async () => {
    signedInAs('user-a');
    mockFetchPerks.mockResolvedValue(perksDto());

    const { rerender } = await renderHook(() => useRewardAdPerks());

    await waitFor(() => {
      expect(useAdsStore.getState().skipNextInterstitial).toBe(true);
    });

    mockUseAuth.mockReturnValue({ isAuthenticated: false, isHydrated: true, user: null });
    rerender(undefined);

    await waitFor(() => {
      expect(useAdsStore.getState().skipNextInterstitial).toBe(false);
    });
    expect(useAdsStore.getState().skipPerkId).toBeNull();
  });

  it('never carries one account’s ad skip into the next account', async () => {
    signedInAs('user-a');
    mockFetchPerks.mockResolvedValue(perksDto());

    const { rerender } = await renderHook(() => useRewardAdPerks());

    await waitFor(() => {
      expect(useAdsStore.getState().skipPerkId).toBe('perk-skip-1');
    });

    // B holds nothing. Without the clear-then-read ordering, B would ride A's
    // perk for as long as their own read took to land.
    mockFetchPerks.mockResolvedValue({
      perks: [],
      skipNextInterstitial: false,
      adFreeUntil: null,
    });
    signedInAs('user-b');
    rerender(undefined);

    await waitFor(() => {
      expect(useAdsStore.getState().skipNextInterstitial).toBe(false);
    });
    expect(useAdsStore.getState().skipPerkId).toBeNull();
  });

  it('does not drop a running ad pass while re-reading it for the same account', async () => {
    // The effect also re-runs on app foreground - which is exactly when a
    // viewer returns from the Instagram hand-off. Clearing there would leave
    // the gate with no pass for the length of one network call, and a video
    // transition in that window would show an interstitial the viewer spent
    // coins to avoid.
    signedInAs('user-a');
    mockFetchPerks.mockResolvedValue(
      perksDto({ perks: [], skipNextInterstitial: false, adFreeUntil: FUTURE })
    );

    const { rerender } = await renderHook(() => useRewardAdPerks());

    await waitFor(() => {
      expect(useAdsStore.getState().adFreeUntil).toBe(Date.parse(FUTURE));
    });

    // Same account, effect re-runs. The pass must survive it.
    await rerender(undefined);

    expect(useAdsStore.getState().adFreeUntil).toBe(Date.parse(FUTURE));
  });

  it('registers a consumer that reports a spend and adopts what the server still holds', async () => {
    signedInAs('user-a');
    mockFetchPerks.mockResolvedValue(perksDto());
    mockConsumePerk.mockResolvedValue({
      perkId: 'perk-skip-1',
      consumed: true,
      alreadyConsumed: false,
      // The viewer held two. Spending one must not throw the other away.
      perks: perksDto({
        perks: [
          {
            id: 'perk-skip-2',
            perkType: 'SKIP_NEXT_INTERSTITIAL',
            expiresAt: FUTURE,
            remainingUses: 1,
            grantedAt: '2026-08-26T09:00:00.000Z',
          },
        ],
        skipNextInterstitial: true,
      }),
    });

    await renderHook(() => useRewardAdPerks());

    await waitFor(() => {
      expect(getPerkConsumer()).not.toBeNull();
    });

    await act(async () => {
      getPerkConsumer()?.consumeSkip('perk-skip-1');
    });

    expect(mockConsumePerk).toHaveBeenCalledWith('perk-skip-1');
    await waitFor(() => {
      expect(useAdsStore.getState().skipPerkId).toBe('perk-skip-2');
    });
  });

  it('does not re-grant a perk locally when the spend report fails', async () => {
    signedInAs('user-a');
    mockFetchPerks.mockResolvedValue(perksDto());
    mockConsumePerk.mockRejectedValue(new ApiError(409, 'REWARD_PERK_EXPIRED', 'gone'));

    await renderHook(() => useRewardAdPerks());

    await waitFor(() => {
      expect(getPerkConsumer()).not.toBeNull();
    });

    // The gate already cleared the local flag before calling, so the worst
    // case is a perk the server still believes is held - never a second free
    // skip on this device.
    act(() => {
      useAdsStore.getState().consumeSkipPerk();
    });

    await act(async () => {
      getPerkConsumer()?.consumeSkip('perk-skip-1');
    });

    expect(useAdsStore.getState().skipNextInterstitial).toBe(false);
  });
});
