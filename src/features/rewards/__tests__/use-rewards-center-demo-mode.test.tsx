import { renderHook, waitFor } from '@testing-library/react-native';

import { useRewardsCenter } from '@/features/rewards/use-rewards-center';
import {
  claimDailyCheckIn,
  fetchRewardsLedger,
  fetchRewardsSnapshot,
  redeemReward,
} from '@/services/rewards/rewards-service';

/**
 * Rewards in an OFFLINE demo build (`EXPO_PUBLIC_DEMO_MODE=true`).
 *
 * Every `/rewards/*` route is authenticated and server-authoritative, and
 * the fixture module was deleted outright so there is deliberately nothing
 * to fall back to (see `docs/rewards-domain-contract.md`). A demo build has
 * no backend at all, so the container must not attempt the call: without
 * this gate a demo viewer who signs in - and demo login accepts ANY
 * credentials, see `services/demo/demo-auth.ts` - lands on the generic
 * `error` state with a Retry button that can never succeed, and, because
 * the API layer has no timeout, on a permanent spinner whenever the baked-in
 * host resolves but never answers.
 *
 * The state shown instead is NOT new copy invented for the demo: it is the
 * SAME bounded `unavailable` state a deployment with `REWARDS_ENABLED=false`
 * already produces, already localized in id/en/zh. No balance, streak or
 * ledger row is fabricated, which is the guarantee the rewards contract
 * exists to protect.
 */

jest.mock('@/services/rewards/rewards-service', () => ({
  fetchRewardsSnapshot: jest.fn(),
  claimDailyCheckIn: jest.fn(),
  fetchRewardsLedger: jest.fn(),
  redeemReward: jest.fn(),
}));

const mockUseAuth = jest.fn();

/**
 * ONE stable `t` reference for the whole suite, matching the sibling
 * container suite. `t` is a dependency of the load effect, so returning a
 * fresh arrow from the mock on every render would change the deps every
 * render and re-fire the effect forever - the hook would never settle and
 * the test would time out rather than assert anything.
 */
const mockTranslate = (key: string) => key;
const mockEntitlementRefresh = jest.fn().mockResolvedValue(undefined);

jest.mock('@/stores/auth', () => ({ useAuth: () => mockUseAuth() }));
jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => ({ isPremium: false, refresh: mockEntitlementRefresh }),
}));
jest.mock('@/stores/language', () => ({
  useTranslation: () => ({
    t: mockTranslate,
    language: 'id',
    setLanguage: jest.fn(),
  }),
}));

const mockFetchSnapshot = fetchRewardsSnapshot as jest.MockedFunction<typeof fetchRewardsSnapshot>;
const mockFetchLedger = fetchRewardsLedger as jest.MockedFunction<typeof fetchRewardsLedger>;
const mockCheckIn = claimDailyCheckIn as jest.MockedFunction<typeof claimDailyCheckIn>;
const mockRedeem = redeemReward as jest.MockedFunction<typeof redeemReward>;

const DEMO_USER = { id: 'demo-user', name: 'Demo', username: 'demo', email: 'demo@example.com' };

const ORIGINAL_DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE;

function signedIn() {
  mockUseAuth.mockReturnValue({ isAuthenticated: true, isHydrated: true, user: DEMO_USER });
}

function signedOut() {
  mockUseAuth.mockReturnValue({ isAuthenticated: false, isHydrated: true, user: null });
}

afterEach(() => {
  if (ORIGINAL_DEMO_MODE === undefined) {
    delete process.env.EXPO_PUBLIC_DEMO_MODE;
  } else {
    process.env.EXPO_PUBLIC_DEMO_MODE = ORIGINAL_DEMO_MODE;
  }
});

describe('rewards center in a demo build', () => {
  beforeEach(() => {
    process.env.EXPO_PUBLIC_DEMO_MODE = 'true';
    signedIn();
  });

  it('never calls the rewards API, even for a signed-in demo viewer', async () => {
    // The whole point of the gate. A demo build has no backend, so every
    // one of these calls is a request that can only fail.
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.view.status).not.toBe('loading'));

    expect(mockFetchSnapshot).not.toHaveBeenCalled();
    expect(mockFetchLedger).not.toHaveBeenCalled();
    expect(mockCheckIn).not.toHaveBeenCalled();
    expect(mockRedeem).not.toHaveBeenCalled();
  });

  it('shows the bounded unavailable state rather than a retryable error', async () => {
    // `error` renders a Retry button that can never succeed offline;
    // `unavailable` is the existing dead-end state with no retry.
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.view.status).toBe('unavailable'));

    expect(result.current.view).toEqual({
      status: 'unavailable',
      message: 'rewards.unavailableBody',
    });
  });

  it('settles the ledger as ready-and-empty so history can never spin forever', async () => {
    // The history sheet reads this. Left at `loading` it would show an
    // ActivityIndicator with nothing that could ever resolve it.
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.ledger.status).toBe('ready'));

    expect(result.current.ledger).toEqual({
      status: 'ready',
      entries: [],
      hasMore: false,
      isLoadingMore: false,
      loadMoreError: null,
    });
  });

  it('shows the same state signed out, so signing in never makes Rewards worse', async () => {
    // Without this, the demo's always-succeeds login is what pushes a
    // viewer from a clean "sign in to see coins" prompt into a broken
    // surface - the natural demo script producing the worst outcome.
    signedOut();

    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.view.status).toBe('unavailable'));

    expect(mockFetchSnapshot).not.toHaveBeenCalled();
  });

  it('leaves reload inert instead of re-arming a doomed request', async () => {
    const { result } = await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(result.current.view.status).toBe('unavailable'));

    result.current.reload();

    await waitFor(() => expect(result.current.view.status).toBe('unavailable'));
    expect(mockFetchSnapshot).not.toHaveBeenCalled();
  });
});

describe('rewards center outside a demo build', () => {
  // The guard against over-broad gating: a normal build must be completely
  // unaffected, or this fix would silently dark the feature everywhere.
  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_DEMO_MODE;
    signedIn();
  });

  it('still fetches the snapshot and the ledger', async () => {
    mockFetchSnapshot.mockRejectedValue(new Error('network'));
    mockFetchLedger.mockRejectedValue(new Error('network'));

    await renderHook(() => useRewardsCenter());

    await waitFor(() => expect(mockFetchSnapshot).toHaveBeenCalledTimes(1));
    expect(mockFetchLedger).toHaveBeenCalledTimes(1);
  });
});
