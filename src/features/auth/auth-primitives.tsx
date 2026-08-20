import { LinearGradient } from 'expo-linear-gradient';
import { SymbolView } from 'expo-symbols';
import type { ComponentProps } from 'react';
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

const CONTROL_HEIGHT = 52;

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
  return (
    <View>
      <Pressable
        accessibilityLabel={backAccessibilityLabel}
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
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
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputShell, Boolean(error) && styles.inputShellError]}>
        {prefix ? <Text style={styles.inputPrefix}>{prefix}</Text> : null}
        <TextInput
          accessibilityLabel={accessibilityLabel}
          autoCapitalize={autoCapitalize}
          autoComplete={autoComplete}
          editable={isEditable}
          keyboardType={keyboardType}
          maxLength={maxLength}
          onChangeText={onChangeText}
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
        pressed && styles.pressed,
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
        pressed && styles.pressed,
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
      {isBusy ? <ActivityIndicator color={Palette.textSecondary} size="small" /> : null}
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
        hitSlop={8}
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
  title: {
    marginTop: 28,
    fontSize: 26,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  subtitle: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
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
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  inputShellError: {
    borderColor: Palette.error,
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
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  primaryButtonDisabled: {
    opacity: 0.5,
  },
  primaryButtonGradient: {
    height: CONTROL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontSize: 15,
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
    paddingHorizontal: 16,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  providerButtonDisabled: {
    opacity: 0.5,
  },
  providerBadge: {
    width: 26,
    height: 26,
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
    alignItems: 'center',
    gap: 8,
  },
  footerPrompt: {
    fontSize: 13,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  footerButton: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  footerButtonText: {
    fontSize: 13.5,
    fontFamily: FontFamily.bold,
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
