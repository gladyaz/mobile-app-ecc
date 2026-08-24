import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { SymbolView } from 'expo-symbols';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Gradients, Palette, Radius } from '@/constants/theme';
import { isInternalScreenEnabled } from '@/services/debug/internal-screens';
import { isDemoMode } from '@/services/demo/demo-mode';
import { resetAllPersistedState } from '@/services/storage/local-storage';
import { useAuth } from '@/stores/auth';
import { LANGUAGE_LABELS, LANGUAGES } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import { useToast } from '@/stores/toast';
import { useVideoInteractions } from '@/stores/video-interactions';

// Development-only escape hatch to clear persisted auth/likes/saved/watch
// progress. Storage is cleared immediately; in-memory state for the
// current session still needs a manual app reload to pick that up, since
// there's no cross-platform way to force-remount every provider from here.
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
      style={({ pressed }) => [styles.devResetButton, pressed && styles.buttonPressed]}>
      <Text style={styles.devResetButtonText}>Reset Local Data (Dev)</Text>
    </Pressable>
  );
}

/**
 * Rendered in both the signed-in and the guest branch. Language is a device
 * preference, not an account setting - leaving it behind the signed-in state
 * would make it unreachable for exactly the person most likely to need it.
 */
function LanguagePicker() {
  const { t, language, setLanguage } = useTranslation();

  return (
    <View style={styles.languageSection}>
      <Text style={styles.languageLabel}>{t('profile.language')}</Text>
      <View style={styles.languageRow}>
        {LANGUAGES.map((code) => {
          const isSelected = code === language;

          return (
            <Pressable
              key={code}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              onPress={() => setLanguage(code)}
              style={({ pressed }) => [
                styles.languageChip,
                isSelected && styles.languageChipSelected,
                pressed && styles.buttonPressed,
              ]}>
              <Text
                style={[styles.languageChipText, isSelected && styles.languageChipTextSelected]}>
                {LANGUAGE_LABELS[code]}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { t } = useTranslation();
  const { isAuthenticated, logout, user } = useAuth();
  const { savedVideoIds, likedVideoIds } = useVideoInteractions();
  const { showToast } = useToast();

  if (isAuthenticated && user) {
    // Never `user.id`: a cuid is a database key, and rendering one where a
    // name goes looks like a name the account actually has. A neutral
    // label is the honest fallback when there is no displayName and no
    // email local part to derive one from.
    const displayName = user.name ?? t('profile.accountFallbackName');

    return (
      <View style={styles.container}>
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
                loading bug, and inventing an address (a synthetic
                `…@whatsapp.local`, or the user id) would be claiming an
                identity the account does not have. What it says instead is
                the truth, and Account Security shows the masked identifier
                the backend does consider safe to display. */}
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

        <LanguagePicker />

        {/* Every destination below needs the backend: password change and
            session management, data export and account deletion, and the
            internal processing queue. A demo build has none of it, so these
            entries are hidden rather than left to fail when someone taps
            them. */}
        {!isDemoMode() && (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                router.push('/account-security');
              }}
              style={({ pressed }) => [styles.processingButton, pressed && styles.buttonPressed]}>
              <SymbolView
                name={{ ios: 'lock.shield', android: 'security', web: 'security' }}
                size={20}
                tintColor={Palette.textSecondary}
              />
              <Text style={styles.processingButtonText}>{t('profile.accountSecurity')}</Text>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={16}
                tintColor={Palette.textDisabled}
              />
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => {
                router.push('/account-data');
              }}
              style={({ pressed }) => [styles.processingButton, pressed && styles.buttonPressed]}>
              <SymbolView
                name={{
                  ios: 'square.and.arrow.up',
                  android: 'file_download',
                  web: 'file_download',
                }}
                size={20}
                tintColor={Palette.textSecondary}
              />
              <Text style={styles.processingButtonText}>{t('profile.dataPrivacy')}</Text>
              <SymbolView
                name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                size={16}
                tintColor={Palette.textDisabled}
              />
            </Pressable>

            {/* INTERNAL, and fabricated: /processing renders bundled fixture
                rows including backend storage paths. `isInternalScreenEnabled`
                keeps it out of every release artifact, not just demo ones -
                see services/debug/internal-screens.ts. The screen itself
                refuses too, so a `mobileappecc://processing` deep link cannot
                reach past this. */}
            {isInternalScreenEnabled() && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  router.push('../processing');
                }}
                style={({ pressed }) => [
                  styles.processingButton,
                  pressed && styles.buttonPressed,
                ]}>
                <SymbolView
                  name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
                  size={20}
                  tintColor={Palette.textSecondary}
                />
                <Text style={styles.processingButtonText}>{t('profile.processingHistory')}</Text>
                <Text style={styles.internalBadge}>INTERNAL</Text>
                <SymbolView
                  name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
                  size={16}
                  tintColor={Palette.textDisabled}
                />
              </Pressable>
            )}
          </>
        )}

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
      </View>
    );
  }

  return (
    <View style={styles.container}>
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

        <LanguagePicker />

        <DevResetButton />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 70,
    backgroundColor: Palette.background,
  },
  title: {
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  guestState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingBottom: 96,
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
    marginTop: 24,
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
    marginTop: 16,
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
  languageSection: {
    gap: 10,
    marginBottom: 8,
  },
  languageLabel: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  languageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  languageChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  languageChipSelected: {
    borderColor: Palette.primary,
    backgroundColor: 'rgba(255, 122, 26, 0.14)',
  },
  languageChipText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.textSecondary,
  },
  languageChipTextSelected: {
    color: Palette.primary,
  },
  processingButton: {
    marginTop: 16,
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  processingButtonText: {
    flex: 1,
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  internalBadge: {
    fontSize: 9,
    letterSpacing: 1,
    fontFamily: FontFamily.bold,
    color: Palette.primaryHover,
    borderWidth: 1,
    borderColor: 'rgba(255, 122, 26, 0.4)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    overflow: 'hidden',
  },
  logoutButton: {
    marginTop: 16,
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
    marginTop: 12,
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
