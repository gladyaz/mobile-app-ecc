import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { useTranslation } from '@/stores/language';
import {
  DISCOVER_GRID_GAP,
  POSTER_ASPECT_RATIO,
  type DiscoverGrid,
} from '@/features/discover/use-discover-grid';

/** Placeholder rows drawn while the catalog request is in flight. */
const SKELETON_ROWS = 3;

type DiscoverGridSkeletonProps = {
  readonly grid: DiscoverGrid;
};

/**
 * Poster-shaped placeholders at the real grid dimensions, so the layout does
 * not jump when the catalog arrives. Deliberately static - a pulsing
 * skeleton would be motion for its own sake.
 */
export function DiscoverGridSkeleton({ grid }: DiscoverGridSkeletonProps) {
  const { t } = useTranslation();
  const placeholderStyle = useMemo(
    () => ({ width: grid.posterWidth, aspectRatio: POSTER_ASPECT_RATIO }),
    [grid.posterWidth]
  );
  const placeholderKeys = useMemo(
    () => Array.from({ length: grid.columns * SKELETON_ROWS }, (_, index) => `skeleton-${index}`),
    [grid.columns]
  );

  return (
    <View
      accessibilityLabel={t('discover.loadingA11y')}
      accessibilityRole="progressbar"
      accessible
      style={styles.skeletonGrid}>
      {placeholderKeys.map((key) => (
        <View key={key} style={[styles.skeletonBlock, placeholderStyle]} />
      ))}
    </View>
  );
}

type DiscoverErrorStateProps = {
  readonly onRetry: () => void;
};

export function DiscoverErrorState({ onRetry }: DiscoverErrorStateProps) {
  const { t } = useTranslation();

  return (
    <View style={styles.state}>
      <StateIcon name={{ ios: 'wifi.exclamationmark', android: 'error', web: 'error' }} />
      <Text style={styles.stateTitle}>{t('discover.loadFailed')}</Text>
      <Text style={styles.stateDescription}>{t('discover.loadFailedDesc')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}>
        <Text style={styles.primaryActionText}>{t('discover.retry')}</Text>
      </Pressable>
    </View>
  );
}

type DiscoverEmptyStateProps = {
  readonly symbol: SymbolViewProps['name'];
  readonly title: string;
  readonly description: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
};

export function DiscoverEmptyState({
  symbol,
  title,
  description,
  actionLabel,
  onAction,
}: DiscoverEmptyStateProps) {
  return (
    <View style={styles.state}>
      <StateIcon name={symbol} />
      <Text style={styles.stateTitle}>{title}</Text>
      <Text style={styles.stateDescription}>{description}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.secondaryAction, pressed && styles.pressed]}>
          <Text style={styles.secondaryActionText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function StateIcon({ name }: { readonly name: SymbolViewProps['name'] }) {
  return (
    <View style={styles.stateIconCircle}>
      <SymbolView name={name} size={26} tintColor={Palette.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: DISCOVER_GRID_GAP,
    paddingTop: 2,
  },
  skeletonBlock: {
    borderRadius: Radius.md,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
  },
  state: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  stateIconCircle: {
    width: 68,
    height: 68,
    borderRadius: Radius.pill,
    backgroundColor: Palette.surface,
    borderWidth: 1,
    borderColor: Palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateTitle: {
    marginTop: 4,
    fontSize: 16,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
    textAlign: 'center',
  },
  stateDescription: {
    fontSize: 13,
    lineHeight: 19,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
    maxWidth: 260,
  },
  primaryAction: {
    marginTop: 6,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 22,
    borderRadius: Radius.md,
    backgroundColor: Palette.primary,
  },
  primaryActionText: {
    fontSize: 13.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  secondaryAction: {
    marginTop: 6,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 20,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surface,
  },
  secondaryActionText: {
    fontSize: 13,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  pressed: {
    opacity: 0.72,
  },
});
