import { Image } from 'expo-image';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PremiumPreviewModal } from '@/components/premium-preview-modal';
import { SeriesEpisodeRow } from '@/components/series-episode-row';
import { useVideoCatalog } from '@/features/videos/video-catalog-provider';
import { getSeriesById } from '@/services/videos/series-service';
import type { Episode } from '@/types/series';

export default function SeriesDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { videos, isLoading, error, refresh } = useVideoCatalog();
  const series = getSeriesById(videos, id);
  const [isPremiumModalVisible, setIsPremiumModalVisible] = useState(false);

  const handleSelectEpisode = (episode: Episode) => {
    if (episode.accessType === 'premium') {
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
        <ActivityIndicator color="#d11f3f" size="large" />
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

  const firstPlayableEpisode = series.episodes.find(
    (episode) => episode.accessType === 'free' && episode.isAvailable
  );

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

      {firstPlayableEpisode ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => handleSelectEpisode(firstPlayableEpisode)}
          style={({ pressed }) => [styles.playButton, pressed && styles.buttonPressed]}>
          <Text style={styles.playButtonText}>Mulai Menonton</Text>
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
              isCurrentlyPlaying={false}
              key={episode.videoId}
              onPress={() => handleSelectEpisode(episode)}
            />
          ))
        )}
      </View>

      <PremiumPreviewModal
        onDismiss={() => setIsPremiumModalVisible(false)}
        onGoToFreeEpisode={
          firstPlayableEpisode
            ? () => {
                setIsPremiumModalVisible(false);
                handleSelectEpisode(firstPlayableEpisode);
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
    backgroundColor: '#fff',
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
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    backgroundColor: '#d11f3f',
  },
  retryButtonText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
  backButton: {
    alignSelf: 'flex-start',
    margin: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#111827',
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  cover: {
    width: '100%',
    height: 220,
    backgroundColor: '#111827',
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
    fontWeight: '700',
    color: '#d11f3f',
  },
  channel: {
    fontSize: 13,
    color: '#4b5563',
  },
  title: {
    marginTop: 8,
    paddingHorizontal: 20,
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: '#111827',
  },
  episodeCount: {
    marginTop: 6,
    paddingHorizontal: 20,
    fontSize: 14,
    fontWeight: '700',
    color: '#6b7280',
  },
  description: {
    marginTop: 10,
    paddingHorizontal: 20,
    fontSize: 15,
    lineHeight: 22,
    color: '#374151',
  },
  playButton: {
    marginTop: 16,
    marginHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#d11f3f',
  },
  playButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  sectionTitle: {
    marginTop: 24,
    paddingHorizontal: 20,
    fontSize: 18,
    fontWeight: '800',
    color: '#111827',
  },
  episodeList: {
    marginTop: 12,
    paddingHorizontal: 20,
    gap: 10,
  },
  emptyText: {
    fontSize: 15,
    color: '#6b7280',
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
