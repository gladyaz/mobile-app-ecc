import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import type { Episode } from '@/types/series';

type SeriesEpisodeRowProps = {
  readonly episode: Episode;
  readonly isCurrentlyPlaying: boolean;
  readonly onPress?: () => void;
};

export function SeriesEpisodeRow({ episode, isCurrentlyPlaying, onPress }: SeriesEpisodeRowProps) {
  const isPressable = episode.isAvailable && onPress != null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !isPressable, selected: isCurrentlyPlaying }}
      disabled={!isPressable}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        isCurrentlyPlaying && styles.rowCurrentlyPlaying,
        pressed && isPressable && styles.rowPressed,
      ]}>
      <Image
        contentFit="cover"
        source={{ uri: episode.thumbnailUrl }}
        style={styles.thumbnail}
      />
      <View style={styles.details}>
        <View style={styles.metaRow}>
          <Text style={styles.episodeNumber}>Episode {episode.episodeNumber}</Text>
          <View
            style={[
              styles.accessBadge,
              episode.accessType === 'premium' ? styles.premiumBadge : styles.freeBadge,
            ]}>
            <Text style={styles.accessBadgeText}>
              {episode.accessType === 'premium' ? 'Premium' : 'Free'}
            </Text>
          </View>
        </View>
        {!episode.isAvailable ? <Text style={styles.unavailableText}>Tidak tersedia</Text> : null}
        {isCurrentlyPlaying ? <Text style={styles.playingText}>Sedang diputar</Text> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: Radius.sm,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  rowCurrentlyPlaying: {
    backgroundColor: Palette.surfaceMuted,
    borderColor: Palette.primary,
  },
  rowPressed: {
    opacity: 0.7,
  },
  thumbnail: {
    width: 84,
    height: 56,
    borderRadius: Radius.sm - 2,
    backgroundColor: Palette.backgroundElevated,
  },
  details: {
    flex: 1,
    gap: 4,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  episodeNumber: {
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  accessBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm - 2,
  },
  freeBadge: {
    backgroundColor: 'rgba(34, 197, 94, 0.16)',
  },
  premiumBadge: {
    backgroundColor: 'rgba(234, 179, 8, 0.18)',
  },
  accessBadgeText: {
    fontSize: 11,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  unavailableText: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    color: Palette.error,
  },
  playingText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.primary,
  },
});
