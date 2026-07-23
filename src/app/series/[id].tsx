import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PremiumPreviewModal } from '@/components/premium-preview-modal';
import { SeriesEpisodeRow } from '@/components/series-episode-row';
import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useVideoCatalog } from '@/features/videos/video-catalog-provider';
import { getSeriesById } from '@/services/videos/series-service';
import { useEntitlement } from '@/stores/entitlement';
import { useSeriesProgress } from '@/stores/series-progress';
import type { Episode } from '@/types/series';

export default function SeriesDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { videos, isLoading, error, refresh } = useVideoCatalog();
  const { getProgress } = useSeriesProgress();
  const { isPremium } = useEntitlement();
  const series = getSeriesById(videos, id);
  const [isPremiumModalVisible, setIsPremiumModalVisible] = useState(false);

  const handleSelectEpisode = (episode: Episode) => {
    if (episode.accessType === 'premium' && !isPremium) {
      setIsPremiumModalVisible(true);
      return;
    }

    router.push({ pathname: '/', params: { videoId: episode.videoId } });
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace('/');
  };

  if (isLoading && videos.length === 0) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <ActivityIndicator color={Palette.primary} size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <Text style={styles.stateTitle}>Series gagal dimuat.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={refresh}
          style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (!series) {
    return (
      <View style={[styles.container, styles.centerState]}>
        <Text style={styles.stateTitle}>Series tidak ditemukan.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={handleBack}
          style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
          <Text style={styles.retryButtonText}>Back</Text>
        </Pressable>
      </View>
    );
  }

  const firstFreeEpisode = series.episodes.find(
    (episode) => episode.accessType === 'free' && episode.isAvailable
  );
  const firstPlayableEpisode = series.episodes.find(
    (episode) => episode.isAvailable && (episode.accessType === 'free' || isPremium)
  );
  const progress = getProgress(series.id);
  const continueEpisode = progress
    ? series.episodes.find((episode) => episode.videoId === progress.lastWatchedVideoId)
    : undefined;
  const primaryPlaybackEpisode = continueEpisode ?? firstPlayableEpisode;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable
        accessibilityRole="button"
        onPress={handleBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}>
        <Text style={styles.backButtonText}>Back</Text>
      </Pressable>

      <Image contentFit="cover" source={{ uri: series.coverUrl }} style={styles.cover} />

      <View style={styles.metaRow}>
        <Text style={styles.category}>{series.category}</Text>
        <Text style={styles.channel}>{series.channelName}</Text>
      </View>
      <Text style={styles.title}>{series.title}</Text>
      <Text style={styles.episodeCount}>{series.episodeCount} episode</Text>
      <Text style={styles.description}>{series.description}</Text>

      {primaryPlaybackEpisode ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => handleSelectEpisode(primaryPlaybackEpisode)}
          style={({ pressed }) => [styles.playButton, pressed && styles.buttonPressed]}>
          <Text style={styles.playButtonText}>
            {continueEpisode ? 'Lanjutkan Menonton' : 'Mulai Menonton'}
          </Text>
        </Pressable>
      ) : null}

      <Text style={styles.sectionTitle}>Episodes</Text>
      <View style={styles.episodeList}>
        {series.episodes.length === 0 ? (
          <Text style={styles.emptyText}>Belum ada episode tersedia.</Text>
        ) : (
          series.episodes.map((episode) => (
            <SeriesEpisodeRow
              episode={episode}
              isCurrentlyPlaying={episode.videoId === progress?.lastWatchedVideoId}
              key={episode.videoId}
              onPress={() => handleSelectEpisode(episode)}
            />
          ))
        )}
      </View>

      <PremiumPreviewModal
        onDismiss={() => setIsPremiumModalVisible(false)}
        onGoToFreeEpisode={
          firstFreeEpisode
            ? () => {
                setIsPremiumModalVisible(false);
                handleSelectEpisode(firstFreeEpisode);
              }
            : undefined
        }
        visible={isPremiumModalVisible}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  content: {
    paddingBottom: 48,
  },
  centerState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  stateTitle: {
    fontSize: 17,
    fontFamily: FontFamily.bold,
    color: Palette.text,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: Radius.sm,
    backgroundColor: Palette.primary,
  },
  retryButtonText: {
    fontSize: 15,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  backButton: {
    alignSelf: 'flex-start',
    margin: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radius.sm,
    backgroundColor: Palette.surface,
  },
  backButtonText: {
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  cover: {
    width: '100%',
    height: 220,
    backgroundColor: Palette.backgroundElevated,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 18,
    paddingHorizontal: 20,
  },
  category: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
  },
  channel: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  title: {
    marginTop: 8,
    paddingHorizontal: 20,
    fontSize: 24,
    lineHeight: 30,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  episodeCount: {
    marginTop: 6,
    paddingHorizontal: 20,
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: Palette.textMuted,
  },
  description: {
    marginTop: 10,
    paddingHorizontal: 20,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  playButton: {
    marginTop: 16,
    marginHorizontal: 20,
    paddingVertical: 14,
    borderRadius: Radius.sm,
    alignItems: 'center',
    backgroundColor: Palette.primary,
  },
  playButtonText: {
    fontSize: 16,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  sectionTitle: {
    marginTop: 24,
    paddingHorizontal: 20,
    fontSize: 18,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  episodeList: {
    marginTop: 12,
    paddingHorizontal: 20,
    gap: 10,
  },
  emptyText: {
    fontSize: 15,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
