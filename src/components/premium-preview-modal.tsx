import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

type PremiumPreviewModalProps = {
  readonly visible: boolean;
  readonly onDismiss: () => void;
  readonly onGoToFreeEpisode?: () => void;
};

/**
 * Blocks premium-episode playback with a message only. No payment,
 * subscription, credit balance, or purchase flow exists yet.
 */
export function PremiumPreviewModal({
  visible,
  onDismiss,
  onGoToFreeEpisode,
}: PremiumPreviewModalProps) {
  return (
    <Modal animationType="fade" onRequestClose={onDismiss} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.message}>Episode ini termasuk konten premium.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.buttonPressed]}>
            <Text style={styles.primaryButtonText}>Segera Hadir</Text>
          </Pressable>
          {onGoToFreeEpisode ? (
            <Pressable
              accessibilityRole="button"
              onPress={onGoToFreeEpisode}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.buttonPressed]}>
              <Text style={styles.secondaryButtonText}>Kembali ke Episode Gratis</Text>
            </Pressable>
          ) : null}
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
