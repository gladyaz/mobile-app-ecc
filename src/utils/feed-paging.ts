/**
 * Issue 2 (11R physical-QA remediation): the Home feed's vertical FlatList
 * pages by whole items (`pagingEnabled` + `snapToInterval={feedHeight}`), but
 * `disableIntervalMomentum` alone does not GUARANTEE the platform never
 * settles more than one item away from where a continuous gesture started -
 * a high-velocity flick can still hand the native scroller a target offset
 * two or more items past the start, especially once the JS thread is busy
 * (e.g. mounting/unmounting the newly (in)active `DramaFeedItem`).
 *
 * This is the one deterministic, pure decision point that turns "wherever
 * the platform proposed landing" into "at most one item away from wherever
 * the gesture began" - the contract this file exists to guarantee is:
 * `abs(resolveGestureTargetIndex(...) - startIndex) <= 1`, always, for any
 * finite input. The caller (see `useFeedPagingGuard`) is responsible for
 * capturing `startIndex` once per gesture and issuing a corrective scroll
 * when the resolved index disagrees with where the platform actually landed.
 */
export type ResolveGestureTargetIndexParams = {
  /** The item index the FlatList was resting on when this gesture began. */
  readonly startIndex: number;
  /**
   * The scroll offset (in the same units as `itemHeight`) the gesture is
   * proposing to land on - either the platform's own settled
   * `contentOffset.y` (from `onMomentumScrollEnd`) or a predicted
   * `targetContentOffset.y` (from `onScrollEndDrag`).
   */
  readonly targetOffsetY: number;
  /** Height of one feed item. Must be a positive, finite number to derive a
   * proposed index from `targetOffsetY` at all. */
  readonly itemHeight: number;
  /** Total number of items currently in the feed. */
  readonly itemCount: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamps a proposed landing index to at most one item away from
 * `startIndex`, and always within `[0, itemCount - 1]`. Pure and
 * side-effect-free: it never touches a FlatList, ref, or native offset -
 * callers translate its return value into an imperative correction.
 */
export function resolveGestureTargetIndex({
  startIndex,
  targetOffsetY,
  itemHeight,
  itemCount,
}: ResolveGestureTargetIndexParams): number {
  if (itemCount <= 0) {
    return 0;
  }

  const maxIndex = itemCount - 1;
  const clampedStartIndex = clamp(Math.round(startIndex), 0, maxIndex);

  // A degenerate height carries no reliable information about where
  // `targetOffsetY` actually points - staying put is the only safe answer,
  // rather than guessing (and potentially producing a huge, garbage index
  // from dividing by a near-zero height).
  if (!Number.isFinite(itemHeight) || itemHeight <= 0) {
    return clampedStartIndex;
  }

  const lowerBound = Math.max(clampedStartIndex - 1, 0);
  const upperBound = Math.min(clampedStartIndex + 1, maxIndex);
  const proposedIndex = Number.isFinite(targetOffsetY)
    ? Math.round(targetOffsetY / itemHeight)
    : clampedStartIndex;

  return clamp(proposedIndex, lowerBound, upperBound);
}
