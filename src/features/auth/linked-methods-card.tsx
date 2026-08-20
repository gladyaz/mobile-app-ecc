import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { buildAuthMethodRows, type AuthMethodRow } from '@/features/auth/linked-methods';
import {
  listLinkedAuthMethods,
  unlinkAuthMethod,
} from '@/services/auth/provider-auth-service';
import { useTranslation } from '@/stores/language';
import { useToast } from '@/stores/toast';
import type { AuthProviderId, LinkedAuthMethod } from '@/types/auth';
import type { TranslationKey } from '@/services/i18n/translations';

const PROVIDER_LABEL_KEYS: Record<AuthProviderId, TranslationKey> = {
  email: 'authMethods.email',
  google: 'authMethods.google',
  whatsapp: 'authMethods.whatsapp',
};

/**
 * The account-linking surface: which of the three login methods are
 * attached to this account, and (where it is safe) a way to detach one.
 *
 * FOUNDATION, HONESTLY SCOPED. The backend contract behind
 * `GET /auth/methods` / `DELETE /auth/methods/:provider` is being built in
 * a separate worktree and is not landed yet. This card therefore renders
 * real states only: it makes the real call, shows a real loading state, and
 * shows a real error when the call fails. It never fabricates a linked
 * method, and it never reports a successful unlink that did not happen.
 *
 * The one rule it enforces client-side is the lockout guard: the last
 * remaining method has no unlink control at all (see
 * `linked-methods.ts`'s `canUnlinkAuthMethod`). That is a usability guard,
 * not a security boundary - the backend is expected to enforce it too.
 */
export function LinkedMethodsCard() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [rows, setRows] = useState<readonly AuthMethodRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [unlinkingProvider, setUnlinkingProvider] = useState<AuthProviderId | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  // Only settles state inside the then/catch continuations (never
  // synchronously), matching the precedent `account-security.tsx`'s
  // `loadSessions` sets - so calling it straight from the mount effect
  // below is safe.
  const loadMethods = useCallback(() => {
    return listLinkedAuthMethods()
      .then((methods: readonly LinkedAuthMethod[]) => {
        setRows(buildAuthMethodRows(methods));
        setLoadError(null);
        setIsLoading(false);
      })
      .catch(() => {
        setLoadError(t('authMethods.loadFailed'));
        setIsLoading(false);
      });
  }, [t]);

  useEffect(() => {
    void loadMethods();
  }, [loadMethods]);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    void loadMethods();
  }, [loadMethods]);

  const handleUnlink = useCallback(
    async (provider: AuthProviderId) => {
      setUnlinkingProvider(provider);
      setUnlinkError(null);

      try {
        await unlinkAuthMethod(provider);
        // Re-reads the authoritative list instead of mutating the local
        // one: the removal may change what else can now be unlinked, and
        // the server is the only place that knows.
        await loadMethods();
        showToast(t('authMethods.unlinked'));
      } catch {
        setUnlinkError(t('authMethods.unlinkFailed'));
      } finally {
        setUnlinkingProvider(null);
      }
    },
    [loadMethods, showToast, t]
  );

  return (
    <View style={styles.card} testID="auth-methods-card">
      <Text style={styles.sectionTitle}>{t('authMethods.title')}</Text>
      <Text style={styles.sectionCaption}>{t('authMethods.caption')}</Text>

      {isLoading ? (
        <View style={styles.loading} testID="auth-methods-loading">
          <ActivityIndicator color={Palette.primary} size="small" />
        </View>
      ) : loadError ? (
        <View style={styles.errorBanner} testID="auth-methods-error">
          <Text style={styles.errorBannerText}>{loadError}</Text>
          <Pressable
            accessibilityLabel={t('common.retry')}
            accessibilityRole="button"
            onPress={handleRetry}
            style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            testID="auth-methods-retry">
            <Text style={styles.retryButtonText}>{t('common.retry')}</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.rows}>
          {(rows ?? []).map((row) => (
            <View key={row.provider} style={styles.row} testID={`auth-method-${row.provider}`}>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{t(PROVIDER_LABEL_KEYS[row.provider])}</Text>
                <Text style={[styles.rowStatus, row.isLinked && styles.rowStatusLinked]}>
                  {row.isLinked
                    ? (row.label ?? t('authMethods.linked'))
                    : t('authMethods.notLinked')}
                </Text>
                {row.isLinked && !row.canUnlink ? (
                  <Text style={styles.rowNote}>{t('authMethods.lastMethod')}</Text>
                ) : null}
              </View>

              {row.canUnlink ? (
                <Pressable
                  accessibilityLabel={`${t('authMethods.unlink')} ${t(PROVIDER_LABEL_KEYS[row.provider])}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: unlinkingProvider !== null }}
                  disabled={unlinkingProvider !== null}
                  onPress={() => {
                    void handleUnlink(row.provider);
                  }}
                  style={({ pressed }) => [styles.unlinkButton, pressed && styles.pressed]}
                  testID={`auth-method-unlink-${row.provider}`}>
                  {unlinkingProvider === row.provider ? (
                    <ActivityIndicator color={Palette.error} size="small" />
                  ) : (
                    <Text style={styles.unlinkButtonText}>{t('authMethods.unlink')}</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ))}
        </View>
      )}

      {unlinkError ? (
        <View style={styles.errorBanner} testID="auth-methods-unlink-error">
          <Text style={styles.errorBannerText}>{unlinkError}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    gap: 12,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  sectionTitle: {
    fontSize: 15,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  sectionCaption: {
    fontSize: 12,
    lineHeight: 18,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  loading: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  rows: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  rowText: {
    flex: 1,
    gap: 3,
  },
  rowTitle: {
    fontSize: 13.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.text,
  },
  rowStatus: {
    fontSize: 12,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
  },
  rowStatusLinked: {
    color: Palette.success,
  },
  rowNote: {
    fontSize: 11.5,
    lineHeight: 16,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
  },
  unlinkButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.error,
  },
  unlinkButtonText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.error,
  },
  errorBanner: {
    gap: 10,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.error,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  errorBannerText: {
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: FontFamily.semiBold,
    color: Palette.text,
  },
  retryButton: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  retryButtonText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  pressed: {
    opacity: 0.75,
  },
});
