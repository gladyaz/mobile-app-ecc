// The three supported playback rates, in the order the selector displays
// them. The union type below is derived from this tuple, so a rate outside
// this list is unrepresentable rather than merely unvalidated.
export const PLAYBACK_SPEEDS = [1, 1.5, 2] as const;

export type PlaybackSpeed = (typeof PLAYBACK_SPEEDS)[number];

export const DEFAULT_PLAYBACK_SPEED: PlaybackSpeed = 1;

// SCOPE: per video / feed item, NOT per session.
//
// This module deliberately exports constants only - no store, no shared
// state. A rate belongs to the individual item that is playing: it is a way
// to skim THIS clip, not a standing preference that should follow the viewer
// down the feed. Landing on a fresh video at 2x because of a choice made two
// clips ago is a surprise, not a convenience, so every newly-active item
// starts at DEFAULT_PLAYBACK_SPEED.
//
// The state itself lives in `useState` inside DramaFeedItem (see the rate
// mirror effect there). That placement IS the guarantee: with no shared
// store, one item structurally cannot read or write another item's rate.
// A rate therefore survives exactly as long as its item stays mounted in the
// feed's render window - swiping to the next clip and back restores it,
// while an item recycled out of the window returns to 1x on remount.
