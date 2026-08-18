import { createCoverRecoveryBudget } from '@/features/series/cover-recovery';

/**
 * The storm-prevention rules, tested where they live: as pure bookkeeping,
 * with no React, no fetching and no rendering in the way. Every "can this loop
 * forever?" question is decided here.
 */

const IDLE = { isFetching: false } as const;
const IN_FLIGHT = { isFetching: true } as const;

/** Shaped like the real thing: a presigned URL whose signature is opaque to us. */
const URL_A = 'https://r2.example.com/admin-series/series-104/cover/a?X-Amz-Expires=3600';
const URL_B = 'https://r2.example.com/admin-series/series-104/cover/b?X-Amz-Expires=3600';
const URL_C = 'https://r2.example.com/admin-series/series-104/cover/c?X-Amz-Expires=3600';

describe('cover recovery budget', () => {
  it('grants the first failure of a real URL exactly one refetch', () => {
    const budget = createCoverRecoveryBudget();

    expect(budget.claim(URL_A, IDLE)).toBe(true);
  });

  it('never reacts to the same URL twice, so an unchanged refetch cannot loop', () => {
    const budget = createCoverRecoveryBudget();

    // A fails -> refetch -> the backend hands back the very same A -> A fails
    // again. The second failure must buy nothing, even after a refresh has
    // replenished the budget: that refresh WAS the metadata fetch.
    expect(budget.claim(URL_A, IDLE)).toBe(true);
    budget.replenish();

    expect(budget.claim(URL_A, IDLE)).toBe(false);
  });

  it('spends only ONE attempt when four posters expire together', () => {
    const budget = createCoverRecoveryBudget();
    const fourCards = [URL_A, URL_B, URL_C, `${URL_A}&card=4`];

    const granted = fourCards.filter((url) => budget.claim(url, IDLE));

    // This is the four-card request storm, decided before any request exists.
    expect(granted).toEqual([URL_A]);
  });

  it('does not chain refetches when every reissued URL also fails', () => {
    const budget = createCoverRecoveryBudget();

    // The pathological backend: a distinct signature every time, all broken.
    // Per-URL accounting alone would refetch forever, one request per
    // rotation; the per-load budget is what stops it at one.
    expect(budget.claim(URL_A, IDLE)).toBe(true);
    expect(budget.claim(URL_B, IDLE)).toBe(false);
    expect(budget.claim(URL_C, IDLE)).toBe(false);
  });

  it('joins an in-flight request instead of starting a second one', () => {
    const budget = createCoverRecoveryBudget();

    expect(budget.claim(URL_A, IN_FLIGHT)).toBe(false);
  });

  it('keeps the attempt available after joining, since that response may not fix it', () => {
    const budget = createCoverRecoveryBudget();

    // A failed while a refresh was already on its way. That refresh delivered
    // B, which also fails - and B is still entitled to the one attempt.
    expect(budget.claim(URL_A, IN_FLIGHT)).toBe(false);

    expect(budget.claim(URL_B, IDLE)).toBe(true);
  });

  it('does not re-grant a URL first seen while the budget was empty', () => {
    const budget = createCoverRecoveryBudget();

    expect(budget.claim(URL_A, IDLE)).toBe(true);
    // Seen with no budget left: recorded, so it cannot be retried later.
    expect(budget.claim(URL_B, IDLE)).toBe(false);
    budget.replenish();

    expect(budget.claim(URL_B, IDLE)).toBe(false);
  });

  it('gives an explicit refresh a fresh attempt for artwork it has not seen', () => {
    const budget = createCoverRecoveryBudget();

    expect(budget.claim(URL_A, IDLE)).toBe(true);
    expect(budget.claim(URL_B, IDLE)).toBe(false);

    // The user pressed Retry (or the screen remounted). Admin has since
    // replaced the cover, so C is genuinely new artwork - it must not be
    // suppressed by A having failed, because failure is remembered against the
    // URL and never against the series.
    budget.replenish();

    expect(budget.claim(URL_C, IDLE)).toBe(true);
  });

  it('never spends an attempt on a missing cover', () => {
    const budget = createCoverRecoveryBudget();

    // A null coverUrl is authoritative "no artwork", not an expired URL. There
    // is nothing to refresh, and the attempt must survive for a real failure.
    expect(budget.claim('', IDLE)).toBe(false);
    expect(budget.claim('   ', IDLE)).toBe(false);

    expect(budget.claim(URL_A, IDLE)).toBe(true);
  });

  it('keeps each Series resource on its own budget', () => {
    const catalogBudget = createCoverRecoveryBudget();
    const detailBudget = createCoverRecoveryBudget();

    expect(catalogBudget.claim(URL_A, IDLE)).toBe(true);

    // Series Detail owns a separate request, so Discover having spent its
    // attempt must not silently disable detail recovery.
    expect(detailBudget.claim(URL_A, IDLE)).toBe(true);
  });
});
