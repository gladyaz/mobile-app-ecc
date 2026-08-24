import { router } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FontFamily, Palette, Radius, Space } from '@/constants/theme';
import { useTranslation } from '@/stores/language';

/**
 * Replaces Expo Router's built-in "Unmatched Route" screen.
 *
 * A file named `+not-found` takes over the unmatched-route slot, and it has
 * to, because the built-in one is not shippable in a build handed to
 * anyone outside the team:
 *
 * - it is untranslated English on an off-brand light surface, in an app
 *   that is otherwise Indonesian-first and dark throughout;
 * - it prints the raw `mobileappecc://...` deep link back at the viewer;
 * - it renders a "Sitemap" link with `href="/_sitemap"` HARDCODED
 *   (`expo-router/build/views/Unmatched.js`) - it does not consult
 *   `extra.router.sitemap`, so disabling the sitemap does not remove the
 *   link, only its destination. One tap from a mistyped link to the
 *   internal route inventory is not a thing an internal demo build should
 *   offer.
 *
 * There is deliberately no back affordance and no path onward except Home:
 * whatever produced an unmatched route is not somewhere to return to.
 * `replace`, not `push`, for the same reason - the dead route should not
 * stay on the stack behind Home.
 */
export default function NotFoundScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const handleGoHome = useCallback(() => {
    router.replace('/');
  }, []);

  return (
    <View
      style={[styles.container, { paddingBottom: insets.bottom + Space(6) }]}
      testID="not-found-screen"
    >
      <Text accessibilityRole="header" style={styles.title}>
        {t('notFound.title')}
      </Text>
      <Text style={styles.body}>{t('notFound.body')}</Text>

      <Pressable
        accessibilityRole="button"
        onPress={handleGoHome}
        style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        testID="not-found-home"
      >
        <Text style={styles.actionLabel}>{t('notFound.action')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: Palette.background,
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Space(8),
  },
  title: {
    color: Palette.text,
    fontFamily: FontFamily.bold,
    fontSize: 20,
    textAlign: 'center',
  },
  body: {
    color: Palette.textSecondary,
    fontFamily: FontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
    marginTop: Space(2),
    textAlign: 'center',
  },
  action: {
    backgroundColor: Palette.primary,
    borderRadius: Radius.pill,
    marginTop: Space(7),
    paddingHorizontal: Space(7),
    paddingVertical: Space(3.5),
  },
  actionPressed: {
    backgroundColor: Palette.primaryHover,
  },
  actionLabel: {
    color: Palette.text,
    fontFamily: FontFamily.semiBold,
    fontSize: 15,
  },
});
