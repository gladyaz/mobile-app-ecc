import { router } from 'expo-router';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ScreenHeader, SettingsRow, SettingsSection } from '@/features/settings/settings-primitives';
import { Palette, Spacing } from '@/constants/theme';
import { useTranslation } from '@/stores/language';

/**
 * MY ACCOUNT: the two real account destinations, one level down.
 *
 * Settings used to list `Account Security` and `Data & Privacy` directly, which
 * put two pieces of technical vocabulary on the screen somebody opens to change
 * a setting. They are unchanged and neither was lost - they simply live behind
 * one plainly-named row now.
 *
 * There is no auth check HERE, and that is deliberate rather than an omission:
 * the gate belongs at the door. `settings.tsx` sends a signed-out viewer to
 * `/login` instead of pushing this route, so a second check here would be a
 * duplicated rule that could drift from the one that actually runs. Both
 * destinations below additionally enforce their own gate on arrival
 * (`account-security.tsx` and `account-data.tsx` each redirect once hydrated),
 * so a cold deep link straight to this route still cannot reach account data.
 */
export default function AccountScreen() {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <ScreenHeader testID="account-title" title={t('settings.myAccount')} />
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSection>
          <SettingsRow
            icon={{ ios: 'lock.shield', android: 'security', web: 'security' }}
            label={t('profile.accountSecurity')}
            onPress={() => {
              router.push('/account-security');
            }}
            testID="account-security-row"
          />
          <SettingsRow
            hasDivider
            icon={{ ios: 'square.and.arrow.up', android: 'file_download', web: 'file_download' }}
            label={t('profile.dataPrivacy')}
            onPress={() => {
              router.push('/account-data');
            }}
            testID="account-data-row"
          />
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
