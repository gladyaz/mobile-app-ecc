import { Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PLAYBACK_SPEEDS, type PlaybackSpeed } from '@/constants/playback-speed';
import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useTranslation } from '@/stores/language';

/**
 * Playback Settings bottom sheet - the vertical-kebab (⋮) destination.
 *
 * THIS SHEET OWNS NO PLAYBACK STATE. Speed, clear display and fullscreen all
 * arrive as props from the feed item that rendered it, and every control
 * calls straight back out. That is what keeps the sheet incapable of
 * affecting the wrong video: it is mounted INSIDE `DramaFeedItem`, so the
 * only speed it can read or write is its own item's.
 *
 * It is also deliberately incapable of disturbing playback. Opening it
 * mounts a transparent Modal over the feed - no player is paused, no source
 * is replaced, no authorization is re-requested, and the active item is
 * unchanged.
 *
 * SCOPE: Speed / Immersive / Fullscreen, and nothing else. No quality
 * selector, no HLS terminology, no download - manual rendition choice is not
 * part of this app's playback model, and surfacing it would imply a control
 * the player does not actually offer.
 */

type PlaybackSettingsSheetProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  /**
   * iOS only: fires after the Modal's dismissal transition completes.
   * Presenting the native fullscreen view controller while this Modal is
   * still animating out is a UIKit presentation conflict, so fullscreen
   * entry is deferred to here rather than run on press.
   */
  readonly onDismissed?: () => void;
  readonly playbackSpeed: PlaybackSpeed;
  readonly onSelectPlaybackSpeed: (speed: PlaybackSpeed) => void;
  readonly isClearDisplay: boolean;
  readonly onToggleClearDisplay: () => void;
  /** Omitted for a vertical video, which has no fullscreen affordance. */
  readonly onEnterFullscreen?: () => void;
};

export function PlaybackSettingsSheet({
  visible,
  onClose,
  onDismissed,
  playbackSpeed,
  onSelectPlaybackSpeed,
  isClearDisplay,
  onToggleClearDisplay,
  onEnterFullscreen,
}: PlaybackSettingsSheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="slide"
      onDismiss={Platform.OS === 'ios' ? onDismissed : undefined}
      onRequestClose={onClose}
      testID="playback-settings-modal"
      transparent
      visible={visible}>
      {/* Tapping the scrim closes the sheet. It is a sibling of the panel,
          not its parent, so a tap inside the panel cannot bubble out to it. */}
      <Pressable
        accessibilityLabel={t('feed.closePlaybackSettings')}
        accessibilityRole="button"
        onPress={onClose}
        style={styles.scrim}
        testID="playback-settings-scrim"
      />
      <View
        style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]}
        testID="playback-settings-sheet">
        <View style={styles.grabber} />
        <Text accessibilityRole="header" style={styles.title}>
          {t('feed.playbackSettings')}
        </Text>

        <Text style={styles.sectionLabel}>{t('feed.speed')}</Text>
        <View style={styles.speedRow}>
          {PLAYBACK_SPEEDS.map((speedOption) => {
            const isSelected = playbackSpeed === speedOption;

            return (
              <Pressable
                accessibilityLabel={t('feed.speedOption', { rate: speedOption })}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                key={speedOption}
                onPress={() => onSelectPlaybackSpeed(speedOption)}
                style={({ pressed }) => [
                  styles.speedOption,
                  isSelected && styles.speedOptionSelected,
                  pressed && styles.pressed,
                ]}>
                <Text style={[styles.speedText, !isSelected && styles.speedTextDimmed]}>
                  {`${speedOption}x`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('feed.clearDisplay')}</Text>
          <Switch
            accessibilityLabel={t('feed.clearDisplay')}
            ios_backgroundColor={Palette.surfaceMuted}
            onValueChange={onToggleClearDisplay}
            testID="playback-settings-clear-display"
            thumbColor="#fff"
            trackColor={{ false: Palette.surfaceMuted, true: Palette.primary }}
            value={isClearDisplay}
          />
        </View>

        {onEnterFullscreen ? (
          <Pressable
            accessibilityLabel={t('feed.fullscreen')}
            accessibilityRole="button"
            onPress={onEnterFullscreen}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            testID="playback-settings-fullscreen">
            <Text style={styles.rowLabel}>{t('feed.fullscreen')}</Text>
            <Text style={styles.rowChevron}>{'›'}</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  sheet: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    gap: 14,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    backgroundColor: Palette.surface,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Palette.border,
  },
  title: {
    fontSize: 17,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  sectionLabel: {
    marginTop: 2,
    fontSize: 12,
    letterSpacing: 0.4,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  speedRow: {
    flexDirection: 'row',
    gap: 8,
  },
  speedOption: {
    flex: 1,
    // 48 clears Android's 48dp minimum as well as iOS's 44pt.
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  speedOptionSelected: {
    borderColor: Palette.primary,
    backgroundColor: 'rgba(255, 122, 26, 0.14)',
  },
  speedText: {
    fontSize: 15,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  speedTextDimmed: {
    color: Palette.textSecondary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
  },
  rowLabel: {
    fontSize: 15,
    fontFamily: FontFamily.semiBold,
    color: Palette.text,
  },
  rowChevron: {
    fontSize: 22,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  pressed: {
    opacity: 0.75,
  },
});
