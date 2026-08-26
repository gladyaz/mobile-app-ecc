import { useEffect, useRef } from 'react';

import { useAppForeground } from '@/hooks/use-app-foreground';
import { ApiError } from '@/services/api/client';
import type { PerkConsumer } from '@/services/ads/ad-perk-registry';
import { registerPerkConsumer, unregisterPerkConsumer } from '@/services/ads/ad-perk-registry';
import { isDemoMode } from '@/services/demo/demo-mode';
import type { ActivePerksDto } from '@/services/rewards/rewards-dto';
import { consumePerk, fetchActivePerks } from '@/services/rewards/rewards-service';
import { useAdsStore, type AdPerkState } from '@/stores/ads-store';
import { useAuth } from '@/stores/auth';

/**
 * Mirrors the account's server-held ad perks into the ads store, and reports
 * a spent skip back to the backend.
 *
 * WHY A MIRROR RATHER THAN A FETCH ON THE AD PATH. `onVideoTransition()` is a
 * synchronous, module-level call made from the feed's viewability handler. It
 * cannot await a request, and a network round trip per video transition would
 * be both slow and wasteful. So the perk answer is fetched on the events that
 * can actually change it - sign-in, account switch, app foreground, and a
 * spend - and read from the store synchronously when an ad is due. This is
 * exactly how `isPremium` already reaches the same gate.
 *
 * THE SAFE DIRECTION IS THE DEFAULT, EVERYWHERE. Every failure path here
 * leaves `skipNextInterstitial: false` and `adFreeUntil: null`, which
 * suppresses nothing: a rewards outage means the existing ad policy runs
 * unchanged, never that ads quietly stop. The opposite default would let a
 * disabled or unreachable backend hand every viewer a free ad-free session.
 *
 * REWARDS FAILURES MUST NOT REACH PLAYBACK. Every call is wrapped and
 * swallowed. Nothing in this hook can throw into the tree, and nothing it
 * does gates a video.
 */

/**
 * Reduces a perks response to what the gate needs.
 *
 * THE TWO SIGNALS ARE COPIED, NOT DERIVED. `skipNextInterstitial` and
 * `adFreeUntil` are the server's own answers to "is a perk live right now?" -
 * re-deriving them by walking `perks[]` would be a second implementation of a
 * rule the backend owns, on the one code path where the two drifting apart
 * means showing an ad to someone who spent coins not to see one.
 *
 * The array is read for ONE thing: the id to address when spending the skip.
 * The earliest-expiring candidate is chosen so a viewer holding two spends
 * the one closer to lapsing first.
 */
export function toAdPerkState(dto: ActivePerksDto): AdPerkState {
  const skipPerk = (dto.perks ?? [])
    .filter((perk) => perk.perkType === 'SKIP_NEXT_INTERSTITIAL')
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))[0];

  const adFreeUntilMs = dto.adFreeUntil ? Date.parse(dto.adFreeUntil) : Number.NaN;

  return {
    skipNextInterstitial: dto.skipNextInterstitial === true,
    // A timestamp the device cannot parse is treated as NO pass rather than
    // as an unbounded one. `NaN > now` is false either way, but storing NaN
    // would make the store's own state unreadable to anything that logs it.
    adFreeUntil: Number.isFinite(adFreeUntilMs) ? adFreeUntilMs : null,
    skipPerkId: skipPerk?.id ?? null,
  };
}

export const NO_AD_PERKS: AdPerkState = {
  skipNextInterstitial: false,
  adFreeUntil: null,
  skipPerkId: null,
};

/**
 * Re-reads `GET /rewards/perks` and adopts the answer into the ads store.
 *
 * Module-level rather than a hook callback because the OTHER caller is the
 * Rewards Center container, which has just spent coins on a perk and needs
 * the ad gate to know about it without waiting for the next app foreground.
 * A viewer who buys an ad skip and goes straight back to the feed should get
 * the skip they paid for.
 *
 * NEVER THROWS, and never grants anything on failure: a rejected read leaves
 * whatever the store already held, and the store's own default is "no perk".
 * That is the direction that preserves the existing ad policy - the opposite
 * would let one failed request hand out a free ad-free session.
 */
export async function syncRewardAdPerks(): Promise<void> {
  try {
    const dto = await fetchActivePerks();

    useAdsStore.getState().setPerks(toAdPerkState(dto));
  } catch {
    // Deliberately silent. Rewards is not on the playback path, and a perk
    // read that failed is not a reason to interrupt anything.
  }
}

export function useRewardAdPerks(): void {
  const { isAuthenticated, isHydrated, user } = useAuth();
  const setPerks = useAdsStore((state) => state.setPerks);
  const isForeground = useAppForeground();
  const userId = user?.id ?? null;
  /**
   * Whose perks the store is currently holding.
   *
   * This exists so the clear below fires on an IDENTITY CHANGE and not on
   * every re-read. The effect also re-runs on app foreground, and clearing
   * there would drop a running ad-free pass for the length of one network
   * call - long enough for a video transition to show an interstitial the
   * viewer spent coins to avoid.
   */
  const holdingPerksForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isHydrated) {
      return;
    }

    // A guest has no wallet and therefore no perks. Clearing rather than
    // leaving the last value is what stops the PREVIOUS account's ad skip
    // from suppressing an ad for whoever signs in next - the same
    // cross-account leak the rewards container tags its own fetches to avoid.
    if (!isAuthenticated || !userId || isDemoMode()) {
      holdingPerksForRef.current = null;
      setPerks(NO_AD_PERKS);

      return;
    }

    if (holdingPerksForRef.current !== userId) {
      // A DIFFERENT ACCOUNT. Between the switch and this account's first
      // answer the honest state is "we do not know", and the safe rendering
      // of "we do not know" is no perk.
      holdingPerksForRef.current = userId;
      setPerks(NO_AD_PERKS);
    }

    let isCancelled = false;

    void (async () => {
      try {
        const dto = await fetchActivePerks();

        // The cancellation check is what keeps a slow response for the
        // PREVIOUS account from landing after a switch and handing the new
        // one a perk it never bought.
        if (!isCancelled) {
          setPerks(toAdPerkState(dto));
        }
      } catch {
        // Deliberately silent, and deliberately not a retry loop. A rewards
        // outage is not a playback problem, and the state it leaves behind -
        // no perks - is the state that preserves the existing ad policy.
      }
    })();

    return () => {
      isCancelled = true;
    };
    // `isForeground` is a dependency so returning from the WhatsApp/Instagram
    // hand-off, or from a long background, re-reads perks that may have
    // expired or been spent on another device.
  }, [isAuthenticated, isHydrated, isForeground, setPerks, userId]);

  useEffect(() => {
    if (!isHydrated || !isAuthenticated || !userId || isDemoMode()) {
      return;
    }

    const consumer: PerkConsumer = {
      consumeSkip: (perkId: string) => {
        void (async () => {
          try {
            const response = await consumePerk(perkId);

            // ADOPTED FROM THE RESPONSE, not assumed. The server returns the
            // account's remaining perks, so a viewer who held two skips still
            // has the second one after spending the first - which a blanket
            // local clear would have thrown away.
            setPerks(toAdPerkState(response.perks));
          } catch (error) {
            // The local flag is ALREADY cleared (see `consumeSkipPerk`), so
            // the failure mode here is a perk the server still believes is
            // held - never a second free skip. Re-reading settles it when the
            // perk was genuinely still live; an expired or missing one is
            // already gone on both sides and needs nothing.
            if (
              error instanceof ApiError &&
              (error.code === 'REWARD_PERK_EXPIRED' || error.code === 'REWARD_PERK_NOT_FOUND')
            ) {
              return;
            }

            try {
              setPerks(toAdPerkState(await fetchActivePerks()));
            } catch {
              // Still unreachable. The store keeps "no perk", which shows
              // ads - the safe direction, and the one a retry cannot make
              // worse.
            }
          }
        })();
      },
    };

    registerPerkConsumer(consumer);

    return () => {
      unregisterPerkConsumer(consumer);
    };
  }, [isAuthenticated, isHydrated, setPerks, userId]);
}
