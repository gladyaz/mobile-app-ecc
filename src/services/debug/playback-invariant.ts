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

// 11R PLAYBACK-STABILITY REMEDIATION: a lean, __DEV__-only audit trail for
// every play()/pause()/source-replace decision the feed's single
// reconciler (and its few other legitimate call sites - a user tap, the
// outgoing-player-on-swap cleanup) makes, WITH the reason it made it. This
// is what turned the reported "black screen / visibly paused / self-pause"
// symptoms into file:line-anchored root causes instead of guesses: every
// entry names the player, the video, what it did, and why. A no-op outside
// __DEV__, so release builds carry no behaviour and no bookkeeping - same
// contract as `reportPlayingState` above. Never logs a token, URL, or
// header - only ids/enums/booleans, for the same reason `reportPlayingState`
// and `drama-feed-item.tsx`'s own error logging never do either.
export type PlaybackDecisionAction = 'play' | 'pause' | 'source-replace';

export type PlaybackDecisionContext = {
  readonly isActive: boolean;
  readonly isScreenFocused: boolean;
  readonly isAppForeground: boolean;
  readonly isManuallyPaused: boolean;
  readonly sourceKind: 'none' | 'mp4' | 'hls';
  readonly playerStatus: string | undefined;
};

export function reportPlaybackDecision(
  playerLabel: string,
  videoId: string,
  action: PlaybackDecisionAction,
  reason: string,
  context: PlaybackDecisionContext
): void {
  if (!__DEV__) {
    return;
  }

  console.log(`[PlaybackDecision] ${playerLabel} ${videoId} ${action} reason=${reason}`, context);
}

// 11R QUALITY SELECTOR: the ONE truthful answer to "which rendition is this
// player ACTUALLY on." `VideoPlayer.videoTrack` is read-only and reported by
// the native player itself (ExoPlayer/AVPlayer), so this is decoder truth -
// not an echo of whatever the quality menu was last set to. A manual
// selection is only verified when this line says the expected dimensions;
// the button changing colour proves nothing.
//
// Also the evidence that AUTO is genuinely adaptive: on the master playlist
// this fires again whenever ABR moves between rungs, so a sequence of
// differing sizes for one video IS the adaptive behaviour, observed.
//
// Same contract as the rest of this module: a no-op outside __DEV__, and it
// logs dimensions/bitrate only - never a manifest URL or a gateway token.
export type PlaybackVideoTrackSnapshot = {
  readonly width: number;
  readonly height: number;
  readonly peakBitrate: number | null;
  readonly frameRate: number | null;
};

export function reportVideoTrack(
  playerLabel: string,
  videoId: string,
  requestedQuality: string,
  track: PlaybackVideoTrackSnapshot | null
): void {
  if (!__DEV__) {
    return;
  }

  console.log(
    `[PlaybackVideoTrack] ${playerLabel} ${videoId} requested=${requestedQuality}`,
    track === null
      ? { playing: 'unknown' }
      : {
          playing: `${track.width}x${track.height}`,
          peakBitrate: track.peakBitrate,
          frameRate: track.frameRate,
        }
  );
}
