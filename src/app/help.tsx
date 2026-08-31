import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader, SettingsRow, SettingsSection } from '@/features/settings/settings-primitives';
import {
  getSupportEmailUrl,
  getSupportUrl,
  getSupportWhatsAppUrl,
} from '@/constants/support';
import { FontFamily, Palette, Spacing } from '@/constants/theme';
import { openExternalUrl } from '@/services/links/open-external-url';
import { useTranslation } from '@/stores/language';
import { useToast } from '@/stores/toast';

/**
 * HELP & FEEDBACK.
 *
 * Three real channels, each rendered only when this build is configured with
 * one (`constants/support.ts`) - the same rule About follows for the legal
 * pages, and for the same reason: a row that opens nothing is worse than no
 * row. A build with no support configuration says so plainly instead of
 * offering dead links.
 *
 * NO RAW URL, ADDRESS OR NUMBER IS RENDERED. Each row is a plain label; the
 * destination lives in configuration. That keeps the screen readable, keeps the
 * contact details in one place, and means changing a channel never touches this
 * file.
 *
 * Everything opens through `openExternalUrl`, the app's single cross-platform
 * mechanism - an in-app browser sheet for https, the OS handler for `mailto:`,
 * and a `wa.me` link for WhatsApp that hands off to the installed app on
 * Android and degrades to the click-to-chat page on web. There is no chatbot,
 * no new endpoint, and no login.
 */
export default function HelpScreen() {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const rows = [
    { key: 'center', label: t('help.helpCenter'), url: getSupportUrl() },
    { key: 'email', label: t('help.emailSupport'), url: getSupportEmailUrl() },
    { key: 'whatsapp', label: t('help.whatsappSupport'), url: getSupportWhatsAppUrl() },
  ].filter((row): row is { key: string; label: string; url: string } => Boolean(row.url));

  const open = (url: string) => {
    void openExternalUrl(url).then((wasOpened) => {
      if (!wasOpened) {
        showToast(t('profile.linkUnavailable'));
      }
    });
  };

  return (
    <View style={styles.container}>
      <ScreenHeader testID="help-title" title={t('help.title')} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.blurbTitle}>{t('help.contactTitle')}</Text>
        <Text style={styles.blurb}>
          {rows.length > 0 ? t('help.contactBody') : t('help.unavailable')}
        </Text>

        {rows.length > 0 ? (
          <SettingsSection>
            {rows.map((row, index) => (
              <SettingsRow
                hasDivider={index > 0}
                isExternal
                key={row.key}
                label={row.label}
                onPress={() => open(row.url)}
                testID={`help-${row.key}`}
              />
            ))}
          </SettingsSection>
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
  blurbTitle: {
    marginTop: Spacing.three,
    fontSize: 16,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  blurb: {
    marginTop: Spacing.two,
    fontSize: 13.5,
    lineHeight: 21,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
});
