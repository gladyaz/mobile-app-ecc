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
}[] = [
  {
    name: 'index',
    titleKey: 'home.title',
    icon: { ios: 'house.fill', android: 'home', web: 'home' },
  },
  {
    name: 'discover',
    titleKey: 'discover.title',
    icon: { ios: 'safari.fill', android: 'explore', web: 'explore' },
  },
  {
    name: 'saved',
    titleKey: 'saved.title',
    icon: { ios: 'bookmark.fill', android: 'bookmark', web: 'bookmark' },
  },
  {
    // Preview surface - no reward engine behind it yet. It earns a root tab
    // anyway because the screen states its own PRATINJAU/PREVIEW status on
    // every card; a tab that is honest about being a preview is discoverable
    // without being misleading.
    name: 'rewards',
    titleKey: 'rewards.title',
    icon: { ios: 'gift.fill', android: 'redeem', web: 'redeem' },
  },
  {
    name: 'profile',
    titleKey: 'profile.title',
    icon: { ios: 'person.crop.circle.fill', android: 'account_circle', web: 'account_circle' },
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
        tabBarLabelStyle: {
          fontFamily: FontFamily.bold,
          fontSize: 10,
        },
      }}>
      {TAB_SCREENS.map(({ name, titleKey, icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title: t(titleKey),
            // Five tabs share a 320pt phone at roughly 64pt each, so a large
            // OS text size truncates labels ("Discove…"). `maxFontSizeMultiplier`
            // is a Text prop rather than a style, so capping it means
            // rendering the label ourselves; everything else (color, active
            // state) still comes from the navigator.
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
