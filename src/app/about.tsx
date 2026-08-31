import Constants from 'expo-constants';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader, SettingsRow, SettingsSection } from '@/features/settings/settings-primitives';
import {
  getAccountDeletionUrl,
  getPrivacyPolicyUrl,
  getTermsUrl,
} from '@/constants/legal';
import { FontFamily, Palette, Spacing } from '@/constants/theme';
import {
  isAdPrivacyOptionsRequired,
  showAdPrivacyOptionsForm,
} from '@/services/ads/consent-gate';
import { openExternalUrl } from '@/services/links/open-external-url';
import { useTranslation } from '@/stores/language';
import { useToast } from '@/stores/toast';

/**
 * About: the app's legal and privacy surface, moved off the main Profile
 * screen and given a page of its own.
 *
 * EVERY ROW HERE IS CONDITIONAL ON SOMETHING REAL, and that is the entire
 * design. `constants/legal.ts` returns a URL only for a configured, absolute
 * https value, so a build without a published page simply has no row for it -
 * a link that 404s is worse than no link, and this screen must never imply a
 * page exists that nobody has published.
 *
 * WHAT IS DELIBERATELY ABSENT, and why:
 *
 *  - Terms of Service. `EXPO_PUBLIC_TERMS_URL` is unset in this build (release
 *    preflight already warns about it), so the row is omitted rather than
 *    rendered disabled or pointed at an invented page. It appears by itself,
 *    with no code change, the moment the URL is configured.
 *  - Open Source Licenses. There is no licence manifest, screen or generated
 *    data in this repo. A row opening an empty screen would be a worse claim
 *    than silence.
 *  - Community Guidelines. No published URL and no route exists.
 *
 * The version comes from the Expo config the binary was actually built with,
 * never a literal, so it cannot drift from the artifact.
 */
export default function AboutScreen() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const privacyPolicyUrl = getPrivacyPolicyUrl();
  const termsUrl = getTermsUrl();
  const accountDeletionUrl = getAccountDeletionUrl();

  // UMP's requirement is not only "show a form once". Where
  // `privacyOptionsRequirementStatus` is REQUIRED - the EEA and UK under the
  // European message, and the covered US states under the US one - the app
  // must ALSO expose a persistent control that reopens the form, or the
  // first-launch choice is permanent. Rendered only where Google says it is
  // required, so no other region grows a row that opens nothing. Google UMP
  // stays the authority: this is an entry point to the SDK's own form, never a
  // consent value this app stores or a toggle it owns.
  const showsAdPrivacyOptions = isAdPrivacyOptionsRequired();

  const openExternal = (url: string) => {
    void openExternalUrl(url).then((wasOpened) => {
      if (!wasOpened) {
        showToast(t('profile.linkUnavailable'));
      }
    });
  };

  const legalRows = [
    { key: 'privacy', label: t('profile.privacyPolicy'), url: privacyPolicyUrl },
    { key: 'terms', label: t('profile.termsOfService'), url: termsUrl },
    { key: 'deletion', label: t('profile.deleteAccountHelp'), url: accountDeletionUrl },
  ].filter((row): row is { key: string; label: string; url: string } => Boolean(row.url));

  const version = Constants.expoConfig?.version;

  return (
    <View style={styles.container}>
      <ScreenHeader testID="about-title" title={t('about.title')} />
      <ScrollView contentContainerStyle={styles.content}>
        {legalRows.length > 0 || showsAdPrivacyOptions ? (
          <SettingsSection>
            {legalRows.map((row, index) => (
              <SettingsRow
                hasDivider={index > 0}
                isExternal
                key={row.key}
                label={row.label}
                onPress={() => openExternal(row.url)}
                testID={`about-${row.key}`}
              />
            ))}
            {showsAdPrivacyOptions ? (
              <SettingsRow
                hasDivider={legalRows.length > 0}
                label={t('profile.adPrivacyOptions')}
                onPress={() => {
                  void showAdPrivacyOptionsForm().then((wasShown) => {
                    if (!wasShown) {
                      showToast(t('profile.adPrivacyOptionsFailed'));
                    }
                  });
                }}
                testID="about-ad-privacy-options"
              />
            ) : null}
          </SettingsSection>
        ) : null}

        {version ? (
          <Text style={styles.version} testID="about-version">
            {t('about.version', { version })}
          </Text>
        ) : null}
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
  version: {
    marginTop: Spacing.four,
    textAlign: 'center',
    fontSize: 12,
    fontFamily: FontFamily.regular,
    color: Palette.textDisabled,
  },
});
