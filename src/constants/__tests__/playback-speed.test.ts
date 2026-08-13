import { DEFAULT_PLAYBACK_SPEED, PLAYBACK_SPEEDS } from '@/constants/playback-speed';

// The speed itself is per-item state inside DramaFeedItem, so its BEHAVIOUR
// (a fresh video starting at 1x, one video's choice not reaching another) is
// pinned by the "per-video speed" describe block in
// src/components/__tests__/drama-feed-item.test.tsx. What is left here is the
// shape of the option set the selector renders.
//
// The old session-store cases (setSpeed, "never touches AsyncStorage",
// "resets on cold restart") are deliberately gone rather than ported: with no
// store, there is no singleton to mutate, no persistence path to spy on, and
// no module-level state that could survive a restart. Those contracts are now
// structural, and a test asserting them would assert nothing.
describe('playback speed options', () => {
  it('offers exactly the three supported rates, in display order', () => {
    expect(PLAYBACK_SPEEDS).toEqual([1, 1.5, 2]);
  });

  it('defaults to 1x, so a newly-active video never starts pre-accelerated', () => {
    expect(DEFAULT_PLAYBACK_SPEED).toBe(1);
    expect(PLAYBACK_SPEEDS[0]).toBe(DEFAULT_PLAYBACK_SPEED);
  });
});
