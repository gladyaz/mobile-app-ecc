import {
  playbackPlayerLabel,
  reportPlayingState,
  resetPlaybackInvariantForTests,
} from '@/services/debug/playback-invariant';

describe('playback invariant check', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    resetPlaybackInvariantForTests();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('gives each player instance a stable label', () => {
    // Arrange
    const firstPlayer = {};
    const secondPlayer = {};

    // Act
    const firstLabel = playbackPlayerLabel(firstPlayer);

    // Assert: same object keeps its label, a different object gets its own.
    expect(playbackPlayerLabel(firstPlayer)).toBe(firstLabel);
    expect(playbackPlayerLabel(secondPlayer)).not.toBe(firstLabel);
  });

  it('stays silent while only one player is playing', () => {
    // Act
    reportPlayingState('p1', 'video-1', true);
    reportPlayingState('p1', 'video-1', false);
    reportPlayingState('p2', 'video-2', true);

    // Assert
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('reports a violation naming both videos when two players play at once', () => {
    // Arrange
    reportPlayingState('p1', 'video-1', true);

    // Act: the overlapping-audio bug, whatever started it.
    reportPlayingState('p2', 'video-2', true);

    // Assert
    expect(errorSpy).toHaveBeenCalledWith('[PlaybackInvariantViolation]', [
      'p1:video-1',
      'p2:video-2',
    ]);
  });

  it('is inert in a release build - no violation reported, no bookkeeping kept', () => {
    // Arrange: __DEV__ is the only thing separating this diagnostic from
    // shipping console noise to real users, so it is worth pinning.
    const globalWithDev = globalThis as typeof globalThis & { __DEV__: boolean };
    const originalDev = globalWithDev.__DEV__;
    globalWithDev.__DEV__ = false;

    try {
      // Act: the exact sequence that reports a violation in development.
      reportPlayingState('p1', 'video-1', true);
      reportPlayingState('p2', 'video-2', true);

      // Assert: silent, and every player collapses to the same constant label
      // (no per-instance WeakMap entry or counter in release).
      expect(errorSpy).not.toHaveBeenCalled();
      expect(playbackPlayerLabel({})).toBe(playbackPlayerLabel({}));
    } finally {
      globalWithDev.__DEV__ = originalDev;
    }

    // And nothing leaked into the development-mode registry: one player
    // playing is still silent afterwards.
    reportPlayingState('p3', 'video-3', true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('clears a player from the registry when it stops, so a later single play is silent', () => {
    // Arrange: a violation happened...
    reportPlayingState('p1', 'video-1', true);
    reportPlayingState('p2', 'video-2', true);
    errorSpy.mockClear();

    // Act: ...and then the feed recovers to a single playing player.
    reportPlayingState('p1', 'video-1', false);
    reportPlayingState('p2', 'video-2', false);
    reportPlayingState('p3', 'video-3', true);

    // Assert
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
