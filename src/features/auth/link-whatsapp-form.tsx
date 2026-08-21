import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import {
  AuthErrorBanner,
  AuthPrimaryButton,
  AuthTextField,
} from '@/features/auth/auth-primitives';
import {
  describeIdentityLinkError,
  describeOtpRequestError,
} from '@/features/auth/provider-error-messages';
import { useOtpResendCountdown } from '@/features/auth/use-otp-resend-countdown';
import { OTP_CODE_LENGTH } from '@/features/auth/whatsapp-otp-step';
import { normalizePhoneNumber } from '@/services/auth/phone-number';
import {
  linkWhatsAppIdentity,
  startWhatsAppOtp,
} from '@/services/auth/provider-auth-service';
import { useTranslation } from '@/stores/language';
import type { AuthIdentitySummary } from '@/types/auth';

type LinkWhatsAppFormProps = {
  readonly onLinked: (identities: readonly AuthIdentitySummary[]) => void;
  readonly onCancel: () => void;
};

/**
 * Attaching a WhatsApp number to the account that is ALREADY signed in.
 *
 * Deliberately its own small component rather than a reuse of the login
 * screen's two steps: those steps end in `verifyWhatsAppOtp`, which
 * authenticates as the phone's own account and would sign the viewer OUT of
 * the account they are trying to extend. The OTP challenge itself is shared
 * infrastructure - `startWhatsAppOtp` is the same call - so the ONLY thing
 * that must differ is which endpoint consumes the code, and keeping that in
 * a separate component is what makes the two impossible to confuse.
 *
 * Scope is bounded on purpose: one number, one code, no account switching,
 * no settings redesign. The number is normalized by the same
 * `phone-number.ts` the login flow uses, so `0812…` and `+62 812-…` cannot
 * become two different identities for one person.
 */
export function LinkWhatsAppForm({ onLinked, onCancel }: LinkWhatsAppFormProps) {
  const { t } = useTranslation();
  const { secondsRemaining, canResend, start: startResendCountdown } = useOtpResendCountdown();

  const [phone, setPhone] = useState('');
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [isPhoneSubmitted, setIsPhoneSubmitted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isLinking, setIsLinking] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const normalizedPhone = normalizePhoneNumber(phone);
  const phoneFieldError = isPhoneSubmitted
    ? normalizedPhone.status === 'empty'
      ? t('whatsapp.phoneRequired')
      : normalizedPhone.status === 'invalid'
        ? t('whatsapp.phoneInvalid')
        : null
    : null;

  const sendCode = useCallback(
    async (e164: string) => {
      setIsSending(true);

      try {
        const challenge = await startWhatsAppOtp(e164);
        setPhoneE164(e164);
        startResendCountdown(challenge.resendAvailableInSeconds);
        setFormError(null);
      } catch (error) {
        setFormError(t(describeOtpRequestError(error)));
      } finally {
        setIsSending(false);
      }
    },
    [startResendCountdown, t]
  );

  const handleSendCode = useCallback(() => {
    setIsPhoneSubmitted(true);
    setFormError(null);

    if (normalizedPhone.status !== 'valid') {
      return;
    }

    void sendCode(normalizedPhone.e164);
  }, [normalizedPhone, sendCode]);

  const handleResend = useCallback(() => {
    if (!phoneE164) {
      return;
    }

    void sendCode(phoneE164);
  }, [phoneE164, sendCode]);

  const handleLink = useCallback(async () => {
    if (!phoneE164 || code.length !== OTP_CODE_LENGTH) {
      return;
    }

    setIsLinking(true);
    setFormError(null);

    try {
      // The LINK route, never `verifyWhatsAppOtp`: this attaches the number
      // to the current account and returns that account's updated identity
      // list. Calling verify here would replace the session instead.
      onLinked(await linkWhatsAppIdentity(phoneE164, code));
    } catch (error) {
      setFormError(t(describeIdentityLinkError(error, 'whatsapp')));
    } finally {
      setIsLinking(false);
    }
  }, [code, onLinked, phoneE164, t]);

  return (
    <View style={styles.form} testID="auth-method-link-whatsapp-form">
      <Text style={styles.title}>{t('authMethods.linkWhatsAppTitle')}</Text>
      <Text style={styles.hint}>{t('authMethods.linkWhatsAppHint')}</Text>

      {formError ? (
        <AuthErrorBanner message={formError} testID="auth-method-link-whatsapp-error" />
      ) : null}

      {phoneE164 ? (
        <>
          <AuthTextField
            accessibilityLabel={t('whatsapp.otpLabel')}
            keyboardType="number-pad"
            label={t('whatsapp.otpLabel')}
            maxLength={OTP_CODE_LENGTH}
            onChangeText={setCode}
            placeholder={t('whatsapp.otpPlaceholder')}
            testID="auth-method-link-whatsapp-code"
            value={code}
          />
          <AuthPrimaryButton
            busyLabel={t('authMethods.linking')}
            isBusy={isLinking}
            isDisabled={code.length !== OTP_CODE_LENGTH}
            label={t('authMethods.linkWhatsAppConfirm')}
            onPress={() => {
              void handleLink();
            }}
            testID="auth-method-link-whatsapp-confirm"
          />
          <Pressable
            accessibilityLabel={canResend ? t('whatsapp.resend') : t('whatsapp.resendIn', { seconds: String(secondsRemaining) })}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canResend || isSending }}
            disabled={!canResend || isSending}
            onPress={handleResend}
            style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            testID="auth-method-link-whatsapp-resend">
            <Text style={[styles.secondaryText, !canResend && styles.secondaryTextMuted]}>
              {canResend
                ? t('whatsapp.resend')
                : t('whatsapp.resendIn', { seconds: String(secondsRemaining) })}
            </Text>
          </Pressable>
        </>
      ) : (
        <>
          <AuthTextField
            accessibilityLabel={t('whatsapp.phoneLabel')}
            error={phoneFieldError}
            hint={t('whatsapp.phoneHint')}
            keyboardType="phone-pad"
            label={t('whatsapp.phoneLabel')}
            onChangeText={setPhone}
            placeholder={t('whatsapp.phonePlaceholder')}
            prefix="+62"
            testID="auth-method-link-whatsapp-phone"
            value={phone}
          />
          <AuthPrimaryButton
            busyLabel={t('whatsapp.sending')}
            isBusy={isSending}
            label={t('authMethods.linkWhatsAppSendCode')}
            onPress={handleSendCode}
            testID="auth-method-link-whatsapp-send"
          />
        </>
      )}

      <Pressable
        accessibilityLabel={t('authMethods.linkCancel')}
        accessibilityRole="button"
        onPress={onCancel}
        style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
        testID="auth-method-link-whatsapp-cancel">
        <Text style={styles.secondaryText}>{t('authMethods.linkCancel')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  form: {
    gap: 10,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  title: {
    fontSize: 13.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.text,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  secondary: {
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  secondaryText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  secondaryTextMuted: {
    color: Palette.textMuted,
  },
  pressed: {
    opacity: 0.75,
  },
});
