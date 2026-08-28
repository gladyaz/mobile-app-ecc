import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { DeleteAccountCard } from '@/features/account-deletion/delete-account-card';
import { ApiError } from '@/services/api/client';
import { exportMyData } from '@/services/export/export-service';
import { useAuth } from '@/stores/auth';
import type { UserExport } from '@/types/export';

/**
 * "Data & Privasi" - hosts the two personal-data-lifecycle actions the
 * backend exposes: `GET /users/me/export` (owned by this file) and account
 * deletion (owned by `features/account-deletion`, which now spans three
 * routes and three provider flows rather than the single password field this
 * screen used to render inline).
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

export default function AccountDataScreen() {
  const { isAuthenticated, isHydrated } = useAuth();

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

        {/* Danger zone: delete account. The whole flow - which proofs this
            account can produce, gathering the one it uses, the irreversible
            confirmation, and the post-deletion cleanup - lives in
            `features/account-deletion`, because it is now three provider
            flows rather than one password field. This screen keeps only what
            it is: the place both personal-data actions live. */}
        <DeleteAccountCard />
      </ScrollView>
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
  buttonPressed: {
    opacity: 0.75,
  },
});
