import { renderHook } from '@testing-library/react-native';
import type { FlatList, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { useFeedPagingGuard } from '@/hooks/use-feed-paging-guard';

const ITEM_HEIGHT = 800;
const ITEM_COUNT = 5;

function buildScrollEvent(offsetY: number): NativeSyntheticEvent<NativeScrollEvent> {
  return {
    nativeEvent: { contentOffset: { x: 0, y: offsetY } },
  } as unknown as NativeSyntheticEvent<NativeScrollEvent>;
}

// `renderHook()` in this testing-library version is itself async (matching
// `render()` - see the analogous comment in drama-feed-item.test.tsx), so
// every call site awaits it before touching `result.current`.
async function setup(itemHeight = ITEM_HEIGHT, itemCount = ITEM_COUNT) {
  const scrollToOffset = jest.fn();
  const flatListRef = {
    current: { scrollToOffset } as unknown as FlatList<unknown>,
  };

  const { result } = await renderHook(() =>
    useFeedPagingGuard({ flatListRef, itemHeight, itemCount })
  );

  return { result, scrollToOffset };
}

describe('useFeedPagingGuard', () => {
  it('issues no corrective scroll for an ordinary one-page swipe (A -> B)', async () => {
    // Arrange
    const { result, scrollToOffset } = await setup();

    // Act: drag begins at A (offset 0), momentum settles exactly on B.
    result.current.onScrollBeginDrag(buildScrollEvent(0));
    result.current.onMomentumScrollEnd(buildScrollEvent(1 * ITEM_HEIGHT));

    // Assert: the platform already landed within the allowed window, so this
    // handler stays a no-op rather than firing a redundant scroll.
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('corrects a high-velocity flick that lands on C back to B, not letting it skip to C', async () => {
    // Arrange
    const { result, scrollToOffset } = await setup();

    // Act: drag begins at A (offset 0), but momentum carries the native
    // scroller all the way to C (2 items past the start).
    result.current.onScrollBeginDrag(buildScrollEvent(0));
    result.current.onMomentumScrollEnd(buildScrollEvent(2 * ITEM_HEIGHT));

    // Assert: a single corrective, non-animated scroll lands on B (index 1),
    // never C.
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 1 * ITEM_HEIGHT,
      animated: false,
    });
  });

  it('corrects an extreme-velocity flick that overshoots multiple pages, still capping at +1', async () => {
    // Arrange
    const { result, scrollToOffset } = await setup();

    // Act: an even harder flick, proposing 4 items past the start.
    result.current.onScrollBeginDrag(buildScrollEvent(0));
    result.current.onMomentumScrollEnd(buildScrollEvent(4 * ITEM_HEIGHT));

    // Assert
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 1 * ITEM_HEIGHT,
      animated: false,
    });
  });

  it('resolves a downward gesture from B to A without overshooting', async () => {
    // Arrange
    const { result, scrollToOffset } = await setup();

    // Act: drag begins at B (offset = 1 item), settles exactly on A.
    result.current.onScrollBeginDrag(buildScrollEvent(1 * ITEM_HEIGHT));
    result.current.onMomentumScrollEnd(buildScrollEvent(0));

    // Assert: already within the allowed window - no correction needed.
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('clamps at the first item - cannot correct to a negative index', async () => {
    // Arrange
    const { result, scrollToOffset } = await setup();

    // Act: drag begins at A (offset 0), and an upward overshoot proposes a
    // negative offset.
    result.current.onScrollBeginDrag(buildScrollEvent(0));
    result.current.onMomentumScrollEnd(buildScrollEvent(-2 * ITEM_HEIGHT));

    // Assert: corrected back to index 0, not left negative.
    expect(scrollToOffset).toHaveBeenCalledWith({ offset: 0, animated: false });
  });

  it('clamps at the last item - cannot correct past itemCount - 1', async () => {
    // Arrange
    const { result, scrollToOffset } = await setup();
    const lastIndex = ITEM_COUNT - 1;

    // Act: drag begins at the last item, a hard flick proposes landing 3
    // items past the end (an offset beyond the content the list even has).
    result.current.onScrollBeginDrag(buildScrollEvent(lastIndex * ITEM_HEIGHT));
    result.current.onMomentumScrollEnd(buildScrollEvent((lastIndex + 3) * ITEM_HEIGHT));

    // Assert: the platform's own bounce/overscroll landed past the end, so
    // this issues one corrective scroll back to the last real item - never
    // further, since there is nothing beyond it to land on.
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: lastIndex * ITEM_HEIGHT,
      animated: false,
    });
  });

  it('chains across separate gestures: A -> B -> C, each measured from its own fresh start', async () => {
    // Arrange
    const { result, scrollToOffset } = await setup();

    // Act: gesture 1, A -> B, settles cleanly.
    result.current.onScrollBeginDrag(buildScrollEvent(0));
    result.current.onMomentumScrollEnd(buildScrollEvent(1 * ITEM_HEIGHT));

    // Gesture 2, starting fresh from B (where the list now visually rests),
    // overshoots to D (2 items past B).
    result.current.onScrollBeginDrag(buildScrollEvent(1 * ITEM_HEIGHT));
    result.current.onMomentumScrollEnd(buildScrollEvent(3 * ITEM_HEIGHT));

    // Assert: gesture 1 needed no correction; gesture 2's overshoot was
    // clamped to exactly one item past ITS OWN start (index 1 -> index 2),
    // never straight to index 3.
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 2 * ITEM_HEIGHT,
      animated: false,
    });
  });

  it('does not record a gesture start or attempt a division by a degenerate item height', async () => {
    // Arrange: itemHeight of 0 - the "feedHeight not yet measured" state.
    const { result, scrollToOffset } = await setup(0);

    // Act
    expect(() => {
      result.current.onScrollBeginDrag(buildScrollEvent(0));
      result.current.onMomentumScrollEnd(buildScrollEvent(1600));
    }).not.toThrow();

    // Assert: nothing to safely correct without a real item height.
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it('does nothing for an empty feed', async () => {
    // Arrange
    const { result, scrollToOffset } = await setup(ITEM_HEIGHT, 0);

    // Act
    result.current.onScrollBeginDrag(buildScrollEvent(0));
    result.current.onMomentumScrollEnd(buildScrollEvent(1 * ITEM_HEIGHT));

    // Assert
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  describe('interrupted momentum (a second touch begins before the first gesture\'s onMomentumScrollEnd)', () => {
    // RN iOS's RCTScrollView only fires onMomentumScrollEnd from
    // didEndDecelerating / didEndScrollingAnimation / didMoveToWindow - NOT
    // when a new touch grabs the list mid-deceleration. So a real device can
    // deliver onScrollBeginDrag a second time with no onMomentumScrollEnd in
    // between for the first gesture at all.

    it("reviewer's exact repro: begin-drag(0) -> [no momentum-end] -> begin-drag(1.8H) -> momentum-end(1.8H) settles no further than the second gesture's own baseline + 1", async () => {
      // Arrange
      const { result, scrollToOffset } = await setup();

      // Act: gesture 1 begins at A (offset 0) and never reaches its own
      // onMomentumScrollEnd - a second touch interrupts it at 1.8 items past
      // A, which becomes gesture 2. Per the fix, gesture 1 is first resolved
      // to ITS clamped landing (round(1.8) = 2, clamped to start(0) +/- 1 =
      // 1) - THAT becomes gesture 2's baseline, not a raw round(1.8) = 2.
      result.current.onScrollBeginDrag(buildScrollEvent(0));
      result.current.onScrollBeginDrag(buildScrollEvent(1.8 * ITEM_HEIGHT));
      result.current.onMomentumScrollEnd(buildScrollEvent(1.8 * ITEM_HEIGHT));

      // Assert: gesture 2's baseline is 1 (resolved above), so its own +/-1
      // window permits landing on index 2 (round(1.8) = 2 = baseline + 1) -
      // the landed index does not exceed baseline + 1, so no corrective
      // scroll is needed here. This is the two-touch chain (0 -> 1 -> 2)
      // advancing at most one index per touch, never a single ungoverned
      // +2 jump from one Math.round of the raw mid-flight offset.
      expect(scrollToOffset).not.toHaveBeenCalled();
    });

    it('interrupted momentum with a larger mid-flight offset (2.8H) caps the chain at baseline + 1, correcting the overshoot', async () => {
      // Arrange
      const { result, scrollToOffset } = await setup();

      // Act: same interruption shape, but the interrupting touch grabs the
      // list further out (2.8 items past A). Gesture 1 resolves to
      // round(2.8) = 3, clamped to start(0) +/- 1 = 1 - THAT is gesture 2's
      // baseline (never the raw round(2.8) = 3 the old, unclamped chaining
      // would have used).
      result.current.onScrollBeginDrag(buildScrollEvent(0));
      result.current.onScrollBeginDrag(buildScrollEvent(2.8 * ITEM_HEIGHT));
      result.current.onMomentumScrollEnd(buildScrollEvent(2.8 * ITEM_HEIGHT));

      // Assert: gesture 2's landed index (round(2.8) = 3) exceeds its own
      // baseline(1) + 1 = 2, so one corrective scroll fires, landing on
      // index 2 - two touches, at most two indexes advanced, never three.
      expect(scrollToOffset).toHaveBeenCalledTimes(1);
      expect(scrollToOffset).toHaveBeenCalledWith({
        offset: 2 * ITEM_HEIGHT,
        animated: false,
      });
    });
  });

  it("uses the itemHeight captured at this gesture's own begin-drag for the corrective target, not a later itemHeight change", async () => {
    // Arrange: itemHeight starts at ITEM_HEIGHT (800) - the value the
    // gesture will capture at onScrollBeginDrag.
    const scrollToOffset = jest.fn();
    const flatListRef = {
      current: { scrollToOffset } as unknown as FlatList<unknown>,
    };
    const { result, rerender } = await renderHook(
      ({ itemHeight }: { itemHeight: number }) =>
        useFeedPagingGuard({ flatListRef, itemHeight, itemCount: ITEM_COUNT }),
      { initialProps: { itemHeight: ITEM_HEIGHT } }
    );

    // Act: the gesture begins while itemHeight is still 800.
    result.current.onScrollBeginDrag(buildScrollEvent(0));

    // feedHeight is re-measured mid-gesture (e.g. a rotation or safe-area
    // change) - the itemHeight prop this hook receives is now 400, a
    // different unit scale than what the in-flight gesture captured. `render`
    // (and therefore `rerender`) in this testing-library version is async -
    // see the analogous comment on `setup()` above - so this is awaited to
    // guarantee the new itemHeight has actually propagated (and the
    // `onMomentumScrollEnd` handler been recreated against it) before it's
    // invoked below.
    await rerender({ itemHeight: 400 });

    // Momentum settles at an offset that is 2 *captured* (800px) items past
    // the start.
    result.current.onMomentumScrollEnd(buildScrollEvent(2 * ITEM_HEIGHT));

    // Assert: the correction is computed - and its target offset expressed -
    // in the CAPTURED 800px unit (clamped to index 1 => offset 800), never
    // the new 400px unit that was only introduced after this gesture began.
    expect(scrollToOffset).toHaveBeenCalledTimes(1);
    expect(scrollToOffset).toHaveBeenCalledWith({
      offset: 1 * ITEM_HEIGHT,
      animated: false,
    });
  });
});
