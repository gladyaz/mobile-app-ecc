import type { Translate } from '@/stores/language';
import type {
  DailyCheckIn,
  RewardRedemption,
  RewardTask,
  RewardWallet,
  RewardsSnapshot,
  WatchTimeProgress,
} from '@/types/rewards';

/**
 * ===========================================================================
 * PLACEHOLDER ECONOMICS - NOT PRODUCT-APPROVED - DO NOT SHIP AS REAL VALUES
 * ===========================================================================
 *
 * Every number in this file is a layout fixture chosen to exercise the UI
 * (a claimed day, a today day, upcoming days, a bonus day, a partially
 * filled progress bar, an affordable and an unaffordable redemption). None
 * of it is a business decision.
 *
 * Still awaiting product/founder approval, and therefore still fake here:
 *   - daily check-in reward curve and any streak bonus
 *   - rewarded-ad reward value and the daily ad cap
 *   - social-follow reward value
 *   - watch-time milestone thresholds and their reward values
 *   - VIP redemption costs and benefit durations
 *
 * THE ONLY PLACE these numbers may live. Components receive them as props
 * off the `RewardsSnapshot` model and must never inline an economic value -
 * `__tests__/rewards-economics-boundary.test.ts` fails if a component file
 * imports this module.
 *
 * When the backend lands, this file is replaced by a service response of
 * the same shape; no component changes.
 *
 * WHY A BUILDER RATHER THAN A CONST: Rewards is a routed, user-visible
 * screen, so its placeholder copy has to speak all three app languages. The
 * `RewardsSnapshot` MODEL is deliberately unchanged - `title`, `description`
 * and `ctaLabel` stay plain strings, because that is what a real backend
 * will send. Only this preview module needs `t`, so only this module takes
 * it. Swapping in the real service later means deleting this file, not
 * unpicking a translation key from the domain contract.
 */

const FIXTURE_WALLET: RewardWallet = {
  balancePoints: 1250,
  lifetimeEarnedPoints: 8400,
  // Fixture data is never authoritative. The UI reads this flag to label
  // the balance as a preview instead of implying a real, spendable total.
  isServerAuthoritative: false,
  updatedAtLabel: null,
};

function buildDailyCheckIn(t: Translate): DailyCheckIn {
  return {
    currentStreakDays: 3,
    longestStreakDays: 11,
    todayRewardPoints: 25,
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
    ctaLabel: t('rewards.fixtureCheckInCta'),
    isClaimSupported: false,
    resetsAtLabel: t('rewards.fixtureResetsAt'),
  };
}

const FIXTURE_WATCH_TIME: WatchTimeProgress = {
  watchedMinutes: 7,
  milestones: [
    { id: 'watch_3m', minutes: 3, rewardPoints: 15, status: 'CLAIMED' },
    { id: 'watch_5m', minutes: 5, rewardPoints: 25, status: 'REACHED' },
    { id: 'watch_10m', minutes: 10, rewardPoints: 50, status: 'LOCKED' },
    { id: 'watch_30m', minutes: 30, rewardPoints: 120, status: 'LOCKED' },
    { id: 'watch_45m', minutes: 45, rewardPoints: 200, status: 'LOCKED' },
  ],
  // Not 'SERVER': there is no watch analytics feed behind this yet, and a
  // local timer is explicitly disqualified from ever backing an award.
  source: 'PLACEHOLDER',
  isClaimSupported: false,
};

function buildTasks(t: Translate): readonly RewardTask[] {
  return [
    {
      id: 'task_social_facebook',
      type: 'SOCIAL_FOLLOW',
      socialPlatform: 'FACEBOOK',
      title: t('rewards.fixtureFacebookTitle'),
      description: t('rewards.fixtureFacebookDesc'),
      rewardPoints: 50,
      progress: null,
      status: 'AVAILABLE',
      ctaLabel: t('rewards.ctaFollow'),
      isClaimSupported: false,
    },
    {
      id: 'task_social_youtube',
      type: 'SOCIAL_FOLLOW',
      socialPlatform: 'YOUTUBE',
      title: t('rewards.fixtureYoutubeTitle'),
      description: t('rewards.fixtureYoutubeDesc'),
      rewardPoints: 50,
      progress: null,
      status: 'AVAILABLE',
      ctaLabel: t('rewards.ctaSubscribe'),
      isClaimSupported: false,
    },
    {
      id: 'task_social_tiktok',
      type: 'SOCIAL_FOLLOW',
      socialPlatform: 'TIKTOK',
      title: t('rewards.fixtureTiktokTitle'),
      description: t('rewards.fixtureTiktokDesc'),
      rewardPoints: 50,
      progress: null,
      status: 'AVAILABLE',
      ctaLabel: t('rewards.ctaFollow'),
      isClaimSupported: false,
    },
    {
      id: 'task_rewarded_ad',
      type: 'REWARDED_AD',
      title: t('rewards.fixtureAdTitle'),
      description: t('rewards.fixtureAdDesc'),
      rewardPoints: 20,
      progress: { current: 0, target: 5 },
      status: 'IN_PROGRESS',
      ctaLabel: t('rewards.ctaWatch'),
      isClaimSupported: false,
    },
    {
      id: 'task_campaign_placeholder',
      type: 'CAMPAIGN',
      title: t('rewards.fixtureCampaignTitle'),
      description: t('rewards.fixtureCampaignDesc'),
      rewardPoints: 150,
      // No progress: a one-shot campaign has no meaningful "x of y", and a
      // 0/1 bar rendered as a permanently-empty track on the least
      // actionable row - the visually busiest row for the least reason.
      progress: null,
      status: 'LOCKED',
      ctaLabel: t('rewards.ctaLocked'),
      isClaimSupported: false,
    },
  ];
}

function buildRedemptions(t: Translate): readonly RewardRedemption[] {
  return [
    {
      id: 'redeem_vip_1d',
      title: t('rewards.fixtureVip1Title'),
      description: t('rewards.fixtureVipDesc'),
      costPoints: 1000,
      grantsDays: 1,
      availability: 'AVAILABLE',
      ctaLabel: t('rewards.ctaRedeem'),
      isRedeemSupported: false,
    },
    {
      id: 'redeem_vip_3d',
      title: t('rewards.fixtureVip3Title'),
      description: t('rewards.fixtureVipDesc'),
      costPoints: 2500,
      grantsDays: 3,
      availability: 'INSUFFICIENT_POINTS',
      ctaLabel: t('rewards.ctaRedeem'),
      isRedeemSupported: false,
    },
    {
      id: 'redeem_vip_7d',
      title: t('rewards.fixtureVip7Title'),
      description: t('rewards.fixtureVipDesc'),
      costPoints: 5000,
      grantsDays: 7,
      availability: 'COMING_SOON',
      ctaLabel: t('rewards.ctaSoon'),
      isRedeemSupported: false,
    },
  ];
}

/**
 * The preview snapshot, in the caller's current language.
 *
 * Every `isClaimSupported` / `isRedeemSupported` flag is hardcoded false and
 * `wallet.isServerAuthoritative` is hardcoded false, so no argument to this
 * function can produce a snapshot that claims to be real.
 */
export function buildFixtureRewardsSnapshot(t: Translate): RewardsSnapshot {
  return {
    wallet: FIXTURE_WALLET,
    dailyCheckIn: buildDailyCheckIn(t),
    watchTime: FIXTURE_WATCH_TIME,
    tasks: buildTasks(t),
    redemptions: buildRedemptions(t),
  };
}
