import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { RewardEmptyState } from '@/features/rewards/components/rewards-primitives';
import { useFormatPoints } from '@/features/rewards/format-points';
import { RewardAccent, scaledLineHeight } from '@/features/rewards/rewards-theme';
import type { TranslationKey } from '@/services/i18n/translations';
import { useTranslation } from '@/stores/language';
import type { RewardLedgerEntry, RewardLedgerReason, RewardsLedgerState } from '@/types/rewards';

/**
 * Point history, straight from the server's ledger.
 *
 * THE LEDGER IS THE ONLY HISTORY AUTHORITY. Nothing in this file is derived
 * from what the user did in this session: no "you just checked in" row is
 * synthesised on a successful check-in, and no row is removed on a failure.
 * A locally-composed history would drift from the balance sitting above it
 * the first time a request succeeded on the server and failed on the wire,
 * and the user reading this list to reconcile their own points is exactly
 * the person that drift would mislead.
 *
 * DIRECTION IS CARRIED BY TEXT, NOT COLOUR. A credit reads "+10" and a debit
 * reads "-1.000", so the sign survives a greyscale screen, a colour-blind
 * reader and a screen reader. The green/gold tint is a second, redundant
 * cue - never the only one.
 *
 * PAGINATION IS CURSOR-BASED, and the "load more" control appears only while
 * the server has actually said there is more (`hasMore`). A failed page load
 * leaves the rows already on screen in place and shows the failure beneath
 * them, because throwing away a page the user is reading to report a network
 * blip would be a worse outcome than the blip.
 */

const REASON_LABEL_KEY: Record<RewardLedgerReason, TranslationKey> = {
  DAILY_CHECK_IN: 'rewards.reasonCheckIn',
  VIP_REDEMPTION: 'rewards.reasonRedemption',
  ADJUSTMENT: 'rewards.reasonAdjustment',
  REVERSAL: 'rewards.reasonReversal',
  // A reason this build does not know still renders as a real movement with
  // its real amount. Hiding it would leave a history that does not add up.
  OTHER: 'rewards.reasonOther',
};

type TransactionRowProps = {
  readonly entry: RewardLedgerEntry;
};

function TransactionRow({ entry }: TransactionRowProps) {
  const { t } = useTranslation();
  const formatPoints = useFormatPoints();
  const isEarn = entry.deltaPoints > 0;
  // `formatPoints` is fed the magnitude and the sign is applied by the
  // template, so a negative delta cannot render as "-​-1.000".
  const magnitude = formatPoints(Math.abs(entry.deltaPoints));
  const deltaLabel = t(isEarn ? 'rewards.deltaEarn' : 'rewards.deltaRedeem', {
    points: magnitude,
  });
  const reasonLabel = t(REASON_LABEL_KEY[entry.reason]);

  return (
    <View
      accessible
      accessibilityLabel={t('rewards.transactionA11y', {
        reason: reasonLabel,
        delta: deltaLabel,
        date: entry.createdAtLabel,
        balance: formatPoints(entry.balanceAfter),
      })}
      style={styles.row}
      // Every row shares one testID so automation can count and read them as
      // a set; the per-entry id is on the amount, where a specific assertion
      // needs it.
      testID="rewards-transaction-item">
      <View style={styles.rowBody}>
        <Text style={styles.rowReason}>{reasonLabel}</Text>
        <Text style={styles.rowDate}>{entry.createdAtLabel}</Text>
      </View>

      <View style={styles.rowTrailing}>
        <Text
          style={[styles.rowDelta, isEarn ? styles.rowDeltaEarn : styles.rowDeltaRedeem]}
          testID={`rewards-transaction-delta-${entry.id}`}>
          {deltaLabel}
        </Text>
        {/* The server's balance immediately after this entry - never a
            running total recomputed on the device. */}
        <Text style={styles.rowBalance}>
          {t('rewards.balanceAfter', { points: formatPoints(entry.balanceAfter) })}
        </Text>
      </View>
    </View>
  );
}

export type TransactionHistoryPanelProps = {
  readonly state: RewardsLedgerState;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
};

export function TransactionHistoryPanel({
  state,
  onRetry,
  onLoadMore,
}: TransactionHistoryPanelProps) {
  const { t } = useTranslation();

  if (state.status === 'loading') {
    return (
      <View style={styles.centered} testID="rewards-history-loading">
        <ActivityIndicator color={Palette.primary} size="small" />
        <Text style={styles.centeredText}>{t('rewards.historyLoading')}</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centered} testID="rewards-history-error">
        <Text style={styles.errorText}>{state.message}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          testID="rewards-history-retry">
          <Text style={styles.secondaryButtonText}>{t('rewards.retry')}</Text>
        </Pressable>
      </View>
    );
  }

  if (state.entries.length === 0) {
    return (
      <View testID="rewards-history">
        <RewardEmptyState message={t('rewards.historyEmpty')} testID="rewards-history-empty" />
      </View>
    );
  }

  return (
    <View style={styles.list} testID="rewards-history">
      {state.entries.map((entry) => (
        <TransactionRow entry={entry} key={entry.id} />
      ))}

      {state.loadMoreError ? (
        <Text style={styles.errorText} testID="rewards-history-load-more-error">
          {state.loadMoreError}
        </Text>
      ) : null}

      {/* Offered only while the SERVER says another page exists. A control
          that pages forever past the end of the history would invent one. */}
      {state.hasMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: state.isLoadingMore, busy: state.isLoadingMore }}
          disabled={state.isLoadingMore}
          onPress={onLoadMore}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          testID="rewards-history-load-more">
          {state.isLoadingMore ? (
            <ActivityIndicator color={Palette.primaryHover} size="small" />
          ) : (
            <Text style={styles.secondaryButtonText}>{t('rewards.historyLoadMore')}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Palette.border,
    borderRadius: Radius.xl,
    backgroundColor: Palette.surface,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowReason: {
    fontSize: 13.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  rowDate: {
    fontSize: 11,
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
  },
  rowTrailing: {
    alignItems: 'flex-end',
    gap: 2,
  },
  rowDelta: {
    fontSize: 14.5,
    fontFamily: FontFamily.extraBold,
  },
  rowDeltaEarn: {
    color: RewardAccent.gold,
  },
  rowDeltaRedeem: {
    // Not red: a redemption is a successful purchase, not an error. Muted
    // ink keeps the credit column the only highlighted one.
    color: Palette.textSecondary,
  },
  rowBalance: {
    fontSize: 10.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  centered: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 20,
    paddingHorizontal: 16,
  },
  centeredText: {
    fontSize: 12.5,
    fontFamily: FontFamily.semiBold,
    color: Palette.textSecondary,
  },
  errorText: {
    fontSize: 12.5,
    lineHeight: scaledLineHeight(12.5),
    fontFamily: FontFamily.regular,
    color: Palette.textSecondary,
    textAlign: 'center',
  },
  secondaryButton: {
    // 44pt is the accessibility floor and is never traded away for density.
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Palette.border,
    backgroundColor: Palette.surfaceMuted,
  },
  secondaryButtonText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  pressed: {
    opacity: 0.75,
  },
});
