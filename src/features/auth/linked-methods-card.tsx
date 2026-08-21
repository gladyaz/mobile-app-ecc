import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { LinkWhatsAppForm } from '@/features/auth/link-whatsapp-form';
import { buildAuthMethodRows, type AuthMethodRow } from '@/features/auth/linked-methods';
import {
  describeIdentityLinkError,
  describeUnlinkError,
} from '@/features/auth/provider-error-messages';
import { signInWithGoogle } from '@/services/auth/google-sign-in';
import {
  linkGoogleIdentity,
  listAuthIdentities,
  unlinkAuthIdentity,
} from '@/services/auth/provider-auth-service';
import { useTranslation } from '@/stores/language';
import { useToast } from '@/stores/toast';
import type { AuthIdentitySummary, AuthProviderId, LinkableAuthProviderId } from '@/types/auth';
import type { TranslationKey } from '@/services/i18n/translations';

const PROVIDER_LABEL_KEYS: Record<AuthProviderId, TranslationKey> = {
  email: 'authMethods.email',
  google: 'authMethods.google',
  whatsapp: 'authMethods.whatsapp',
};

/**
 * The account-linking surface: which of the three login methods are
 * attached to this account, a way to add the ones that are not, and (where
 * the SERVER says it is safe) a way to detach one.
 *
 * Reads `GET /auth/identities` and writes through
 * `POST /auth/identities/:provider/link` and
 * `DELETE /auth/identities/:provider`. Every one of those answers with the
 * account's full, updated identity list, and this card ADOPTS that list
 * rather than re-fetching or mutating its own copy - removing or adding a
 * method can change what else may be removed, and a re-fetch would leave a
 * window in which every `canBeUnlinked` flag on screen is stale.
 *
 * It renders real states only: a real call, a real loading state, a real
 * error when the call fails. It never fabricates a linked method, and it
 * never reports a successful link/unlink that did not happen.
 *
 * WHY THE LINK CONTROLS ARE NOT OPTIONAL. When Google sign-in collides with
 * an existing account the backend answers `AUTH_ACCOUNT_LINK_REQUIRED` and
 * tells the person to sign in with their existing method and link the
 * provider from account settings. Without the control below, the app would
 * be instructing people to do something it does not let them do - and an
 * unreachable escape hatch is exactly how a correct security boundary gets
 * relitigated as "Google login is broken".
 *
 * The last-method rule is the server's: `canBeUnlinked` is computed by the
 * same rule `DELETE` enforces, so this card hides the control when it is
 * false and `linked-methods.ts` only ever narrows further. A stale list can
 * still submit an unlink the server refuses with `AUTH_LAST_IDENTITY`; that
 * is reported truthfully rather than retried.
 */
export function LinkedMethodsCard() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const [rows, setRows] = useState<readonly AuthMethodRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyProvider, setBusyProvider] = useState<LinkableAuthProviderId | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLinkingWhatsApp, setIsLinkingWhatsApp] = useState(false);

  /**
   * The single place a server-authoritative identity list becomes rendered
   * rows. Every mutation funnels its RESPONSE through here instead of
   * re-reading, so the flags on screen are always the ones the server
   * computed for the state it just committed.
   */
  const adoptIdentities = useCallback((identities: readonly AuthIdentitySummary[]) => {
    setRows(buildAuthMethodRows(identities));
    setLoadError(null);
    setIsLoading(false);
  }, []);

  // Only settles state inside the then/catch continuations (never
  // synchronously), matching the precedent `account-security.tsx`'s
  // `loadSessions` sets - so calling it straight from the mount effect
  // below is safe.
  const loadIdentities = useCallback(() => {
    return listAuthIdentities()
      .then(adoptIdentities)
      .catch(() => {
        setLoadError(t('authMethods.loadFailed'));
        setIsLoading(false);
      });
  }, [adoptIdentities, t]);

  useEffect(() => {
    void loadIdentities();
  }, [loadIdentities]);

  const handleRetry = useCallback(() => {
    setIsLoading(true);
    setLoadError(null);
    void loadIdentities();
  }, [loadIdentities]);

  const handleUnlink = useCallback(
    async (provider: LinkableAuthProviderId) => {
      setBusyProvider(provider);
      setActionError(null);

      try {
        // Adopts the returned list. `DELETE` answers 200 with the caller's
        // full updated identities precisely so this does not need a second
        // round trip to learn what is still removable.
        adoptIdentities(await unlinkAuthIdentity(provider));
        showToast(t('authMethods.unlinked'));
      } catch (error) {
        setActionError(t(describeUnlinkError(error)));
      } finally {
        setBusyProvider(null);
      }
    },
    [adoptIdentities, showToast, t]
  );

  /**
   * Google linking: the SAME native sheet the login screen uses, producing
   * the same one-shot ID token - but exchanged at the LINK route, which
   * attaches the Google identity to the session already in hand instead of
   * issuing a new one. The token is never persisted here either.
   */
  const handleLinkGoogle = useCallback(async () => {
    setBusyProvider('google');
    setActionError(null);

    try {
      const result = await signInWithGoogle();

      if (result.status === 'cancelled') {
        return;
      }

      if (result.status !== 'success') {
        setActionError(t('login.googleUnavailable'));

        return;
      }

      adoptIdentities(await linkGoogleIdentity(result.idToken));
      showToast(t('authMethods.linkSuccess'));
    } catch (error) {
      setActionError(t(describeIdentityLinkError(error, 'google')));
    } finally {
      setBusyProvider(null);
    }
  }, [adoptIdentities, showToast, t]);

  const handleWhatsAppLinked = useCallback(
    (identities: readonly AuthIdentitySummary[]) => {
      adoptIdentities(identities);
      setIsLinkingWhatsApp(false);
      showToast(t('authMethods.linkSuccess'));
    },
    [adoptIdentities, showToast, t]
  );

  const handleLinkPress = useCallback(
    (provider: LinkableAuthProviderId) => {
      setActionError(null);

      if (provider === 'google') {
        void handleLinkGoogle();

        return;
      }

      setIsLinkingWhatsApp(true);
    },
    [handleLinkGoogle]
  );

  const describeStatus = useCallback(
    (row: AuthMethodRow): string => {
      if (!row.isLinked) {
        return t('authMethods.notLinked');
      }

      // A masked identifier when the backend had one to give, and the
      // neutral "linked" label when it did not - never a fabricated
      // address, and never the raw provider subject (which the backend
      // does not return at all).
      return row.identifier ?? t('authMethods.identifierHidden');
    },
    [t]
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
                  {describeStatus(row)}
                </Text>
                {row.isLinked && !row.usable ? (
                  <Text style={styles.rowNote}>{t('authMethods.unusable')}</Text>
                ) : null}
                {row.isOnlyMethod && row.usable ? (
                  <Text style={styles.rowNote}>{t('authMethods.lastMethod')}</Text>
                ) : null}
              </View>

              {row.canUnlink ? (
                <Pressable
                  accessibilityLabel={`${t('authMethods.unlink')} ${t(PROVIDER_LABEL_KEYS[row.provider])}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busyProvider !== null }}
                  disabled={busyProvider !== null}
                  onPress={() => {
                    // Safe narrowing: `canUnlink` is false for every
                    // non-linkable provider (see linked-methods.ts).
                    void handleUnlink(row.provider as LinkableAuthProviderId);
                  }}
                  style={({ pressed }) => [styles.unlinkButton, pressed && styles.pressed]}
                  testID={`auth-method-unlink-${row.provider}`}>
                  {busyProvider === row.provider ? (
                    <ActivityIndicator color={Palette.error} size="small" />
                  ) : (
                    <Text style={styles.unlinkButtonText}>{t('authMethods.unlink')}</Text>
                  )}
                </Pressable>
              ) : row.canLink ? (
                <Pressable
                  accessibilityLabel={`${t('authMethods.link')} ${t(PROVIDER_LABEL_KEYS[row.provider])}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busyProvider !== null }}
                  disabled={busyProvider !== null}
                  onPress={() => {
                    handleLinkPress(row.provider as LinkableAuthProviderId);
                  }}
                  style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
                  testID={`auth-method-link-${row.provider}`}>
                  {busyProvider === row.provider ? (
                    <ActivityIndicator color={Palette.primary} size="small" />
                  ) : (
                    <Text style={styles.linkButtonText}>{t('authMethods.link')}</Text>
                  )}
                </Pressable>
              ) : null}
            </View>
          ))}

          {isLinkingWhatsApp ? (
            <LinkWhatsAppForm
              onCancel={() => {
                setIsLinkingWhatsApp(false);
              }}
              onLinked={handleWhatsAppLinked}
            />
          ) : null}
        </View>
      )}

      {actionError ? (
        <View style={styles.errorBanner} testID="auth-methods-unlink-error">
          <Text style={styles.errorBannerText}>{actionError}</Text>
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
  linkButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.primary,
  },
  linkButtonText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.primary,
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
