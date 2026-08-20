import { StyleSheet, View } from 'react-native';

import {
  AuthErrorBanner,
  AuthPrimaryButton,
  AuthTextField,
} from '@/features/auth/auth-primitives';
import { INDONESIA_DIAL_PREFIX } from '@/services/auth/phone-number';
import { useTranslation } from '@/stores/language';

type WhatsAppPhoneStepProps = {
  readonly phone: string;
  readonly onChangePhone: (next: string) => void;
  readonly fieldError: string | null;
  readonly formError: string | null;
  readonly isSubmitting: boolean;
  readonly onSubmit: () => void;
};

/**
 * Step one of WhatsApp login: which number should the code go to.
 *
 * The `+62` affix is fixed rather than a country picker. Indonesia is the
 * audience, and `normalizePhoneNumber` still accepts `0812...`, `62812...`
 * or a pasted `+62 812...` - so the affix is a hint about what is expected,
 * never a trap that silently corrupts a number typed another way.
 */
export function WhatsAppPhoneStep({
  phone,
  onChangePhone,
  fieldError,
  formError,
  isSubmitting,
  onSubmit,
}: WhatsAppPhoneStepProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.step}>
      {formError ? <AuthErrorBanner message={formError} testID="whatsapp-error" /> : null}

      <AuthTextField
        accessibilityLabel={t('whatsapp.phoneLabel')}
        autoComplete="tel"
        error={fieldError}
        hint={t('whatsapp.phoneHint')}
        isEditable={!isSubmitting}
        keyboardType="phone-pad"
        label={t('whatsapp.phoneLabel')}
        onChangeText={onChangePhone}
        onSubmitEditing={onSubmit}
        placeholder={t('whatsapp.phonePlaceholder')}
        prefix={INDONESIA_DIAL_PREFIX}
        returnKeyType="go"
        testID="whatsapp-phone-input"
        textContentType="telephoneNumber"
        value={phone}
      />

      <AuthPrimaryButton
        busyLabel={t('whatsapp.sending')}
        isBusy={isSubmitting}
        label={t('whatsapp.sendCode')}
        onPress={onSubmit}
        testID="whatsapp-send-code"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  step: {
    gap: 16,
  },
});
