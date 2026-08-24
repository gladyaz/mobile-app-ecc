import type { RewardLedgerEntry } from '@/types/rewards';

/**
 * Reconciles pages of `GET /rewards/ledger` into ONE list with unique rows.
 *
 * WHY THIS EXISTS AT ALL. `TransactionHistoryPanel` renders the history with
 * `key={entry.id}`, and React requires that key to be unique among siblings.
 * Until this module, nothing established that: `loadMoreLedger` concatenated
 * each page onto the last with `[...current.entries, ...page.entries]`, which
 * is correct only under an invariant the client asserted but never enforced -
 * "the server never sends me a row I already hold".
 *
 * That invariant is not the client's to assume, and it is not exotic to
 * break:
 *
 *  - CURSOR TIES. `docs/rewards-domain-contract.md` §4 puts the balance
 *    mutation and the ledger append in ONE transaction, so rows can share a
 *    `createdAt` to the millisecond. Any keyset cursor whose boundary is
 *    inclusive - or which orders on that instant alone - re-serves the
 *    boundary row on the next page.
 *  - LATE ROWS. `REVERSAL` entries are written by after-the-fact anomaly
 *    detection (§4), so rows appear inside a window the user already paged
 *    past, shifting everything below them.
 *  - REPLAYS. A retried GET, at any hop, is a page the client sees twice.
 *
 * WHY `id` IS THE IDENTITY, AND NOT A COMPOSITE OR AN INDEX. The ledger is
 * append-only with no updates and no deletes (§3), so `id` names exactly one
 * immutable movement, for the life of the account, across every refresh.
 * `${id}-${index}` would be worse than the bug: a row's index changes every
 * time a movement is prepended, so every row below a new entry would get a
 * fresh key, unmount, and remount - React would rebuild rows that did not
 * change, and the duplicate would still be on screen, merely no longer
 * reported.
 *
 * FIRST COPY WINS. Two rows carrying one id cannot both be true of an
 * append-only table, and the one already on screen is the one the user is
 * reading. Letting a later page overwrite it would let a re-serve silently
 * restate a movement.
 *
 * ORDER IS THE SERVER'S. Nothing here sorts. The pages arrive newest-first
 * and each continues where the last stopped; re-ordering them on this side
 * would produce a list that disagrees with the cursor that built it.
 */
export function mergeLedgerEntries(
  held: readonly RewardLedgerEntry[],
  incoming: readonly RewardLedgerEntry[]
): readonly RewardLedgerEntry[] {
  if (incoming.length === 0) {
    return held;
  }

  const seen = new Set<string>();
  const merged: RewardLedgerEntry[] = [];

  // One pass over both lists, so a page that is already held costs nothing
  // extra and `held` is itself normalised on the way through - a duplicate
  // can never survive a second merge even if one somehow entered earlier.
  for (const entry of held) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      merged.push(entry);
    }
  }

  for (const entry of incoming) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      merged.push(entry);
    }
  }

  return merged;
}

/**
 * The same rule applied to a page that REPLACES the list rather than
 * extending it (the first read, and every post-mutation head refresh).
 *
 * A single page should never contain a repeated id, so this is a boundary
 * check rather than a merge: it costs one pass and means every path into
 * `RewardsLedgerState.entries` upholds the same invariant, instead of one
 * path upholding it and the others being trusted to.
 */
export function dedupeLedgerEntries(
  entries: readonly RewardLedgerEntry[]
): readonly RewardLedgerEntry[] {
  return mergeLedgerEntries([], entries);
}
