import { SymbolView } from 'expo-symbols';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import type { DiscoverTabKey } from '@/types/discover';

type DiscoverTab = {
  readonly key: DiscoverTabKey;
  readonly labelKey: TranslationKey;
};

export const DISCOVER_TABS: readonly DiscoverTab[] = [
  { key: 'home', labelKey: 'discover.tabHome' },
  { key: 'new', labelKey: 'discover.tabNew' },
  { key: 'rankings', labelKey: 'discover.tabRankings' },
];

type DiscoverHeaderProps = {
  readonly searchQuery: string;
  readonly onChangeSearchQuery: (query: string) => void;
  readonly activeTab: DiscoverTabKey;
  readonly onSelectTab: (tab: DiscoverTabKey) => void;
  /**
   * Search results replace the active tab's content, so while a query is in
   * force no tab is marked selected - the strip must never highlight a tab
   * whose content is not on screen. Pressing any tab clears the query.
   */
  readonly isSearching: boolean;
};

/**
 * Discover's own header: a search field plus the Discover-local
 * Home / New / Rankings sub-navigation. It deliberately carries no Rewards or
 * VIP entry point - those belong to the later integration slice.
 */
export function DiscoverHeader({
  searchQuery,
  onChangeSearchQuery,
  activeTab,
  onSelectTab,
  isSearching,
}: DiscoverHeaderProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.header}>
      <Text style={styles.title}>{t('discover.title')}</Text>

      <View style={styles.searchBar}>
        <SymbolView
          name={{ ios: 'magnifyingglass', android: 'search', web: 'search' }}
          size={18}
          tintColor={Palette.textMuted}
        />
        <TextInput
          accessibilityLabel={t('discover.searchA11y')}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={onChangeSearchQuery}
          placeholder={t('discover.searchPlaceholder')}
          placeholderTextColor={Palette.textMuted}
          returnKeyType="search"
          style={styles.searchInput}
          value={searchQuery}
        />
        {searchQuery.length > 0 ? (
          <Pressable
            accessibilityLabel={t('discover.clearSearch')}
            accessibilityRole="button"
            // 26pt control + 11 on each side clears Android's 48dp minimum.
            hitSlop={11}
            onPress={() => onChangeSearchQuery('')}
            style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}>
            <SymbolView
              name={{ ios: 'xmark', android: 'close', web: 'close' }}
              size={12}
              tintColor={Palette.textSecondary}
            />
          </Pressable>
        ) : null}
      </View>

      <View accessibilityRole="tablist" style={styles.tabRow}>
        {DISCOVER_TABS.map((tab) => {
          const isActive = !isSearching && tab.key === activeTab;

          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isActive }}
              // The labels are narrow ("New" is ~29pt), so the tappable area is
              // widened past the text box to clear the 44pt minimum.
              // Reaches 48dp (Android's minimum) vertically and ~49pt
              // horizontally; the two 10pt slops meet in the 20pt tabRow gap,
              // so no two tabs share a hit area.
              hitSlop={{ bottom: 2, left: 10, right: 10, top: 2 }}
              key={tab.key}
              onPress={() => onSelectTab(tab.key)}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
              <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>{t(tab.labelKey)}</Text>
              <View style={[styles.tabIndicator, isActive && styles.tabIndicatorActive]} />
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: 12,
  },
  title: {
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    fontSize: 14.5,
    fontFamily: FontFamily.regular,
    color: Palette.text,
  },
  clearButton: {
    width: 26,
    height: 26,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabRow: {
    flexDirection: 'row',
    gap: 20,
  },
  tab: {
    minHeight: 44,
    justifyContent: 'center',
    gap: 6,
  },
  tabLabel: {
    fontSize: 14.5,
    fontFamily: FontFamily.bold,
    color: Palette.textMuted,
  },
  tabLabelActive: {
    color: Palette.text,
  },
  tabIndicator: {
    height: 2.5,
    borderRadius: Radius.pill,
    backgroundColor: 'transparent',
  },
  tabIndicatorActive: {
    backgroundColor: Palette.primary,
  },
  pressed: {
    opacity: 0.72,
  },
});
