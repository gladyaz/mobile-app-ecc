import { fireEvent, render, waitFor } from '@testing-library/react-native';

import RewardsRoute from '@/app/(tabs)/rewards';
import { ApiError } from '@/services/api/client';
import { DEFAULT_LANGUAGE, LANGUAGES, translations } from '@/services/i18n/translations';
import type {
  CheckInResponseDto,
  RedeemResponseDto,
  RewardLedgerPageDto,
  RewardsSnapshotDto,
} from '@/services/rewards/rewards-dto';
import {
  claimDailyCheckIn,
  fetchRewardsLedger,
  fetchRewardsSnapshot,
  redeemReward,
} from '@/services/rewards/rewards-service';

/**
 * The Rewards tab, WIRED - route + container + screen, with only the network
 * replaced.
 *
 * This is the file that proves the integration rather than the parts.
 * `rewards-center-screen.test.tsx` proves the screen cannot move a number on
 * its own, and `rewards-service.test.ts` proves the client sends no
 * economics. What is only observable here is the loop between them: that a
 * balance on screen came from a response, that a second check-in does not
 * pay twice, that a refused redemption leaves the wallet exactly where it
 * was, and that a successful one re-reads the EXISTING entitlement rather
 * than inventing a second premium flag.
 *
 * Every number below originates in a mocked BACKEND RESPONSE. None is
 * hardcoded in an assertion that the app could satisfy without the server -
 * each expected string is derived from the DTO it should have come from.
 */

jest.mock('@/services/rewards/rewards-service', () => ({
  fetchRewardsSnapshot: jest.fn(),
  claimDailyCheckIn: jest.fn(),
  fetchRewardsLedger: jest.fn(),
  redeemReward: jest.fn(),
}));

const mockRouterPush = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

const mockUseAuth = jest.fn();
const mockRefreshEntitlement = jest.fn();

jest.mock('@/stores/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/stores/entitlement', () => ({
  useEntitlement: () => ({ isPremium: false, refresh: mockRefreshEntitlement }),
}));

const mockFetchSnapshot = fetchRewardsSnapshot as jest.MockedFunction<typeof fetchRewardsSnapshot>;
const mockCheckIn = claimDailyCheckIn as jest.MockedFunction<typeof claimDailyCheckIn>;
const mockFetchLedger = fetchRewardsLedger as jest.MockedFunction<typeof fetchRewardsLedger>;
const mockRedeem = redeemReward as jest.MockedFunction<typeof redeemReward>;

const idCopy = translations[DEFAULT_LANGUAGE];

// ---------------------------------------------------------------------------
// Backend responses. Test-only, and deliberately NOT a shared fixture module:
// the runtime has no fixture snapshot to fall back to any more, and giving
// the tests one that looked importable would invite its return.
// ---------------------------------------------------------------------------

const SERVER_BALANCE = 1250;
const SERVER_CHECK_IN_REWARD = 25;
const SERVER_AWARDED_POINTS = 10;
const SERVER_VIP_1D_COST = 1000;

function buildSnapshotDto(overrides: Partial<RewardsSnapshotDto> = {}): RewardsSnapshotDto {
  return {
    wallet: {
      balancePoints: SERVER_BALANCE,
      lifetimeEarnedPoints: 8400,
      // The real backend always sends `true`. This is what makes the preview
      // chrome disappear, so it is data here, never a component default.
      isServerAuthoritative: true,
      updatedAt: '2026-08-22T03:00:00.000Z',
      version: 7,
    },
    dailyCheckIn: {
      currentStreakDays: 3,
      longestStreakDays: 11,
      totalCheckInDays: 14,
      todayRewardPoints: SERVER_CHECK_IN_REWARD,
      isTodayClaimed: false,
      days: [
        { day: 1, rewardPoints: 10, state: 'CLAIMED', isBonus: false },
        { day: 2, rewardPoints: 15, state: 'CLAIMED', isBonus: false },
        { day: 3, rewardPoints: 20, state: 'CLAIMED', isBonus: false },
        { day: 4, rewardPoints: 25, state: 'TODAY', isBonus: false },
        { day: 5, rewardPoints: 30, state: 'UPCOMING', isBonus: false },
        { day: 6, rewardPoints: 40, state: 'UPCOMING', isBonus: false },
        { day: 7, rewardPoints: 100, state: 'UPCOMING', isBonus: true },
      ],
      // Check-in is the ONE fully server-verified earn path.
      isClaimSupported: true,
      periodKey: '2026-08-22',
      timezone: 'Asia/Jakarta',
      resetsAt: '2026-08-22T17:00:00.000Z',
    },
    // The backend has no trustworthy watch-time signal and says so.
    watchTime: null,
    tasks: [
      {
        id: 'task_social_facebook',
        type: 'SOCIAL_FOLLOW',
        socialPlatform: 'FACEBOOK',
        rewardPoints: 50,
        status: 'AVAILABLE',
        isClaimSupported: false,
        unsupportedReason: 'NO_VERIFIABLE_SIGNAL',
      },
      {
        id: 'task_rewarded_ad',
        type: 'REWARDED_AD',
        rewardPoints: 20,
        status: 'AVAILABLE',
        isClaimSupported: false,
        unsupportedReason: 'NO_VERIFIABLE_SIGNAL',
      },
      {
        id: 'task_campaign_placeholder',
        type: 'CAMPAIGN',
        rewardPoints: 150,
        status: 'LOCKED',
        isClaimSupported: false,
        unsupportedReason: 'AWAITING_PRODUCT_DECISION',
      },
    ],
    redemptions: [
      {
        id: 'redeem_vip_1d',
        costPoints: SERVER_VIP_1D_COST,
        grantsDays: 1,
        availability: 'AVAILABLE',
        isRedeemSupported: true,
      },
      {
        id: 'redeem_vip_3d',
        costPoints: 2500,
        grantsDays: 3,
        // Server-computed against the SERVER's balance, not the client's.
        availability: 'INSUFFICIENT_POINTS',
        isRedeemSupported: true,
      },
      {
        id: 'redeem_vip_7d',
        costPoints: 5000,
        grantsDays: 7,
        availability: 'COMING_SOON',
        isRedeemSupported: false,
      },
    ],
    ...overrides,
  };
}

/**
 * Newest first, and internally consistent: the check-in at the top credits
 * 10 onto the 1240 the redemption below it left, reaching the 1250 the
 * wallet reports. A history that did not add up to the balance beside it
 * would let a bug hide behind test data.
 */
const LEDGER_PAGE: RewardLedgerPageDto = {
  entries: [
    {
      id: 'led_checkin_1',
      deltaPoints: SERVER_AWARDED_POINTS,
      reason: 'DAILY_CHECK_IN',
      sourceType: 'CHECK_IN',
      sourceId: null,
      balanceAfter: 1250,
      createdAt: '2026-08-22T01:05:00.000Z',
      metadata: null,
    },
    {
      id: 'led_redeem_1',
      deltaPoints: -SERVER_VIP_1D_COST,
      reason: 'VIP_REDEMPTION',
      sourceType: 'REDEMPTION',
      sourceId: 'rdm_1',
      balanceAfter: 1240,
      createdAt: '2026-08-21T09:30:00.000Z',
      metadata: null,
    },
  ],
  nextCursor: null,
};

function buildCheckInResponse(overrides: Partial<CheckInResponseDto> = {}): CheckInResponseDto {
  const base = buildSnapshotDto();

  return {
    awardedPoints: SERVER_AWARDED_POINTS,
    alreadyCheckedIn: false,
    ledgerEntryId: 'led_checkin_2',
    wallet: {
      ...base.wallet,
      balancePoints: SERVER_BALANCE + SERVER_AWARDED_POINTS,
      version: base.wallet.version + 1,
    },
    dailyCheckIn: { ...base.dailyCheckIn, isTodayClaimed: true, currentStreakDays: 4 },
    ...overrides,
  };
}

function buildRedeemResponse(overrides: Partial<RedeemResponseDto> = {}): RedeemResponseDto {
  const base = buildSnapshotDto();

  return {
    redemptionId: 'rdm_2',
    offerId: 'redeem_vip_1d',
    costPoints: SERVER_VIP_1D_COST,
    grantsDays: 1,
    status: 'FULFILLED',
    replayed: false,
    wallet: {
      ...base.wallet,
      balancePoints: SERVER_BALANCE - SERVER_VIP_1D_COST,
      version: base.wallet.version + 1,
    },
    entitlementExpiresAt: '2026-08-23T03:00:00.000Z',
    ...overrides,
  };
}

/** Indonesian groups thousands with "." - the app's default language here. */
function formatId(points: number): string {
  return String(Math.trunc(Math.abs(points))).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function signedIn() {
  mockUseAuth.mockReturnValue({
    isAuthenticated: true,
    isHydrated: true,
    user: { id: 'user_1', name: 'QA', username: 'qa', email: 'qa@example.com' },
  });
}

function guest() {
  mockUseAuth.mockReturnValue({ isAuthenticated: true, isHydrated: true, user: null });
}

beforeEach(() => {
  signedIn();
  mockFetchSnapshot.mockResolvedValue(buildSnapshotDto());
  mockFetchLedger.mockResolvedValue(LEDGER_PAGE);
  mockCheckIn.mockResolvedValue(buildCheckInResponse());
  mockRedeem.mockResolvedValue(buildRedeemResponse());
  mockRefreshEntitlement.mockResolvedValue(undefined);
});

// ===========================================================================
// A - guest
// ===========================================================================

describe('Rewards tab - a guest gets no rewards at all', () => {
  beforeEach(() => {
    guest();
  });

  it('shows the sign-in requirement instead of any balance', async () => {
    const { findByTestId, queryByTestId } = await render(<RewardsRoute />);

    expect(await findByTestId('rewards-sign-in-required')).toBeTruthy();
    // Not a zero, not a preview figure, not a cached number: no balance at all.
    expect(queryByTestId('rewards-balance-value')).toBeNull();
    expect(queryByTestId('rewards-balance')).toBeNull();
  });

  it('never calls the rewards backend for a signed-out viewer', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-sign-in-required');

    // Rewards routes are authenticated by contract; asking anyway would only
    // produce a 401 to mistranslate into an error state.
    expect(mockFetchSnapshot).not.toHaveBeenCalled();
    expect(mockFetchLedger).not.toHaveBeenCalled();
    expect(mockCheckIn).not.toHaveBeenCalled();
    expect(mockRedeem).not.toHaveBeenCalled();
  });

  it('offers the way in rather than a dead end', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    fireEvent.press(await findByTestId('rewards-sign-in-button'));

    expect(mockRouterPush).toHaveBeenCalledWith('/login');
  });
});

// ===========================================================================
// B, C - the snapshot IS the screen
// ===========================================================================

describe('Rewards tab - the balance is the server’s', () => {
  it('fetches the whole centre in ONE authenticated snapshot read', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance');

    // One call, not four: the wallet, the streak strip and redemption
    // availability must agree with each other.
    expect(mockFetchSnapshot).toHaveBeenCalledTimes(1);
  });

  it('renders exactly the balance the backend sent', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    const balance = await findByTestId('rewards-balance-value');

    expect(balance.props.children).toBe(formatId(SERVER_BALANCE));
  });

  it('renders a DIFFERENT balance when the backend sends a different one', async () => {
    // The point of this case is that the previous one is not passing by
    // coincidence with a hardcoded number somewhere in the render path.
    const snapshot = buildSnapshotDto();

    mockFetchSnapshot.mockResolvedValue({
      ...snapshot,
      wallet: { ...snapshot.wallet, balancePoints: 98765 },
    });

    const { findByTestId } = await render(<RewardsRoute />);

    expect((await findByTestId('rewards-balance-value')).props.children).toBe(formatId(98765));
  });

  it('drops the preview badge, banner and tag once the wallet is server-authoritative', async () => {
    // "PRATINJAU", "Poin dan hadiah belum aktif" and "Nilai pratinjau" were
    // all true of the preview slice and are all false now. They are driven
    // off the server's own flag rather than deleted, so a non-authoritative
    // balance would still be labelled.
    const { findByTestId, queryByTestId, queryByText } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance');

    expect(queryByTestId('rewards-preview-banner')).toBeNull();
    expect(queryByTestId('rewards-balance-preview-tag')).toBeNull();
    expect(queryByText(idCopy['rewards.previewBadge'])).toBeNull();
    expect(queryByText(idCopy['rewards.previewBannerBody'])).toBeNull();
  });

  it('renders the check-in reward the server configured, not a bundled curve', async () => {
    const snapshot = buildSnapshotDto();

    mockFetchSnapshot.mockResolvedValue({
      ...snapshot,
      dailyCheckIn: { ...snapshot.dailyCheckIn, todayRewardPoints: 77 },
    });

    const { findByTestId } = await render(<RewardsRoute />);

    expect((await findByTestId('check-in-today-reward')).props.children).toBe('+77');
  });
});

// ===========================================================================
// D, E, F - check-in
// ===========================================================================

describe('Rewards tab - daily check-in', () => {
  it('calls the backend when the check-in CTA is pressed', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    fireEvent.press(await findByTestId('rewards-check-in'));

    await waitFor(() => expect(mockCheckIn).toHaveBeenCalledTimes(1));
  });

  it('supplies NO amount, date or key - the call takes no arguments', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    fireEvent.press(await findByTestId('rewards-check-in'));

    await waitFor(() => expect(mockCheckIn).toHaveBeenCalled());
    // Everything about the payout is the server's decision. There is nothing
    // in this call for a client to influence.
    expect(mockCheckIn).toHaveBeenCalledWith();
  });

  it('adopts the wallet from the response rather than adding the award to it', async () => {
    const response = buildCheckInResponse();

    mockCheckIn.mockResolvedValue(response);

    const { findByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance-value');
    fireEvent.press(await findByTestId('rewards-check-in'));

    await waitFor(async () =>
      expect((await findByTestId('rewards-balance-value')).props.children).toBe(
        formatId(response.wallet.balancePoints)
      )
    );
  });

  it('shows the SERVER’s balance even when it disagrees with balance + award', async () => {
    // The distinguishing case: if the client were adding `awardedPoints` to
    // the balance it already had, it would render 1260. The server says 999,
    // and the server is the authority - so 999 is what must appear.
    mockCheckIn.mockResolvedValue(
      buildCheckInResponse({
        awardedPoints: SERVER_AWARDED_POINTS,
        wallet: { ...buildSnapshotDto().wallet, balancePoints: 999, version: 8 },
      })
    );

    const { findByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance-value');
    fireEvent.press(await findByTestId('rewards-check-in'));

    await waitFor(async () =>
      expect((await findByTestId('rewards-balance-value')).props.children).toBe(formatId(999))
    );
  });

  it('does not double the balance when check-in is pressed twice', async () => {
    const first = buildCheckInResponse();
    // A replay: 200, nothing awarded, the SAME wallet returned.
    const replay = buildCheckInResponse({
      awardedPoints: 0,
      alreadyCheckedIn: true,
      wallet: first.wallet,
    });

    mockCheckIn.mockResolvedValueOnce(first).mockResolvedValueOnce(replay);

    const { findByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance-value');

    fireEvent.press(await findByTestId('rewards-check-in'));
    await waitFor(() => expect(mockCheckIn).toHaveBeenCalledTimes(1));
    await waitFor(async () =>
      expect((await findByTestId('rewards-balance-value')).props.children).toBe(
        formatId(first.wallet.balancePoints)
      )
    );

    fireEvent.press(await findByTestId('rewards-check-in'));
    await waitFor(() => expect(mockCheckIn).toHaveBeenCalledTimes(2));

    // Still the first response's balance - the replay moved nothing, and the
    // client added nothing of its own.
    await waitFor(async () =>
      expect((await findByTestId('rewards-balance-value')).props.children).toBe(
        formatId(first.wallet.balancePoints)
      )
    );
  });

  it('tells the user plainly that today was already claimed', async () => {
    mockCheckIn.mockResolvedValue(
      buildCheckInResponse({ awardedPoints: 0, alreadyCheckedIn: true })
    );

    const { findByTestId, findByText } = await render(<RewardsRoute />);

    fireEvent.press(await findByTestId('rewards-check-in'));

    // A repeat is a successful no-op, not an error to render as a failure.
    expect(await findByText(idCopy['rewards.checkInAlready'])).toBeTruthy();
  });

  it('leaves the balance untouched when the check-in request fails', async () => {
    mockCheckIn.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    const { findByTestId, findByText } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance-value');
    fireEvent.press(await findByTestId('rewards-check-in'));

    expect(await findByText(idCopy['rewards.errorNetwork'])).toBeTruthy();
    expect((await findByTestId('rewards-balance-value')).props.children).toBe(
      formatId(SERVER_BALANCE)
    );
  });
});

// ===========================================================================
// G, H, I - ledger
// ===========================================================================

describe('Rewards tab - transaction history comes from the ledger', () => {
  it('reads history from the backend', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-history');

    expect(mockFetchLedger).toHaveBeenCalled();
  });

  it('renders one row per server entry, and none of its own', async () => {
    const { findByTestId, getAllByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-history');

    expect(getAllByTestId('rewards-transaction-item')).toHaveLength(LEDGER_PAGE.entries.length);
  });

  it('renders an EARN entry with its sign and its reason', async () => {
    const { findByTestId, findByText } = await render(<RewardsRoute />);

    const earn = await findByTestId('rewards-transaction-delta-led_checkin_1');

    expect(earn.props.children).toBe(`+${formatId(SERVER_AWARDED_POINTS)}`);
    expect(await findByText(idCopy['rewards.reasonCheckIn'])).toBeTruthy();
  });

  it('renders a REDEEM entry as a negative, understandable at a glance', async () => {
    const { findByTestId, findByText } = await render(<RewardsRoute />);

    const redeem = await findByTestId('rewards-transaction-delta-led_redeem_1');

    // The sign is carried by TEXT, so direction survives greyscale, colour
    // blindness and a screen reader.
    expect(redeem.props.children).toBe(`-${formatId(SERVER_VIP_1D_COST)}`);
    expect(await findByText(idCopy['rewards.reasonRedemption'])).toBeTruthy();
  });

  it('re-reads the ledger after a check-in instead of composing the new row', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-history');
    const readsBefore = mockFetchLedger.mock.calls.length;

    fireEvent.press(await findByTestId('rewards-check-in'));

    await waitFor(() => expect(mockFetchLedger.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('offers no "load more" control when the server says the history is exhausted', async () => {
    const { findByTestId, queryByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-history');

    // `nextCursor: null`. A control that paged past the end would invent one.
    expect(queryByTestId('rewards-history-load-more')).toBeNull();
  });

  it('pages with the server’s opaque cursor when there is more', async () => {
    mockFetchLedger.mockResolvedValueOnce({ ...LEDGER_PAGE, nextCursor: 'CURSOR_ABC' });

    const { findByTestId } = await render(<RewardsRoute />);

    fireEvent.press(await findByTestId('rewards-history-load-more'));

    await waitFor(() =>
      expect(mockFetchLedger).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: 'CURSOR_ABC' })
      )
    );
  });

  it('reports a failed history read instead of showing an empty one', async () => {
    // An empty list and a failed load look identical to a user reconciling
    // their points, and only one of them means "you have no transactions".
    mockFetchLedger.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    const { findByTestId, queryByTestId } = await render(<RewardsRoute />);

    expect(await findByTestId('rewards-history-error')).toBeTruthy();
    expect(queryByTestId('rewards-history-empty')).toBeNull();
  });
});

// ===========================================================================
// J, K, L, M - redemption
// ===========================================================================

describe('Rewards tab - redemption', () => {
  it('sends intent only to the canonical redemption call', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    fireEvent.press(await findByTestId('redeem-cta-redeem_vip_1d'));

    await waitFor(() => expect(mockRedeem).toHaveBeenCalledTimes(1));

    const body = mockRedeem.mock.calls[0][0];

    expect(body.offerId).toBe('redeem_vip_1d');
    expect(Object.keys(body).sort()).toEqual(['idempotencyKey', 'offerId']);
    expect(body.idempotencyKey).toMatch(/^[A-Za-z0-9_:-]{8,128}$/);
  });

  it('shows the debited balance the server returned', async () => {
    const response = buildRedeemResponse();

    mockRedeem.mockResolvedValue(response);
    // The post-redeem re-read agrees with the receipt.
    mockFetchSnapshot
      .mockResolvedValueOnce(buildSnapshotDto())
      .mockResolvedValueOnce({ ...buildSnapshotDto(), wallet: response.wallet });

    const { findByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance-value');
    fireEvent.press(await findByTestId('redeem-cta-redeem_vip_1d'));

    await waitFor(async () =>
      expect((await findByTestId('rewards-balance-value')).props.children).toBe(
        formatId(response.wallet.balancePoints)
      )
    );
  });

  it('refreshes the EXISTING entitlement after a successful redemption', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    fireEvent.press(await findByTestId('redeem-cta-redeem_vip_1d'));

    // Not a premium flag of its own: the one entitlement authority is
    // re-read, so series gating, profile and ads all see the same answer.
    await waitFor(() => expect(mockRefreshEntitlement).toHaveBeenCalledTimes(1));
  });

  it('re-reads the snapshot after redeeming, because affordability is server-computed', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance-value');
    expect(mockFetchSnapshot).toHaveBeenCalledTimes(1);

    fireEvent.press(await findByTestId('redeem-cta-redeem_vip_1d'));

    await waitFor(() => expect(mockFetchSnapshot).toHaveBeenCalledTimes(2));
  });

  it('refuses an unaffordable offer WITHOUT calling the backend or moving the balance', async () => {
    const { findByTestId, findByText } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance-value');
    fireEvent.press(await findByTestId('redeem-cta-redeem_vip_3d'));

    expect(
      await findByText(
        idCopy['rewards.redeemInsufficient'].replace(
          '{title}',
          idCopy['rewards.offerVip3Title']
        )
      )
    ).toBeTruthy();
    expect(mockRedeem).not.toHaveBeenCalled();
    expect((await findByTestId('rewards-balance-value')).props.children).toBe(
      formatId(SERVER_BALANCE)
    );
  });

  it('leaves the balance untouched when the SERVER refuses for insufficient points', async () => {
    // The race the previous case cannot cover: the snapshot said affordable,
    // the server disagreed. Nothing moved there, so nothing may move here.
    mockRedeem.mockRejectedValue(
      new ApiError(409, 'INSUFFICIENT_REWARD_POINTS', 'insufficient')
    );

    const { findByTestId, findByText } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance-value');
    fireEvent.press(await findByTestId('redeem-cta-redeem_vip_1d'));

    expect(
      await findByText(
        idCopy['rewards.redeemInsufficient'].replace(
          '{title}',
          idCopy['rewards.offerVip1Title']
        )
      )
    ).toBeTruthy();
    expect((await findByTestId('rewards-balance-value')).props.children).toBe(
      formatId(SERVER_BALANCE)
    );
    expect(mockRefreshEntitlement).not.toHaveBeenCalled();
  });

  it('still reports success when the post-purchase re-read fails', async () => {
    // The purchase has already committed on the server. A failure while
    // re-reading its consequences must not be reported as a failed
    // redemption - a user who just bought premium being told it went wrong
    // is worse than a momentarily stale offer list, and would send them to
    // buy it again.
    const response = buildRedeemResponse();

    mockRedeem.mockResolvedValue(response);
    mockFetchSnapshot
      .mockResolvedValueOnce(buildSnapshotDto())
      .mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    const { findByTestId, findByText } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance-value');
    fireEvent.press(await findByTestId('redeem-cta-redeem_vip_1d'));

    expect(
      await findByText(
        idCopy['rewards.redeemSuccess']
          .replace('{title}', idCopy['rewards.offerVip1Title'])
          .replace('{points}', String(SERVER_VIP_1D_COST))
      )
    ).toBeTruthy();
    // And the balance from the RECEIPT stays on screen - it is authoritative
    // regardless of whether the follow-up read landed.
    expect((await findByTestId('rewards-balance-value')).props.children).toBe(
      formatId(response.wallet.balancePoints)
    );
  });

  it('never redeems an offer the server has not enabled', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    fireEvent.press(await findByTestId('redeem-cta-redeem_vip_7d'));

    await waitFor(async () => expect(await findByTestId('rewards-action-banner')).toBeTruthy());
    expect(mockRedeem).not.toHaveBeenCalled();
  });

  it('does not grant premium itself when the redemption fails', async () => {
    mockRedeem.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    const { findByTestId, findByText } = await render(<RewardsRoute />);

    fireEvent.press(await findByTestId('redeem-cta-redeem_vip_1d'));

    expect(await findByText(idCopy['rewards.errorNetwork'])).toBeTruthy();
    expect(mockRefreshEntitlement).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// N - unsupported earn paths
// ===========================================================================

describe('Rewards tab - unverifiable earn paths stay unavailable', () => {
  it('renders every social, ad and campaign task as unclaimable', async () => {
    const { findByTestId, getByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-earn-panel');

    const hint = idCopy['rewards.unavailableCtaHint'];

    for (const taskId of ['task_social_facebook', 'task_rewarded_ad', 'task_campaign_placeholder']) {
      expect(getByTestId(`reward-task-cta-${taskId}`).props.accessibilityHint).toBe(hint);
    }
  });

  it('never puts an action word on a task the server cannot pay', async () => {
    // "Follow" beside a +50 pill is an invitation to earn points the backend
    // has no way to verify and will refuse to credit.
    const { findByTestId, queryByText } = await render(<RewardsRoute />);

    await findByTestId('rewards-earn-panel');

    expect(queryByText(idCopy['rewards.ctaFollow'])).toBeNull();
    expect(queryByText(idCopy['rewards.ctaWatch'])).toBeNull();
    expect(queryByText(idCopy['rewards.ctaSubscribe'])).toBeNull();
  });

  it('pressing an unsupported task credits nothing and calls nothing', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    const balanceBefore = (await findByTestId('rewards-balance-value')).props.children;

    fireEvent.press(await findByTestId('reward-task-cta-task_social_facebook'));
    fireEvent.press(await findByTestId('reward-task-cta-task_rewarded_ad'));

    expect(await findByTestId('rewards-action-banner')).toBeTruthy();
    expect((await findByTestId('rewards-balance-value')).props.children).toBe(balanceBefore);
    expect(mockCheckIn).not.toHaveBeenCalled();
    expect(mockRedeem).not.toHaveBeenCalled();
  });

  it('renders the watch-time section empty, because the server sends no watch data', async () => {
    const { findByTestId } = await render(<RewardsRoute />);

    // `watchTime: null` is an ANSWER: the backend's only watch data is a
    // resume position that decreases on a rewatch. The empty state says so
    // honestly rather than showing a number that looks like watch time.
    expect(await findByTestId('rewards-watch-time-empty')).toBeTruthy();
  });

  it('starts no timer of its own to fill the watch-time gap', async () => {
    jest.useFakeTimers();

    try {
      const { findByTestId } = await render(<RewardsRoute />);

      const balanceBefore = (await findByTestId('rewards-balance-value')).props.children;

      jest.advanceTimersByTime(10 * 60 * 1000);

      expect((await findByTestId('rewards-balance-value')).props.children).toBe(balanceBefore);
    } finally {
      jest.useRealTimers();
    }
  });
});

// ===========================================================================
// O, P - feature flag, and no fixture fallback anywhere
// ===========================================================================

describe('Rewards tab - feature disabled and failure states are truthful', () => {
  it('renders a bounded unavailable state when the backend has rewards switched off', async () => {
    mockFetchSnapshot.mockRejectedValue(
      new ApiError(503, 'REWARDS_DISABLED', 'Rewards are not enabled')
    );
    mockFetchLedger.mockRejectedValue(
      new ApiError(503, 'REWARDS_DISABLED', 'Rewards are not enabled')
    );

    const { findByTestId, queryByTestId, getByText } = await render(<RewardsRoute />);

    expect(await findByTestId('rewards-unavailable')).toBeTruthy();
    expect(getByText(idCopy['rewards.unavailableTitle'])).toBeTruthy();
    // The critical half: NO balance, and no retry for something retrying
    // cannot fix.
    expect(queryByTestId('rewards-balance-value')).toBeNull();
    expect(queryByTestId('rewards-retry-button')).toBeNull();
  });

  it('renders no balance of any kind when the snapshot read fails', async () => {
    mockFetchSnapshot.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'offline'));

    const { findByTestId, queryByTestId } = await render(<RewardsRoute />);

    expect(await findByTestId('rewards-error')).toBeTruthy();
    expect(queryByTestId('rewards-balance-value')).toBeNull();
  });

  // The preview slice shipped 1.250 / 8.400 as bundled placeholders. These
  // cases assert that NO failure path can put a plausible number on screen,
  // which is the whole meaning of "the backend is authoritative".
  //
  // `it.each` rather than a loop inside one case on purpose: each render
  // needs its own mount/unmount lifecycle, and rendering four trees inside a
  // single test overlaps React's `act()` scopes.
  it.each([
    ['a dropped connection', new ApiError(0, 'NETWORK_ERROR', 'offline')],
    ['a server fault', new ApiError(500, 'INTERNAL_ERROR', 'boom')],
    ['the feature being switched off', new ApiError(503, 'REWARDS_DISABLED', 'off')],
    ['an expired credential', new ApiError(401, 'INVALID_ACCESS_TOKEN', 'expired')],
  ])('renders no fixture figure after %s', async (_label, failure) => {
    mockFetchSnapshot.mockRejectedValue(failure);
    mockFetchLedger.mockRejectedValue(failure);

    const { queryByTestId, findByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-center-screen');
    await waitFor(() => expect(queryByTestId('rewards-loading')).toBeNull());

    expect(queryByTestId('rewards-balance-value')).toBeNull();
    expect(queryByTestId('rewards-balance')).toBeNull();
  });

  it('sends an expired session to the sign-in affordance, not to preview data', async () => {
    mockFetchSnapshot.mockRejectedValue(
      new ApiError(401, 'INVALID_ACCESS_TOKEN', 'expired')
    );

    const { findByTestId, queryByTestId } = await render(<RewardsRoute />);

    expect(await findByTestId('rewards-sign-in-required')).toBeTruthy();
    expect(queryByTestId('rewards-balance-value')).toBeNull();
  });
});

// ===========================================================================
// Cross-cutting: copy and dev tooling
// ===========================================================================

describe('Rewards tab - copy and tooling hygiene', () => {
  it('defines every rewards string in all three app languages', async () => {
    // Rewards is routed, so an untranslated key is a user-visible bug rather
    // than dead weight. `Copy` already makes a MISSING key a type error; this
    // catches the other half - a key present but left blank in en/zh.
    const rewardsKeys = Object.keys(idCopy).filter((key) => key.startsWith('rewards.'));

    expect(rewardsKeys.length).toBeGreaterThan(0);

    for (const language of LANGUAGES) {
      for (const key of rewardsKeys) {
        const value = translations[language][key as keyof typeof idCopy];

        expect(typeof value).toBe('string');
        expect(value.trim()).not.toBe('');
      }
    }
  });

  it('does not put backend or ledger terminology in front of the user', async () => {
    const { findByTestId, queryByText } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance');

    for (const fragment of ['backend', 'ledger', 'SDK', 'entitlement', 'idempoten']) {
      expect(queryByText(new RegExp(fragment, 'i'))).toBeNull();
    }
  });

  it('exposes no point-granting control anywhere in the rendered tab', async () => {
    // The demo balance is prepared with `scripts/dev-grant-reward-points.sh`
    // against a local server. A "give me points" affordance in the app would
    // ship inside the release APK.
    const { findByTestId, queryByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance');

    for (const testID of ['rewards-dev-grant', 'rewards-grant-points', 'rewards-debug']) {
      expect(queryByTestId(testID)).toBeNull();
    }
  });

  it('renders no back control - a bottom-tab root has nowhere to go back to', async () => {
    const { findByTestId, queryByTestId } = await render(<RewardsRoute />);

    await findByTestId('rewards-balance');

    expect(queryByTestId('rewards-back-button')).toBeNull();
  });
});
