import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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
    borderRadius: 8,
    backgroundColor: '#f9fafb',
  },
  rowCurrentlyPlaying: {
    backgroundColor: '#ffe4e6',
  },
  rowPressed: {
    opacity: 0.7,
  },
  thumbnail: {
    width: 84,
    height: 56,
    borderRadius: 6,
    backgroundColor: '#111827',
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
    fontWeight: '700',
    color: '#111827',
  },
  accessBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  freeBadge: {
    backgroundColor: '#dcfce7',
  },
  premiumBadge: {
    backgroundColor: '#fef3c7',
  },
  accessBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#111827',
  },
  unavailableText: {
    fontSize: 13,
    color: '#b91c1c',
  },
  playingText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#d11f3f',
  },
});
