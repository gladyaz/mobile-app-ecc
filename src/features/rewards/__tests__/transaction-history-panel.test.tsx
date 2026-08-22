import { fireEvent, render } from '@testing-library/react-native';

import { TransactionHistoryPanel } from '@/features/rewards/components/transaction-history-panel';
import { DEFAULT_LANGUAGE, translations } from '@/services/i18n/translations';
import type { RewardLedgerEntry, RewardsLedgerState } from '@/types/rewards';

/**
 * Point history, as a presentational surface.
 *
 * The one property worth protecting here is that this panel renders the
 * ledger it is GIVEN and nothing else - no synthesised row for an action
 * that just happened, no running total recomputed on the device, and no
 * "load more" control past the end of the server's history. A locally
 * composed history would drift from the balance sitting above it the first
 * time a request succeeded on the server and failed on the wire.
 */

const idCopy = translations[DEFAULT_LANGUAGE];

const EARN_ENTRY: RewardLedgerEntry = {
  id: 'led_earn',
  deltaPoints: 10,
  reason: 'DAILY_CHECK_IN',
  balanceAfter: 1250,
  createdAt: '2026-08-22T01:05:00.000Z',
  createdAtLabel: '22/08/2026 08:05',
};

const REDEEM_ENTRY: RewardLedgerEntry = {
  id: 'led_redeem',
  deltaPoints: -1000,
  reason: 'VIP_REDEMPTION',
  balanceAfter: 250,
  createdAt: '2026-08-21T09:30:00.000Z',
  createdAtLabel: '21/08/2026 16:30',
};

function readyState(overrides: Partial<Extract<RewardsLedgerState, { status: 'ready' }>> = {}) {
  return {
    status: 'ready' as const,
    entries: [EARN_ENTRY, REDEEM_ENTRY],
    hasMore: false,
    isLoadingMore: false,
    loadMoreError: null,
    ...overrides,
  };
}

function renderPanel(state: RewardsLedgerState, handlers: Partial<Record<'onRetry' | 'onLoadMore', jest.Mock>> = {}) {
  return render(
    <TransactionHistoryPanel
      onLoadMore={handlers.onLoadMore ?? jest.fn()}
      onRetry={handlers.onRetry ?? jest.fn()}
      state={state}
    />
  );
}

describe('TransactionHistoryPanel - rendering the server’s ledger', () => {
  it('renders exactly one row per supplied entry', async () => {
    const { getAllByTestId } = await renderPanel(readyState());

    expect(getAllByTestId('rewards-transaction-item')).toHaveLength(2);
  });

  it('renders an EARN entry with a leading plus', async () => {
    const { getByTestId } = await renderPanel(readyState());

    expect(getByTestId('rewards-transaction-delta-led_earn').props.children).toBe('+10');
  });

  it('renders a REDEEM entry with a leading minus, not a double negative', async () => {
    // `formatPoints` is fed the MAGNITUDE and the sign comes from the
    // template, so a negative delta cannot render as "--1.000".
    const { getByTestId } = await renderPanel(readyState());

    expect(getByTestId('rewards-transaction-delta-led_redeem').props.children).toBe('-1.000');
  });

  it('carries direction in text, never by colour alone', async () => {
    // The sign has to survive greyscale, colour blindness and a screen
    // reader, so it lives in the string itself.
    const { getByTestId } = await renderPanel(readyState());

    const earn = String(getByTestId('rewards-transaction-delta-led_earn').props.children);
    const redeem = String(getByTestId('rewards-transaction-delta-led_redeem').props.children);

    expect(earn.startsWith('+')).toBe(true);
    expect(redeem.startsWith('-')).toBe(true);
  });

  it('labels each entry with its reason', async () => {
    const { getByText } = await renderPanel(readyState());

    expect(getByText(idCopy['rewards.reasonCheckIn'])).toBeTruthy();
    expect(getByText(idCopy['rewards.reasonRedemption'])).toBeTruthy();
  });

  it('labels an unrecognised reason generically rather than hiding the row', async () => {
    const { getByText, getAllByTestId } = await renderPanel(
      readyState({ entries: [{ ...EARN_ENTRY, reason: 'OTHER' }] })
    );

    expect(getByText(idCopy['rewards.reasonOther'])).toBeTruthy();
    expect(getAllByTestId('rewards-transaction-item')).toHaveLength(1);
  });

  it('shows the server’s timestamp, pre-formatted', async () => {
    const { getByText } = await renderPanel(readyState());

    expect(getByText(EARN_ENTRY.createdAtLabel)).toBeTruthy();
  });

  it('announces reason, signed amount, date and resulting balance as one node', async () => {
    const { getAllByTestId } = await renderPanel(readyState());

    const label = String(getAllByTestId('rewards-transaction-item')[0].props.accessibilityLabel);

    expect(label).toContain(idCopy['rewards.reasonCheckIn']);
    expect(label).toContain('+10');
    expect(label).toContain(EARN_ENTRY.createdAtLabel);
    expect(label).toContain('1.250');
  });
});

describe('TransactionHistoryPanel - states', () => {
  it('renders a loading state with no rows', async () => {
    const { getByTestId, queryAllByTestId } = await renderPanel({ status: 'loading' });

    expect(getByTestId('rewards-history-loading')).toBeTruthy();
    expect(queryAllByTestId('rewards-transaction-item')).toHaveLength(0);
  });

  it('distinguishes a failed read from an empty history', async () => {
    // They look identical to a user reconciling their points, and only one
    // of them means "you have no transactions".
    const { getByTestId, queryByTestId } = await renderPanel({
      status: 'error',
      message: 'gagal',
    });

    expect(getByTestId('rewards-history-error')).toBeTruthy();
    expect(queryByTestId('rewards-history-empty')).toBeNull();
  });

  it('retries a failed read on demand', async () => {
    const onRetry = jest.fn();
    const { getByTestId } = await renderPanel({ status: 'error', message: 'gagal' }, { onRetry });

    fireEvent.press(getByTestId('rewards-history-retry'));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders an explicit empty state rather than nothing at all', async () => {
    const { getByTestId, getByText } = await renderPanel(readyState({ entries: [] }));

    expect(getByTestId('rewards-history-empty')).toBeTruthy();
    expect(getByText(idCopy['rewards.historyEmpty'])).toBeTruthy();
  });
});

describe('TransactionHistoryPanel - cursor pagination', () => {
  it('offers no "load more" control when the server says there is no more', async () => {
    const { queryByTestId } = await renderPanel(readyState({ hasMore: false }));

    // Paging past the end of an append-only history would be inventing a
    // page the server never offered.
    expect(queryByTestId('rewards-history-load-more')).toBeNull();
  });

  it('offers it when the server says there is more', async () => {
    const onLoadMore = jest.fn();
    const { getByTestId } = await renderPanel(readyState({ hasMore: true }), { onLoadMore });

    fireEvent.press(getByTestId('rewards-history-load-more'));

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });

  it('blocks a second press while a page is already loading', async () => {
    const onLoadMore = jest.fn();
    const { getByTestId } = await renderPanel(
      readyState({ hasMore: true, isLoadingMore: true }),
      { onLoadMore }
    );

    fireEvent.press(getByTestId('rewards-history-load-more'));

    expect(onLoadMore).not.toHaveBeenCalled();
    expect(getByTestId('rewards-history-load-more').props.accessibilityState).toMatchObject({
      busy: true,
      disabled: true,
    });
  });

  it('keeps the loaded rows on screen when the next page fails', async () => {
    // Discarding a page the user is reading in order to report a network
    // blip is a worse outcome than the blip.
    const { getAllByTestId, getByTestId } = await renderPanel(
      readyState({ hasMore: true, loadMoreError: 'gagal halaman' })
    );

    expect(getAllByTestId('rewards-transaction-item')).toHaveLength(2);
    expect(getByTestId('rewards-history-load-more-error')).toBeTruthy();
  });

  it('gives the "load more" control a 44pt touch target', async () => {
    const { getByTestId } = await renderPanel(readyState({ hasMore: true }));
    const style = getByTestId('rewards-history-load-more').props.style;
    const flattened = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;

    expect(flattened.minHeight).toBeGreaterThanOrEqual(44);
  });
});
