import { create } from 'zustand';

// The three supported playback rates, in the order the selector displays
// them. The union type below is derived from this tuple, so a rate outside
// this list is unrepresentable rather than merely unvalidated.
export const PLAYBACK_SPEEDS = [1, 1.5, 2] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1;

type PlaybackSpeedState = {
  /**
   * The session's chosen rate. Every mounted feed item reads this one
   * value; whether any given item's PLAYER is allowed to receive it is
   * decided entirely by that item's own `shouldPlay` gate (see the rate
   * mirror effect in drama-feed-item.tsx) - the store itself never touches
   * a player.
   */
  readonly speed: PlaybackSpeed;
  readonly setSpeed: (speed: PlaybackSpeed) => void;
};

// Memory-only on purpose: no `persist` middleware, no AsyncStorage. A
// playback speed is a session choice - it follows the viewer from clip to
// clip while the app lives, and a cold restart deliberately starts over at
// 1x (2x is a way to skim right now, not a lasting account preference).
export const usePlaybackSpeedStore = create<PlaybackSpeedState>()((set) => ({
  speed: DEFAULT_PLAYBACK_SPEED,
  setSpeed: (speed) => set({ speed }),
}));

/** Test-only: resets the module-level store singleton to its cold-start state. */
export function __resetPlaybackSpeedForTests(): void {
  usePlaybackSpeedStore.setState({ speed: DEFAULT_PLAYBACK_SPEED });
}
