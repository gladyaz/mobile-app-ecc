/**
 * THE V1 PRODUCT CONTRACT, PINNED IN ONE PLACE.
 *
 * Red Panda V1 is: FREE CONTENT + ADS + REWARDS, signed in with GOOGLE or
 * WHATSAPP, played over HLS - and NO payment, NO subscription, NO premium
 * paywall, NO coin purchase.
 *
 * ## What this suite is for, given the preflight already exists
 *
 * `scripts/check-release-android.js` grades BUILD CONFIGURATION: env values,
 * signing, ad ids, the presence of a route file. It is thorough and this
 * suite deliberately re-runs NONE of it - a second copy of those rules would
 * be one more thing to keep in step, and a stale one at that.
 *
 * What the preflight cannot see is the WIRE side: that this app still parses
 * a Google session, still calls the real OTP endpoints, still renders the
 * three social platforms V1 asked for, still plays an HLS master, and still
 * withholds every premium offer. A mobile change can satisfy every preflight
 * check and still contradict the backend release contract - and that is the
 * failure this file catches.
 *
 * The manifest names the backend's own requirement ids so the two halves of
 * one release can be diffed by a person in seconds, WITHOUT this repository
 * importing anything from the backend checkout.
 */
import { isPremiumExperienceEnabled } from '@/services/config/v1-scope';
import { mapRewardsSnapshot } from '@/features/rewards/rewards-mapper';
import { BACKEND_REFERENCE } from '@/services/contract/fixtures/provenance';
import {
  HLS_FULL_LADDER,
  MP4_LOCAL_FREE,
} from '@/services/contract/fixtures/playback-fixtures';
import { REWARDS_SNAPSHOT } from '@/services/contract/fixtures/rewards-fixtures';
import {
  V1_AUTH_ENDPOINTS,
  V1_FEATURE_POLICY,
  V1_FORBIDDEN_FEATURES,
  V1_REQUIRED_FEATURES,
  V1_REQUIRED_SOCIAL_PLATFORMS,
  V1_REWARDS_ENDPOINTS,
} from '@/services/contract/v1-contract-manifest';
import { isHlsPlaybackEnabled } from '@/services/videos/hls-playback-flag';
import type { Translate } from '@/stores/language';

const t = ((key: string) => key) as unknown as Translate;

describe('the V1 feature policy is stated completely and unambiguously', () => {
  it('names each feature once, with a posture and a real consequence', () => {
    const features = V1_FEATURE_POLICY.map((entry) => entry.feature);

    expect(new Set(features).size).toBe(features.length);
    V1_FEATURE_POLICY.forEach((entry) => {
      expect(['REQUIRED', 'OPTIONAL', 'OFF']).toContain(entry.posture);
      // A consequence short enough to be generic is how a policy table stops
      // meaning anything.
      expect(entry.consequence.length).toBeGreaterThan(60);
    });
  });

  it('REQUIRES Google Login, WhatsApp Login, Rewards, HLS and the free posture', () => {
    expect(V1_REQUIRED_FEATURES).toEqual([
      'Google Login',
      'WhatsApp Login',
      'Rewards',
      'HLS playback',
      'Free content posture',
    ]);
  });

  it('switches payment, subscription, paywall and coin purchase OFF', () => {
    expect(V1_FORBIDDEN_FEATURES).toEqual([
      'Payments',
      'Subscription',
      'Premium paywall',
      'Coin purchase',
    ]);
  });

  it('cites the backend requirement id wherever the backend gate has a matching rule', () => {
    const cited = V1_FEATURE_POLICY.filter((entry) => entry.backendContractId !== null).map(
      (entry) => entry.backendContractId
    );

    // These four are the ids in the backend's own `V1_FEATURE_CONTRACT`. A
    // rename on either side should be noticed by a human reading a diff,
    // which is what the citation is for.
    expect(cited).toEqual([
      'google-login',
      'whatsapp-login',
      'rewards',
      'free-catalog',
      'payments-disabled',
    ]);
  });

  it('records which backend commit the whole contract was reconciled against', () => {
    // Evidence, not a dependency: no test in this repository reads a path in
    // the backend checkout, and none may start.
    expect(BACKEND_REFERENCE.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(BACKEND_REFERENCE.branch.length).toBeGreaterThan(0);
    expect(BACKEND_REFERENCE.reconciledOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('every REQUIRED V1 capability is actually wired on the wire side', () => {
  it('Google Login: the app has a real route to exchange an ID token for a session', () => {
    const google = V1_AUTH_ENDPOINTS.find((endpoint) => endpoint.path === 'auth/google');

    expect(google).toBeDefined();
    expect(google?.requiredResponseFields).toEqual(
      expect.arrayContaining(['accessToken', 'refreshToken'])
    );
  });

  it('WhatsApp Login: both halves of the OTP flow are real, separate routes', () => {
    const paths = V1_AUTH_ENDPOINTS.map((endpoint) => endpoint.path);

    expect(paths).toContain('auth/whatsapp/otp/request');
    expect(paths).toContain('auth/whatsapp/otp/verify');
  });

  it('Rewards: the snapshot, the earn routes and the spend routes are all declared', () => {
    const paths = V1_REWARDS_ENDPOINTS.map((endpoint) => endpoint.path);

    expect(paths).toContain('rewards/snapshot');
    expect(paths).toContain('rewards/check-in');
    expect(paths).toContain('rewards/missions/:missionId/claim');
    expect(paths).toContain('rewards/redemptions');
    expect(paths).toContain('rewards/perks/:perkId/consume');
  });

  it('Rewards: the canonical snapshot renders an earn loop AND a spend loop', () => {
    const snapshot = mapRewardsSnapshot(REWARDS_SNAPSHOT, t);

    expect(snapshot.tasks.length).toBeGreaterThan(0);
    expect(snapshot.redemptions.length).toBeGreaterThan(0);
    expect(snapshot.wallet.isServerAuthoritative).toBe(true);
  });

  it('Rewards: all three V1 social platforms reach the rendered Rewards Center', () => {
    const snapshot = mapRewardsSnapshot(REWARDS_SNAPSHOT, t);
    const platforms = snapshot.tasks.map((task) => task.socialPlatform);

    V1_REQUIRED_SOCIAL_PLATFORMS.forEach((platform) =>
      expect(platforms).toContain(platform)
    );
  });

  it('HLS: the discriminated union carries a master playlist and a rendition ladder', () => {
    expect(HLS_FULL_LADDER.type).toBe('hls');
    expect(HLS_FULL_LADDER.masterUrl).toMatch(/master\.m3u8$/);
    expect(HLS_FULL_LADDER.renditions.length).toBeGreaterThanOrEqual(2);
  });

  it('HLS: the kill switch is OFF by default, so a default build plays HLS', () => {
    // A kill switch, not a fallback. `hls-playback-flag.ts` reads an env var
    // that a V1 release must leave unset.
    expect(isHlsPlaybackEnabled()).toBe(true);
  });

  it('Free posture: a free row needs no bearer token to play', () => {
    expect(MP4_LOCAL_FREE.requiresAuthHeader).toBe(false);
  });
});

describe('every FORBIDDEN V1 capability is actually withheld', () => {
  it('the premium experience is OFF unless a build opts in explicitly', () => {
    // One switch the whole app reads. The premium ARCHITECTURE stays as
    // working code for V1.1/V2; this gates only what a viewer can SEE.
    expect(isPremiumExperienceEnabled()).toBe(false);
  });

  it('no premium-granting offer reaches the rendered catalog', () => {
    const snapshot = mapRewardsSnapshot(REWARDS_SNAPSHOT, t);

    expect(snapshot.redemptions.every((offer) => offer.kind === 'AD_PERK')).toBe(true);
    expect(snapshot.redemptions.every((offer) => offer.grantsDays <= 0)).toBe(true);
  });

  it('declares no purchase, checkout, subscription or coin-top-up endpoint anywhere', () => {
    const allPaths = [...V1_AUTH_ENDPOINTS, ...V1_REWARDS_ENDPOINTS].map(
      (endpoint) => endpoint.path
    );

    // A structural boundary, not a flag: V1 ships no payment rail at all, so
    // there is no route for one to hide behind.
    allPaths.forEach((path) => {
      expect(path).not.toMatch(/payment|checkout|subscription|billing|purchase|coins?\/buy/i);
    });
  });

  it('spends coins only on ad perks - the one coin utility V1 actually ships', () => {
    const spendRoutes = V1_REWARDS_ENDPOINTS.filter((endpoint) =>
      endpoint.path.includes('redemptions')
    );

    expect(spendRoutes).toHaveLength(1);
    // The receipt carries a perk, and `entitlementExpiresAt` is the field a
    // premium grant would arrive in.
    expect(spendRoutes[0].requiredResponseFields).toContain('perk');
    expect(spendRoutes[0].requiredResponseFields).not.toContain('entitlementExpiresAt');
  });
});
