import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  __resetPlaybackSpeedForTests,
  DEFAULT_PLAYBACK_SPEED,
  PLAYBACK_SPEEDS,
  usePlaybackSpeedStore,
} from '@/stores/playback-speed';

beforeEach(() => {
  __resetPlaybackSpeedForTests();
});

describe('usePlaybackSpeedStore', () => {
  it('starts the session at 1x', () => {
    expect(DEFAULT_PLAYBACK_SPEED).toBe(1);
    expect(usePlaybackSpeedStore.getState().speed).toBe(1);
  });

  it('offers exactly the three supported rates, in display order', () => {
    expect(PLAYBACK_SPEEDS).toEqual([1, 1.5, 2]);
  });

  it('setSpeed updates the session speed', () => {
    usePlaybackSpeedStore.getState().setSpeed(1.5);
    expect(usePlaybackSpeedStore.getState().speed).toBe(1.5);

    usePlaybackSpeedStore.getState().setSpeed(2);
    expect(usePlaybackSpeedStore.getState().speed).toBe(2);
  });

  it('never touches AsyncStorage - the speed must not survive a cold restart', () => {
    // The persistence contract is "none": a wired-up `persist` middleware
    // (the ads-store pattern next door) would write on every change, so a
    // silent zero here is what proves the store stayed memory-only.
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

    usePlaybackSpeedStore.getState().setSpeed(2);

    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  it('resets to 1x on a cold app restart (a fresh JS context builds a fresh store)', () => {
    usePlaybackSpeedStore.getState().setSpeed(2);

    // A cold restart re-evaluates every module from scratch. Isolating the
    // registry and requiring the module again is that restart in miniature:
    // the new store instance must have no memory of the old session's 2x.
    jest.isolateModules(() => {
      const freshModule =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@/stores/playback-speed') as typeof import('@/stores/playback-speed');

      expect(freshModule.usePlaybackSpeedStore.getState().speed).toBe(1);
    });
  });
});
