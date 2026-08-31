import { ScrollView, StyleSheet, View } from 'react-native';

import { ScreenHeader, SettingsChoiceRow, SettingsSection } from '@/features/settings/settings-primitives';
import { Palette, Spacing } from '@/constants/theme';
import { LANGUAGE_LABELS, LANGUAGES } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';

/**
 * The dedicated language screen.
 *
 * This replaces the row of chips that used to sit on Profile. It is a
 * PRESENTATION change only: it reads `language` and calls `setLanguage` from
 * the same `useTranslation()` context Profile used, so persistence
 * (`STORAGE_KEYS.language`, written by `stores/language.tsx`) is unchanged and
 * there is no second copy of language state anywhere.
 *
 * Deliberately NOT behind auth. Language is a device preference, not an
 * account setting, and putting it behind sign-in would make it unreachable for
 * exactly the person most likely to need it - somebody who cannot read the
 * current language well enough to find the login button.
 */
export default function LanguageScreen() {
  const { t, language, setLanguage } = useTranslation();

  return (
    <View style={styles.container}>
      <ScreenHeader testID="language-title" title={t('language.title')} />
      <ScrollView contentContainerStyle={styles.content}>
        <SettingsSection>
          {LANGUAGES.map((code, index) => (
            <SettingsChoiceRow
              hasDivider={index > 0}
              isSelected={code === language}
              key={code}
              label={LANGUAGE_LABELS[code]}
              onPress={() => setLanguage(code)}
              testID={`language-option-${code}`}
            />
          ))}
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
