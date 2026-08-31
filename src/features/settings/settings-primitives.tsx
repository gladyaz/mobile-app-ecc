import { router } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius, Spacing } from '@/constants/theme';

/**
 * The shared vocabulary of the Profile -> Settings -> About hierarchy.
 *
 * One row idiom, one group idiom, one screen header - so four screens cannot
 * drift into four slightly different visual languages. Everything here is
 * built from EXISTING tokens (`Palette`, `Radius`, `Spacing`, `FontFamily`);
 * no new colour, radius or font is introduced, which is what keeps this a
 * re-organisation of Red Panda's design system rather than a second one.
 *
 * Rows are grouped inside a single bordered surface with hairline dividers
 * rather than being separate floating cards. With three to six destinations on
 * a screen that reads as one list to scan, which is the whole point of moving
 * these settings off the Profile page.
 */

/** 56pt: comfortably above the 44pt minimum touch target, and the height the
 *  app's existing account rows already use, so nothing changes size. */
const ROW_HEIGHT = 56;

export type RowGlyph = SymbolViewProps['name'];

/** Chevron for navigation that stays in the app. */
const CHEVRON: RowGlyph = { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' };

/** The "this leaves the app" glyph, kept distinct from the chevron on purpose:
 *  a row that opens a web page should not look like a row that pushes a
 *  screen. Profile's legal rows already made that distinction; it is kept. */
const EXTERNAL: RowGlyph = {
  ios: 'arrow.up.right',
  android: 'open_in_new',
  web: 'open_in_new',
};

export function ScreenHeader({ title, testID }: { title: string; testID?: string }) {
  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel={title}
        accessibilityRole="button"
        onPress={() => {
          // `canGoBack` is false for a cold deep link into this screen, where
          // `back()` would do nothing and strand the viewer. Profile is the
          // parent of every screen in this hierarchy, so it is the honest
          // fallback - the same rule account-security.tsx already follows.
          if (router.canGoBack()) {
            router.back();

            return;
          }

          router.replace('/profile');
        }}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
        testID={testID ? `${testID}-back` : undefined}>
        <SymbolView
          name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
          size={18}
          tintColor={Palette.text}
        />
      </Pressable>
      <Text style={styles.headerTitle} testID={testID}>
        {title}
      </Text>
    </View>
  );
}

export function SettingsSection({
  title,
  children,
}: PropsWithChildren<{ title?: string }>) {
  return (
    <View style={styles.section}>
      {title ? <Text style={styles.sectionTitle}>{title}</Text> : null}
      <View style={styles.group}>{children}</View>
    </View>
  );
}

export type SettingsRowProps = {
  readonly label: string;
  /** Rendered right-aligned before the trailing glyph, e.g. the current
   *  language on Profile's Language row. */
  readonly value?: string;
  readonly icon?: RowGlyph;
  readonly onPress: () => void;
  /** `true` when the row opens a web page rather than pushing a screen. */
  readonly isExternal?: boolean;
  /** Hairline above the row; set on every row after the first in a group. */
  readonly hasDivider?: boolean;
  readonly testID?: string;
  readonly accessibilityHint?: string;
};

export function SettingsRow({
  label,
  value,
  icon,
  onPress,
  isExternal = false,
  hasDivider = false,
  testID,
  accessibilityHint,
}: SettingsRowProps) {
  return (
    <Pressable
      accessibilityHint={accessibilityHint}
      accessibilityRole={isExternal ? 'link' : 'button'}
      onPress={onPress}
      style={({ pressed }) => [styles.row, hasDivider && styles.rowDivided, pressed && styles.pressed]}
      testID={testID}>
      {icon ? <SymbolView name={icon} size={20} tintColor={Palette.textSecondary} /> : null}
      <Text numberOfLines={1} style={styles.rowLabel}>
        {label}
      </Text>
      {value ? (
        <Text numberOfLines={1} style={styles.rowValue}>
          {value}
        </Text>
      ) : null}
      <SymbolView
        name={isExternal ? EXTERNAL : CHEVRON}
        size={isExternal ? 14 : 16}
        tintColor={Palette.textDisabled}
      />
    </Pressable>
  );
}

/** A row whose job is to report a state, not to navigate - the selected
 *  language. Presented with a check rather than a chevron. */
export function SettingsChoiceRow({
  label,
  isSelected,
  onPress,
  hasDivider = false,
  testID,
}: {
  readonly label: string;
  readonly isSelected: boolean;
  readonly onPress: () => void;
  readonly hasDivider?: boolean;
  readonly testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: isSelected }}
      onPress={onPress}
      style={({ pressed }) => [styles.row, hasDivider && styles.rowDivided, pressed && styles.pressed]}
      testID={testID}>
      <Text numberOfLines={1} style={[styles.rowLabel, isSelected && styles.rowLabelSelected]}>
        {label}
      </Text>
      {isSelected ? (
        <SymbolView
          name={{ ios: 'checkmark', android: 'check', web: 'check' }}
          size={18}
          tintColor={Palette.primary}
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    paddingTop: 64,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  backButton: {
    width: 40,
    height: 40,
    marginLeft: -Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  headerTitle: {
    fontSize: 20,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  section: {
    marginTop: Spacing.four,
  },
  sectionTitle: {
    marginBottom: Spacing.two,
    marginLeft: Spacing.one,
    fontSize: 12,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    fontFamily: FontFamily.semiBold,
    color: Palette.textMuted,
  },
  group: {
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
    overflow: 'hidden',
  },
  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.three,
  },
  rowDivided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Palette.border,
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  rowLabelSelected: {
    color: Palette.primary,
  },
  rowValue: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
    maxWidth: 160,
  },
  pressed: {
    opacity: 0.75,
  },
});
