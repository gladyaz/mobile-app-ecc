import { useCallback, useRef } from 'react';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { resolveGestureTargetIndex } from '@/utils/feed-paging';

export type UseFeedPagingGuardParams<ItemT> = {
  /** The same ref passed to the FlatList's own `ref` prop. */
  readonly flatListRef: React.RefObject<FlatList<ItemT> | null>;
  /** Must match the FlatList's `snapToInterval` / `getItemLayout` height. */
  readonly itemHeight: number;
  readonly itemCount: number;
};

export type FeedPagingGuardHandlers = {
  readonly onScrollBeginDrag: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
  readonly onMomentumScrollEnd: (event: NativeSyntheticEvent<NativeScrollEvent>) => void;
};

type OpenGesture = {
  /** The item index this gesture is measured FROM. */
  readonly startIndex: number;
  /**
   * `itemHeight` as of THIS gesture's `onScrollBeginDrag` - captured once and
   * reused for every computation tied to this gesture (see Issue 2 fix-up
   * below), so a `feedHeight` re-measurement mid-gesture can never mix units
   * between a gesture's start and its landing.
   */
  readonly itemHeight: number;
  /**
   * `true` from `onScrollBeginDrag` until this gesture's own
   * `onMomentumScrollEnd` has been observed. RN iOS's `RCTScrollView` only
   * fires `onMomentumScrollEnd` from `didEndDecelerating` /
   * `didEndScrollingAnimation` / `didMoveToWindow` - NOT when a new touch
   * interrupts an in-flight deceleration - so a second `onScrollBeginDrag`
   * can legitimately arrive while this is still `true`.
   */
  readonly isOpen: boolean;
};

/**
 * Issue 2 (11R physical-QA remediation): enforces the feed's paging
 * contract - a single continuous swipe/flick may move the active index by at
 * most ±1 from wherever it started, at any velocity. `disableIntervalMomentum`
 * on the FlatList is the right platform primitive, but is not itself a
 * guarantee (see `feed-paging.ts`), so this hook adds a deterministic,
 * corrective backstop:
 *
 *   1. `onScrollBeginDrag` records the index the gesture is starting FROM,
 *      derived from the current offset - not from whatever the last
 *      corrective scroll requested, so a gesture that starts mid-correction
 *      still measures from where the list visually is. If the PREVIOUS
 *      gesture never reached its own `onMomentumScrollEnd` (a new touch
 *      interrupted its momentum - see `OpenGesture.isOpen`), that previous
 *      gesture is first resolved to its own clamped landing - using the
 *      `itemHeight` captured for THAT gesture - and the new gesture's start
 *      index is that clamped value, never a raw `Math.round` of the
 *      mid-flight offset. This is what keeps a chain of N interrupting
 *      touches capped at N indexes total, instead of letting one touch's
 *      still-unresolved momentum hand the next touch an already-overshot
 *      baseline.
 *   2. `onMomentumScrollEnd` (fired once per gesture, after native paging /
 *      momentum has fully settled - including a snap the platform performed
 *      on its own) compares where the list actually landed against
 *      `resolveGestureTargetIndex`'s clamp of that same landing, both
 *      computed with the `itemHeight` captured at this gesture's own
 *      `onScrollBeginDrag`. A landing that already agrees needs no
 *      correction, which is the common case and keeps this a no-op
 *      scroll-wise. A landing that overshot issues one corrective,
 *      non-animated `scrollToOffset` to the clamped index - a real scroll, so
 *      the FlatList's own viewability tracking (and this screen's
 *      `onViewableItemsChanged` → active-index derivation) reruns against the
 *      corrected position exactly the way it would for any other scroll,
 *      rather than needing a second, parallel "set active index" path.
 */
export function useFeedPagingGuard<ItemT>({
  flatListRef,
  itemHeight,
  itemCount,
}: UseFeedPagingGuardParams<ItemT>): FeedPagingGuardHandlers {
  const gestureRef = useRef<OpenGesture>({ startIndex: 0, itemHeight, isOpen: false });

  const onScrollBeginDrag = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!Number.isFinite(itemHeight) || itemHeight <= 0) {
        return;
      }

      const offsetY = event.nativeEvent.contentOffset.y;
      const previous = gestureRef.current;

      // The previous gesture is still "open" - its own momentum-end never
      // fired because this touch interrupted it. Resolve where THAT gesture
      // would have clamped to (using its own captured itemHeight) and start
      // the new gesture from there, rather than rounding this mid-flight
      // offset directly.
      const startIndex =
        previous.isOpen && Number.isFinite(previous.itemHeight) && previous.itemHeight > 0
          ? resolveGestureTargetIndex({
              startIndex: previous.startIndex,
              targetOffsetY: offsetY,
              itemHeight: previous.itemHeight,
              itemCount,
            })
          : Math.round(offsetY / itemHeight);

      gestureRef.current = { startIndex, itemHeight, isOpen: true };
    },
    [itemHeight, itemCount]
  );

  const onMomentumScrollEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const gesture = gestureRef.current;
      gestureRef.current = { ...gesture, isOpen: false };

      const gestureItemHeight = gesture.itemHeight;
      if (!Number.isFinite(gestureItemHeight) || gestureItemHeight <= 0 || itemCount <= 0) {
        return;
      }

      const targetOffsetY = event.nativeEvent.contentOffset.y;
      const resolvedIndex = resolveGestureTargetIndex({
        startIndex: gesture.startIndex,
        targetOffsetY,
        itemHeight: gestureItemHeight,
        itemCount,
      });
      const landedIndex = Math.round(targetOffsetY / gestureItemHeight);

      // The common case: the platform already landed within the allowed
      // ±1 window, so no corrective scroll is issued - only a genuine
      // overshoot triggers one.
      if (landedIndex === resolvedIndex) {
        return;
      }

      flatListRef.current?.scrollToOffset({
        offset: resolvedIndex * gestureItemHeight,
        animated: false,
      });
    },
    [flatListRef, itemCount]
  );

  return { onScrollBeginDrag, onMomentumScrollEnd };
}
