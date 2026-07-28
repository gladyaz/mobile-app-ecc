import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';

type ConfirmDialogProps = {
  readonly visible: boolean;
  readonly title: string;
  readonly message: string;
  /** Defaults to "Batal". */
  readonly cancelLabel?: string;
  /** Defaults to "Konfirmasi". */
  readonly confirmLabel?: string;
  /** Styles the confirm button as a destructive (red) action. */
  readonly isDestructive?: boolean;
  /** Disables both buttons and shows a spinner on the confirm button. */
  readonly isConfirming?: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
};

/**
 * Reusable confirm step for destructive account-security actions (logout
 * from all devices, revoke a session - Phase 12, work unit 12B-M1). Modeled
 * on `PremiumPreviewModal`'s existing backdrop-card Modal pattern, restyled
 * to the "Red Panda" dark palette used everywhere else in this app.
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  cancelLabel = 'Batal',
  confirmLabel = 'Konfirmasi',
  isDestructive = false,
  isConfirming = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Modal animationType="fade" onRequestClose={onCancel} transparent visible={visible}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              disabled={isConfirming}
              onPress={onCancel}
              style={({ pressed }) => [
                styles.cancelButton,
                (pressed || isConfirming) && styles.buttonPressed,
              ]}
              testID="confirm-dialog-cancel">
              <Text style={styles.cancelButtonText}>{cancelLabel}</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={isConfirming}
              onPress={onConfirm}
              style={({ pressed }) => [
                styles.confirmButton,
                isDestructive && styles.confirmButtonDestructive,
                (pressed || isConfirming) && styles.buttonPressed,
              ]}
              testID="confirm-dialog-confirm">
              {isConfirming ? (
                <ActivityIndicator color={Palette.text} size="small" />
              ) : (
                <Text style={styles.confirmButtonText}>{confirmLabel}</Text>
              )}
            </Pressable>
          </View>
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
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    paddingHorizontal: 28,
  },
  card: {
    width: '100%',
    padding: 20,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  title: {
    fontSize: 16,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  message: {
    marginTop: 8,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  buttonRow: {
    marginTop: 20,
    flexDirection: 'row',
    gap: 10,
  },
  cancelButton: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  cancelButtonText: {
    fontSize: 13.5,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  confirmButton: {
    flex: 1,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    backgroundColor: Palette.primary,
  },
  confirmButtonDestructive: {
    backgroundColor: Palette.error,
  },
  confirmButtonText: {
    fontSize: 13.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  buttonPressed: {
    opacity: 0.75,
  },
});
