import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

/**
 * "Red Panda" design tokens, sourced from the Claude Design project
 * "C-Verse Mobile App Design" (C-Verse App.dc.html). The app is dark-only
 * by design intent - there is no light-theme variant in the source design.
 * Named distinctly from the unused light/dark scaffold above (Colors,
 * Fonts, Spacing) so both can coexist without a breaking rename.
 */
export const Palette = {
  background: '#0D0D0F',
  backgroundElevated: '#101013',
  surface: '#18181B',
  surfaceMuted: '#1c1c1f',
  border: '#2A2A2E',
  primary: '#FF7A1A',
  primaryHover: '#FF9A4D',
  brandRed: '#E23B3B',
  text: '#FFFFFF',
  textSecondary: '#A1A1AA',
  textMuted: '#71717A',
  textDisabled: '#52525B',
  error: '#EF4444',
  success: '#22C55E',
  warning: '#EAB308',
} as const;

export const Gradients = {
  primary: ['#FF7A1A', '#E23B3B'] as const,
};

export const Radius = {
  sm: 8,
  md: 10,
  lg: 14,
  xl: 16,
  xxl: 20,
  pill: 999,
} as const;

export const Space = (multiplier: number) => multiplier * 4;

export const FontFamily = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semiBold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extraBold: 'PlusJakartaSans_800ExtraBold',
} as const;

export const Typography = {
  display: { fontFamily: FontFamily.extraBold, fontSize: 26 },
  title: { fontFamily: FontFamily.extraBold, fontSize: 18 },
  body: { fontFamily: FontFamily.regular, fontSize: 14 },
  caption: { fontFamily: FontFamily.semiBold, fontSize: 12 },
} as const;
