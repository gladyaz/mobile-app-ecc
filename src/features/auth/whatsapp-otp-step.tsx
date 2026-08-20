import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import {
  AuthErrorBanner,
  AuthPrimaryButton,
  AuthTextField,
} from '@/features/auth/auth-primitives';
import { useTranslation } from '@/stores/language';

/** The backend issues six-digit codes; the field stops accepting input at
 * that length so a stray keystroke cannot produce a silently wrong code. */
export const OTP_CODE_LENGTH = 6;

type WhatsAppOtpStepProps = {
  readonly maskedPhone: string;
  readonly code: string;
  readonly onChangeCode: (next: string) => void;
  readonly fieldError: string | null;
  readonly formError: string | null;
  readonly isVerifying: boolean;
  readonly isResending: boolean;
  readonly secondsUntilResend: number;
  readonly canResend: boolean;
  readonly onVerify: () => void;
  readonly onResend: () => void;
  readonly onChangeNumber: () => void;
};

/**
 * Step two of WhatsApp login: the six-digit code.
 *
 * Everything a stuck viewer might need is on this one screen - what number
 * the code went to, how long until they can ask for another, and a way back
 * to fix a wrong number - because the usual failure here is not a wrong
 * code, it is a code that never arrives.
 */
export function WhatsAppOtpStep({
  maskedPhone,
  code,
  onChangeCode,
  fieldError,
  formError,
  isVerifying,
  isResending,
  secondsUntilResend,
  canResend,
  onVerify,
  onResend,
  onChangeNumber,
}: WhatsAppOtpStepProps) {
  const { t } = useTranslation();
  const isBusy = isVerifying || isResending;

  return (
    <View style={styles.step}>
      {formError ? <AuthErrorBanner message={formError} testID="whatsapp-error" /> : null}

      <Text style={styles.sentTo}>{t('whatsapp.otpSubtitle', { phone: maskedPhone })}</Text>

      <AuthTextField
        accessibilityLabel={t('whatsapp.otpLabel')}
        autoComplete="sms-otp"
        error={fieldError}
        isEditable={!isBusy}
        keyboardType="number-pad"
        label={t('whatsapp.otpLabel')}
        maxLength={OTP_CODE_LENGTH}
        onChangeText={onChangeCode}
        onSubmitEditing={onVerify}
        placeholder={t('whatsapp.otpPlaceholder')}
        returnKeyType="go"
        testID="whatsapp-otp-input"
        textContentType="oneTimeCode"
        value={code}
      />

      <AuthPrimaryButton
        busyLabel={t('whatsapp.verifying')}
        isBusy={isVerifying}
        isDisabled={isResending}
        label={t('whatsapp.verify')}
        onPress={onVerify}
        testID="whatsapp-verify"
      />

      <View style={styles.secondaryRow}>
        <Pressable
          accessibilityLabel={
            canResend ? t('whatsapp.resend') : t('whatsapp.resendIn', { seconds: secondsUntilResend })
          }
          accessibilityRole="button"
          accessibilityState={{ disabled: !canResend || isBusy }}
          disabled={!canResend || isBusy}
          hitSlop={8}
          onPress={onResend}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          testID="whatsapp-resend">
          <Text style={[styles.secondaryText, (!canResend || isBusy) && styles.secondaryTextMuted]}>
            {canResend
              ? t('whatsapp.resend')
              : t('whatsapp.resendIn', { seconds: secondsUntilResend })}
          </Text>
        </Pressable>

        <Pressable
          accessibilityLabel={t('whatsapp.changeNumber')}
          accessibilityRole="button"
          accessibilityState={{ disabled: isBusy }}
          disabled={isBusy}
          hitSlop={8}
          onPress={onChangeNumber}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          testID="whatsapp-change-number">
          <Text style={styles.secondaryText}>{t('whatsapp.changeNumber')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: 16,
  },
  sentTo: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  secondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  secondaryButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  secondaryText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.primary,
  },
  secondaryTextMuted: {
    color: Palette.textMuted,
  },
  pressed: {
    opacity: 0.75,
  },
});
