import { mergeLedgerEntries } from '@/features/rewards/ledger-merge';
import type { RewardLedgerEntry } from '@/types/rewards';

/**
 * The ledger's IDENTITY RULE, on its own.
 *
 * `RewardLedgerEntry.id` is server-generated over an append-only table with
 * no updates and no deletes (`docs/rewards-domain-contract.md` §3), so it is
 * the one value that names a movement, survives a refresh, and cannot be
 * re-issued for a different row. That makes it the React key - and makes
 * "two rows with this id" a contradiction rather than a rendering quirk.
 *
 * This module is where that contradiction is resolved, so the rest of the
 * app may assume it never happens.
 */

function entry(id: string, createdAt: string, deltaPoints = 10): RewardLedgerEntry {
  return {
    id,
    deltaPoints,
    reason: 'DAILY_CHECK_IN',
    balanceAfter: 100,
    createdAt,
    createdAtLabel: createdAt,
  };
}

const LED_3 = entry('led_3', '2026-08-22T03:00:00.000Z');
const LED_2 = entry('led_2', '2026-08-22T02:00:00.000Z');
const LED_1 = entry('led_1', '2026-08-22T01:00:00.000Z');

describe('mergeLedgerEntries', () => {
  it('appends a page that shares no row with what is already held', () => {
    expect(mergeLedgerEntries([LED_3, LED_2], [LED_1]).map((row) => row.id)).toEqual([
      'led_3',
      'led_2',
      'led_1',
    ]);
  });

  it('drops a row the list already holds instead of rendering it twice', () => {
    // The keyset-overlap case: two entries written in ONE transaction share a
    // `createdAt`, so a cursor over that instant re-serves the boundary row.
    const merged = mergeLedgerEntries([LED_3, LED_2], [LED_2, LED_1]);

    expect(merged.map((row) => row.id)).toEqual(['led_3', 'led_2', 'led_1']);
  });

  it('keeps the row already on screen when the server re-sends it', () => {
    // Append-only means the first copy is the true one. Replacing it would
    // let a re-serve rewrite a row the user is reading.
    const restated = entry('led_2', '2026-08-22T02:00:00.000Z', 999);
    const merged = mergeLedgerEntries([LED_3, LED_2], [restated, LED_1]);

    expect(merged[1]).toBe(LED_2);
    expect(merged[1].deltaPoints).toBe(10);
  });

  it('de-duplicates WITHIN a single page as well as across pages', () => {
    expect(mergeLedgerEntries([], [LED_2, LED_2, LED_1]).map((row) => row.id)).toEqual([
      'led_2',
      'led_1',
    ]);
  });

  it('is idempotent - merging the same page twice changes nothing', () => {
    const once = mergeLedgerEntries([LED_3], [LED_2, LED_1]);
    const twice = mergeLedgerEntries(once, [LED_2, LED_1]);

    expect(twice.map((row) => row.id)).toEqual(once.map((row) => row.id));
  });

  it('yields a list whose ids are unique, whatever it was given', () => {
    const merged = mergeLedgerEntries([LED_3, LED_3, LED_2], [LED_2, LED_1, LED_1]);
    const ids = merged.map((row) => row.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('preserves the server’s order rather than re-sorting', () => {
    // Ordering is the server's answer; a client that re-sorted by `createdAt`
    // would disagree with the cursor that produced the page.
    const merged = mergeLedgerEntries([LED_1], [LED_3, LED_2]);

    expect(merged.map((row) => row.id)).toEqual(['led_1', 'led_3', 'led_2']);
  });

  it('does not mutate either input', () => {
    const held = [LED_3, LED_2];
    const incoming = [LED_2, LED_1];

    mergeLedgerEntries(held, incoming);

    expect(held.map((row) => row.id)).toEqual(['led_3', 'led_2']);
    expect(incoming.map((row) => row.id)).toEqual(['led_2', 'led_1']);
  });

  it('returns the held list unchanged when the incoming page is empty', () => {
    expect(mergeLedgerEntries([LED_3], []).map((row) => row.id)).toEqual(['led_3']);
  });
});
