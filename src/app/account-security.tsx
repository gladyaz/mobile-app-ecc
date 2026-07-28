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
import {
  changePassword as changePasswordRequest,
  listSessions as listSessionsRequest,
  logoutAll as logoutAllRequest,
  revokeSession as revokeSessionRequest,
} from '@/services/auth/account-security-service';
import { getTokens, setTokensAndNotify } from '@/services/auth/token-store';
import { useAuth } from '@/stores/auth';
import { useToast } from '@/stores/toast';
import type { SessionSummary } from '@/types/auth';

// Mirrors the backend's ChangePasswordDto.newPassword policy exactly
// (short-drama-backend `MIN_PASSWORD_LENGTH`/`MAX_PASSWORD_LENGTH`, both
// reused from RegisterDto - a single source of truth on the backend side).
// `currentPassword` deliberately has NO length check here, matching the
// backend's own "just non-empty, verified against the stored hash" rule -
// a legitimately-existing account must never be rejected just because this
// policy changed after the account registered.
const MIN_NEW_PASSWORD_LENGTH = 8;
const MAX_NEW_PASSWORD_LENGTH = 128;

/**
 * Deliberate scope decision (Phase 12, work unit 12B-M1): this screen does
 * NOT include the `/auth/password-reset/request` + `/auth/password-reset/
 * confirm` (forgot-password) surface. That flow is for a user who is
 * LOGGED OUT and can't authenticate at all - it doesn't fit an
 * authenticated "Account Security" screen's context, and half-building it
 * here (without also deciding where the confirm step / dev-token-free
 * production copy would live) risks exactly the "reachable dev-only
 * control" failure mode this work unit must avoid. Nothing dev-only is
 * added by this file as a result - there is no `devToken` field read,
 * rendered, logged, or persisted anywhere in this screen.
 */
function describeChangePasswordError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'INVALID_CREDENTIALS') {
    return 'Password saat ini salah.';
  }

  if (error instanceof ApiError && error.code === 'INVALID_REFRESH_TOKEN') {
    return 'Sesi kamu sudah tidak valid. Silakan login ulang.';
  }

  return 'Gagal mengubah password. Periksa koneksi kamu dan coba lagi.';
}

function describeRevokeError(error: unknown): string {
  if (error instanceof ApiError && error.code === 'SESSION_NOT_FOUND') {
    return 'Sesi ini sudah tidak aktif.';
  }

  return 'Gagal menghapus sesi. Periksa koneksi kamu dan coba lagi.';
}

/** Plain `Date` formatting only - no `Intl`/`toLocaleString`, which isn't
 * guaranteed to be ICU-complete in every JS engine this app runs under. */
function formatDateTime(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  const pad = (value: number) => String(value).padStart(2, '0');

  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export default function AccountSecurityScreen() {
  const { isAuthenticated, isHydrated, logout } = useAuth();
  const { showToast } = useToast();

  useEffect(() => {
    if (isHydrated && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isHydrated, isAuthenticated]);

  // ---- Change password ----
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isChangePasswordSubmitted, setIsChangePasswordSubmitted] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [changePasswordError, setChangePasswordError] = useState<string | null>(null);

  const currentPasswordError =
    isChangePasswordSubmitted && !currentPassword ? 'Password saat ini wajib diisi' : null;
  const newPasswordError = isChangePasswordSubmitted
    ? !newPassword
      ? 'Password baru wajib diisi'
      : newPassword.length < MIN_NEW_PASSWORD_LENGTH || newPassword.length > MAX_NEW_PASSWORD_LENGTH
        ? `Password baru harus ${MIN_NEW_PASSWORD_LENGTH}-${MAX_NEW_PASSWORD_LENGTH} karakter`
        : null
    : null;
  const confirmNewPasswordError =
    isChangePasswordSubmitted && confirmNewPassword !== newPassword
      ? 'Konfirmasi password baru tidak cocok'
      : null;

  const handleChangePassword = useCallback(async () => {
    setIsChangePasswordSubmitted(true);
    setChangePasswordError(null);

    const isCurrentPasswordInvalid = !currentPassword;
    const isNewPasswordInvalid =
      !newPassword ||
      newPassword.length < MIN_NEW_PASSWORD_LENGTH ||
      newPassword.length > MAX_NEW_PASSWORD_LENGTH;
    const isConfirmInvalid = confirmNewPassword !== newPassword;

    if (isCurrentPasswordInvalid || isNewPasswordInvalid || isConfirmInvalid) {
      return;
    }

    setIsChangingPassword(true);

    try {
      const refreshToken = getTokens()?.refreshToken;

      if (!refreshToken) {
        throw new Error('No refresh token available to identify the current session.');
      }

      const authResponse = await changePasswordRequest(currentPassword, newPassword, refreshToken);

      // CRITICAL: change-password rotates this session's token pair.
      // Persist it through the exact path the HTTP client's own
      // refresh-on-401 interceptor uses, so `stores/auth.tsx` picks up the
      // change and re-persists to AsyncStorage - see
      // account-security-service.ts's `changePassword` doc comment.
      setTokensAndNotify({
        accessToken: authResponse.accessToken,
        refreshToken: authResponse.refreshToken,
      });

      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setIsChangePasswordSubmitted(false);
      showToast('Password berhasil diubah.');
    } catch (error) {
      setChangePasswordError(describeChangePasswordError(error));
    } finally {
      setIsChangingPassword(false);
    }
  }, [confirmNewPassword, currentPassword, newPassword, showToast]);

  // ---- Sessions ----
  const [sessions, setSessions] = useState<readonly SessionSummary[] | null>(null);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<SessionSummary | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  // Only settles state inside the then/catch continuations (never
  // synchronously), matching `VideoCatalogProvider.fetchVideos`'s existing
  // precedent - so it is safe to call directly from the mount effect below
  // without tripping the "no setState synchronously within an effect" rule.
  const loadSessions = useCallback(() => {
    return listSessionsRequest()
      .then((result) => {
        setSessions(result);
        setSessionsError(null);
        setIsLoadingSessions(false);
      })
      .catch(() => {
        setSessionsError('Gagal memuat daftar sesi. Periksa koneksi kamu dan coba lagi.');
        setIsLoadingSessions(false);
      });
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void loadSessions();
    }
  }, [isAuthenticated, loadSessions]);

  // Resets loading/error synchronously before re-fetching. Only ever
  // called from the user-triggered Retry button, never from inside an
  // effect (mirrors `VideoCatalogProvider.refresh`'s existing precedent).
  const handleRetrySessions = useCallback(() => {
    setIsLoadingSessions(true);
    setSessionsError(null);
    void loadSessions();
  }, [loadSessions]);

  const handleConfirmRevoke = useCallback(async () => {
    if (!revokeTarget) {
      return;
    }

    setIsRevoking(true);
    setRevokeError(null);

    try {
      await revokeSessionRequest(revokeTarget.id);
      setSessions((previous) => previous?.filter((session) => session.id !== revokeTarget.id) ?? previous);
      setRevokeTarget(null);
      showToast('Sesi berhasil dihapus.');
    } catch (error) {
      setRevokeError(describeRevokeError(error));
    } finally {
      setIsRevoking(false);
    }
  }, [revokeTarget, showToast]);

  // ---- Logout-all ----
  const [isLogoutAllConfirmVisible, setIsLogoutAllConfirmVisible] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);
  const [logoutAllError, setLogoutAllError] = useState<string | null>(null);

  const handleConfirmLogoutAll = useCallback(async () => {
    setIsLoggingOutAll(true);
    setLogoutAllError(null);

    try {
      // FROZEN SEMANTIC: revokes EVERY session, including this device's -
      // so a full local sign-out (the same one `useAuth().logout()`
      // performs) always follows a successful call. `logout()` also makes
      // its own best-effort `POST /auth/logout` call with the (now
      // revoked) refresh token, which the backend treats as idempotent -
      // this is intentionally redundant, not a bug.
      await logoutAllRequest();
      setIsLogoutAllConfirmVisible(false);
      await logout();
      router.replace('/login');
    } catch {
      setLogoutAllError('Gagal keluar dari semua perangkat. Periksa koneksi kamu dan coba lagi.');
    } finally {
      setIsLoggingOutAll(false);
    }
  }, [logout]);

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
        <Text style={styles.title}>Keamanan Akun</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* Change password */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ganti Password</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Password Saat Ini</Text>
            <TextInput
              editable={!isChangingPassword}
              onChangeText={setCurrentPassword}
              placeholder="••••••••"
              placeholderTextColor={Palette.textMuted}
              secureTextEntry
              style={[styles.input, currentPasswordError && styles.inputError]}
              testID="current-password-input"
              value={currentPassword}
            />
            {currentPasswordError ? <Text style={styles.errorText}>{currentPasswordError}</Text> : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password Baru</Text>
            <TextInput
              editable={!isChangingPassword}
              onChangeText={setNewPassword}
              placeholder="••••••••"
              placeholderTextColor={Palette.textMuted}
              secureTextEntry
              style={[styles.input, newPasswordError && styles.inputError]}
              testID="new-password-input"
              value={newPassword}
            />
            {newPasswordError ? <Text style={styles.errorText}>{newPasswordError}</Text> : null}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Konfirmasi Password Baru</Text>
            <TextInput
              editable={!isChangingPassword}
              onChangeText={setConfirmNewPassword}
              placeholder="••••••••"
              placeholderTextColor={Palette.textMuted}
              secureTextEntry
              style={[styles.input, confirmNewPasswordError && styles.inputError]}
              testID="confirm-new-password-input"
              value={confirmNewPassword}
            />
            {confirmNewPasswordError ? (
              <Text style={styles.errorText}>{confirmNewPasswordError}</Text>
            ) : null}
          </View>

          <Pressable
            accessibilityRole="button"
            disabled={isChangingPassword}
            onPress={() => {
              void handleChangePassword();
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || isChangingPassword) && styles.buttonPressed,
            ]}
            testID="change-password-submit">
            {isChangingPassword ? (
              <ActivityIndicator color={Palette.text} size="small" />
            ) : (
              <Text style={styles.primaryButtonText}>Ubah Password</Text>
            )}
          </Pressable>

          {changePasswordError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{changePasswordError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void handleChangePassword();
                }}
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
                <Text style={styles.retryButtonText}>Coba Lagi</Text>
              </Pressable>
            </View>
          ) : null}
        </View>

        {/* Active sessions */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Sesi Aktif</Text>
          <Text style={styles.sectionCaption}>
            Menghapus sesi akan langsung mencabut refresh token-nya. Token akses yang sudah
            diterbitkan tetap bisa dipakai hingga habis masa berlakunya (±15 menit).
          </Text>

          {isLoadingSessions ? (
            <View style={styles.sessionsLoading} testID="sessions-loading">
              <ActivityIndicator color={Palette.primary} size="small" />
            </View>
          ) : sessionsError ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{sessionsError}</Text>
              <Pressable
                accessibilityRole="button"
                onPress={handleRetrySessions}
                style={({ pressed }) => [styles.retryButton, pressed && styles.buttonPressed]}>
                <Text style={styles.retryButtonText}>Coba Lagi</Text>
              </Pressable>
            </View>
          ) : sessions && sessions.length > 0 ? (
            <View style={styles.sessionList}>
              {sessions.map((session) => (
                <View key={session.id} style={styles.sessionRow} testID={`session-row-${session.id}`}>
                  <View style={styles.sessionInfo}>
                    <Text style={styles.sessionDevice}>
                      {session.userAgent ?? 'Perangkat tidak diketahui'}
                    </Text>
                    <Text style={styles.sessionMeta}>
                      Terakhir digunakan:{' '}
                      {session.lastUsedAt ? formatDateTime(session.lastUsedAt) : 'Belum pernah digunakan'}
                    </Text>
                    <Text style={styles.sessionMeta}>Dibuat: {formatDateTime(session.createdAt)}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={isRevoking}
                    onPress={() => {
                      setRevokeError(null);
                      setRevokeTarget(session);
                    }}
                    style={({ pressed }) => [
                      styles.revokeButton,
                      (pressed || isRevoking) && styles.buttonPressed,
                    ]}
                    testID={`revoke-session-button-${session.id}`}>
                    <Text style={styles.revokeButtonText}>Hapus</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.sectionCaption}>Tidak ada sesi aktif.</Text>
          )}
        </View>

        {/* Danger zone */}
        <View style={[styles.card, styles.dangerCard]}>
          <Text style={styles.sectionTitle}>Zona Berbahaya</Text>
          <Text style={styles.sectionCaption}>
            Ini akan mengeluarkan SEMUA sesi, termasuk perangkat yang sedang kamu pakai sekarang.
            Kamu perlu login kembali setelahnya.
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setLogoutAllError(null);
              setIsLogoutAllConfirmVisible(true);
            }}
            style={({ pressed }) => [styles.dangerButton, pressed && styles.buttonPressed]}>
            <Text style={styles.dangerButtonText}>Keluar dari Semua Perangkat</Text>
          </Pressable>
        </View>
      </ScrollView>

      <ConfirmDialog
        cancelLabel="Batal"
        confirmLabel="Ya, Keluar dari Semua Perangkat"
        isConfirming={isLoggingOutAll}
        isDestructive
        message={
          logoutAllError
            ? `${logoutAllError} Tekan tombol di bawah untuk mencoba lagi.`
            : 'Tindakan ini akan mengeluarkan SEMUA sesi, termasuk perangkat yang sedang kamu pakai sekarang.'
        }
        onCancel={() => {
          setIsLogoutAllConfirmVisible(false);
          setLogoutAllError(null);
        }}
        onConfirm={() => {
          void handleConfirmLogoutAll();
        }}
        title="Keluar dari Semua Perangkat?"
        visible={isLogoutAllConfirmVisible}
      />

      <ConfirmDialog
        cancelLabel="Batal"
        confirmLabel="Ya, Hapus Sesi"
        isConfirming={isRevoking}
        isDestructive
        message={
          revokeError
            ? `${revokeError} Tekan tombol di bawah untuk mencoba lagi.`
            : `Sesi "${revokeTarget?.userAgent ?? 'Perangkat tidak diketahui'}" akan langsung tidak bisa dipakai lagi.`
        }
        onCancel={() => {
          setRevokeTarget(null);
          setRevokeError(null);
        }}
        onConfirm={() => {
          void handleConfirmRevoke();
        }}
        title="Hapus Sesi Ini?"
        visible={revokeTarget !== null}
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
  sessionsLoading: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  sessionList: {
    gap: 10,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.lg,
    backgroundColor: Palette.background,
  },
  sessionInfo: {
    flex: 1,
    minWidth: 0,
  },
  sessionDevice: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  sessionMeta: {
    marginTop: 2,
    fontSize: 11,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
  },
  revokeButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.error,
  },
  revokeButtonText: {
    fontSize: 12,
    fontFamily: FontFamily.bold,
    color: Palette.error,
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
