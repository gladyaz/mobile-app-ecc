import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Palette, FontFamily } from '@/constants/theme';
import {
  AuthDivider,
  AuthErrorBanner,
  AuthFooterLink,
  AuthPrimaryButton,
  AuthProviderButton,
  AuthScreenHeader,
  AuthTextField,
  PROVIDER_BADGES,
} from '@/features/auth/auth-primitives';
import { describeGoogleLoginError } from '@/features/auth/provider-error-messages';
import { ApiError } from '@/services/api/client';
import { isGoogleSignInConfigured } from '@/services/auth/google-sign-in';
import {
  isAnyProviderLoginOffered,
  isGoogleLoginOffered,
  isWhatsAppLoginOffered,
} from '@/services/auth/provider-availability';
import { isDemoMode } from '@/services/demo/demo-mode';
import { useAuth } from '@/stores/auth';
import { useTranslation } from '@/stores/language';
import { useToast } from '@/stores/toast';

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/** How far the register prompt may drift from the provider rows above it: it
 * follows them down a tall screen, but never far enough to read as a gap. */
const FOOTER_GAP_MIN = 20;
const FOOTER_GAP_MAX = 44;

/**
 * The app's single entry point for signing in, offering all three methods
 * side by side: email + password, Google, and WhatsApp OTP.
 *
 * What changed in Phase 10B, and why it matters: this screen used to
 * promise "any valid email and any password - an account is created if you
 * do not have one", and `stores/auth.tsx` delivered exactly that by calling
 * `POST /auth/register` whenever login returned INVALID_CREDENTIALS. A
 * mistyped password therefore created a second, empty account. Login now
 * only logs in; creating an account is a deliberate trip to `/register`.
 *
 * Every provider ends in the same place - the existing session store, with
 * the app's own access/refresh pair - so nothing downstream (Profile,
 * entitlement, saved/progress ownership) can tell how the viewer signed in.
 */
export default function LoginScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { login, loginWithGoogle, isAuthenticated, isHydrated } = useAuth();
  const { showToast } = useToast();

  /**
   * Redirects an already-signed-in viewer away, mirroring the guard
   * `account-security.tsx` uses.
   *
   * This matters now in a way it did not before Phase 10B. Login used to be
   * the only auth route, so its own `router.replace('/profile')` always
   * consumed its stack entry. `/register` and `/login-whatsapp` are PUSHED
   * on top of it and replace only the top entry on success, leaving
   * `[(tabs), login, profile]` - so Android back / iOS swipe landed on the
   * login form while already authenticated, where signing in again would
   * mint a second session without revoking the first.
   */
  useEffect(() => {
    if (isHydrated && isAuthenticated) {
      router.replace('/profile');
    }
  }, [isAuthenticated, isHydrated]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // A demo build has no backend to register against, and no provider to
  // exchange a token with. Those entry points are hidden rather than left
  // to fail when someone taps them - the same choice profile.tsx already
  // makes for its backend-only rows.
  //
  // The provider rows extend that same rule to a build that HAS a backend but
  // whose backend cannot serve a given method. See
  // services/auth/provider-availability.ts for why each one is gated and what
  // turns it back on; nothing about either provider's implementation changes.
  const isBackendAvailable = !isDemoMode();
  const hasAnyProvider = isBackendAvailable && isAnyProviderLoginOffered();
  const isGoogleVisible = isBackendAvailable && isGoogleLoginOffered();
  const isWhatsAppVisible = isBackendAvailable && isWhatsAppLoginOffered();
  const isGoogleReady = isGoogleSignInConfigured();

  const trimmedEmail = email.trim();
  const emailError = isSubmitted
    ? !trimmedEmail
      ? t('login.emailRequired')
      : !EMAIL_PATTERN.test(trimmedEmail)
        ? t('login.emailInvalid')
        : null
    : null;
  const passwordError = isSubmitted && !password ? t('login.passwordRequired') : null;
  const isBusy = isSubmitting || isGoogleSubmitting;

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();

      return;
    }

    router.replace('/');
  }, []);

  const handleLogin = useCallback(async () => {
    setIsSubmitted(true);
    setFormError(null);

    if (!trimmedEmail || !EMAIL_PATTERN.test(trimmedEmail) || !password) {
      return;
    }

    setIsSubmitting(true);

    try {
      await login(trimmedEmail, password);
      router.replace('/profile');
      showToast(t('login.welcome'));
    } catch (error) {
      // The backend answers INVALID_CREDENTIALS for both a wrong password
      // and an unknown email, and deliberately does not distinguish them.
      // The copy therefore points at registration as a possibility without
      // claiming this email is or isn't registered.
      setFormError(
        error instanceof ApiError && error.code === 'INVALID_CREDENTIALS'
          ? t('login.invalidCredentials')
          : t('login.failed')
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [login, password, showToast, t, trimmedEmail]);

  const handleGoogleLogin = useCallback(async () => {
    setFormError(null);
    setIsGoogleSubmitting(true);

    try {
      const outcome = await loginWithGoogle();

      switch (outcome.status) {
        case 'success':
          router.replace('/profile');
          showToast(t('login.welcome'));

          return;
        case 'cancelled':
          // The viewer dismissed the Google sheet on purpose. Saying
          // anything here would be scolding them for it.
          return;
        case 'unconfigured':
          // `developerMessage` names the missing env keys and is already
          // logged by the adapter in dev; the banner stays user-readable.
          setFormError(
            __DEV__ ? t('login.googleDevHint') : t('login.googleUnavailable')
          );

          return;
        case 'unsupported':
          setFormError(t('login.googleUnavailable'));

          return;
        default:
          setFormError(t('login.googleFailed'));
      }
    } catch (error) {
      // A real failure from the backend exchange, distinct from every
      // branch above (which are outcomes of the native sheet).
      //
      // These are NOT all one failure, and must not be reported as one.
      // `AUTH_ACCOUNT_LINK_REQUIRED` in particular means an account already
      // exists for this Google address and the ONLY way forward is to sign
      // in with the existing method and link Google from Account Security -
      // matching email addresses never merge accounts. Reporting that as
      // "Login Google gagal" leaves a correct security boundary looking
      // like a bug, which is how it ends up getting weakened.
      setFormError(t(describeGoogleLoginError(error)));
    } finally {
      setIsGoogleSubmitting(false);
    }
  }, [loginWithGoogle, showToast, t]);

  return (
    <View style={styles.container}>
      <ScrollView
        // iOS insets the scroll content by the keyboard height, so the CTA and
        // the provider rows stay reachable without a KeyboardAvoidingView -
        // which this app does not use anywhere. Android needs no equivalent:
        // Expo's default `resize` soft-input mode shrinks the window, and this
        // ScrollView simply scrolls inside what is left.
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <AuthScreenHeader
          backAccessibilityLabel={t('common.back')}
          backTestID="login-back"
          onBack={handleBack}
          subtitle={t('login.subtitle')}
          title={t('login.title')}
        />

        <View style={styles.form}>
          {formError ? <AuthErrorBanner message={formError} testID="login-error" /> : null}

          <AuthTextField
            accessibilityLabel={t('login.email')}
            autoComplete="email"
            error={emailError}
            keyboardType="email-address"
            label={t('login.email')}
            onChangeText={setEmail}
            placeholder={t('login.emailPlaceholder')}
            isEditable={!isBusy}
            returnKeyType="next"
            testID="login-email-input"
            textContentType="emailAddress"
            value={email}
          />

          <AuthTextField
            accessibilityLabel={t('login.password')}
            autoComplete="current-password"
            error={passwordError}
            isEditable={!isBusy}
            isSecure
            label={t('login.password')}
            onChangeText={setPassword}
            onSubmitEditing={() => {
              void handleLogin();
            }}
            placeholder="••••••••"
            returnKeyType="go"
            testID="login-password-input"
            textContentType="password"
            value={password}
          />

          <AuthPrimaryButton
            busyLabel={t('login.submitting')}
            isBusy={isSubmitting}
            isDisabled={isGoogleSubmitting}
            label={t('login.submit')}
            onPress={() => {
              void handleLogin();
            }}
            testID="login-submit"
          />

          <Text style={styles.hint}>{t('login.hint')}</Text>

          {hasAnyProvider ? (
            <>
              <AuthDivider label={t('login.orContinueWith')} />

              {isGoogleVisible ? (
                <View style={styles.providerBlock}>
                  <AuthProviderButton
                    badge={PROVIDER_BADGES.google}
                    isBusy={isGoogleSubmitting}
                    isDisabled={isSubmitting}
                    label={t('login.google')}
                    onPress={() => {
                      void handleGoogleLogin();
                    }}
                    testID="login-google"
                  />
                  {/* Development-only, and only when the build genuinely has
                      no Google client IDs: the button stays pressable so the
                      failure is reproducible, but the reason is stated up
                      front instead of after a mysterious dead tap. */}
                  {__DEV__ && !isGoogleReady ? (
                    <Text style={styles.devHint} testID="login-google-config-hint">
                      {t('login.googleDevHint')}
                    </Text>
                  ) : null}
                </View>
              ) : null}

              {isWhatsAppVisible ? (
                <AuthProviderButton
                  badge={PROVIDER_BADGES.whatsapp}
                  isDisabled={isBusy}
                  label={t('login.whatsapp')}
                  onPress={() => {
                    router.push('/login-whatsapp');
                  }}
                  testID="login-whatsapp"
                />
              ) : null}
            </>
          ) : null}
        </View>

        {/* Outside `styles.form` on purpose, so the bounded spacer below can
            sit between the provider rows and the register prompt as a direct
            child of the flex-grown content container.

            The spacer takes the leftover height, but only up to
            FOOTER_GAP_MAX. Letting it take ALL of it - the obvious
            `marginTop: 'auto'` - pinned the prompt to the bottom edge and
            opened a 234pt hole under the WhatsApp row on a 360x800 screen,
            because the column is much shorter than the viewport once the
            provider rows are the last thing in it. Capping keeps the stack
            reading as one block; whatever is left over falls below it as
            ordinary bottom whitespace. On a screen too short for the column
            the spacer holds at FOOTER_GAP_MIN and the ScrollView scrolls. */}
        {isBackendAvailable ? (
          <>
            <View style={styles.footerSpacer} />
            <AuthFooterLink
              actionLabel={t('login.registerWithEmail')}
              onPress={() => {
                router.push('/register');
              }}
              prompt={t('login.noAccount')}
              testID="login-register-email"
            />
          </>
        ) : null}
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
    // Grows to at least the viewport so the register prompt can bottom-anchor;
    // beyond that the ScrollView scrolls as usual. The top inset belongs to
    // `AuthScreenHeader`, which owns it for all three auth screens.
    flexGrow: 1,
    paddingHorizontal: 20,
  },
  form: {
    marginTop: 24,
    gap: 16,
  },
  providerBlock: {
    gap: 6,
  },
  hint: {
    // Pulled up against the button it explains, so it reads as part of the
    // same block rather than as another item in the stack.
    marginTop: -6,
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
    textAlign: 'center',
  },
  footerSpacer: {
    flexGrow: 1,
    minHeight: FOOTER_GAP_MIN,
    maxHeight: FOOTER_GAP_MAX,
  },
  devHint: {
    fontSize: 11,
    lineHeight: 16,
    fontFamily: FontFamily.semiBold,
    color: Palette.warning,
  },
});
