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
 */

const FIXTURE_WALLET: RewardWallet = {
  balancePoints: 1250,
  lifetimeEarnedPoints: 8400,
  // Fixture data is never authoritative. The UI reads this flag to label
  // the balance as a preview instead of implying a real, spendable total.
  isServerAuthoritative: false,
  updatedAtLabel: null,
};

const FIXTURE_DAILY_CHECK_IN: DailyCheckIn = {
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
  ctaLabel: 'Check-in Hari Ini',
  isClaimSupported: false,
  resetsAtLabel: 'Reset tiap tengah malam WIB',
};

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

const FIXTURE_TASKS: readonly RewardTask[] = [
  {
    id: 'task_social_facebook',
    type: 'SOCIAL_FOLLOW',
    socialPlatform: 'FACEBOOK',
    title: 'Follow Facebook',
    description: 'Ikuti halaman Facebook resmi untuk update rilis drama terbaru.',
    rewardPoints: 50,
    progress: null,
    status: 'AVAILABLE',
    ctaLabel: 'Follow',
    isClaimSupported: false,
  },
  {
    id: 'task_social_youtube',
    type: 'SOCIAL_FOLLOW',
    socialPlatform: 'YOUTUBE',
    title: 'Subscribe YouTube',
    description: 'Subscribe channel YouTube resmi untuk cuplikan episode baru.',
    rewardPoints: 50,
    progress: null,
    status: 'AVAILABLE',
    ctaLabel: 'Subscribe',
    isClaimSupported: false,
  },
  {
    id: 'task_social_tiktok',
    type: 'SOCIAL_FOLLOW',
    socialPlatform: 'TIKTOK',
    title: 'Follow TikTok',
    description: 'Ikuti akun TikTok resmi untuk potongan drama harian.',
    rewardPoints: 50,
    progress: null,
    status: 'AVAILABLE',
    ctaLabel: 'Follow',
    isClaimSupported: false,
  },
  {
    id: 'task_rewarded_ad',
    type: 'REWARDED_AD',
    title: 'Tonton Iklan Berhadiah',
    description: 'Tonton iklan sampai selesai untuk poin tambahan.',
    rewardPoints: 20,
    progress: { current: 0, target: 5 },
    status: 'IN_PROGRESS',
    ctaLabel: 'Tonton',
    isClaimSupported: false,
  },
  {
    id: 'task_campaign_placeholder',
    type: 'CAMPAIGN',
    title: 'Misi Spesial',
    description: 'Slot untuk campaign musiman. Kontennya nanti dikirim backend.',
    rewardPoints: 150,
    progress: { current: 0, target: 1 },
    status: 'LOCKED',
    ctaLabel: 'Belum Dibuka',
    isClaimSupported: false,
  },
];

const FIXTURE_REDEMPTIONS: readonly RewardRedemption[] = [
  {
    id: 'redeem_vip_1d',
    title: 'VIP 1 Hari',
    description: 'Akses semua episode premium selama 24 jam.',
    costPoints: 1000,
    grantsDays: 1,
    availability: 'AVAILABLE',
    ctaLabel: 'Tukar',
    isRedeemSupported: false,
  },
  {
    id: 'redeem_vip_3d',
    title: 'VIP 3 Hari',
    description: 'Akses semua episode premium selama 3 hari.',
    costPoints: 2500,
    grantsDays: 3,
    availability: 'INSUFFICIENT_POINTS',
    ctaLabel: 'Tukar',
    isRedeemSupported: false,
  },
  {
    id: 'redeem_vip_7d',
    title: 'VIP 7 Hari',
    description: 'Akses semua episode premium selama sepekan.',
    costPoints: 5000,
    grantsDays: 7,
    availability: 'COMING_SOON',
    ctaLabel: 'Segera',
    isRedeemSupported: false,
  },
];

export const FIXTURE_REWARDS_SNAPSHOT: RewardsSnapshot = {
  wallet: FIXTURE_WALLET,
  dailyCheckIn: FIXTURE_DAILY_CHECK_IN,
  watchTime: FIXTURE_WATCH_TIME,
  tasks: FIXTURE_TASKS,
  redemptions: FIXTURE_REDEMPTIONS,
};
