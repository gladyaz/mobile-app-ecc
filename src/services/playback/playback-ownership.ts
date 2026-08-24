// The runtime enforcement half of the feed's core playback rule: at most one
// player may own active playback at a time.
//
// `services/debug/playback-invariant.ts` DETECTS a violation of that rule, in
// __DEV__ only, by observing which players report `playing: true`. This module
// PREVENTS one, in every build, by making the handoff itself ordered: an
// incoming player cannot start until the outgoing one has been told to stop.
//
// Why that needs its own registry rather than falling out of the feed's
// existing per-item effects: React commits passive effects in TREE order, not
// in "outgoing before incoming" order. Paging FORWARD (item 1 -> item 2) the
// outgoing item is earlier in the tree, so its pause runs first and the
// handoff is naturally correct. Paging BACKWARD (item 2 -> item 1) the
// INCOMING item is earlier, so without this module its play() is issued
// before the outgoing item's pause() - two players commanded to play at once.
// The window is short, but "short" is not "zero", and the product rule is
// zero-tolerance.
//
// The dev-only observer never caught that case, and could not: it watches
// `playing`, and a freshly-started player does not report `playing: true`
// until it has decoded a frame - long after the outgoing pause has landed. So
// the two mechanisms are complementary, not redundant: one watches the
// player's answer, this one fixes the question's order.

/** Pauses the player that currently owns playback. Must not throw. */
type PlaybackReleaseHandler = () => void;

// Identity is the PLAYER INSTANCE itself, deliberately - not an id string.
// expo-video hands back a new player whenever the source changes (a token
// refresh, an MP4 -> HLS switch), and using the instance means a superseded
// generation is a different owner by construction: its late release() can
// never revoke the replacement's ownership, with no generation counter to
// keep in sync. Not a WeakMap key - only one owner exists at a time, and it
// is cleared explicitly on release.
let currentOwner: object | null = null;
let currentRelease: PlaybackReleaseHandler | null = null;

/**
 * Hands playback ownership to `owner`, pausing the previous owner FIRST.
 *
 * Call this immediately before `player.play()`. By the time it returns, any
 * player that previously owned playback has already been told to stop, so the
 * caller's own `play()` cannot overlap it.
 *
 * Re-acquiring for the owner that already holds playback is a no-op beyond
 * refreshing its release handler, so the reconciler may call it freely.
 */
export function acquirePlaybackOwnership(owner: object, release: PlaybackReleaseHandler): void {
  if (currentOwner === owner) {
    // Same generation re-affirming itself. Refresh the handler (the effect
    // that owns it closes over the current render's values) but do NOT run
    // the release - that would pause the very player that is playing.
    currentRelease = release;

    return;
  }

  const outgoingRelease = currentRelease;

  // Grant BEFORE releasing, so that if the outgoing player's release path
  // re-enters this module (its own reconciler calling releasePlaybackOwnership
  // as it settles) it sees itself as no longer the owner and cannot revoke the
  // ownership just granted here.
  currentOwner = owner;
  currentRelease = release;

  if (outgoingRelease !== null) {
    outgoingRelease();
  }
}

/**
 * Gives up playback ownership, if `owner` still holds it.
 *
 * A superseded player calling this is a no-op: ownership is keyed on the
 * instance, so a stale generation - or an outgoing item whose own pause effect
 * runs after the incoming item already acquired - cannot clear the current
 * owner. That is what stops a late cleanup from leaving the feed ownerless
 * while a player is legitimately playing.
 */
export function releasePlaybackOwnership(owner: object): void {
  if (currentOwner !== owner) {
    return;
  }

  currentOwner = null;
  currentRelease = null;
}

/** The player instance that currently owns playback, or null. Tests only. */
export function currentPlaybackOwnerForTests(): object | null {
  return currentOwner;
}

/**
 * Module-level state outlives a single test, exactly like the invariant
 * registry's own reset - without this, an item left owning playback at the end
 * of one test would be "released" (paused) by the first acquire of the next.
 */
export function resetPlaybackOwnershipForTests(): void {
  currentOwner = null;
  currentRelease = null;
}
