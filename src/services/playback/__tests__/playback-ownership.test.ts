import {
  acquirePlaybackOwnership,
  currentPlaybackOwnerForTests,
  releasePlaybackOwnership,
  resetPlaybackOwnershipForTests,
} from '@/services/playback/playback-ownership';

describe('playback ownership', () => {
  beforeEach(() => {
    resetPlaybackOwnershipForTests();
  });

  it('pauses the outgoing owner BEFORE the incoming one is granted playback', () => {
    // Arrange: the ordering this module exists to guarantee. React commits
    // passive effects in tree order, so on a backward swipe the incoming
    // item's effect runs first - without this module it would call play()
    // while the outgoing player was still running.
    const callOrder: string[] = [];
    const outgoing = {};
    const incoming = {};

    acquirePlaybackOwnership(outgoing, () => callOrder.push('outgoing-paused'));

    // Act
    acquirePlaybackOwnership(incoming, () => callOrder.push('incoming-paused'));
    callOrder.push('incoming-play');

    // Assert
    expect(callOrder).toEqual(['outgoing-paused', 'incoming-play']);
    expect(currentPlaybackOwnerForTests()).toBe(incoming);
  });

  it('never runs the release handler of the owner that is re-acquiring', () => {
    // Arrange: the reconciler re-runs on unrelated dependency changes; a
    // re-acquire must not pause the very player that is legitimately playing.
    const release = jest.fn();
    const owner = {};

    acquirePlaybackOwnership(owner, release);

    // Act
    acquirePlaybackOwnership(owner, release);

    // Assert
    expect(release).not.toHaveBeenCalled();
    expect(currentPlaybackOwnerForTests()).toBe(owner);
  });

  it('lets a stale generation release itself without revoking the current owner', () => {
    // Arrange: expo-video hands back a NEW player when the source changes, so
    // a superseded generation's late cleanup must not leave the feed
    // ownerless while the replacement is playing.
    const stalePlayer = {};
    const currentPlayer = {};

    acquirePlaybackOwnership(stalePlayer, jest.fn());
    acquirePlaybackOwnership(currentPlayer, jest.fn());

    // Act
    releasePlaybackOwnership(stalePlayer);

    // Assert
    expect(currentPlaybackOwnerForTests()).toBe(currentPlayer);
  });

  it('clears ownership when the actual owner releases it', () => {
    // Arrange
    const owner = {};

    acquirePlaybackOwnership(owner, jest.fn());

    // Act
    releasePlaybackOwnership(owner);

    // Assert
    expect(currentPlaybackOwnerForTests()).toBeNull();
  });

  it('does not re-pause a player that already gave up ownership', () => {
    // Arrange: a manual pause releases ownership. The next item to start must
    // not call a dead player's release handler.
    const release = jest.fn();
    const outgoing = {};
    const incoming = {};

    acquirePlaybackOwnership(outgoing, release);
    releasePlaybackOwnership(outgoing);

    // Act
    acquirePlaybackOwnership(incoming, jest.fn());

    // Assert
    expect(release).not.toHaveBeenCalled();
  });

  it('hands ownership across a three-item run, pausing exactly one player per step', () => {
    // Arrange: rapid A -> B -> C paging. Every handoff pauses the outgoing
    // player exactly once, and only one owner ever exists.
    const releaseA = jest.fn();
    const releaseB = jest.fn();
    const releaseC = jest.fn();
    const playerA = {};
    const playerB = {};
    const playerC = {};

    // Act
    acquirePlaybackOwnership(playerA, releaseA);
    acquirePlaybackOwnership(playerB, releaseB);
    acquirePlaybackOwnership(playerC, releaseC);

    // Assert
    expect(releaseA).toHaveBeenCalledTimes(1);
    expect(releaseB).toHaveBeenCalledTimes(1);
    expect(releaseC).not.toHaveBeenCalled();
    expect(currentPlaybackOwnerForTests()).toBe(playerC);
  });

  it('grants ownership before releasing, so an outgoing release cannot revoke the new owner', () => {
    // Arrange: the outgoing item's own reconciler settles by calling
    // releasePlaybackOwnership for itself. If that ran while it still counted
    // as the owner it would clear the ownership just granted to the incoming
    // player, leaving the feed with a playing-but-unowned item.
    const outgoing = {};
    const incoming = {};

    acquirePlaybackOwnership(outgoing, () => {
      releasePlaybackOwnership(outgoing);
    });

    // Act
    acquirePlaybackOwnership(incoming, jest.fn());

    // Assert
    expect(currentPlaybackOwnerForTests()).toBe(incoming);
  });
});
