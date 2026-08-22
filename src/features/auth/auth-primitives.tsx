import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import { useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FontFamily, Gradients, Palette, Radius } from '@/constants/theme';

/**
 * The shared building blocks every auth screen is assembled from: login,
 * email registration, and the two WhatsApp OTP steps.
 *
 * They exist so the three screens cannot drift apart - one field height,
 * one error treatment, one primary button, one divider. That consistency is
 * the point for a first-time viewer: whichever way they choose to sign in,
 * the surface behaves identically.
 *
 * Nothing here owns auth state or talks to a service. Each component takes
 * what it renders as props, so the screens stay the only place flow logic
 * lives.
 */

/** Inputs and provider rows. One height so the stack reads as one column. */
const CONTROL_HEIGHT = 52;

/** The primary CTA is deliberately taller than a field, so "the thing to
 * press" is obvious before any of the labels are read. */
const PRIMARY_HEIGHT = 54;

/** Breathing room between the status bar and the back button. Added to the
 * measured top inset rather than replacing it, so the control clears a
 * notch, a punch-hole and a plain status bar alike. */
const HEADER_TOP_GAP = 8;

/** The register/sign-in switch is plain accent text, so its tappable area has
 * to come from hit slop rather than from padding that would show as chrome. */
const FOOTER_HIT_SLOP = { top: 12, bottom: 12, left: 12, right: 12 } as const;

type AuthScreenHeaderProps = {
  readonly title: string;
  readonly subtitle?: string;
  readonly onBack: () => void;
  readonly backAccessibilityLabel: string;
  readonly backTestID?: string;
};

export function AuthScreenHeader({
  title,
  subtitle,
  onBack,
  backAccessibilityLabel,
  backTestID,
}: AuthScreenHeaderProps) {
  // The auth routes are all `headerShown: false` (see `app/_layout.tsx`), so
  // nothing above this component reserves the status bar for it. Owning the
  // top inset here - rather than in each screen - is what keeps login,
  // register and the WhatsApp steps from drifting apart again.
  const insets = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: insets.top + HEADER_TOP_GAP }}>
      <Pressable
        accessibilityLabel={backAccessibilityLabel}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.backButtonPressed]}
        testID={backTestID}>
        <SymbolView
          name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
          size={18}
          tintColor={Palette.text}
        />
      </Pressable>

      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

type AuthTextFieldProps = {
  readonly label: string;
  readonly value: string;
  readonly onChangeText: (next: string) => void;
  readonly testID: string;
  readonly accessibilityLabel: string;
  readonly placeholder?: string;
  readonly error?: string | null;
  /** Rendered inside the field, before the input (e.g. the "+62" affix). */
  readonly prefix?: string;
  /** Shown under the field when there is no error - one short line of
   * guidance, so a first-time viewer knows the rule BEFORE being told off
   * for breaking it. */
  readonly hint?: string;
  readonly isEditable?: boolean;
  readonly isSecure?: boolean;
  readonly keyboardType?: KeyboardTypeOptions;
  readonly autoCapitalize?: TextInputProps['autoCapitalize'];
  readonly autoComplete?: TextInputProps['autoComplete'];
  readonly textContentType?: TextInputProps['textContentType'];
  readonly maxLength?: number;
  readonly returnKeyType?: TextInputProps['returnKeyType'];
  readonly onSubmitEditing?: () => void;
};

export function AuthTextField({
  label,
  value,
  onChangeText,
  testID,
  accessibilityLabel,
  placeholder,
  error,
  prefix,
  hint,
  isEditable = true,
  isSecure = false,
  keyboardType,
  autoCapitalize = 'none',
  autoComplete,
  textContentType,
  maxLength,
  returnKeyType,
  onSubmitEditing,
}: AuthTextFieldProps) {
  // Purely presentational: which field currently has the caret. A dark form
  // on a dark background gives almost no natural focus cue, and "which box
  // am I typing in" is the first thing a first-time viewer loses track of.
  // Error still wins over focus in the style array below - being wrong is
  // more urgent to communicate than being active.
  const [isFocused, setIsFocused] = useState(false);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View
        style={[
          styles.inputShell,
          isFocused && styles.inputShellFocused,
          Boolean(error) && styles.inputShellError,
        ]}>
        {prefix ? <Text style={styles.inputPrefix}>{prefix}</Text> : null}
        <TextInput
          accessibilityLabel={accessibilityLabel}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          editable={isEditable}
          keyboardType={keyboardType}
          maxLength={maxLength}
          onBlur={() => setIsFocused(false)}
          onChangeText={onChangeText}
          onFocus={() => setIsFocused(true)}
          onSubmitEditing={onSubmitEditing}
          placeholder={placeholder}
          placeholderTextColor={Palette.textMuted}
          returnKeyType={returnKeyType}
          secureTextEntry={isSecure}
          style={styles.input}
          testID={testID}
          textContentType={textContentType}
          value={value}
        />
      </View>
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          style={styles.errorText}
          testID={`${testID}-error`}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={styles.hintText}>{hint}</Text>
      ) : null}
    </View>
  );
}

type AuthPrimaryButtonProps = {
  readonly label: string;
  readonly busyLabel?: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly isBusy?: boolean;
  readonly isDisabled?: boolean;
};

export function AuthPrimaryButton({
  label,
  busyLabel,
  onPress,
  testID,
  isBusy = false,
  isDisabled = false,
}: AuthPrimaryButtonProps) {
  const isInactive = isBusy || isDisabled;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: isBusy, disabled: isInactive }}
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        // The generic 0.75 `pressed` wash reads as "broken" on a control this
        // large and this saturated, so the CTA dims by its own smaller step.
        pressed && styles.primaryButtonPressed,
        isInactive && styles.primaryButtonFlat,
        isDisabled && styles.primaryButtonDisabled,
      ]}
      testID={testID}>
      <LinearGradient
        colors={Gradients.primary}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={styles.primaryButtonGradient}>
        {isBusy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={Palette.text} size="small" />
            {busyLabel ? <Text style={styles.primaryButtonText}>{busyLabel}</Text> : null}
          </View>
        ) : (
          <Text style={styles.primaryButtonText}>{label}</Text>
        )}
      </LinearGradient>
    </Pressable>
  );
}

/** Matches `SymbolView`'s own `name` prop, which is a strict union of known
 * symbol names rather than a free string. */
type SymbolName = NonNullable<ComponentProps<typeof SymbolView>['name']>;

/** The brand badge inside a provider button. Deliberately a plain letter or
 * glyph on the provider's colour rather than an imitation of an official
 * logo asset, which this repo does not ship and must not fake. */
type ProviderBadge =
  | { readonly kind: 'letter'; readonly letter: string; readonly color: string }
  | { readonly kind: 'symbol'; readonly name: SymbolName; readonly color: string };

type AuthProviderButtonProps = {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly badge: ProviderBadge;
  readonly isBusy?: boolean;
  readonly isDisabled?: boolean;
};

export function AuthProviderButton({
  label,
  onPress,
  testID,
  badge,
  isBusy = false,
  isDisabled = false,
}: AuthProviderButtonProps) {
  const isInactive = isBusy || isDisabled;

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ busy: isBusy, disabled: isInactive }}
      disabled={isInactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.providerButton,
        pressed && styles.providerButtonPressed,
        isDisabled && styles.providerButtonDisabled,
      ]}
      testID={testID}>
      <View style={[styles.providerBadge, { backgroundColor: badge.color }]}>
        {badge.kind === 'letter' ? (
          <Text style={styles.providerBadgeLetter}>{badge.letter}</Text>
        ) : (
          <SymbolView name={badge.name} size={16} tintColor={Palette.text} />
        )}
      </View>
      <Text style={styles.providerButtonText}>{label}</Text>
      {isBusy ? (
        <ActivityIndicator color={Palette.textSecondary} size="small" />
      ) : (
        // Decorative: it says "this leads somewhere" - the provider sheet, or
        // the WhatsApp step - rather than submitting the form in place. The
        // Pressable above is the accessibility element, so this adds nothing
        // for a screen reader to read out.
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={14}
          tintColor={Palette.textMuted}
        />
      )}
    </Pressable>
  );
}

export function AuthDivider({ label }: { readonly label: string }) {
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.dividerRow}>
      <View style={styles.dividerLine} />
      <Text style={styles.dividerLabel}>{label}</Text>
      <View style={styles.dividerLine} />
    </View>
  );
}

/**
 * A form-level failure (bad credentials, network down, expired code).
 * Announced to screen readers, because a viewer who cannot see the banner
 * would otherwise just experience "nothing happened".
 */
export function AuthErrorBanner({
  message,
  testID,
}: {
  readonly message: string;
  readonly testID: string;
}) {
  return (
    <View
      accessibilityLiveRegion="assertive"
      accessibilityRole="alert"
      style={styles.errorBanner}
      testID={testID}>
      <SymbolView
        name={{
          ios: 'exclamationmark.triangle.fill',
          android: 'warning',
          web: 'warning',
        }}
        size={16}
        tintColor={Palette.error}
      />
      <Text style={styles.errorBannerText}>{message}</Text>
    </View>
  );
}

type AuthFooterLinkProps = {
  readonly prompt: string;
  readonly actionLabel: string;
  readonly onPress: () => void;
  readonly testID: string;
};

export function AuthFooterLink({ prompt, actionLabel, onPress, testID }: AuthFooterLinkProps) {
  return (
    <View style={styles.footer}>
      <Text style={styles.footerPrompt}>{prompt}</Text>
      <Pressable
        accessibilityLabel={actionLabel}
        accessibilityRole="button"
        hitSlop={FOOTER_HIT_SLOP}
        onPress={onPress}
        style={({ pressed }) => [styles.footerButton, pressed && styles.pressed]}
        testID={testID}>
        <Text style={styles.footerButtonText}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  backButton: {
    width: 44,
    height: 44,
    alignSelf: 'flex-start',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  backButtonPressed: {
    opacity: 0.75,
    backgroundColor: Palette.surfaceMuted,
  },
  title: {
    marginTop: 22,
    fontSize: 26,
    lineHeight: 33,
    letterSpacing: -0.4,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  subtitle: {
    marginTop: 6,
    // Held back from the full column width so the title keeps the emphasis
    // and the sentence does not run edge to edge.
    maxWidth: 300,
    fontSize: 13.5,
    lineHeight: 20,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  field: {
    gap: 7,
  },
  label: {
    fontSize: 12,
    fontFamily: FontFamily.bold,
    letterSpacing: 0.3,
    color: Palette.textSecondary,
  },
  inputShell: {
    flexDirection: 'row',
    alignItems: 'center',
    height: CONTROL_HEIGHT,
    paddingHorizontal: 16,
    gap: 8,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  inputShellFocused: {
    borderColor: Palette.primary,
    backgroundColor: Palette.surfaceMuted,
  },
  inputShellError: {
    borderColor: Palette.error,
    backgroundColor: 'rgba(239, 68, 68, 0.07)',
  },
  inputPrefix: {
    fontSize: 14.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  input: {
    flex: 1,
    height: '100%',
    fontSize: 14.5,
    fontFamily: FontFamily.regular,
    color: Palette.text,
  },
  errorText: {
    fontSize: 12,
    fontFamily: FontFamily.semiBold,
    color: Palette.error,
  },
  hintText: {
    fontSize: 11.5,
    lineHeight: 16,
    fontFamily: FontFamily.regular,
    color: Palette.textMuted,
  },
  primaryButton: {
    // Stated here as well as on the gradient child: the pressable IS the
    // touch target, and it must not be able to collapse under it.
    minHeight: PRIMARY_HEIGHT,
    borderRadius: Radius.xl,
    overflow: 'hidden',
    // Also the Android elevation surface: an elevated view with no background
    // of its own casts no shadow. The gradient covers it completely.
    backgroundColor: Palette.brandRed,
    shadowColor: Palette.primary,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 14,
    elevation: 6,
  },
  primaryButtonPressed: {
    opacity: 0.88,
  },
  /** No glow while the button cannot be pressed - a lit-up dead control is
   * exactly the thing a first-time viewer keeps tapping. */
  primaryButtonFlat: {
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonGradient: {
    height: PRIMARY_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 15.5,
    letterSpacing: 0.2,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  busyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  providerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: CONTROL_HEIGHT,
    paddingHorizontal: 14,
    borderRadius: Radius.xl,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  providerButtonPressed: {
    opacity: 0.85,
    borderColor: Palette.textDisabled,
    backgroundColor: Palette.surfaceMuted,
  },
  providerButtonDisabled: {
    opacity: 0.5,
  },
  providerBadge: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.pill,
  },
  providerBadgeLetter: {
    fontSize: 15,
    lineHeight: 19,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  providerButtonText: {
    flex: 1,
    fontSize: 14.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.text,
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: Palette.border,
  },
  dividerLabel: {
    fontSize: 12,
    letterSpacing: 0.4,
    fontFamily: FontFamily.semiBold,
    color: Palette.textMuted,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.error,
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: FontFamily.semiBold,
    color: Palette.text,
  },
  footer: {
    flexDirection: 'row',
    // Wraps rather than truncating: the prompt and the action are both longer
    // in English and German-length locales than in Indonesian.
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerPrompt: {
    fontSize: 13.5,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  footerButton: {
    paddingVertical: 4,
  },
  footerButtonText: {
    fontSize: 13.5,
    fontFamily: FontFamily.extraBold,
    color: Palette.primary,
  },
  pressed: {
    opacity: 0.75,
  },
});

/** Brand badges the provider buttons use, kept next to the component that
 * renders them so a screen never invents its own. */
export const PROVIDER_BADGES = {
  google: { kind: 'letter', letter: 'G', color: '#4285F4' },
  whatsapp: {
    kind: 'symbol',
    name: { ios: 'message.fill', android: 'chat', web: 'chat' },
    color: '#25D366',
  },
} as const satisfies Record<string, ProviderBadge>;
