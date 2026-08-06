import { StyleSheet, View } from 'react-native';

import { Palette } from '@/constants/theme';

type FeedProgressBarProps = {
  /** Playback position as reported by the player, 0-1. */
  readonly progressRatio: number;
  /** Distance from the bottom of the feed item. */
  readonly bottom: number;
};

/**
 * A read-only playback indicator, nothing more.
 *
 * It was briefly a scrubber. Dragging never became smooth enough on a real
 * phone to be worth keeping - and a control that stutters reads as broken,
 * where a plain bar reads as finished. Kept as its own component so the video
 * position can re-render here without touching the metadata or the action
 * rail, and so the interaction can come back later without unpicking the feed
 * item again.
 */
export function FeedProgressBar({ progressRatio, bottom }: FeedProgressBarProps) {
  return (
    <View testID="feed-item-progress-track" style={[styles.track, { bottom }]}>
      <View style={[styles.fill, { width: `${progressRatio * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  fill: {
    height: '100%',
    backgroundColor: Palette.primary,
  },
});
