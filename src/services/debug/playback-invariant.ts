// Development-only guard for the Home feed's core playback rule: at most one
// player may be playing at a time. It exists because the failure it catches -
// a second player becoming audible - is invisible to the type system, silent
// in Jest (no real native player), and easy to reintroduce from any new effect
// that touches a player. In development it turns that class of regression into
// an immediate, attributable console error instead of something a human has to
// hear on a device.
//
// Every entry point is a no-op outside __DEV__, so release builds carry no
// behaviour and no bookkeeping. Never log tokens or URLs here - ids only.

// Stable "p1"/"p2"... labels per native player instance, so a violation can
// distinguish "one player kept playing" from "a second player started".
const playerLabels = new WeakMap<object, string>();
let playerCounter = 0;

// Release builds get a constant and keep no bookkeeping at all - no WeakMap
// write, no counter, no per-player string. The value is unused there anyway,
// because reportPlayingState() is itself a no-op outside __DEV__.
const RELEASE_LABEL = 'p0';

export function playbackPlayerLabel(player: object): string {
  if (!__DEV__) {
    return RELEASE_LABEL;
  }

  const existingLabel = playerLabels.get(player);

  if (existingLabel) {
    return existingLabel;
  }

  playerCounter += 1;
  const label = `p${playerCounter}`;

  playerLabels.set(player, label);

  return label;
}

// Which players currently report playing=true. Two at once is the
// overlapping-audio bug by definition, whatever started it - which is why the
// check lives here, on the observed state, rather than on any one suspected
// cause.
//
// The check is deliberately zero-tolerance rather than debounced: a swipe
// handoff is only correct if the outgoing player has actually stopped before
// the incoming one starts, so even a momentary two-player overlap is the
// defect this exists to surface. On-device measurement supports that being
// achievable - across 852 recorded transitions the peak was exactly one
// playing player, including five handoffs where the outgoing item was still
// playing at the moment it was deactivated.
const playingPlayers = new Map<string, string>();

export function reportPlayingState(playerLabel: string, videoId: string, isPlaying: boolean): void {
  if (!__DEV__) {
    return;
  }

  if (isPlaying) {
    playingPlayers.set(playerLabel, videoId);
  } else {
    playingPlayers.delete(playerLabel);
  }

  if (playingPlayers.size > 1) {
    console.error(
      '[PlaybackInvariantViolation]',
      Array.from(playingPlayers.entries()).map(([label, id]) => `${label}:${id}`)
    );
  }
}

export function resetPlaybackInvariantForTests(): void {
  playingPlayers.clear();
}
