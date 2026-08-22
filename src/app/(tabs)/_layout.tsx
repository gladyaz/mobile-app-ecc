import { Tabs } from 'expo-router';
import { StyleSheet, Text, type ColorValue } from 'react-native';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';

import { FontFamily, Palette } from '@/constants/theme';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';

/**
 * Without an explicit `tabBarIcon`, React Navigation renders its own
 * placeholder glyph, which shows up as an empty box on Android. Each entry
 * therefore names a symbol per platform, matching the convention already used
 * for the feed action rail and the profile rows.
 */
const TAB_SCREENS: readonly {
  readonly name: string;
  readonly titleKey: TranslationKey;
  readonly icon: SymbolViewProps['name'];
  /**
   * Stable automation handle. Appium/Playwright address a tab by THIS, never
   * by its x-position: the order below is a product decision that has already
   * changed once, and a suite pinned to "the third button" silently retargets
   * the wrong screen the next time it changes.
   */
  readonly testID: string;
}[] = [
  {
    name: 'index',
    titleKey: 'home.title',
    icon: { ios: 'house.fill', android: 'home', web: 'home' },
    testID: 'tab-home',
  },
  {
    name: 'discover',
    titleKey: 'discover.title',
    icon: { ios: 'safari.fill', android: 'explore', web: 'explore' },
    testID: 'tab-discover',
  },
  {
    // CENTRE, by product decision: Rewards is the surface the product wants
    // a first-time user to find without hunting, and the middle slot is the
    // one a thumb reaches without moving the hand. It sits here rather than
    // fourth as before - Saved moved right by one to make room.
    //
    // Reordering this array is presentation ONLY. The route names are
    // untouched, so `/rewards` and `/saved` keep resolving to the same files
    // and every existing deep link still lands where it did.
    name: 'rewards',
    titleKey: 'rewards.title',
    icon: { ios: 'gift.fill', android: 'redeem', web: 'redeem' },
    testID: 'tab-rewards',
  },
  {
    name: 'saved',
    titleKey: 'saved.title',
    icon: { ios: 'bookmark.fill', android: 'bookmark', web: 'bookmark' },
    testID: 'tab-saved',
  },
  {
    name: 'profile',
    titleKey: 'profile.title',
    icon: { ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' },
    testID: 'tab-profile',
  },
];

export default function TabsLayout() {
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Palette.primary,
        tabBarInactiveTintColor: Palette.textMuted,
        tabBarStyle: {
          backgroundColor: 'rgba(13, 13, 15, 0.84)',
          borderTopColor: Palette.border,
        },
      }}>
      {TAB_SCREENS.map(({ name, titleKey, icon, testID }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(titleKey),
            tabBarButtonTestID: testID,
            tabBarAccessibilityLabel: t(titleKey),
            // Five tabs share a 320pt phone at roughly 64pt each, so a large
            // OS text size truncates labels ("Discove…"). `maxFontSizeMultiplier`
            // is a Text prop rather than a style, so capping it means
            // rendering the label ourselves; everything else (color, active
            // state) still comes from the navigator. Note this makes
            // `tabBarLabelStyle` inert - a custom element ignores it - so the
            // font is set on `styles.tabLabel` below instead of in both
            // places.
            tabBarLabel: ({ color }: { color: ColorValue }) => (
              <Text
                maxFontSizeMultiplier={1.3}
                numberOfLines={1}
                style={[styles.tabLabel, { color }]}>
                {t(titleKey)}
              </Text>
            ),
            tabBarIcon: ({ color, size }) => (
              <SymbolView name={icon} size={size} tintColor={color} />
            ),
          }}
        />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabLabel: {
    fontFamily: FontFamily.bold,
    fontSize: 10,
    textAlign: 'center',
  },
});
