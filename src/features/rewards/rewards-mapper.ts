import type {
  CheckInResponseDto,
  DailyCheckInDto,
  RewardLedgerEntryDto,
  RewardLedgerPageDto,
  RewardRedemptionOfferDto,
  RewardTaskDto,
  RewardWalletDto,
  RewardsSnapshotDto,
} from '@/services/rewards/rewards-dto';
import { isPremiumExperienceEnabled } from '@/services/config/v1-scope';
import type { TranslationKey } from '@/services/i18n/translations';
import type { Translate } from '@/stores/language';
import type {
  DailyCheckIn,
  RewardLedgerEntry,
  RewardLedgerPage,
  RewardLedgerReason,
  RewardRedemption,
  RewardTask,
  RewardWallet,
  RewardsSnapshot,
  SocialPlatform,
} from '@/types/rewards';

/**
 * The ONE seam between the `/rewards/*` wire format and what the Rewards
 * Center renders.
 *
 * It exists because the server and the client own different halves of the
 * same screen, and the split is deliberate in both directions:
 *
 *   SERVER OWNS every economic value and every availability flag - points,
 *   costs, durations, streak state, `isClaimSupported`, `isRedeemSupported`,
 *   and the `availability` of each offer. This module copies them across
 *   verbatim. It never computes one, never defaults one to a friendlier
 *   value, and never re-derives affordability from the balance it just read.
 *
 *   CLIENT OWNS copy and formatting - titles, descriptions, CTA words and
 *   date labels. The app ships three languages and localises through `t()`;
 *   a backend that sent "Check in" would either force English on every
 *   locale or drag a translation catalog into that service.
 *
 * Because every function here takes `t`, the copy follows the app's language
 * automatically, and because none of them takes a number that is not already
 * in the DTO, no reward value can enter the UI from this side.
 *
 * NO FIXTURES, NO FALLBACK SNAPSHOT. If a response is missing, the caller
 * renders an error state. There is deliberately no "build a plausible
 * snapshot" path in this module for a caller to reach for.
 */

/** Plain `Date` formatting only - no `Intl`/`toLocaleString`, matching the
 * precedent in `app/account-security.tsx`: ICU data is not guaranteed to be
 * complete in every JS engine this app runs under. */
function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateTimeLabel(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    // A malformed instant is echoed rather than rendered as "Invalid Date".
    return iso;
  }

  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatTimeLabel(iso: string): string {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return iso;
  }

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function mapWallet(dto: RewardWalletDto): RewardWallet {
  return {
    balancePoints: dto.balancePoints,
    lifetimeEarnedPoints: dto.lifetimeEarnedPoints,
    // Copied, never asserted. The real backend sends `true`; anything that
    // arrives without it stays labelled as non-authoritative rather than
    // being promoted here.
    isServerAuthoritative: dto.isServerAuthoritative === true,
    updatedAtLabel: dto.updatedAt ? formatDateTimeLabel(dto.updatedAt) : null,
  };
}

export function mapDailyCheckIn(dto: DailyCheckInDto, t: Translate): DailyCheckIn {
  return {
    currentStreakDays: dto.currentStreakDays,
    longestStreakDays: dto.longestStreakDays,
    todayRewardPoints: dto.todayRewardPoints,
    isTodayClaimed: dto.isTodayClaimed,
    days: dto.days.map((day) => ({
      day: day.day,
      rewardPoints: day.rewardPoints,
      state: day.state,
      isBonus: day.isBonus,
    })),
    ctaLabel: dto.isTodayClaimed ? t('rewards.checkedInCta') : t('rewards.checkInCta'),
    isClaimSupported: dto.isClaimSupported,
    // Both halves are true at once and neither can be dropped: `{time}` is
    // the rollover instant on the reader's own clock, and `{timezone}` names
    // the zone whose CALENDAR DAY defines a reward day. Showing only the
    // local time would imply the device decides the boundary (it never
    // does); showing only the zone would not answer "when?".
    resetsAtLabel: t('rewards.resetsAt', {
      time: formatTimeLabel(dto.resetsAt),
      timezone: dto.timezone,
    }),
  };
}

const SOCIAL_TITLE_KEY: Record<SocialPlatform, TranslationKey> = {
  FACEBOOK: 'rewards.taskFacebookTitle',
  YOUTUBE: 'rewards.taskYoutubeTitle',
  TIKTOK: 'rewards.taskTiktokTitle',
  INSTAGRAM: 'rewards.taskInstagramTitle',
};

const SOCIAL_DESCRIPTION_KEY: Record<SocialPlatform, TranslationKey> = {
  FACEBOOK: 'rewards.taskFacebookDesc',
  YOUTUBE: 'rewards.taskYoutubeDesc',
  TIKTOK: 'rewards.taskTiktokDesc',
  INSTAGRAM: 'rewards.taskInstagramDesc',
};

function taskTitle(dto: RewardTaskDto, t: Translate): string {
  if (dto.socialPlatform) {
    return t(SOCIAL_TITLE_KEY[dto.socialPlatform]);
  }

  switch (dto.type) {
    case 'REWARDED_AD':
      return t('rewards.taskAdTitle');
    case 'CAMPAIGN':
      return t('rewards.taskCampaignTitle');
    case 'WATCH_TIME':
      return t('rewards.taskWatchTitle');
    case 'DAILY_CHECK_IN':
      return t('rewards.taskCheckInTitle');
    default:
      return t('rewards.taskGenericTitle');
  }
}

function taskDescription(dto: RewardTaskDto, t: Translate): string {
  if (dto.socialPlatform) {
    return t(SOCIAL_DESCRIPTION_KEY[dto.socialPlatform]);
  }

  switch (dto.type) {
    case 'REWARDED_AD':
      return t('rewards.taskAdDesc');
    case 'CAMPAIGN':
      return t('rewards.taskCampaignDesc');
    case 'WATCH_TIME':
      return t('rewards.taskWatchDesc');
    case 'DAILY_CHECK_IN':
      return t('rewards.taskCheckInDesc');
    default:
      return t('rewards.taskGenericDesc');
  }
}

/**
 * The CTA word for a task.
 *
 * An UNSUPPORTED task never gets an action word. "Follow" beside a reward
 * pill is an invitation to earn those points, and the backend cannot pay
 * them - it has no way to verify that a follow happened, that it was the
 * same person, or that it outlasted collecting the reward. So the label
 * itself states the unavailability, and `RewardCta` adds the "pressing this
 * does not add points" hint for screen-reader users on top.
 */
function taskCtaLabel(dto: RewardTaskDto, t: Translate): string {
  if (!dto.isClaimSupported) {
    return dto.unsupportedReason === 'AWAITING_PRODUCT_DECISION'
      ? t('rewards.ctaSoon')
      : t('rewards.ctaUnavailable');
  }

  if (dto.socialPlatform === 'YOUTUBE') {
    return t('rewards.ctaSubscribe');
  }

  if (dto.socialPlatform) {
    return t('rewards.ctaFollow');
  }

  return dto.type === 'REWARDED_AD' ? t('rewards.ctaWatch') : t('rewards.ctaClaim');
}

export function mapTask(dto: RewardTaskDto, t: Translate): RewardTask {
  return {
    id: dto.id,
    type: dto.type,
    title: taskTitle(dto, t),
    description: taskDescription(dto, t),
    rewardPoints: dto.rewardPoints,
    // The backend serves no task progress, so there is none to render. A
    // client-counted "2 of 5 ads watched" would be a local number dressed as
    // server progress toward a reward the server will not pay.
    progress: null,
    status: dto.status,
    ctaLabel: taskCtaLabel(dto, t),
    ...(dto.socialPlatform ? { socialPlatform: dto.socialPlatform } : {}),
    isClaimSupported: dto.isClaimSupported,
    ...(dto.unsupportedReason ? { unsupportedReason: dto.unsupportedReason } : {}),
  };
}

const OFFER_TITLE_KEY: Record<string, TranslationKey> = {
  redeem_vip_1d: 'rewards.offerVip1Title',
  redeem_vip_3d: 'rewards.offerVip3Title',
  redeem_vip_7d: 'rewards.offerVip7Title',
};

export function mapRedemption(dto: RewardRedemptionOfferDto, t: Translate): RewardRedemption {
  const titleKey = OFFER_TITLE_KEY[dto.id];

  return {
    id: dto.id,
    // A catalog entry this build has no copy for still renders, named by the
    // one fact the server sent about it. Dropping an unknown offer would
    // hide a purchasable item from the user; inventing a name for it would
    // be worse.
    title: titleKey ? t(titleKey) : t('rewards.offerGenericTitle', { days: dto.grantsDays }),
    description: t('rewards.offerVipDesc'),
    costPoints: dto.costPoints,
    grantsDays: dto.grantsDays,
    availability: dto.availability,
    // The CTA word states the SERVER's verdict, so the button is never a
    // bare "Redeem" that the press handler then refuses. Each branch is a
    // value the backend sent: not open yet, cannot afford it yet, or go.
    ctaLabel:
      dto.availability === 'COMING_SOON'
        ? t('rewards.ctaSoon')
        : dto.availability === 'INSUFFICIENT_POINTS'
          ? t('rewards.ctaInsufficient')
          : t('rewards.ctaRedeem'),
    isRedeemSupported: dto.isRedeemSupported,
  };
}

/**
 * Which redemption offers a V1 build may show.
 *
 * V1 IS FREE + ADS. `grantsDays` is how the backend says "this offer buys
 * premium access for N days", so an offer with `grantsDays > 0` IS the premium
 * experience, sold for coins - a paid unlock of episodes that are already free
 * in V1. Showing it would advertise a tier the app does not have and take
 * coins for nothing.
 *
 * KEYED ON THE GRANT, NOT ON AN ID BLOCKLIST, on purpose. It states the actual
 * rule ("V1 hides offers that grant premium"), so the first genuinely
 * non-premium offer the backend adds - a Skip Next Ad perk, say, with
 * `grantsDays: 0` - flows through to the Redeem panel with no client change.
 * That is the forward boundary the coin-utility work plugs into; see
 * services/config/v1-scope.ts.
 *
 * The offers themselves, their mapping, and the whole Redeem section are
 * untouched: with every current offer filtered out, the panel renders its
 * existing honest empty state rather than disappearing.
 */
function isOfferInV1Scope(dto: RewardRedemptionOfferDto): boolean {
  return isPremiumExperienceEnabled() || dto.grantsDays <= 0;
}

export function mapRewardsSnapshot(dto: RewardsSnapshotDto, t: Translate): RewardsSnapshot {
  return {
    wallet: mapWallet(dto.wallet),
    dailyCheckIn: dto.dailyCheckIn ? mapDailyCheckIn(dto.dailyCheckIn, t) : null,
    // The backend sends `null` and means it: it has no watch-analytics feed,
    // only a per-series resume position that DECREASES on a rewatch. This
    // maps straight through to the section's empty state rather than being
    // back-filled from anything on the device.
    watchTime: dto.watchTime ?? null,
    tasks: dto.tasks.map((task) => mapTask(task, t)),
    redemptions: dto.redemptions
      .filter(isOfferInV1Scope)
      .map((offer) => mapRedemption(offer, t)),
  };
}

/**
 * Applies a check-in response to the snapshot already on screen.
 *
 * The response carries the authoritative wallet AND the authoritative
 * check-in state, so both are adopted wholesale. Nothing is added to the old
 * balance: `awardedPoints` is reported to the user as what just happened,
 * never used as an operand. On a replay the server sends `awardedPoints: 0`
 * and the same wallet back, so an already-claimed day is a visible no-op.
 *
 * The redemption list is deliberately NOT patched here even though a new
 * balance can change affordability - `availability` is server-computed, and
 * recomputing it on this side is exactly the divergence this module exists
 * to prevent. The caller re-reads the snapshot instead.
 */
export function applyCheckInResponse(
  snapshot: RewardsSnapshot,
  response: CheckInResponseDto,
  t: Translate
): RewardsSnapshot {
  return {
    ...snapshot,
    wallet: mapWallet(response.wallet),
    dailyCheckIn: mapDailyCheckIn(response.dailyCheckIn, t),
  };
}

const LEDGER_REASONS: readonly RewardLedgerReason[] = [
  'DAILY_CHECK_IN',
  'VIP_REDEMPTION',
  'ADJUSTMENT',
  'REVERSAL',
];

/**
 * Narrows the server's free-form `reason` string.
 *
 * An unrecognised reason becomes `OTHER` and still renders as a movement
 * with its real amount and timestamp. Dropping it would leave a user
 * reconciling their own history against a balance that no longer adds up,
 * which is a worse failure than a generically-labelled row.
 */
function toLedgerReason(reason: string): RewardLedgerReason {
  return LEDGER_REASONS.includes(reason as RewardLedgerReason)
    ? (reason as RewardLedgerReason)
    : 'OTHER';
}

export function mapLedgerEntry(dto: RewardLedgerEntryDto): RewardLedgerEntry {
  return {
    id: dto.id,
    deltaPoints: dto.deltaPoints,
    reason: toLedgerReason(dto.reason),
    balanceAfter: dto.balanceAfter,
    createdAt: dto.createdAt,
    createdAtLabel: formatDateTimeLabel(dto.createdAt),
  };
}

export function mapLedgerPage(dto: RewardLedgerPageDto): RewardLedgerPage {
  return {
    entries: dto.entries.map(mapLedgerEntry),
    nextCursor: dto.nextCursor,
  };
}
