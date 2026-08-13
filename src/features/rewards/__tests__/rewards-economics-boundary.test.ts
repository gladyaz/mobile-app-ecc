// Side-effect imports: loading each presentational module is the whole
// point of this file. If any of them reaches for a module it must not
// depend on, the corresponding tripwire below fires at import time.
import '@/features/rewards/components/daily-check-in-card';
import '@/features/rewards/components/earn-panel';
import '@/features/rewards/components/points-balance-card';
import '@/features/rewards/components/redeem-card';
import '@/features/rewards/components/redeem-panel';
import '@/features/rewards/components/reward-task-card';
import '@/features/rewards/components/rewards-primitives';
import '@/features/rewards/components/watch-time-card';

/**
 * Architectural guardrails for the Rewards foundation.
 *
 * The screen tests prove the UI does not pay out today. This file protects
 * the *structure* that keeps it that way, so the guarantee cannot be
 * quietly undone by a later edit.
 *
 * Each `jest.mock` factory below is a tripwire, not a stub: the factory
 * body only runs if some module actually imports that path. Because module
 * resolution is transitive, this catches an indirect dependency (component
 * -> helper -> entitlement store) that a source-text grep would miss.
 *
 * Note the screen itself is deliberately NOT imported here - it is the one
 * module allowed to import the fixtures, and doing so would trip the first
 * wire. That the screen does read the fixtures is covered by the
 * "falls back to the clearly-labelled fixture snapshot" case in
 * `rewards-center-screen.test.tsx`.
 */

const mockFixturesImported = jest.fn();
const mockEntitlementStoreImported = jest.fn();
const mockEntitlementServiceImported = jest.fn();
const mockAdGateImported = jest.fn();
const mockAdsSdkImported = jest.fn();
const mockRouterImported = jest.fn();

jest.mock('@/features/rewards/rewards-fixtures', () => {
  mockFixturesImported();
  return {};
});

jest.mock('@/stores/entitlement', () => {
  mockEntitlementStoreImported();
  return {};
});

jest.mock('@/services/entitlement/entitlement-service', () => {
  mockEntitlementServiceImported();
  return {};
});

jest.mock('@/services/ads/ad-gate', () => {
  mockAdGateImported();
  return {};
});

jest.mock('react-native-google-mobile-ads', () => {
  mockAdsSdkImported();
  return {};
});

jest.mock('expo-router', () => {
  mockRouterImported();
  return {};
});

describe('rewards economics boundary', () => {
  it('keeps every economic value out of the presentational components', () => {
    // A component importing the fixtures would be re-introducing hardcoded
    // reward values through the back door. Numbers arrive as props only.
    expect(mockFixturesImported).not.toHaveBeenCalled();
  });
});

describe('rewards scope boundary', () => {
  it('gives the rewards components no path to the entitlement system', () => {
    expect(mockEntitlementStoreImported).not.toHaveBeenCalled();
    expect(mockEntitlementServiceImported).not.toHaveBeenCalled();
  });

  it('gives the rewards components no path to the ads SDK or ad gate', () => {
    expect(mockAdGateImported).not.toHaveBeenCalled();
    expect(mockAdsSdkImported).not.toHaveBeenCalled();
  });

  it('keeps the rewards components navigation-agnostic', () => {
    // The screen takes an `onClose` callback rather than driving the
    // router, so this slice cannot affect root/bottom navigation.
    expect(mockRouterImported).not.toHaveBeenCalled();
  });
});

describe('rewards fixtures', () => {
  // `requireActual` bypasses the tripwire above on purpose: these cases
  // assert on the real placeholder data.
  const { FIXTURE_REWARDS_SNAPSHOT } = jest.requireActual<
    typeof import('@/features/rewards/rewards-fixtures')
  >('@/features/rewards/rewards-fixtures');

  it('marks the placeholder wallet as not server-authoritative', () => {
    expect(FIXTURE_REWARDS_SNAPSHOT.wallet.isServerAuthoritative).toBe(false);
  });

  it('ships every task with claiming switched off', () => {
    const claimable = FIXTURE_REWARDS_SNAPSHOT.tasks.filter((task) => task.isClaimSupported);

    expect(claimable).toEqual([]);
  });

  it('ships every redemption with redeeming switched off', () => {
    const redeemable = FIXTURE_REWARDS_SNAPSHOT.redemptions.filter(
      (redemption) => redemption.isRedeemSupported
    );

    expect(redeemable).toEqual([]);
  });

  it('ships check-in and watch-time as unclaimable placeholder data', () => {
    expect(FIXTURE_REWARDS_SNAPSHOT.dailyCheckIn?.isClaimSupported).toBe(false);
    expect(FIXTURE_REWARDS_SNAPSHOT.watchTime?.isClaimSupported).toBe(false);
    // A local timer must never be able to claim it produced this number.
    expect(FIXTURE_REWARDS_SNAPSHOT.watchTime?.source).toBe('PLACEHOLDER');
  });
});
