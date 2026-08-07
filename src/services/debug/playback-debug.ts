// Dev-only diagnostics for the Home-feed playback-ownership investigation:
// a structured event log ([PlaybackDebug]) plus a registry that asserts the
// single-playing-player invariant ([PlaybackInvariantViolation]). Every entry
// point is a no-op outside __DEV__, so release builds carry no behaviour.
// Never log auth tokens or URLs here - ids, labels, and flags only.

export type PlaybackDebugEvent =
  | 'MOUNT'
  | 'UNMOUNT'
  | 'ACTIVE_CHANGED'
  | 'FOCUS_CHANGED'
  | 'APP_STATE_CHANGED'
  | 'PLAY_REQUEST'
  | 'PAUSE_REQUEST'
  | 'PLAYING_CHANGED'
  | 'PLAYBACK_RATE_WRITE'
  | 'PLAYER_STATUS'
  | 'FULLSCREEN'
  | 'VIEWABILITY_CHANGED';

type PlaybackDebugFields = Record<string, string | number | boolean | undefined>;

// Stable "p1"/"p2"... labels per native player instance, so a log line can
// distinguish "the same player kept playing" from "a new player was created".
const playerLabels = new WeakMap<object, string>();
let playerCounter = 0;

export function playbackPlayerLabel(player: object): string {
  const existingLabel = playerLabels.get(player);

  if (existingLabel) {
    return existingLabel;
  }

  playerCounter += 1;
  const label = `p${playerCounter}`;

  playerLabels.set(player, label);

  return label;
}

export function logPlaybackDebug(event: PlaybackDebugEvent, fields: PlaybackDebugFields): void {
  if (!__DEV__) {
    return;
  }

  const renderedFields = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');

  console.log(`[PlaybackDebug] event=${event} ${renderedFields}`);
}

// The invariant registry: which players currently report playing=true. More
// than one simultaneously is the double-audio bug by definition, whatever
// started it - so it is asserted here, at the evidence layer, rather than
// inferred from symptoms. Diagnostic only, never business logic.
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

export function resetPlaybackDebugForTests(): void {
  playingPlayers.clear();
}
