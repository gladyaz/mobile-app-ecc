import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranslation } from '@/stores/language';

type PremiumPreviewModalProps = {
  readonly visible: boolean;
  readonly onDismiss: () => void;
  readonly onGoToFreeEpisode?: () => void;
};

/**
 * Blocks premium-episode playback with a message only. No payment,
 * subscription, credit balance, or purchase flow exists yet.
 *
 * THE "Segera Hadir" ("Coming Soon") PRIMARY BUTTON WAS REMOVED HERE. It was
 * the last remnant of the removed payment direction: it promised a purchase
 * flow this build does not have and will not ship, and it was wired to
 * `onDismiss`, so pressing it did nothing but close the sheet. A control whose
 * label describes something that never happens is exactly the "production must
 * not pretend" failure - a first-time viewer reads it as "wait for this", and
 * there is nothing to wait for.
 *
 * What replaces it is the honest shape of the same decision. The viewer has
 * exactly two real options, and the layout now says so: go watch something
 * they CAN watch, or close. `onGoToFreeEpisode` is the genuinely useful one,
 * so it takes the primary treatment when a free episode exists; closing is
 * always present and always reachable, which is what stops the dialog from
 * becoming a dead end for the (common) caller that has no free episode to
 * offer and would otherwise leave the card with no visible way out at all -
 * `onRequestClose` only covers the Android hardware back gesture.
 *
 * All three strings go through the shared catalog. They were hardcoded
 * Indonesian literals in a component the app renders in ID, EN and ZH, so a
 * viewer who had switched language met one dialog that had not switched with
 * the rest of the app.
 */
export function PremiumPreviewModal({
  visible,
  onDismiss,
  onGoToFreeEpisode,
}: PremiumPreviewModalProps) {
  const { t } = useTranslation();

  return (
    <Modal animationType="fade" onRequestClose={onDismiss} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.message}>{t('feed.premiumPreviewMessage')}</Text>
          {onGoToFreeEpisode ? (
            <Pressable
              accessibilityRole="button"
              onPress={onGoToFreeEpisode}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}>
              <Text style={styles.primaryButtonText}>{t('feed.premiumPreviewGoToFree')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}>
            <Text style={styles.secondaryButtonText}>{t('feed.premiumPreviewClose')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    paddingHorizontal: 32,
  },
  card: {
    width: '100%',
    padding: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  message: {
    fontSize: 17,
    lineHeight: 24,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  primaryButton: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#d11f3f',
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
  },
  secondaryButton: {
    // 44pt minimum. For a series with no free episode this is the ONLY
    // visible way out of the dialog - drama-feed-item.tsx and series/[id].tsx
    // both pass `onGoToFreeEpisode: undefined` in that case - so a target that
    // is hard to hit turns the card back into the dead end this change removed.
    minHeight: 44,
    justifyContent: 'center',
    marginTop: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#4b5563',
  },
  buttonPressed: {
    opacity: 0.7,
  },
});
