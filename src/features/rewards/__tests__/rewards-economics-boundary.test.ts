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
import '@/features/rewards/components/transaction-history-panel';
import '@/features/rewards/components/watch-time-card';

/**
 * Architectural guardrails for the Rewards feature.
 *
 * The screen and route tests prove the UI does not invent a balance. This
 * file protects the *structure* that keeps it that way, so the guarantee
 * cannot be quietly undone by a later edit.
 *
 * Each `jest.mock` factory below is a tripwire, not a stub: the factory body
 * only runs if some module actually imports that path. Because module
 * resolution is transitive, this catches an indirect dependency (component
 * -> helper -> rewards service) that a source-text grep would miss.
 *
 * WHAT CHANGED NOW THAT REWARDS IS LIVE. The old tripwire on
 * `rewards-fixtures` is gone because that module is gone - the fixture set
 * was deleted outright rather than left importable, which is a stronger
 * guarantee than a test that it stays unimported. In its place are wires on
 * the modules that CAN now move a balance: the `/rewards/*` client, the
 * container hook, and the DTO mapper. A presentational component that
 * imported any of them could fetch, claim or redeem on its own, which is
 * precisely the arrangement this split exists to prevent.
 *
 * The screen and the route are deliberately NOT imported here - the route is
 * the one module allowed to hold the container, and importing it would trip
 * the wires by design.
 */

const mockRewardsServiceImported = jest.fn();
const mockRewardsMapperImported = jest.fn();
const mockRewardsContainerImported = jest.fn();
const mockEntitlementStoreImported = jest.fn();
const mockEntitlementServiceImported = jest.fn();
const mockApiClientImported = jest.fn();
const mockAuthStoreImported = jest.fn();
const mockAdGateImported = jest.fn();
const mockAdsSdkImported = jest.fn();
const mockRouterImported = jest.fn();

jest.mock('@/services/rewards/rewards-service', () => {
  mockRewardsServiceImported();
  return {};
});

jest.mock('@/features/rewards/rewards-mapper', () => {
  mockRewardsMapperImported();
  return {};
});

jest.mock('@/features/rewards/use-rewards-center', () => {
  mockRewardsContainerImported();
  return {};
});

jest.mock('@/services/api/client', () => {
  mockApiClientImported();
  return {};
});

jest.mock('@/stores/auth', () => {
  mockAuthStoreImported();
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

/**
 * There is deliberately NO import tripwire for AsyncStorage or
 * `@/services/storage/local-storage` here, and the omission is not an
 * oversight: the rewards components import `useTranslation` from
 * `@/stores/language`, which legitimately persists the chosen language, so
 * both modules are genuinely in this graph. An import-shaped assertion
 * cannot separate "persisted the locale" from "persisted a streak".
 *
 * The prohibition that matters - no CTA may persist anything - is asserted
 * behaviourally instead, in `rewards-center-screen.test.tsx`: every CTA is
 * pressed and `AsyncStorage.setItem` must not be called.
 */

describe('rewards economics boundary', () => {
  it('gives the presentational components no way to read or move a balance', () => {
    // A component that could call the rewards API could claim, redeem, or
    // refresh a wallet on its own - and would then own economics that
    // belong to the server. Numbers arrive as props only.
    expect(mockRewardsServiceImported).not.toHaveBeenCalled();
    expect(mockApiClientImported).not.toHaveBeenCalled();
  });

  it('keeps the container and the wire-format mapper out of the components', () => {
    // The mapper is where DTOs become view models. A component holding it
    // could render a raw server payload the screen never validated, and a
    // component holding the container could fetch during render.
    expect(mockRewardsMapperImported).not.toHaveBeenCalled();
    expect(mockRewardsContainerImported).not.toHaveBeenCalled();
  });

  it('gives the rewards components no path to the entitlement system', () => {
    // Redemption grants premium in the same server transaction as the
    // debit. A component that could reach the entitlement store could
    // create a SECOND premium authority, and "am I premium?" would start
    // depending on which screen asked.
    expect(mockEntitlementStoreImported).not.toHaveBeenCalled();
    expect(mockEntitlementServiceImported).not.toHaveBeenCalled();
  });

  it('gives the rewards components no path to the auth session', () => {
    // Rewards routes are authenticated, but the components must not be the
    // ones deciding who is signed in - that is the container's job, and a
    // component reading the session could render one user's balance to
    // another during an account switch.
    expect(mockAuthStoreImported).not.toHaveBeenCalled();
  });

  it('gives the rewards components no path to the ads SDK or ad gate', () => {
    // The rewarded-ad task is served UNCLAIMABLE. A component that could
    // start an ad would be building the earn path the backend refuses to
    // pay, because it cannot verify an ad completed.
    expect(mockAdGateImported).not.toHaveBeenCalled();
    expect(mockAdsSdkImported).not.toHaveBeenCalled();
  });

  it('keeps the rewards components navigation-agnostic', () => {
    // The screen takes callbacks rather than driving the router, so this
    // feature cannot affect root/bottom navigation.
    expect(mockRouterImported).not.toHaveBeenCalled();
  });
});

describe('rewards fixture removal', () => {
  it('no longer ships a fixture snapshot module at all', () => {
    // The strongest form of "no fixture runtime fallback": the module the
    // screen used to fall back to does not exist. Resolved at RUNTIME rather
    // than imported, because a missing module has to be an observable
    // resolution failure here, not a compile error that stops this file from
    // building at all.
    expect(() => jest.requireActual('@/features/rewards/rewards-fixtures')).toThrow();
  });
});
