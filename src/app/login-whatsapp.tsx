import { Redirect, router } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Palette } from '@/constants/theme';
import { AuthScreenHeader } from '@/features/auth/auth-primitives';
import {
  describeOtpRequestError,
  describeOtpVerifyError,
} from '@/features/auth/provider-error-messages';
import { useOtpResendCountdown } from '@/features/auth/use-otp-resend-countdown';
import { WhatsAppOtpStep, OTP_CODE_LENGTH } from '@/features/auth/whatsapp-otp-step';
import { WhatsAppPhoneStep } from '@/features/auth/whatsapp-phone-step';
import { ApiError } from '@/services/api/client';
import { maskPhoneNumber, normalizePhoneNumber } from '@/services/auth/phone-number';
import { startWhatsAppOtp } from '@/services/auth/provider-auth-service';
import { isWhatsAppLoginOffered } from '@/services/auth/provider-availability';
import { useAuth } from '@/stores/auth';
import { useTranslation } from '@/stores/language';
import { useToast } from '@/stores/toast';
import type { OtpChallenge } from '@/types/auth';

const HTTP_TOO_MANY_REQUESTS = 429;

/**
 * What a send/resend attempt produced. `isRateLimited` is carried
 * separately from the error copy because it is the one failure the UI
 * reacts to structurally (by re-locking resend) rather than just reporting.
 */
type SendCodeResult =
  | { readonly isSent: true; readonly challenge: OtpChallenge }
  | { readonly isSent: false; readonly isRateLimited: boolean };

/**
 * WhatsApp OTP login, as two steps of one route rather than two routes: the
 * normalized number - which IS the challenge handle - and the challenge's
 * timings live in this component's state, so going back to fix a typo
 * cannot strand a half-finished challenge on another screen's stack entry.
 *
 * ANTI-ENUMERATION (deliberate, do not "improve"): a successful send moves
 * to the code step for EVERY number, registered or not. This screen never
 * asks whether an account exists and has no branch that could reveal it -
 * the only thing that distinguishes a registered number is whether the
 * final verify returns a session, which requires possession of the code.
 *
 * Nothing here hardcodes a code, in any build. The only way past the verify
 * step is a code the backend actually sent over WhatsApp.
 */
export default function WhatsAppLoginScreen() {
  const { t } = useTranslation();
  const { loginWithWhatsApp } = useAuth();
  const { showToast } = useToast();
  const { secondsRemaining, canResend, start: startResendCountdown } = useOtpResendCountdown();

  const [phone, setPhone] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge | null>(null);
  const [phoneE164, setPhoneE164] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [isPhoneSubmitted, setIsPhoneSubmitted] = useState(false);
  const [isCodeSubmitted, setIsCodeSubmitted] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const normalizedPhone = normalizePhoneNumber(phone);
  const phoneFieldError = isPhoneSubmitted
    ? normalizedPhone.status === 'empty'
      ? t('whatsapp.phoneRequired')
      : normalizedPhone.status === 'invalid'
        ? t('whatsapp.phoneInvalid')
        : null
    : null;
  const codeFieldError = isCodeSubmitted
    ? !code
      ? t('whatsapp.otpRequired')
      : code.length !== OTP_CODE_LENGTH
        ? t('whatsapp.otpLength')
        : null
    : null;

  const describeSendError = useCallback(
    (error: unknown): string => t(describeOtpRequestError(error)),
    [t]
  );

  /**
   * The canonical backend answers ONE code for a rejected OTP -
   * `INVALID_OTP` - covering wrong, expired, attempts-exhausted,
   * already-used and no-such-challenge alike. The three distinct messages
   * this screen used to show are gone because the distinction they rendered
   * is one the server must not reveal: telling "expired" from "too many
   * attempts" reports whether an attacker's guessing is making progress,
   * and telling "wrong code" from "no challenge for this number" turns
   * verification into a phone-number enumeration oracle.
   *
   * The 429 branch survives inside `describeOtpVerifyError` and is not the
   * resend cooldown: this callback only ever sees errors from the VERIFY
   * call, so a 429 here is the per-IP verify throttle.
   */
  const describeVerifyError = useCallback(
    (error: unknown): string => t(describeOtpVerifyError(error)),
    [t]
  );

  const handleBack = useCallback(() => {
    if (router.canGoBack()) {
      router.back();

      return;
    }

    router.replace('/login');
  }, []);

  /** Shared by the first send and every resend: one place that talks to the
   * provider service, so both paths get identical error handling and
   * identical (account-existence-free) behaviour. */
  const requestCode = useCallback(
    async (e164: string): Promise<SendCodeResult> => {
      try {
        const nextChallenge = await startWhatsAppOtp(e164);
        setChallenge(nextChallenge);
        setPhoneE164(e164);
        startResendCountdown(nextChallenge.resendAvailableInSeconds);
        setFormError(null);

        return { isSent: true, challenge: nextChallenge };
      } catch (error) {
        setFormError(describeSendError(error));

        return {
          isSent: false,
          isRateLimited: error instanceof ApiError && error.status === HTTP_TOO_MANY_REQUESTS,
        };
      }
    },
    [describeSendError, startResendCountdown]
  );

  const handleSendCode = useCallback(async () => {
    setIsPhoneSubmitted(true);
    setFormError(null);

    if (normalizedPhone.status !== 'valid') {
      return;
    }

    setIsSending(true);

    try {
      await requestCode(normalizedPhone.e164);
    } finally {
      setIsSending(false);
    }
  }, [normalizedPhone, requestCode]);

  const handleResend = useCallback(async () => {
    if (!phoneE164 || !challenge) {
      return;
    }

    setIsResending(true);

    try {
      const result = await requestCode(phoneE164);

      if (result.isSent) {
        // Only cleared once a NEW code is actually on its way. Wiping it up
        // front meant a failed resend also threw away a perfectly good code
        // the viewer had already typed from the first message - while the
        // original challenge was still the valid one.
        setCode('');
        setIsCodeSubmitted(false);
        showToast(t('whatsapp.resent'));

        return;
      }

      if (result.isRateLimited) {
        // Re-locks the button using the countdown the backend already gave
        // us for this challenge, rather than leaving it pressable so the
        // viewer can hammer it into more 429s - which is the exact thing the
        // server-driven countdown exists to prevent. No invented duration:
        // it is the value from the challenge that is still active.
        startResendCountdown(challenge.resendAvailableInSeconds);
      }
    } finally {
      setIsResending(false);
    }
  }, [challenge, phoneE164, requestCode, showToast, startResendCountdown, t]);

  const handleVerify = useCallback(async () => {
    setIsCodeSubmitted(true);
    setFormError(null);

    if (!challenge || !phoneE164 || code.length !== OTP_CODE_LENGTH) {
      return;
    }

    setIsVerifying(true);

    try {
      // The NUMBER is the challenge handle - there is no challenge id, and
      // `phoneE164` is the same normalized value the challenge was started
      // with, including after a resend.
      await loginWithWhatsApp(phoneE164, code);
      router.replace('/profile');
      showToast(t('login.welcome'));
    } catch (error) {
      setFormError(describeVerifyError(error));
    } finally {
      setIsVerifying(false);
    }
  }, [challenge, code, describeVerifyError, loginWithWhatsApp, phoneE164, showToast, t]);

  const handleChangeNumber = useCallback(() => {
    setChallenge(null);
    setPhoneE164(null);
    setCode('');
    setIsCodeSubmitted(false);
    setFormError(null);
  }, []);

  // GATED HERE AS WELL AS ON THE LOGIN SCREEN, for the same reason
  // `processing.tsx` guards itself rather than trusting Profile: `_layout.tsx`
  // registers this as a real route and `app.json` declares the `mobileappecc`
  // URL scheme, so `mobileappecc://login-whatsapp` reaches this screen whatever
  // the login screen chose to render. Hiding only the button would leave a
  // fully functional phone-number form one deep link away in a store build -
  // a viewer could type their real number, tap send, and get a 503 from a
  // provider that cannot exist yet.
  //
  // Placed after every hook so the hook order is identical in both branches.
  // See services/auth/provider-availability.ts for what turns this back on.
  if (!isWhatsAppLoginOffered()) {
    return <Redirect href="/login" />;
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <AuthScreenHeader
          backAccessibilityLabel={t('common.back')}
          backTestID="whatsapp-back"
          onBack={handleBack}
          subtitle={challenge ? undefined : t('whatsapp.phoneSubtitle')}
          title={t('whatsapp.title')}
        />

        <View style={styles.form}>
          {challenge && phoneE164 ? (
            <WhatsAppOtpStep
              canResend={canResend}
              code={code}
              fieldError={codeFieldError}
              formError={formError}
              isResending={isResending}
              isVerifying={isVerifying}
              maskedPhone={maskPhoneNumber(phoneE164)}
              onChangeCode={setCode}
              onChangeNumber={handleChangeNumber}
              onResend={() => {
                void handleResend();
              }}
              onVerify={() => {
                void handleVerify();
              }}
              secondsUntilResend={secondsRemaining}
            />
          ) : (
            <WhatsAppPhoneStep
              fieldError={phoneFieldError}
              formError={formError}
              isSubmitting={isSending}
              onChangePhone={setPhone}
              onSubmit={() => {
                void handleSendCode();
              }}
              phone={phone}
            />
          )}
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
    // No `paddingTop`: `AuthScreenHeader` now owns the status-bar inset for
    // every auth screen, so adding one here would double it.
    paddingBottom: 48,
  },
  form: {
    marginTop: 28,
  },
});
