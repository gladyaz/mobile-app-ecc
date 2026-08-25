import { Modal, Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AUTO_PLAYBACK_QUALITY,
  type PlaybackQuality,
  type PlaybackQualityOption,
} from '@/constants/playback-quality';
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
 * SCOPE: Quality / Speed / Immersive / Fullscreen, and nothing else. No HLS
 * terminology, no download.
 *
 * The Quality section is rendered ONLY when `qualityOptions` is non-empty,
 * and that list is derived (in `constants/playback-quality.ts`) from the
 * renditions the backend actually produced for THIS video - so a video with
 * one fixed stream, or an MP4-backed one with no ladder at all, shows no
 * quality control rather than a menu that cannot do anything. Selecting a
 * rendition really constrains playback to it (the item swaps the source to
 * that rendition's own variant playlist); it is not a label over an
 * unchanged player.
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
  /**
   * The renditions this video genuinely offers, already ordered and
   * labelled. EMPTY means "no real choice exists here" and the whole
   * section is omitted - never rendered as a disabled or single-entry menu.
   */
  readonly qualityOptions: readonly PlaybackQualityOption[];
  /**
   * The quality to mark as selected. The feed item passes the EFFECTIVE
   * quality (`resolveEffectiveQuality`), so the checkmark can never sit on a
   * rendition the player is not actually on.
   */
  readonly playbackQuality: PlaybackQuality;
  readonly onSelectPlaybackQuality: (quality: PlaybackQuality) => void;
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
  qualityOptions,
  playbackQuality,
  onSelectPlaybackQuality,
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

        {qualityOptions.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>{t('feed.quality')}</Text>
            {/* Wraps rather than stretching each chip to an equal share: with
                up to five entries ("Auto" through "1080p HD") equal flex
                squeezes the longest label to the point of truncation, and a
                quality a viewer cannot read is a quality they will not
                pick. */}
            <View style={styles.optionRow}>
              <Pressable
                accessibilityHint={t('feed.qualityAutoOption')}
                accessibilityLabel={t('feed.qualityAuto')}
                accessibilityRole="button"
                accessibilityState={{ selected: playbackQuality.mode === 'auto' }}
                onPress={() => onSelectPlaybackQuality(AUTO_PLAYBACK_QUALITY)}
                style={({ pressed }) => [
                  styles.option,
                  playbackQuality.mode === 'auto' && styles.optionSelected,
                  pressed && styles.pressed,
                ]}
                testID="playback-settings-quality-auto">
                <Text
                  style={[
                    styles.optionText,
                    playbackQuality.mode !== 'auto' && styles.optionTextDimmed,
                  ]}>
                  {t('feed.qualityAuto')}
                </Text>
              </Pressable>

              {qualityOptions.map((option) => {
                const isSelected =
                  playbackQuality.mode === 'manual' && playbackQuality.quality === option.quality;
                // "1080p HD" - the HD marker is localized copy, not an
                // English literal, so a zh viewer reads "1080p 高清". The
                // rendition token itself ("1080p") is deliberately NOT
                // translated: it is the backend's own rendition name and
                // reads identically in every streaming app in every locale.
                const label = option.isHighDefinition
                  ? `${option.quality} ${t('feed.qualityHd')}`
                  : option.quality;

                return (
                  <Pressable
                    accessibilityLabel={t('feed.qualityOption', { label })}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={option.quality}
                    onPress={() =>
                      onSelectPlaybackQuality({ mode: 'manual', quality: option.quality })
                    }
                    style={({ pressed }) => [
                      styles.option,
                      isSelected && styles.optionSelected,
                      pressed && styles.pressed,
                    ]}
                    testID={`playback-settings-quality-${option.quality}`}>
                    <Text style={[styles.optionText, !isSelected && styles.optionTextDimmed]}>
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

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

        {/* The whole row is the target, matching the Fullscreen row below.
            Two visually identical adjacent rows where only one accepts a tap
            on its label is exactly the kind of precision demand this sheet
            exists to remove. The Switch itself leaves the accessibility tree
            so the row announces once, as a switch, with its checked state. */}
        <Pressable
          accessibilityLabel={t('feed.clearDisplay')}
          accessibilityRole="switch"
          accessibilityState={{ checked: isClearDisplay }}
          onPress={onToggleClearDisplay}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          testID="playback-settings-clear-display-row">
          <Text style={styles.rowLabel}>{t('feed.clearDisplay')}</Text>
          <Switch
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            ios_backgroundColor={Palette.surfaceMuted}
            onValueChange={onToggleClearDisplay}
            testID="playback-settings-clear-display"
            thumbColor="#fff"
            trackColor={{ false: Palette.surfaceMuted, true: Palette.primary }}
            value={isClearDisplay}
          />
        </Pressable>

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
  optionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  option: {
    paddingHorizontal: 16,
    // Matches the speed chips: 48 clears Android's 48dp minimum as well as
    // iOS's 44pt.
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  optionSelected: {
    borderColor: Palette.primary,
    backgroundColor: 'rgba(255, 122, 26, 0.14)',
  },
  optionText: {
    fontSize: 15,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  optionTextDimmed: {
    color: Palette.textSecondary,
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
