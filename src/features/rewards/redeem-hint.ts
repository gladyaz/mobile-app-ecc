import type { RewardRedemption } from '@/types/rewards';

/**
 * What the balance hero may truthfully say a balance is WORTH.
 *
 * The reference design puts a value hint beside the balance ("~4 premium
 * episodes"). This app cannot say that: the backend serves VIP access by
 * DURATION (`grantsDays`) and has no episodes-per-point rate to convert
 * from, so an episode count would be a number the product invented to fill
 * a pill. What it can say is what the SERVER already decided - which offers
 * this account can redeem right now - so that is what this selector returns.
 *
 * EVERY INPUT IS SERVER-OWNED AND NOTHING IS RECOMPUTED HERE:
 *   - `isRedeemSupported` gates the whole list; an offer the backend has not
 *     enabled cannot be advertised as something the balance buys.
 *   - `availability` is affordability, decided against the SERVER's own
 *     balance. This function never compares a cost against the number in the
 *     hero, which is exactly the divergence that would let a stale balance
 *     promise a redemption the backend is about to refuse.
 *
 * Returning `null` is a real outcome, not a failure: a deployment with no
 * supported offers gets no hint rather than an invented one.
 */
export type RedeemHint =
  /** At least one offer is redeemable now; this is the longest of them. */
  | { readonly kind: 'AFFORDABLE'; readonly title: string; readonly grantsDays: number }
  /** Nothing is redeemable yet; this is the cheapest thing to aim for. */
  | { readonly kind: 'CHEAPEST'; readonly costPoints: number }
  | null;

export function selectRedeemHint(redemptions: readonly RewardRedemption[]): RedeemHint {
  const supported = redemptions.filter((offer) => offer.isRedeemSupported);

  if (supported.length === 0) {
    return null;
  }

  const affordable = supported.filter((offer) => offer.availability === 'AVAILABLE');

  if (affordable.length > 0) {
    // The BEST thing the balance already buys, not merely the first one in
    // the list: a user with 5.000 points should read "enough for VIP 7 days",
    // not "enough for VIP 1 day".
    const best = affordable.reduce((longest, offer) =>
      offer.grantsDays > longest.grantsDays ? offer : longest
    );

    return { kind: 'AFFORDABLE', title: best.title, grantsDays: best.grantsDays };
  }

  // Deliberately the offer's own cost, NOT "you need N more points". The
  // shortfall would be arithmetic this client performed on a balance it does
  // not own, and it would be wrong the moment the wallet moves.
  const cheapest = supported.reduce((lowest, offer) =>
    offer.costPoints < lowest.costPoints ? offer : lowest
  );

  return { kind: 'CHEAPEST', costPoints: cheapest.costPoints };
}
