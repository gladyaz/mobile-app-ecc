import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FontFamily, Palette, Radius } from '@/constants/theme';
import { TransactionHistoryPanel } from '@/features/rewards/components/transaction-history-panel';
import { RewardSurface } from '@/features/rewards/rewards-theme';
import { useTranslation } from '@/stores/language';
import type { RewardsLedgerState } from '@/types/rewards';

/**
 * The "Riwayat" destination: the server's ledger, on its own surface.
 *
 * WHY A SHEET RATHER THAN A SIXTH SECTION. History answers a different
 * question from the rest of the page ("where did my coins go?" instead of
 * "what can I do now?"), it is the one block that can run to dozens of rows,
 * and in the reference design it is a header affordance rather than
 * something the main scroll ends with. Moving it here keeps the earn ->
 * redeem path short while leaving the history one tap away.
 *
 * IT ADDS NO HISTORY OF ITS OWN. Every row comes from
 * `TransactionHistoryPanel`, which renders the `GET /rewards/ledger` page the
 * container fetched - the same rows, the same states, the same cursor-based
 * "load more". This file supplies a header, a scrim and a scroll container
 * and nothing else; it holds no entries, composes no row, and knows no
 * balance.
 */

type RewardsHistorySheetProps = {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly ledger: RewardsLedgerState;
  readonly onRetry: () => void;
  readonly onLoadMore: () => void;
};

export function RewardsHistorySheet({
  visible,
  onClose,
  ledger,
  onRetry,
  onLoadMore,
}: RewardsHistorySheetProps) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      testID="rewards-history-modal"
      transparent
      visible={visible}>
      {/* Tapping the scrim closes the sheet. It is a SIBLING of the panel,
          not its parent, so a tap inside the panel cannot bubble out to it. */}
      <Pressable
        accessibilityLabel={t('rewards.historyClose')}
        accessibilityRole="button"
        onPress={onClose}
        style={styles.scrim}
        testID="rewards-history-scrim"
      />

      <View style={[styles.panel, { paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.grabber} />

        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            {t('rewards.sectionHistory')}
          </Text>
          <Pressable
            accessibilityLabel={t('rewards.historyClose')}
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            testID="rewards-history-close">
            <Text style={styles.closeButtonText}>{t('rewards.dismiss')}</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          testID="rewards-history-scroll">
          <TransactionHistoryPanel onLoadMore={onLoadMore} onRetry={onRetry} state={ledger} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
  },
  panel: {
    marginTop: 'auto',
    // Bounded so the sheet never covers the whole screen: the page behind it
    // stays visible, which is what makes the sheet read as a detour rather
    // than a navigation the user has to find their way back from.
    maxHeight: '82%',
    paddingHorizontal: 16,
    paddingTop: 8,
    borderTopLeftRadius: Radius.xxl,
    borderTopRightRadius: Radius.xxl,
    borderTopWidth: 1,
    borderColor: RewardSurface.cardBorder,
    backgroundColor: Palette.backgroundElevated,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: Radius.pill,
    backgroundColor: Palette.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 17,
    fontFamily: FontFamily.extraBold,
    color: Palette.text,
  },
  closeButton: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: RewardSurface.cardBorder,
    backgroundColor: RewardSurface.card,
  },
  closeButtonText: {
    fontSize: 12.5,
    fontFamily: FontFamily.bold,
    color: Palette.text,
  },
  content: {
    paddingBottom: 8,
  },
  pressed: {
    opacity: 0.75,
  },
});
