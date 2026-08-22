import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useTranslation } from '@/stores/language';
import type { Episode } from '@/types/series';

type SeriesEpisodeRowProps = {
  readonly episode: Episode;
  readonly isCurrentlyPlaying: boolean;
  readonly onPress?: () => void;
  /**
   * The series' own presigned cover, used ONLY when this episode has no
   * artwork of its own. Pass `null` (or omit) when the series has no cover
   * either, or when its cover has already failed to load on this screen -
   * a URL known to be broken must not be retried once per episode row.
   */
  readonly seriesCoverUrl?: string | null;
};

export function SeriesEpisodeRow({
  episode,
  isCurrentlyPlaying,
  onPress,
  seriesCoverUrl,
}: SeriesEpisodeRowProps) {
  const { t } = useTranslation();
  const isPressable = episode.isAvailable && onPress != null;
  /**
   * Latched per URL, the same shape `series/[id].tsx` uses for the hero
   * cover: a presigned R2 URL that has expired must fall through to the next
   * candidate instead of retrying the identical request forever.
   */
  const [failedUrls, setFailedUrls] = useState<readonly string[]>([]);

  /**
   * ARTWORK RESOLUTION (2026-08-22). Ordered, and deliberately NOT a
   * hardcoded image:
   *
   *  1. `episode.thumbnailUrl` - the per-episode still. The backend already
   *     declares this field (`VideoResponseDto.thumbnailUrl`, backed by
   *     `Video.thumbnailImageKey`), so consuming it needs no new contract -
   *     but nothing populates it today (0/42 rows), and the mapper turns the
   *     absent field into `''` (`video-mapper.ts`). That empty string is why
   *     every row rendered `<Image source={{ uri: '' }} />` and showed a bare
   *     dark rectangle. The moment the transcode poster step or an admin
   *     upload fills the column, these rows start showing real stills with no
   *     further client change.
   *  2. The series cover - a bounded, truthful stand-in: it is this series'
   *     real artwork, already fetched for the header, so it costs no extra
   *     request and never misrepresents a DIFFERENT title.
   *  3. Neither - the episode-number placeholder below, matching Discover's
   *     initial-letter treatment. Never a blank surface.
   */
  const artworkUrl = useMemo(() => {
    const candidates = [episode.thumbnailUrl, seriesCoverUrl ?? ''];

    return candidates.find((url) => url.length > 0 && !failedUrls.includes(url)) ?? null;
  }, [episode.thumbnailUrl, seriesCoverUrl, failedUrls]);

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
      {/* `pointerEvents="none"`: the artwork is decoration inside a pressable
          row, so it must never swallow the tap that opens the episode. */}
      <View pointerEvents="none" style={styles.thumbnail}>
        {artworkUrl !== null ? (
          <Image
            // `cover` on a fixed 84x56 box CROPS rather than stretches, so a
            // portrait series cover standing in for a missing still is never
            // distorted.
            contentFit="cover"
            onError={() =>
              setFailedUrls((current) =>
                current.includes(artworkUrl) ? current : [...current, artworkUrl]
              )
            }
            source={{ uri: artworkUrl }}
            style={styles.thumbnailImage}
            testID="series-episode-thumbnail"
            // Fades in over the surface underneath instead of swapping from a
            // dark hole to the image in one frame.
            transition={160}
          />
        ) : (
          <View
            // Decoration: the row's own label already carries episode number
            // and access tier.
            importantForAccessibility="no-hide-descendants"
            style={styles.thumbnailFallback}
            testID="series-episode-thumbnail-fallback">
            <Text allowFontScaling={false} style={styles.thumbnailFallbackText}>
              {episode.episodeNumber}
            </Text>
          </View>
        )}
      </View>
      <View style={styles.details}>
        <View style={styles.metaRow}>
          <Text style={styles.episodeNumber}>Episode {episode.episodeNumber}</Text>
          <View
            style={[
              styles.accessBadge,
              episode.accessType === 'premium' ? styles.premiumBadge : styles.freeBadge,
            ]}>
            <Text style={styles.accessBadgeText}>
              {episode.accessType === 'premium' ? t('series.premium') : t('series.free')}
            </Text>
          </View>
        </View>
        {!episode.isAvailable ? (
          <Text style={styles.unavailableText}>{t('series.unavailable')}</Text>
        ) : null}
        {isCurrentlyPlaying ? (
          <Text style={styles.playingText}>{t('series.nowPlaying')}</Text>
        ) : null}
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
  /**
   * Fixed box, so the row's height is identical before, during and after the
   * image loads - there is no reflow to see. `surface`, NOT
   * `backgroundElevated`: the latter sits 3/255 from the screen background,
   * which is what made an unloaded thumbnail read as a black hole rather than
   * as a card (the same correction `discover-poster.tsx` already carries).
   */
  thumbnail: {
    width: 84,
    height: 56,
    borderRadius: Radius.sm - 2,
    backgroundColor: Palette.surface,
    overflow: 'hidden',
  },
  thumbnailImage: {
    width: '100%',
    height: '100%',
  },
  thumbnailFallback: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  /**
   * Full-strength accent for the same contrast reason Discover's fallback
   * initial documents: dimmed, it reads as a failed image instead of as a
   * deliberate placeholder.
   */
  thumbnailFallbackText: {
    fontSize: 20,
    lineHeight: 24,
    fontFamily: FontFamily.extraBold,
    color: Palette.primaryHover,
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
