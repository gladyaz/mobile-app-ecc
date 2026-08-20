import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Palette } from '@/constants/theme';
import {
  AuthErrorBanner,
  AuthFooterLink,
  AuthPrimaryButton,
  AuthScreenHeader,
  AuthTextField,
} from '@/features/auth/auth-primitives';
import { ApiError } from '@/services/api/client';
import { useAuth } from '@/stores/auth';
import { useTranslation } from '@/stores/language';
import { useToast } from '@/stores/toast';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

// Mirrors the backend's RegisterDto password policy exactly
// (short-drama-backend `MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH`, the same
// source of truth `/auth/change-password` uses - see
// `app/account-security.tsx`, which states the same two numbers for the same
// reason). Checking it here turns a round trip and a rejection into
// immediate, specific guidance.
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 128;

/**
 * Explicit account creation - the replacement for Phase 10B's removed
 * "login silently registers you" behaviour.
 *
 * Registration is now something a person chooses, on a screen that says so,
 * with a confirm-password field so a typo cannot quietly become the
 * password to an account they can never log back into.
 *
 * On success the new account is signed straight in through the same session
 * path every other method uses (`stores/auth.tsx`'s `registerWithEmail`),
 * so there is no "registered but still logged out" dead end.
 */
export default function RegisterScreen() {
  const { t } = useTranslation();
  const { registerWithEmail } = useAuth();
  const { showToast } = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const trimmedEmail = email.trim();
  const emailError = isSubmitted
    ? !trimmedEmail
      ? t('login.emailRequired')
      : !EMAIL_PATTERN.test(trimmedEmail)
        ? t('login.emailInvalid')
        : null
    : null;
  const passwordError = isSubmitted
    ? !password
      ? t('register.passwordRequired')
      : password.length < MIN_PASSWORD_LENGTH
        ? t('register.passwordTooShort')
        : password.length > MAX_PASSWORD_LENGTH
          ? t('register.passwordTooLong')
          : null
    : null;
  const confirmError =
    isSubmitted && confirmPassword !== password ? t('register.confirmMismatch') : null;

  const goToLogin = useCallback(() => {
    if (router.canGoBack()) {
      router.back();

      return;
    }

    router.replace('/login');
  }, []);

  const handleRegister = useCallback(async () => {
    setIsSubmitted(true);
    setFormError(null);

    const isEmailInvalid = !trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail);
    const isPasswordInvalid =
      !password || password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH;

    if (isEmailInvalid || isPasswordInvalid || confirmPassword !== password) {
      return;
    }

    setIsSubmitting(true);

    try {
      await registerWithEmail(trimmedEmail, password);
      router.replace('/profile');
      showToast(t('register.welcome'));
    } catch (error) {
      // An already-registered email is the one failure with a specific,
      // actionable answer: sign in instead. Everything else is reported as
      // a generic failure - this screen must not become an oracle for
      // which emails exist beyond what the viewer just tried to claim.
      setFormError(
        error instanceof ApiError && error.code === 'EMAIL_ALREADY_REGISTERED'
          ? t('register.emailTaken')
          : t('register.failed')
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [confirmPassword, password, registerWithEmail, showToast, t, trimmedEmail]);

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <AuthScreenHeader
          backAccessibilityLabel={t('common.back')}
          backTestID="register-back"
          onBack={goToLogin}
          subtitle={t('register.subtitle')}
          title={t('register.title')}
        />

        <View style={styles.form}>
          {formError ? <AuthErrorBanner message={formError} testID="register-error" /> : null}

          <AuthTextField
            accessibilityLabel={t('login.email')}
            autoComplete="email"
            error={emailError}
            isEditable={!isSubmitting}
            keyboardType="email-address"
            label={t('login.email')}
            onChangeText={setEmail}
            placeholder={t('login.emailPlaceholder')}
            returnKeyType="next"
            testID="register-email-input"
            textContentType="emailAddress"
            value={email}
          />

          <AuthTextField
            accessibilityLabel={t('register.password')}
            autoComplete="new-password"
            error={passwordError}
            hint={t('register.passwordHint')}
            isEditable={!isSubmitting}
            isSecure
            label={t('register.password')}
            onChangeText={setPassword}
            placeholder="••••••••"
            returnKeyType="next"
            testID="register-password-input"
            textContentType="newPassword"
            value={password}
          />

          <AuthTextField
            accessibilityLabel={t('register.confirmPassword')}
            autoComplete="new-password"
            error={confirmError}
            isEditable={!isSubmitting}
            isSecure
            label={t('register.confirmPassword')}
            onChangeText={setConfirmPassword}
            onSubmitEditing={() => {
              void handleRegister();
            }}
            placeholder="••••••••"
            returnKeyType="go"
            testID="register-confirm-password-input"
            textContentType="newPassword"
            value={confirmPassword}
          />

          <AuthPrimaryButton
            busyLabel={t('register.submitting')}
            isBusy={isSubmitting}
            label={t('register.submit')}
            onPress={() => {
              void handleRegister();
            }}
            testID="register-submit"
          />

          <AuthFooterLink
            actionLabel={t('register.backToLogin')}
            onPress={goToLogin}
            prompt={t('register.haveAccount')}
            testID="register-back-to-login"
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 48,
  },
  form: {
    marginTop: 28,
    gap: 16,
  },
});
