import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ScreenHeader, SettingsRow, SettingsSection } from '@/features/settings/settings-primitives';
import { Palette, Spacing } from '@/constants/theme';
import { isInternalScreenEnabled } from '@/services/debug/internal-screens';
import { isDemoMode } from '@/services/demo/demo-mode';
import { useAuth } from '@/stores/auth';
import { useTranslation } from '@/stores/language';

/**
 * Account & Settings.
 *
 * The screen itself is reachable by ANYONE - a guest included - because its
 * job is to be the door to About, and About carries the privacy policy and the
 * account-deletion route, which must never sit behind a sign-in. What is gated
 * is each ACCOUNT-BOUND row, and it is gated the way the rest of the app
 * already gates one: tapping it while signed out routes to `/login` rather
 * than hiding it, so the viewer learns the feature exists and what it costs.
 *
 * The ACCOUNT section is one plainly-named row. The two real destinations
 * (Account Security, Data & Privacy) live behind it on `/account` - unchanged,
 * and neither lost - so this screen carries no technical vocabulary before
 * somebody has asked for it.
 *
 * A demo build has no backend behind either destination, so - exactly as on the
 * old Profile screen - the section is not rendered at all rather than left to
 * fail when somebody taps it.
 */
export default function SettingsScreen() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();

  const openMyAccount = () => {
    if (!isAuthenticated) {
      router.push('/login');

      return;
    }

    router.push('/account');
  };

  const showsAccountSection = !isDemoMode();

  return (
    <View style={styles.container}>
      <ScreenHeader testID="settings-title" title={t('settings.title')} />
      <ScrollView contentContainerStyle={styles.content}>
        {showsAccountSection ? (
          <SettingsSection title={t('settings.accountSection')}>
            <SettingsRow
              icon={{ ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' }}
              label={t('settings.myAccount')}
              onPress={openMyAccount}
              testID="settings-my-account"
            />
          </SettingsSection>
        ) : null}

        <SettingsSection title={t('settings.generalSection')}>
          <SettingsRow
            icon={{ ios: 'info.circle', android: 'info', web: 'info' }}
            label={t('settings.about')}
            onPress={() => {
              router.push('/about');
            }}
            testID="settings-about"
          />
          {/* INTERNAL, and fabricated: /processing renders bundled fixture rows
              including backend storage paths. `isInternalScreenEnabled` keeps
              it out of every release artifact - see
              services/debug/internal-screens.ts. Moved here from Profile so the
              main screen carries no internal terminology, with the same gate. */}
          {isInternalScreenEnabled() ? (
            <SettingsRow
              hasDivider
              icon={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
              label={t('profile.processingHistory')}
              onPress={() => {
                router.push('/processing');
              }}
              testID="settings-processing"
            />
          ) : null}
        </SettingsSection>
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
    paddingBottom: Spacing.five,
  },
});
