import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ConfirmDialog } from '@/components/confirm-dialog';
import { FontFamily, Palette, Radius } from '@/constants/theme';
import { ApiError } from '@/services/api/client';
import { deleteMyAccount } from '@/services/auth/account-deletion-service';
import { listAuthIdentities } from '@/services/auth/provider-auth-service';
import { exportMyData } from '@/services/export/export-service';
import { clearPersistedProgressForIdentity } from '@/stores/series-progress';
import { useAuth } from '@/stores/auth';
import { clearPersistedInteractionsForIdentity } from '@/stores/video-interactions';
import type { UserExport } from '@/types/export';

/**
 * Phase 12, work unit 12C-M1: "Data & Privasi" screen - hosts the two
 * personal-data-lifecycle actions the backend now exposes (`GET
 * /users/me/export`, `POST /users/me/deletion`).
 *
 * DELIBERATELY a separate screen from `src/app/account-security.tsx`, not a
 * third section bolted onto it. `account-security.tsx`'s own scope note
 * already establishes the precedent that this codebase draws an explicit
 * line around what belongs on that screen (password + session management -
 * "how do I keep this account safe"). Export and deletion are a different
 * question entirely - "what happens to MY DATA" - and grouping them
 * together here (rather than splitting them across two more screens, or
 * bolting them onto the security screen) reflects that they share the same
 * underlying concern: both operate on the full scope of the user's stored
 * personal data, one to let them see it, the other to permanently remove
 * it. This mirrors the common real-world pattern of a single "Your
 * Information" / "Data & Privacy" surface that hosts both "download your
 * data" and "delete your account", separate from a security/password
 * settings surface.
 */

function describeExportError(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    return 'Terlalu banyak permintaan ekspor data. Coba lagi dalam beberapa menit.';
  }

  return 'Gagal mengekspor data. Periksa koneksi kamu dan coba lagi.';
}

/**
 * Maps the three distinct backend failure modes for account deletion to
 * three distinct, actionable messages - a wrong password, a privileged
 * (non-"user") account, and a rate limit are different situations for the
 * user and must never collapse into one generic "something went wrong"
 * message. A 400 (malformed confirmation payload) can never actually occur
 * from this screen - `deleteMyAccount()` always sends the literal boolean
 * `true` - so it falls into the generic fallback below along with any other
 * unexpected failure (network, 500, etc.).
 */
function describeDeleteAccountError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
    return 'Password saat ini salah.';
  }

  if (error instanceof ApiError && error.code === 'ACCOUNT_DELETION_FORBIDDEN') {
    return 'Akun ini tidak bisa dihapus sendiri. Jenis akun ini memerlukan proses penghapusan khusus.';
  }

  if (error instanceof ApiError && error.status === 429) {
    return 'Terlalu banyak percobaan. Untuk keamanan akunmu, coba lagi dalam 15 menit.';
  }

  return 'Gagal menghapus akun. Periksa koneksi kamu dan coba lagi.';
}

export default function AccountDataScreen() {
  const { isAuthenticated, isHydrated, logout, user } = useAuth();

  useEffect(() => {
    if (isHydrated && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isHydrated, isAuthenticated]);

  // ---- Export my data ----
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<UserExport | null>(null);

  const handleExport = useCallback(async () => {
    setIsExporting(true);
    setExportError(null);

    try {
      const result = await exportMyData();
      setExportResult(result);
    } catch (error) {
      setExportError(describeExportError(error));
    } finally {
      setIsExporting(false);
    }
  }, []);

  // ---- Delete my account ----
  /**
   * Whether this account can actually complete an in-app deletion.
   *
   * `POST /users/me/deletion` requires the current password and fails closed
   * with INVALID_CREDENTIALS for an account that has none - and
   * docs/api-contract.md states outright that "the Data & Privacy screen
   * should not offer deletion as if it will work for such an account". Before
   * this check it did exactly that: a Google-only or WhatsApp-only account got
   * a password field, and the backend's refusal was rendered as "Password saat
   * ini salah." - telling a viewer they mistyped a password they never had.
   *
   * The signal is the presence of an `email` identity, because an email
   * identity is inseparable from `User.passwordHash` (see the note on
   * LinkableAuthProviderId in types/auth.ts).
   *
   * `null` means "not known yet". The password form is not rendered on a
   * guess in either direction: showing it too eagerly reproduces the lie, and
   * hiding it too eagerly takes deletion away from an account that has it.
   */
  const [hasPasswordCredential, setHasPasswordCredential] = useState<boolean | null>(null);
  const [isLoadingIdentities, setIsLoadingIdentities] = useState(true);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      try {
        const identities = await listAuthIdentities();

        if (isActive) {
          setHasPasswordCredential(identities.some((identity) => identity.provider === 'email'));
        }
      } catch {
        // Fail SAFE, not closed: a failed lookup must not remove a viewer's
        // ability to delete their own account. The password path still refuses
        // correctly on the server if it turns out there is no password, and the
        // explanatory copy below covers that case.
        if (isActive) {
          setHasPasswordCredential(true);
        }
      } finally {
        if (isActive) {
          setIsLoadingIdentities(false);
        }
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  const [deletePassword, setDeletePassword] = useState('');
  const [isDeleteSubmitted, setIsDeleteSubmitted] = useState(false);
  const [isDeleteConfirmVisible, setIsDeleteConfirmVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deletePasswordError =
    isDeleteSubmitted && !deletePassword ? 'Password saat ini wajib diisi' : null;

  const handleRequestDelete = useCallback(() => {
    setIsDeleteSubmitted(true);

    if (!deletePassword) {
      return;
    }

    setDeleteError(null);
    setIsDeleteConfirmVisible(true);
  }, [deletePassword]);

  const handleConfirmDelete = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(null);

    // Captured BEFORE any cleanup/logout touches `user` - this is the
    // identity whose locally-cached per-user data must be purged on
    // success. See `clearPersistedInteractionsForIdentity`/
    // `clearPersistedProgressForIdentity`'s doc comments for why this is
    // necessary in addition to (not instead of) `logout()`.
    const deletedUserId = user?.id;

    try {
      await deleteMyAccount(deletePassword);

      // Deletion succeeded: the account no longer exists, so every token
      // this device holds for it is now dead, AND any locally-cached
      // per-user data for it must not linger either (there is no future
      // login as this account to ever reclaim it). Order: purge the
      // deleted identity's cached data FIRST (while its id is still in
      // hand), THEN run the same full local sign-out
      // `account-security.tsx`'s logout-all flow already established
      // (`useAuth().logout()` + redirect to `/login`) - reusing that exact
      // path rather than inventing a second one.
      if (deletedUserId) {
        await Promise.all([
          clearPersistedInteractionsForIdentity(deletedUserId),
          clearPersistedProgressForIdentity(deletedUserId),
        ]);
      }

      setIsDeleteConfirmVisible(false);
      setDeletePassword('');
      setIsDeleteSubmitted(false);
      await logout();
      router.replace('/login');
    } catch (error) {
      setDeleteError(describeDeleteAccountError(error));
    } finally {
      setIsDeleting(false);
    }
  }, [deletePassword, logout, user]);

  if (!isHydrated || !isAuthenticated) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Kembali"
          accessibilityRole="button"
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
              return;
            }

            router.replace('/profile');
          }}
          style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}>
          <SymbolView
            name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
            size={18}
            tintColor={Palette.text}
          />
        </Pressable>
        <Text style={styles.title}>Data & Privasi</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Export my data */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ekspor Data Saya</Text>
          <Text style={styles.sectionCaption}>
            Lihat salinan data akunmu: profil, video yang disukai/disimpan, progres tontonan, dan
            riwayat akses premium.
          </Text>

          <Pressable
            accessibilityRole="button"
            disabled={isExporting}
            onPress={() => {
              void handleExport();
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || isExporting) && styles.buttonPressed,
            ]}
            testID="export-data-button">
            {isExporting ? (
              <ActivityIndicator color={Palette.text} size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Ekspor Data Saya</Text>
            )}
          </Pressable>

          {exportError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{exportError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void handleExport();
                }}
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
                <Text style={styles.retryButtonText}>Coba Lagi</Text>
              </Pressable>
            </View>
          ) : null}

          {exportResult ? (
            <View style={styles.exportResultBox} testID="export-data-result">
              <Text style={styles.sectionCaption}>
                Tekan lama teks di bawah untuk menyalinnya secara manual. Data ini hanya
                ditampilkan di perangkatmu - tidak disimpan atau dibagikan ke mana pun oleh
                aplikasi ini.
              </Text>
              <ScrollView style={styles.exportResultScroll} testID="export-data-result-scroll">
                <Text selectable style={styles.exportResultText}>
                  {JSON.stringify(exportResult, null, 2)}
                </Text>
              </ScrollView>
            </View>
          ) : null}
        </View>

        {/* Danger zone: delete account */}
        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.sectionTitle}>Hapus Akun</Text>
          <Text style={styles.sectionCaption}>
            Tindakan ini bersifat PERMANEN dan TIDAK BISA DIBATALKAN. Seluruh datamu - video yang
            disukai, disimpan, progres tontonan, dan akses premium - akan langsung dihapus dan
            tidak dapat dipulihkan.
          </Text>

          {isLoadingIdentities ? (
            <Text style={styles.sectionCaption} testID="delete-account-loading">
              Memeriksa metode masukmu...
            </Text>
          ) : hasPasswordCredential ? (
            <>
              <View style={styles.field}>
                <Text style={styles.label}>Password Saat Ini</Text>
                <TextInput
                  editable={!isDeleting}
                  onChangeText={setDeletePassword}
                  placeholder="••••••••"
                  placeholderTextColor={Palette.textMuted}
                  secureTextEntry
                  style={[styles.input, deletePasswordError && styles.inputError]}
                  testID="delete-account-password-input"
                  value={deletePassword}
                />
                {deletePasswordError ? (
                  <Text style={styles.errorText}>{deletePasswordError}</Text>
                ) : null}
              </View>

              <Pressable
                accessibilityRole="button"
                disabled={isDeleting}
                onPress={handleRequestDelete}
                style={({ pressed }) => [styles.dangerButton, pressed && styles.buttonPressed]}
                testID="delete-account-submit">
                <Text style={styles.dangerButtonText}>Hapus Akun Saya</Text>
              </Pressable>
            </>
          ) : (
            /* No password on this account, so the in-app path cannot succeed.
               Saying so is the whole point: the alternative is a form that
               takes an input, sends it, and reports a wrong password to
               somebody who never set one. */
            <Text style={styles.sectionCaption} testID="delete-account-unavailable">
              Akun ini masuk tanpa password, sehingga penghapusan akun belum bisa dilakukan
              langsung dari aplikasi. Hubungi dukungan lewat alamat email di halaman Kebijakan
              Privasi untuk meminta penghapusan akun.
            </Text>
          )}
        </View>
      </ScrollView>

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
        onCancel={() => {
          setIsDeleteConfirmVisible(false);
          setDeleteError(null);
        }}
        onConfirm={() => {
          void handleConfirmDelete();
        }}
        title="Hapus Akun Secara Permanen?"
        visible={isDeleteConfirmVisible}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 10,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  title: {
    fontSize: 18,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 40,
    gap: 16,
  },
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
  primaryButton: {
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    backgroundColor: Palette.primary,
  },
  primaryButtonText: {
    fontSize: 14,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
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
  exportResultBox: {
    gap: 8,
  },
  exportResultScroll: {
    // VERTICAL scroll (no `horizontal`) - a `horizontal` ScrollView has no
    // vertical-scroll affordance at all, so any payload taller than this cap
    // (a routine amount of interactions/progress/entitlements, not an edge
    // case) was clipped with no way to reach or select the rest. The cap is
    // raised from the original 260 now that scrolling actually works, since
    // this box already sits inside the screen's own outer vertical
    // ScrollView (`styles.content`) - growing it doesn't shrink the danger
    // zone card below, it's just one more screen's worth of scroll.
    maxHeight: 360,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.md,
    backgroundColor: Palette.background,
  },
  exportResultText: {
    padding: 12,
    fontSize: 11.5,
    lineHeight: 16,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
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
