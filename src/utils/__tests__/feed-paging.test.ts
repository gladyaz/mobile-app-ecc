import { resolveGestureTargetIndex } from '@/utils/feed-paging';

const ITEM_HEIGHT = 800;
const ITEM_COUNT = 5;

describe('resolveGestureTargetIndex', () => {
  it('lands on B for a slow swipe from A that proposes exactly the next item', () => {
    // Arrange: gesture starts on item 0 (A), proposes landing on item 1 (B) -
    // a normal, unremarkable single-page swipe.
    const result = resolveGestureTargetIndex({
      startIndex: 0,
      targetOffsetY: 1 * ITEM_HEIGHT,
      itemHeight: ITEM_HEIGHT,
      itemCount: ITEM_COUNT,
    });

    // Assert
    expect(result).toBe(1);
  });

  it('clamps a high-velocity flick that proposes item C down to B, never skipping to C', () => {
    // Arrange: momentum from a hard flick proposes landing 2 items past the
    // start (C) - the platform's own overshoot this hook exists to correct.
    const result = resolveGestureTargetIndex({
      startIndex: 0,
      targetOffsetY: 2 * ITEM_HEIGHT,
      itemHeight: ITEM_HEIGHT,
      itemCount: ITEM_COUNT,
    });

    // Assert: capped at +1 from the start, not the proposed +2.
    expect(result).toBe(1);
  });

  it('clamps an extreme-velocity flick proposing several items past the start down to +1', () => {
    // Arrange: an even more extreme overshoot (5 items past start) - the
    // clamp must hold at ANY velocity, not just a mild overshoot.
    const result = resolveGestureTargetIndex({
      startIndex: 0,
      targetOffsetY: 5 * ITEM_HEIGHT,
      itemHeight: ITEM_HEIGHT,
      itemCount: ITEM_COUNT,
    });

    expect(result).toBe(1);
  });

  it('resolves a downward gesture from B back to A', () => {
    // Arrange: gesture starts on item 1 (B), proposes landing on item 0 (A).
    const result = resolveGestureTargetIndex({
      startIndex: 1,
      targetOffsetY: 0 * ITEM_HEIGHT,
      itemHeight: ITEM_HEIGHT,
      itemCount: ITEM_COUNT,
    });

    // Assert
    expect(result).toBe(0);
  });

  it('never moves more than one index away from the gesture start, in either direction', () => {
    // Arrange / Act / Assert: sweep a wide range of proposed offsets from a
    // fixed start and confirm the ±1 contract holds for every one of them.
    const startIndex = 2;

    for (let proposedIndex = -10; proposedIndex <= 10; proposedIndex += 1) {
      const result = resolveGestureTargetIndex({
        startIndex,
        targetOffsetY: proposedIndex * ITEM_HEIGHT,
        itemHeight: ITEM_HEIGHT,
        itemCount: ITEM_COUNT,
      });

      expect(Math.abs(result - startIndex)).toBeLessThanOrEqual(1);
    }
  });

  it('clamps to the first item - an upward swipe past index 0 cannot go negative', () => {
    // Arrange
    const result = resolveGestureTargetIndex({
      startIndex: 0,
      targetOffsetY: -1 * ITEM_HEIGHT,
      itemHeight: ITEM_HEIGHT,
      itemCount: ITEM_COUNT,
    });

    // Assert
    expect(result).toBe(0);
  });

  it('clamps to the last item - a downward flick past the end cannot exceed itemCount - 1', () => {
    // Arrange: starting on the last item (index 4 of 5), proposing to land
    // even further past the end.
    const lastIndex = ITEM_COUNT - 1;
    const result = resolveGestureTargetIndex({
      startIndex: lastIndex,
      targetOffsetY: (lastIndex + 3) * ITEM_HEIGHT,
      itemHeight: ITEM_HEIGHT,
      itemCount: ITEM_COUNT,
    });

    // Assert
    expect(result).toBe(lastIndex);
  });

  it('chains across separate gestures: A -> B -> C, one index at a time', () => {
    // Arrange / Act: each call represents a SEPARATE gesture, each with its
    // own fresh startIndex - exactly how three consecutive real swipes would
    // each invoke this function once, in sequence.
    const toB = resolveGestureTargetIndex({
      startIndex: 0,
      targetOffsetY: 1 * ITEM_HEIGHT,
      itemHeight: ITEM_HEIGHT,
      itemCount: ITEM_COUNT,
    });

    expect(toB).toBe(1);

    const toC = resolveGestureTargetIndex({
      startIndex: toB,
      targetOffsetY: 2 * ITEM_HEIGHT,
      itemHeight: ITEM_HEIGHT,
      itemCount: ITEM_COUNT,
    });

    // Assert: three chained single-index moves reach C, never a single jump
    // straight from A to C.
    expect(toC).toBe(2);
  });

  it('stays at the gesture-start index when itemHeight is degenerate (zero)', () => {
    // Arrange: a zero item height carries no information about which index
    // targetOffsetY actually points to - dividing by it would produce
    // garbage (Infinity/NaN), so the safe answer is "do not move".
    const result = resolveGestureTargetIndex({
      startIndex: 2,
      targetOffsetY: 4000,
      itemHeight: 0,
      itemCount: ITEM_COUNT,
    });

    expect(result).toBe(2);
  });

  it('stays at the gesture-start index when itemHeight is negative or non-finite', () => {
    expect(
      resolveGestureTargetIndex({
        startIndex: 1,
        targetOffsetY: 4000,
        itemHeight: -800,
        itemCount: ITEM_COUNT,
      })
    ).toBe(1);

    expect(
      resolveGestureTargetIndex({
        startIndex: 1,
        targetOffsetY: 4000,
        itemHeight: Number.NaN,
        itemCount: ITEM_COUNT,
      })
    ).toBe(1);
  });

  it('returns 0 for an empty list rather than an out-of-range index', () => {
    const result = resolveGestureTargetIndex({
      startIndex: 3,
      targetOffsetY: 3 * ITEM_HEIGHT,
      itemHeight: ITEM_HEIGHT,
      itemCount: 0,
    });

    expect(result).toBe(0);
  });
});
