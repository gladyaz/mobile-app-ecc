import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { SettingsRow, SettingsSection } from '@/features/settings/settings-primitives';
import { FontFamily, Gradients, Palette, Radius, Spacing } from '@/constants/theme';
import { resetAllPersistedState } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
import { LANGUAGE_LABELS } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import { useToast } from '@/stores/toast';
import { useVideoInteractions } from '@/stores/video-interactions';

/**
 * PROFILE: identity, then three doors.
 *
 * This screen used to be the app's configuration surface - a row of language
 * chips, a "LEGAL" heading, and raw links to the privacy policy, the terms and
 * the account-deletion page, all visible before anyone asked for them. That is
 * now a hierarchy:
 *
 *   Profile -> Language            (the choice itself, on its own screen)
 *           -> Account & Settings  -> About -> the legal + UMP rows
 *           -> Help & Feedback
 *
 * NOTHING moved behind a sign-in. All three rows render, and work, for a
 * guest: language is a device preference, and the legal pages are exactly what
 * somebody who has not signed in is most likely to want to read first. The
 * account-bound destinations inside Settings keep their own gate.
 */

// Development-only escape hatch to clear persisted auth/likes/saved/watch
// progress. Storage is cleared immediately; in-memory state for the current
// session still needs a manual app reload to pick that up, since there's no
// cross-platform way to force-remount every provider from here.
//
// Kept visually apart from the production rows above it - it is not part of
// the information architecture, and must never read as though it were.
function DevResetButton() {
  if (!__DEV__) {
    return null;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void resetAllPersistedState().then(() => {
          Alert.alert('Local data cleared', 'Reload the app to see the reset state.');
        });
      }}
      style={({ pressed }) => [styles.devResetButton, pressed && styles.buttonPressed]}
      testID="profile-dev-reset">
      <Text style={styles.devResetButtonText}>Reset Local Data (Dev)</Text>
    </Pressable>
  );
}

/**
 * The three navigation rows, identical for a guest and a signed-in viewer.
 *
 * The Language row shows the CURRENT language on the right, so the value is
 * still visible at a glance without listing every option - which is what the
 * chips were really for.
 */
function ProfileNavigation() {
  const { t, language } = useTranslation();

  return (
    <SettingsSection>
      <SettingsRow
        icon={{ ios: 'globe', android: 'language', web: 'language' }}
        label={t('profile.language')}
        onPress={() => {
          router.push('/language');
        }}
        testID="profile-language-row"
        value={LANGUAGE_LABELS[language]}
      />
      <SettingsRow
        hasDivider
        icon={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
        label={t('profile.accountSettings')}
        onPress={() => {
          router.push('/settings');
        }}
        testID="profile-settings-row"
      />
      <SettingsRow
        hasDivider
        icon={{ ios: 'questionmark.circle', android: 'help_outline', web: 'help_outline' }}
        label={t('profile.helpFeedback')}
        onPress={() => {
          router.push('/help');
        }}
        testID="profile-help-row"
      />
    </SettingsSection>
  );
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { isAuthenticated, logout, user } = useAuth();
  const { savedVideoIds, likedVideoIds } = useVideoInteractions();
  const { showToast } = useToast();

  if (isAuthenticated && user) {
    // Never `user.id`: a cuid is a database key, and rendering one where a
    // name goes looks like a name the account actually has. A neutral label is
    // the honest fallback when there is no displayName and no email local part
    // to derive one from.
    const displayName = user.name ?? t('profile.accountFallbackName');

    return (
      <View style={styles.container}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{t('profile.title')}</Text>

          <View style={styles.identityRow}>
            <LinearGradient
              colors={Gradients.primary}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.avatar}>
              <Text style={styles.avatarText}>{displayName.charAt(0)}</Text>
            </LinearGradient>
            <View style={styles.identityText}>
              <Text style={styles.name} testID="profile-name">
                {displayName}
              </Text>
              {user.username ? (
                <Text style={styles.username} testID="profile-username">
                  @{user.username}
                </Text>
              ) : null}
              {/* An account can genuinely have no email address - a
                  WhatsApp-only one always does, and so does a Google account
                  whose token did not assert `email_verified`. The row is
                  OMITTED rather than filled in: an empty line reads as a
                  loading bug, and inventing an address would be claiming an
                  identity the account does not have. */}
              <Text style={styles.email} testID="profile-email">
                {user.email ?? t('profile.noEmail')}
              </Text>
            </View>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statsBox}>
              <Text style={[styles.statsValue, styles.statsValuePrimary]}>
                {savedVideoIds.length}
              </Text>
              <Text style={styles.statsLabel}>{t('profile.savedCount')}</Text>
            </View>
            <View style={styles.statsBox}>
              <Text style={styles.statsValue}>{likedVideoIds.length}</Text>
              <Text style={styles.statsLabel}>{t('profile.likedCount')}</Text>
            </View>
          </View>

          <ProfileNavigation />

          <Pressable
            accessibilityRole="button"
            onPress={() => {
              logout();
              showToast(t('profile.loggedOut'));
            }}
            style={({ pressed }) => [styles.logoutButton, pressed && styles.buttonPressed]}>
            <Text style={styles.logoutButtonText}>{t('profile.logout')}</Text>
          </Pressable>

          <DevResetButton />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('profile.title')}</Text>

        <View style={styles.guestState}>
          <View style={styles.guestAvatar}>
            <SymbolView
              name={{ ios: 'person', android: 'person_outline', web: 'person_outline' }}
              size={36}
              tintColor={Palette.textMuted}
            />
          </View>
          <Text style={styles.guestTitle}>{t('profile.guest')}</Text>
          <Text style={styles.description}>{t('profile.guestBlurb')}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              router.push('/login');
            }}
            style={({ pressed }) => [styles.loginButton, pressed && styles.buttonPressed]}>
            <LinearGradient
              colors={Gradients.primary}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.loginButtonGradient}>
              <Text style={styles.loginButtonText}>{t('profile.login')}</Text>
            </LinearGradient>
          </Pressable>
        </View>

        <ProfileNavigation />

        <DevResetButton />
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
    paddingHorizontal: Spacing.three,
    paddingTop: 70,
    paddingBottom: Spacing.six,
  },
  title: {
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  guestState: {
    alignItems: 'center',
    gap: 10,
    paddingTop: Spacing.five,
    paddingBottom: Spacing.two,
  },
  guestAvatar: {
    width: 96,
    height: 96,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
    borderWidth: 1.5,
    borderColor: Palette.textDisabled,
    borderStyle: 'dashed',
  },
  guestTitle: {
    marginTop: 6,
    fontSize: 19,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  description: {
    fontSize: 13,
    lineHeight: 20,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
  },
  loginButton: {
    marginTop: 10,
    width: '100%',
    maxWidth: 280,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  loginButtonGradient: {
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loginButtonText: {
    fontSize: 15,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  identityRow: {
    marginTop: Spacing.four,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  avatar: {
    width: 68,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  avatarText: {
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  identityText: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: 19,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  username: {
    marginTop: 2,
    fontSize: 12.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.primaryHover,
  },
  email: {
    marginTop: 2,
    fontSize: 12,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
  },
  statsRow: {
    marginTop: Spacing.three,
    flexDirection: 'row',
    gap: 12,
  },
  statsBox: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  statsValue: {
    fontSize: 22,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  statsValuePrimary: {
    color: Palette.primary,
  },
  statsLabel: {
    marginTop: 2,
    fontSize: 11.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  logoutButton: {
    marginTop: Spacing.four,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.textDisabled,
  },
  logoutButtonText: {
    fontSize: 14.5,
    fontFamily: FontFamily.bold,
    color: Palette.error,
  },
  devResetButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: Spacing.five,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: '#fef3c7',
  },
  devResetButtonText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: '#92400e',
  },
  buttonPressed: {
    opacity: 0.75,
  },
});
