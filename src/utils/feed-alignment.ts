/**
 * Series Detail -> feed episode alignment (2026-08-22 physical-QA
 * remediation).
 *
 * Selecting an episode on Series Detail returns to the Home feed with that
 * episode's video id on the route, and the feed has to bring exactly that
 * item to rest filling the viewport. The defect this module exists to
 * prevent: the target offset used to be computed against
 * `useWindowDimensions().height`, because the feed's own height had not been
 * measured yet when the scroll was issued. The tabs navigator lays its bar
 * out IN FLOW beneath this screen (see `use-feed-bottom-anchor.ts` for the
 * same geometry from the overlay's side), so the feed's page is the window
 * MINUS that bar - 1470 against a 1600 window on the reported device. Every
 * index therefore drifted 130px, and episode 6 was asked for 650px past its
 * own page: the list rested across two episodes, neither of them reaching
 * the 80% viewability threshold, so the active item stayed wherever it was.
 *
 * This is the one pure decision point behind the fix - the same shape as
 * `feed-paging.ts` for manual gestures. It decides, from data alone, whether
 * a requested episode can be aligned yet and where its page begins. It never
 * touches a FlatList, a ref or a native offset; `useRequestedVideoAlignment`
 * translates its answer into exactly one imperative scroll.
 *
 * Two rules it encodes:
 *
 *   1. The VIDEO ID is the authority. The target is `videoIds.indexOf(id)`,
 *      never anything derived from an episode number or a visual position -
 *      the backend orders the feed and an episode number is not an index.
 *   2. The page extent must have been MEASURED. `null` (or any degenerate
 *      value) yields `pending`, never a target computed from a stand-in
 *      height, because a stand-in height is the whole defect.
 */
export type ResolveRequestedAlignmentParams = {
  /** The canonical video id the route asked for, if any. */
  readonly requestedVideoId: string | undefined;
  /** The feed's video ids, in the order the feed renders them. */
  readonly videoIds: readonly string[];
  /**
   * The measured height of one feed page - the feed's own laid-out box, not
   * the window. `null` until `onLayout` has reported it.
   */
  readonly pageExtent: number | null;
};

export type RequestedAlignment =
  /** Nothing was requested; the feed is free to behave normally. */
  | { readonly status: 'none' }
  /**
   * Requested, but not yet actionable: the catalog has not arrived, or the
   * viewport has not been measured. The caller must wait rather than scroll
   * with what it has.
   */
  | {
      readonly status: 'pending';
      readonly reason: 'catalog' | 'viewport';
      readonly videoId: string;
    }
  /**
   * Requested, but absent from a catalog that HAS loaded. Deliberately a
   * terminal answer rather than an indefinite `pending`, so one unsatisfiable
   * request cannot block every later re-alignment.
   */
  | { readonly status: 'unavailable'; readonly videoId: string }
  /** Actionable: scroll to `offset` and that item fills the viewport. */
  | {
      readonly status: 'ready';
      readonly videoId: string;
      readonly index: number;
      readonly offset: number;
    };

function isMeasuredExtent(pageExtent: number | null): pageExtent is number {
  return pageExtent !== null && Number.isFinite(pageExtent) && pageExtent > 0;
}

/**
 * Decides where - and whether - the feed may align to the requested episode.
 * Pure and side-effect-free.
 */
export function resolveRequestedAlignment({
  requestedVideoId,
  videoIds,
  pageExtent,
}: ResolveRequestedAlignmentParams): RequestedAlignment {
  if (!requestedVideoId) {
    return { status: 'none' };
  }

  // An empty feed is "not loaded yet", not "the episode is missing" - the
  // catalog is fetched asynchronously and the route routinely wins that race.
  if (videoIds.length === 0) {
    return { status: 'pending', reason: 'catalog', videoId: requestedVideoId };
  }

  const index = videoIds.indexOf(requestedVideoId);

  if (index < 0) {
    return { status: 'unavailable', videoId: requestedVideoId };
  }

  if (!isMeasuredExtent(pageExtent)) {
    return { status: 'pending', reason: 'viewport', videoId: requestedVideoId };
  }

  return { status: 'ready', videoId: requestedVideoId, index, offset: index * pageExtent };
}
