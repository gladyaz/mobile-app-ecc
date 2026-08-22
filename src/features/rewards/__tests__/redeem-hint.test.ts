import { selectRedeemHint } from '@/features/rewards/redeem-hint';
import type { RewardRedemption } from '@/types/rewards';

/**
 * The hero's value hint is the one place the redesign was asked to
 * "approximate Premium value", and the reference sentence ("~4 premium
 * episodes") is one this backend cannot support: it sells VIP by DAYS and
 * publishes no episodes-per-coin rate. These cases pin what the selector may
 * say instead, and - just as importantly - what it must refuse to say.
 */

function offer(overrides: Partial<RewardRedemption> = {}): RewardRedemption {
  return {
    id: 'uji_offer',
    title: 'VIP Uji',
    description: 'Deskripsi uji',
    costPoints: 1234,
    grantsDays: 1,
    availability: 'AVAILABLE',
    ctaLabel: 'Tukar Uji',
    isRedeemSupported: true,
    ...overrides,
  };
}

describe('selectRedeemHint', () => {
  it('says nothing at all when the catalog is empty', () => {
    // No offers means no truthful statement about what a balance buys.
    expect(selectRedeemHint([])).toBeNull();
  });

  it('says nothing when no offer is supported yet', () => {
    // An offer the backend has not enabled cannot be advertised as something
    // this balance already buys.
    expect(
      selectRedeemHint([offer({ isRedeemSupported: false }), offer({ id: 'b', isRedeemSupported: false })])
    ).toBeNull();
  });

  it('names the LONGEST offer the server already calls affordable', () => {
    // Not merely the first affordable one: a balance that covers seven days
    // should read as covering seven days.
    const hint = selectRedeemHint([
      offer({ id: 'd1', title: 'VIP 1 Uji', grantsDays: 1, costPoints: 1000 }),
      offer({ id: 'd7', title: 'VIP 7 Uji', grantsDays: 7, costPoints: 5000 }),
      offer({ id: 'd3', title: 'VIP 3 Uji', grantsDays: 3, costPoints: 2500 }),
    ]);

    expect(hint).toEqual({ kind: 'AFFORDABLE', title: 'VIP 7 Uji', grantsDays: 7 });
  });

  it('ignores an unsupported offer even when the server calls it affordable', () => {
    const hint = selectRedeemHint([
      offer({ id: 'live', title: 'VIP Live Uji', grantsDays: 1, costPoints: 1000 }),
      offer({ id: 'dark', title: 'VIP Dark Uji', grantsDays: 30, costPoints: 900, isRedeemSupported: false }),
    ]);

    expect(hint).toEqual({ kind: 'AFFORDABLE', title: 'VIP Live Uji', grantsDays: 1 });
  });

  it('falls back to the cheapest supported cost when nothing is affordable', () => {
    const hint = selectRedeemHint([
      offer({ id: 'a', costPoints: 5000, availability: 'INSUFFICIENT_POINTS' }),
      offer({ id: 'b', costPoints: 1000, availability: 'INSUFFICIENT_POINTS' }),
      offer({ id: 'c', costPoints: 2500, availability: 'COMING_SOON' }),
    ]);

    expect(hint).toEqual({ kind: 'CHEAPEST', costPoints: 1000 });
  });

  it('reports a cost the server sent, never a shortfall it computed', () => {
    // "You need 758 more coins" would be arithmetic this client performed
    // against a balance it does not own, and it would be wrong the moment the
    // wallet moves. The shape has no field for one.
    const hint = selectRedeemHint([offer({ costPoints: 4242, availability: 'INSUFFICIENT_POINTS' })]);

    expect(hint).toEqual({ kind: 'CHEAPEST', costPoints: 4242 });
    expect(Object.keys(hint ?? {}).sort()).toEqual(['costPoints', 'kind']);
  });

  it('treats COMING_SOON as not-yet-affordable rather than as available', () => {
    const hint = selectRedeemHint([offer({ availability: 'COMING_SOON', costPoints: 777 })]);

    expect(hint).toEqual({ kind: 'CHEAPEST', costPoints: 777 });
  });

  it('never mutates or reorders the catalog it was handed', () => {
    const catalog = [
      offer({ id: 'a', grantsDays: 1 }),
      offer({ id: 'b', grantsDays: 7 }),
    ];
    const snapshot = JSON.parse(JSON.stringify(catalog));

    selectRedeemHint(catalog);

    expect(catalog).toEqual(snapshot);
  });
});
