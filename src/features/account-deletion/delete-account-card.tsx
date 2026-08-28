import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { FontFamily, Palette, Radius } from '@/constants/theme';
import {
  DELETION_METHOD_HINTS,
  DELETION_METHOD_LABELS,
  NO_DELETION_METHOD_MESSAGE,
} from '@/features/account-deletion/deletion-copy';
import {
  DELETION_OTP_CODE_LENGTH,
  useAccountDeletion,
} from '@/features/account-deletion/use-account-deletion';
import type { DeletionProofMethod } from '@/services/auth/account-deletion-service';

/**
 * The "Hapus Akun" danger zone, for every V1 sign-in method.
 *
 * WHAT IT REPLACES. This card used to be a password field and nothing else,
 * plus a paragraph telling a Google-only or WhatsApp-only viewer to email
 * support - which was the app admitting it could create accounts it could not
 * delete. The panel rendered now is whichever one the SERVER says this
 * account can actually use (`GET /users/me/deletion/methods`), so the control
 * on screen is always one that can succeed.
 *
 * ONE STEP VISIBLE AT A TIME, which is the whole layout rule here. A viewer
 * arriving at this card is doing something irreversible and probably
 * upsetting; showing three panels at once and asking them to work out which
 * applies is exactly how somebody mis-taps a permanent action. So: the method
 * picker appears ONLY when there is genuinely a choice, one hint line says
 * what the next step will ask for before it asks, and the destructive button
 * does not appear at all until the flow has reached the step where pressing
 * it means something (see `isAtProofStep`).
 *
 * THE CONFIRMATION IS NEVER SKIPPED. Every method routes through the same
 * unmissable "this is permanent and cannot be undone" dialog before a single
 * request is sent - the precedent `account-security.tsx` set for destructive
 * actions, applied to the most destructive one there is.
 */
export function DeleteAccountCard() {
  const deletion = useAccountDeletion();
  const {
    methods,
    selectedMethod,
    isLoadingMethods,
    methodsError,
    proofError,
    fieldError,
    deleteError,
    isDeleting,
  } = deletion;

  /**
   * Whether the viewer has reached the step where the destructive button
   * means something.
   *
   * ONE PRIMARY ACTION VISIBLE AT A TIME. Before the proof step, the panel's
   * OWN button ("Lanjutkan dengan Google", "Kirim Kode Verifikasi") is the
   * next thing to press, so rendering a greyed-out "Hapus Akun Saya" beside
   * it would add a second, dead control to a screen where a mis-tap is
   * permanent. Once the step IS reached, the button stays ENABLED even with
   * an empty field, so an empty submit answers with a specific "wajib diisi"
   * rather than silently doing nothing - the behaviour the password flow has
   * always had.
   */
  const isAtProofStep =
    selectedMethod === 'password' ||
    (selectedMethod === 'google' && deletion.isGoogleVerified) ||
    (selectedMethod === 'whatsapp' && deletion.hasRequestedCode);

  return (
    <View style={[styles.card, styles.dangerCard]}>
      <Text style={styles.sectionTitle}>Hapus Akun</Text>
      <Text style={styles.sectionCaption}>
        Tindakan ini bersifat PERMANEN dan TIDAK BISA DIBATALKAN. Seluruh datamu - video yang
        disukai, disimpan, progres tontonan, dan poin rewards - akan langsung dihapus dan tidak
        dapat dipulihkan.
      </Text>

      {isLoadingMethods ? (
        <View style={styles.loadingRow} testID="delete-account-loading">
          <ActivityIndicator color={Palette.primary} size="small" />
          <Text style={styles.sectionCaption}>Memeriksa metode konfirmasimu...</Text>
        </View>
      ) : methodsError ? (
        <View style={styles.errorBanner} testID="delete-account-methods-error">
          <Text style={styles.errorBannerText}>{methodsError}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={deletion.retryLoadMethods}
            style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}
            testID="delete-account-methods-retry">
            <Text style={styles.retryButtonText}>Coba Lagi</Text>
          </Pressable>
        </View>
      ) : !methods || methods.length === 0 || !selectedMethod ? (
        /* An empty list is a TRUTHFUL answer from the backend, not a failure -
           so it gets an explanation and a route onward, never a retry button
           that would just ask the same question again. */
        <Text style={styles.sectionCaption} testID="delete-account-unavailable">
          {NO_DELETION_METHOD_MESSAGE}
        </Text>
      ) : (
        <>
          <MethodPicker
            methods={methods}
            onSelect={deletion.selectMethod}
            selectedMethod={selectedMethod}
          />

          <Text style={styles.hint} testID="delete-account-method-hint">
            {DELETION_METHOD_HINTS[selectedMethod]}
          </Text>

          {selectedMethod === 'password' ? (
            <View style={styles.field}>
              <Text style={styles.label}>Password Saat Ini</Text>
              <TextInput
                accessibilityLabel="Password Saat Ini"
                editable={!isDeleting}
                onChangeText={deletion.setPassword}
                placeholder="••••••••"
                placeholderTextColor={Palette.textMuted}
                secureTextEntry
                style={[styles.input, fieldError && styles.inputError]}
                testID="delete-account-password-input"
                value={deletion.password}
              />
              {fieldError ? <Text style={styles.errorText}>{fieldError}</Text> : null}
            </View>
          ) : null}

          {selectedMethod === 'google' ? (
            <GooglePanel
              isAuthenticating={deletion.isGoogleAuthenticating}
              isBusy={isDeleting}
              isVerified={deletion.isGoogleVerified}
              onAuthenticate={deletion.authenticateWithGoogle}
            />
          ) : null}

          {selectedMethod === 'whatsapp' ? (
            <WhatsAppPanel
              canResend={deletion.canResendCode}
              code={deletion.code}
              fieldError={fieldError}
              hasRequestedCode={deletion.hasRequestedCode}
              isBusy={isDeleting}
              isRequestingCode={deletion.isRequestingCode}
              onChangeCode={deletion.setCode}
              onRequestCode={deletion.requestDeletionCode}
              secondsUntilResend={deletion.secondsUntilResend}
            />
          ) : null}

          {proofError ? (
            <View style={styles.errorBanner} testID="delete-account-proof-error">
              <Text style={styles.errorBannerText}>{proofError}</Text>
            </View>
          ) : null}

          {isAtProofStep ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: isDeleting }}
              disabled={isDeleting}
              onPress={deletion.requestDelete}
              style={({ pressed }) => [styles.dangerButton, pressed && styles.buttonPressed]}
              testID="delete-account-submit">
              <Text style={styles.dangerButtonText}>Hapus Akun Saya</Text>
            </Pressable>
          ) : null}
        </>
      )}

      <ConfirmDialog
        cancelLabel="Batal"
        confirmLabel="Ya, Hapus Akun Saya Selamanya"
        isConfirming={isDeleting}
        isDestructive
        message={
          deleteError
            ? `${deleteError} Tekan tombol di bawah untuk mencoba lagi.`
            : 'Tindakan ini PERMANEN dan TIDAK BISA DIBATALKAN. Akun beserta seluruh datamu akan dihapus sekarang juga.'
        }
        onCancel={deletion.cancelDelete}
        onConfirm={deletion.confirmDelete}
        title="Hapus Akun Secara Permanen?"
        visible={deletion.isConfirmVisible}
      />

      {/* The failure message also lives OUTSIDE the dialog, because a refusal
          that invalidated the method list closes the dialog to re-render the
          panel underneath - and a message that vanished with it would leave
          the viewer with a silently changed screen and no reason for it. */}
      {deleteError && !deletion.isConfirmVisible ? (
        <View style={styles.errorBanner} testID="delete-account-error">
          <Text style={styles.errorBannerText}>{deleteError}</Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Rendered ONLY when the account genuinely has more than one usable method. A
 * single-option picker is a control that cannot be operated, and it would
 * imply a decision the viewer does not have to make.
 */
function MethodPicker({
  methods,
  selectedMethod,
  onSelect,
}: {
  readonly methods: readonly DeletionProofMethod[];
  readonly selectedMethod: DeletionProofMethod;
  readonly onSelect: (method: DeletionProofMethod) => void;
}) {
  if (methods.length < 2) {
    return null;
  }

  return (
    <View style={styles.methodPicker} testID="delete-account-method-picker">
      {methods.map((method) => {
        const isSelected = method === selectedMethod;

        return (
          <Pressable
            accessibilityLabel={`Konfirmasi dengan ${DELETION_METHOD_LABELS[method]}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isSelected }}
            hitSlop={6}
            key={method}
            onPress={() => onSelect(method)}
            style={({ pressed }) => [
              styles.methodChip,
              isSelected && styles.methodChipSelected,
              pressed && styles.buttonPressed,
            ]}
            testID={`delete-account-method-${method}`}>
            <Text style={[styles.methodChipText, isSelected && styles.methodChipTextSelected]}>
              {DELETION_METHOD_LABELS[method]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Step one of the Google flow: prove control of the Google account, THEN
 * confirm the deletion.
 *
 * The verified state is stated plainly rather than left implicit in a
 * suddenly-enabled button, because "why can I press this now" is the question
 * a two-step destructive flow otherwise leaves unanswered.
 */
function GooglePanel({
  isVerified,
  isAuthenticating,
  isBusy,
  onAuthenticate,
}: {
  readonly isVerified: boolean;
  readonly isAuthenticating: boolean;
  readonly isBusy: boolean;
  readonly onAuthenticate: () => void;
}) {
  if (isVerified) {
    return (
      <View style={styles.verifiedRow} testID="delete-account-google-verified">
        <Text style={styles.verifiedText}>Akun Google terverifikasi.</Text>
        <Pressable
          accessibilityLabel="Verifikasi ulang dengan Google"
          accessibilityRole="button"
          disabled={isBusy}
          hitSlop={6}
          onPress={onAuthenticate}
          style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
          testID="delete-account-google-reverify">
          <Text style={styles.linkButtonText}>Ganti Akun</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isAuthenticating || isBusy }}
      disabled={isAuthenticating || isBusy}
      onPress={onAuthenticate}
      style={({ pressed }) => [
        styles.secondaryButton,
        (pressed || isAuthenticating) && styles.buttonPressed,
      ]}
      testID="delete-account-google-button">
      {isAuthenticating ? (
        <ActivityIndicator color={Palette.text} size="small" />
      ) : (
        <Text style={styles.secondaryButtonText}>Lanjutkan dengan Google</Text>
      )}
    </Pressable>
  );
}

/**
 * Step one of the WhatsApp flow: get a deletion code delivered to the number
 * this account already has linked, then type it in.
 *
 * The number is deliberately NOT shown or asked for: the backend reads it
 * from the account's own identity and this screen never handles it, which is
 * what keeps the route from becoming a way to send messages anywhere else.
 */
function WhatsAppPanel({
  hasRequestedCode,
  isRequestingCode,
  isBusy,
  code,
  onChangeCode,
  onRequestCode,
  fieldError,
  secondsUntilResend,
  canResend,
}: {
  readonly hasRequestedCode: boolean;
  readonly isRequestingCode: boolean;
  readonly isBusy: boolean;
  readonly code: string;
  readonly onChangeCode: (next: string) => void;
  readonly onRequestCode: () => void;
  readonly fieldError: string | null;
  readonly secondsUntilResend: number;
  readonly canResend: boolean;
}) {
  if (!hasRequestedCode) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isRequestingCode || isBusy }}
        disabled={isRequestingCode || isBusy}
        onPress={onRequestCode}
        style={({ pressed }) => [
          styles.secondaryButton,
          (pressed || isRequestingCode) && styles.buttonPressed,
        ]}
        testID="delete-account-request-code">
        {isRequestingCode ? (
          <ActivityIndicator color={Palette.text} size="small" />
        ) : (
          <Text style={styles.secondaryButtonText}>Kirim Kode Verifikasi</Text>
        )}
      </Pressable>
    );
  }

  return (
    <>
      <View style={styles.field}>
        <Text style={styles.label}>Kode Verifikasi</Text>
        <TextInput
          accessibilityLabel="Kode Verifikasi"
          autoComplete="sms-otp"
          editable={!isBusy}
          keyboardType="number-pad"
          maxLength={DELETION_OTP_CODE_LENGTH}
          onChangeText={onChangeCode}
          placeholder="000000"
          placeholderTextColor={Palette.textMuted}
          style={[styles.input, fieldError && styles.inputError]}
          testID="delete-account-otp-input"
          textContentType="oneTimeCode"
          value={code}
        />
        {fieldError ? <Text style={styles.errorText}>{fieldError}</Text> : null}
      </View>

      <Pressable
        accessibilityLabel={
          canResend ? 'Kirim ulang kode' : `Kirim ulang kode dalam ${secondsUntilResend} detik`
        }
        accessibilityRole="button"
        accessibilityState={{ disabled: !canResend || isRequestingCode || isBusy }}
        disabled={!canResend || isRequestingCode || isBusy}
        hitSlop={6}
        onPress={onRequestCode}
        style={({ pressed }) => [styles.linkButton, pressed && styles.buttonPressed]}
        testID="delete-account-resend-code">
        <Text style={[styles.linkButtonText, !canResend && styles.linkButtonTextMuted]}>
          {canResend ? 'Kirim ulang kode' : `Kirim ulang kode dalam ${secondsUntilResend}s`}
        </Text>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  dangerCard: {
    borderColor: 'rgba(239, 68, 68, 0.35)',
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  sectionCaption: {
    marginTop: -6,
    fontSize: 11.5,
    lineHeight: 17,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
  },
  hint: {
    marginTop: -4,
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  methodPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  methodChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.background,
  },
  methodChipSelected: {
    borderColor: Palette.primary,
    backgroundColor: Palette.surfaceMuted,
  },
  methodChipText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  methodChipTextSelected: {
    color: Palette.text,
  },
  field: {
    gap: 7,
  },
  label: {
    fontSize: 12,
    fontFamily: FontFamily.bold,
    letterSpacing: 0.3,
    color: Palette.textSecondary,
  },
  input: {
    height: 48,
    paddingHorizontal: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.background,
    fontSize: 14,
    fontFamily: FontFamily.regular,
    color: Palette.text,
  },
  inputError: {
    borderColor: Palette.error,
  },
  errorText: {
    fontSize: 11.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.error,
  },
  secondaryButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  secondaryButtonText: {
    fontSize: 13.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  verifiedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.background,
  },
  verifiedText: {
    flex: 1,
    fontSize: 12.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.text,
  },
  linkButton: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  linkButtonText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.primary,
  },
  linkButtonTextMuted: {
    color: Palette.textMuted,
  },
  errorBanner: {
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.35)',
    borderRadius: Radius.md,
    backgroundColor: 'rgba(239, 68, 68, 0.09)',
  },
  errorBannerText: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: FontFamily.regular,
    color: '#F87171',
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: Palette.error,
  },
  retryButtonText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  dangerButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.error,
  },
  dangerButtonText: {
    fontSize: 13.5,
    fontFamily: FontFamily.bold,
    color: Palette.error,
  },
  buttonPressed: {
    opacity: 0.75,
  },
});
