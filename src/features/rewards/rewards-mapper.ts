import type {
  ActivePerksDto,
  CheckInResponseDto,
  DailyCheckInDto,
  MissionClaimResponseDto,
  RewardLedgerEntryDto,
  RewardLedgerPageDto,
  RewardPerkDto,
  RewardRedemptionOfferDto,
  RewardTaskDto,
  RewardWalletDto,
  RewardsSnapshotDto,
} from '@/services/rewards/rewards-dto';
import { isPremiumExperienceEnabled } from '@/services/config/v1-scope';
import type { TranslationKey } from '@/services/i18n/translations';
import type { Translate } from '@/stores/language';
import type {
  ActivePerks,
  DailyCheckIn,
  RewardLedgerEntry,
  RewardLedgerPage,
  RewardLedgerReason,
  RewardPerk,
  RewardPerkType,
  RewardRedemption,
  RewardTask,
  RewardTaskType,
  RewardWallet,
  RewardsSnapshot,
  SocialMissionStage,
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
  const platform = knownSocialPlatform(dto.socialPlatform);

  if (platform) {
    return t(SOCIAL_TITLE_KEY[platform]);
  }

  switch (dto.type) {
    case 'REWARDED_AD':
      return t('rewards.taskAdTitle');
    case 'CAMPAIGN':
      return t('rewards.taskCampaignTitle');
    case 'WATCH_TIME':
      return t('rewards.taskWatchTitle');
    case 'WATCH_EPISODES':
      // Named for what it COUNTS. The backend measures episodes the server
      // authorised, never minutes, so this title must not borrow watch-time
      // wording - a viewer reading "watch time" beside "2/3" would be told a
      // unit the number is not in.
      return t('rewards.taskWatchEpisodesTitle');
    case 'DAILY_CHECK_IN':
      return t('rewards.taskCheckInTitle');
    default:
      return t('rewards.taskGenericTitle');
  }
}

function taskDescription(dto: RewardTaskDto, t: Translate): string {
  const platform = knownSocialPlatform(dto.socialPlatform);

  if (platform) {
    return t(SOCIAL_DESCRIPTION_KEY[platform]);
  }

  switch (dto.type) {
    case 'REWARDED_AD':
      return t('rewards.taskAdDesc');
    case 'CAMPAIGN':
      return t('rewards.taskCampaignDesc');
    case 'WATCH_TIME':
      return t('rewards.taskWatchDesc');
    case 'WATCH_EPISODES':
      return t('rewards.taskWatchEpisodesDesc');
    case 'DAILY_CHECK_IN':
      return t('rewards.taskCheckInDesc');
    default:
      return t('rewards.taskGenericDesc');
  }
}

/**
 * The known task types and social platforms THIS BUILD can render.
 *
 * The wire union documents what the server may send; these arrays are what
 * this binary actually has a tile, a mark and copy for. The backend adds task
 * types server-side and expects already-installed clients to keep working, so
 * an unrecognised value is DROPPED at the seam rather than passed through to
 * a `Record` lookup that would return `undefined` and crash the row on
 * `mark.background`.
 *
 * Dropping rather than rendering-generically is the backend's own
 * instruction ("a client that does not know the member should skip the tile,
 * not crash"), and it is the honest option: a tile whose copy this build does
 * not have would be an unnamed reward the viewer cannot act on.
 */
const KNOWN_TASK_TYPES: readonly string[] = [
  'DAILY_CHECK_IN',
  'SOCIAL_FOLLOW',
  'REWARDED_AD',
  'WATCH_TIME',
  'WATCH_EPISODES',
  'CAMPAIGN',
];

const KNOWN_SOCIAL_PLATFORMS: readonly string[] = ['FACEBOOK', 'YOUTUBE', 'TIKTOK', 'INSTAGRAM'];

function knownTaskType(value: string): RewardTaskType | null {
  return KNOWN_TASK_TYPES.includes(value) ? (value as RewardTaskType) : null;
}

function knownSocialPlatform(value: string | undefined): SocialPlatform | null {
  return value && KNOWN_SOCIAL_PLATFORMS.includes(value) ? (value as SocialPlatform) : null;
}

/**
 * The CTA word for a task.
 *
 * AN UNSUPPORTED TASK NEVER GETS AN ACTION WORD. "Follow" beside a reward
 * pill is an invitation to earn those points, and for a task the backend
 * cannot pay it would be an invitation to nothing. The label itself states
 * the unavailability, and `RewardCta` adds the "pressing this does not add
 * points" hint for screen-reader users on top.
 *
 * A CLAIMED MISSION GETS NO ACTION WORD EITHER. Once the server reports
 * `claimedAt`, there is nothing left to press: leaving "Follow" live would
 * offer a second payout the backend answers `alreadyClaimed: true` to, which
 * reads to a viewer as a reward that silently failed.
 *
 * THE SOCIAL CTA IS STAGED, and the two words are two different actions:
 * `idle` opens the profile (and records the open server-side), `opened` is
 * the viewer confirming they came back. The confirm word deliberately says
 * "I have followed" rather than anything implying the app checked - the
 * server did not observe the follow and nor did this client.
 */
function taskCtaLabel(dto: RewardTaskDto, stage: SocialMissionStage, t: Translate): string {
  if (dto.claimedAt || stage === 'claimed') {
    return t('rewards.ctaClaimed');
  }

  if (!dto.isClaimSupported) {
    return dto.unsupportedReason === 'AWAITING_PRODUCT_DECISION'
      ? t('rewards.ctaSoon')
      : t('rewards.ctaUnavailable');
  }

  if (knownSocialPlatform(dto.socialPlatform)) {
    if (stage === 'opened') {
      return t('rewards.ctaConfirmFollow');
    }

    return dto.socialPlatform === 'YOUTUBE' ? t('rewards.ctaSubscribe') : t('rewards.ctaFollow');
  }

  return dto.type === 'REWARDED_AD' ? t('rewards.ctaWatch') : t('rewards.ctaClaim');
}

/**
 * Maps one wire task, or returns `null` for a task this build cannot render.
 *
 * `null` is a real outcome, not an error path - see `KNOWN_TASK_TYPES`.
 */
export function mapTask(
  dto: RewardTaskDto,
  t: Translate,
  stage: SocialMissionStage = 'idle'
): RewardTask | null {
  const type = knownTaskType(dto.type);

  if (!type) {
    return null;
  }

  const socialPlatform = knownSocialPlatform(dto.socialPlatform);
  const isClaimed = Boolean(dto.claimedAt);
  const effectiveStage: SocialMissionStage = isClaimed ? 'claimed' : stage;

  return {
    id: dto.id,
    type,
    title: taskTitle(dto, t),
    description: taskDescription(dto, t),
    rewardPoints: dto.rewardPoints,
    // STRAIGHT FROM THE SERVER, or absent. `required` becomes `target`; the
    // pair is never derived here, because a locally-counted progress bar is a
    // client number dressed as progress toward a payout only the server makes.
    progress: dto.progress
      ? { current: dto.progress.current, target: dto.progress.required }
      : null,
    status: dto.status,
    ctaLabel: taskCtaLabel(dto, effectiveStage, t),
    ...(socialPlatform ? { socialPlatform } : {}),
    isClaimSupported: dto.isClaimSupported,
    ...(dto.unsupportedReason ? { unsupportedReason: dto.unsupportedReason } : {}),
    ...(dto.verification ? { verification: dto.verification } : {}),
    ...(dto.accountHandle ? { accountHandle: dto.accountHandle } : {}),
    isClaimed,
    ...(dto.resetsAt
      ? { resetsAtLabel: t('rewards.taskResetsAt', { time: formatTimeLabel(dto.resetsAt) }) }
      : {}),
    socialStage: effectiveStage,
  };
}

const PERK_TITLE_KEY: Record<RewardPerkType, TranslationKey> = {
  SKIP_NEXT_INTERSTITIAL: 'rewards.perkSkipTitle',
  TEMPORARY_AD_PASS: 'rewards.perkPassTitle',
};

function mapPerk(dto: RewardPerkDto, t: Translate): RewardPerk | null {
  // A perk type this build has no copy for is dropped rather than rendered
  // as a blank row: the two derived booleans below still carry it into the ad
  // gate, so the viewer keeps the BENEFIT even when this list cannot name it.
  if (!(dto.perkType in PERK_TITLE_KEY)) {
    return null;
  }

  return {
    id: dto.id,
    type: dto.perkType,
    title: t(PERK_TITLE_KEY[dto.perkType]),
    detail:
      dto.perkType === 'SKIP_NEXT_INTERSTITIAL'
        ? t('rewards.perkSkipDetail', { uses: dto.remainingUses ?? 1 })
        : t('rewards.perkPassDetail'),
    expiresAt: dto.expiresAt,
    expiresAtLabel: t('rewards.perkExpiresAt', { time: formatDateTimeLabel(dto.expiresAt) }),
    remainingUses: dto.remainingUses,
  };
}

/**
 * Maps what the account currently holds.
 *
 * `skipNextInterstitial` and `adFreeUntil` are COPIED, never recomputed from
 * `perks[]`. Deriving them here would be a second implementation of a rule
 * the server owns, on the one code path where the two drifting apart means
 * showing an ad to someone who spent coins not to see one.
 */
export function mapActivePerks(dto: ActivePerksDto | undefined, t: Translate): ActivePerks {
  if (!dto) {
    // A snapshot from a backend that predates perks. The honest reading is
    // "this account holds nothing", which is also the SAFE direction: it
    // suppresses no ad and grants no skip.
    return { perks: [], skipNextInterstitial: false, adFreeUntil: null };
  }

  return {
    perks: (dto.perks ?? [])
      .map((perk) => mapPerk(perk, t))
      .filter((perk): perk is RewardPerk => perk !== null),
    skipNextInterstitial: dto.skipNextInterstitial === true,
    adFreeUntil: dto.adFreeUntil ?? null,
  };
}

const OFFER_TITLE_KEY: Record<string, TranslationKey> = {
  redeem_vip_1d: 'rewards.offerVip1Title',
  redeem_vip_3d: 'rewards.offerVip3Title',
  redeem_vip_7d: 'rewards.offerVip7Title',
  redeem_skip_next_ad: 'rewards.offerSkipAdTitle',
  redeem_ad_pass_2h: 'rewards.offerAdPassTitle',
};

/**
 * The offer's description.
 *
 * An AD_PERK offer describes itself from the SERVER's `perk` block - the
 * number of uses and the duration are economics and arrive as data, so
 * retuning "2 hours" to "3 hours" server-side changes this copy with no
 * mobile release. A build with no copy for an offer id still says something
 * true, because the sentence is assembled from the fields rather than looked
 * up by id.
 */
function offerDescription(dto: RewardRedemptionOfferDto, t: Translate): string {
  if (dto.kind === 'AD_PERK' && dto.perk) {
    return dto.perk.type === 'SKIP_NEXT_INTERSTITIAL'
      ? t('rewards.offerSkipAdDesc', { uses: dto.perk.uses ?? 1 })
      : t('rewards.offerAdPassDesc', { minutes: dto.perk.durationMinutes });
  }

  return t('rewards.offerVipDesc');
}

export function mapRedemption(dto: RewardRedemptionOfferDto, t: Translate): RewardRedemption {
  const titleKey = OFFER_TITLE_KEY[dto.id];

  return {
    id: dto.id,
    // A catalog entry this build has no copy for still renders, named by the
    // one fact the server sent about it. Dropping an unknown offer would
    // hide a purchasable item from the user; inventing a name for it would
    // be worse.
    title: titleKey ? t(titleKey) : t('rewards.offerGenericTitle', { days: dto.grantsDays }),
    description: offerDescription(dto, t),
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
    kind: dto.kind,
    ...(dto.perk ? { perk: dto.perk } : {}),
  };
}

/**
 * Which redemption offers a V1 build may show.
 *
 * V1 IS FREE + ADS + REWARDS. A `PREMIUM_DAYS` offer sells access to episodes
 * that are already free, so it would take coins and change nothing - the same
 * judgement the backend reaches from the other side, where those offers are
 * withheld as `COMING_SOON / NOT_APPLICABLE_IN_FREE_MODE` and refused if
 * requested anyway.
 *
 * KEYED ON WHAT THE OFFER HANDS OVER, NOT ON AN ID BLOCKLIST. `kind` is now
 * on the wire and states the rule directly; `grantsDays` is kept beside it as
 * the fail-closed half, so an offer from a backend too old to send `kind`
 * that nonetheless grants premium days is still withheld rather than shown.
 * An `AD_PERK` - the coin utility V1 actually ships - passes both.
 */
function isOfferInV1Scope(dto: RewardRedemptionOfferDto): boolean {
  if (isPremiumExperienceEnabled()) {
    return true;
  }

  return dto.kind !== 'PREMIUM_DAYS' && dto.grantsDays <= 0;
}

export function mapRewardsSnapshot(
  dto: RewardsSnapshotDto,
  t: Translate,
  /**
   * Where each social mission has got to in THIS session, keyed by mission
   * id. Passed in rather than stored on the wire because the middle step of
   * the flow - "the server recorded an open and is waiting to be told you
   * came back" - is device state that must not survive a restart.
   */
  socialStages: Readonly<Record<string, SocialMissionStage>> = {}
): RewardsSnapshot {
  return {
    wallet: mapWallet(dto.wallet),
    dailyCheckIn: dto.dailyCheckIn ? mapDailyCheckIn(dto.dailyCheckIn, t) : null,
    // The backend sends `null` and means it: it has no watch-analytics feed,
    // only a per-series resume position that DECREASES on a rewatch. This
    // maps straight through to the section's empty state rather than being
    // back-filled from anything on the device. The V1 watch MISSION is a
    // different quantity entirely and arrives as a `WATCH_EPISODES` task.
    watchTime: dto.watchTime ?? null,
    tasks: (dto.tasks ?? [])
      .map((task) => mapTask(task, t, socialStages[task.id] ?? 'idle'))
      .filter((task): task is RewardTask => task !== null),
    redemptions: (dto.redemptions ?? [])
      .filter(isOfferInV1Scope)
      .map((offer) => mapRedemption(offer, t)),
    activePerks: mapActivePerks(dto.activePerks, t),
  };
}

/**
 * Re-renders ONE social mission tile at a new stage.
 *
 * The stage is device state, so it cannot arrive with a snapshot - but the
 * CTA word it changes is copy, and copy is built in this module and nowhere
 * else. Rather than let the container assemble a label (which would put
 * translation keys in two places and let the two drift), the container hands
 * the stage here and gets a new snapshot back.
 *
 * A CLAIMED mission ignores the requested stage: once the server has paid it
 * there is no step left to be in, and re-offering the flow would invite a
 * press the backend answers `alreadyClaimed` to.
 */
export function applySocialMissionStage(
  snapshot: RewardsSnapshot,
  missionId: string,
  stage: SocialMissionStage,
  t: Translate
): RewardsSnapshot {
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => {
      if (task.id !== missionId || task.isClaimed) {
        return task;
      }

      const nextStage: SocialMissionStage = stage;

      return {
        ...task,
        socialStage: nextStage,
        ctaLabel: !task.isClaimSupported
          ? task.ctaLabel
          : nextStage === 'opened'
            ? t('rewards.ctaConfirmFollow')
            : task.socialPlatform === 'YOUTUBE'
              ? t('rewards.ctaSubscribe')
              : t('rewards.ctaFollow'),
      };
    }),
  };
}

/**
 * Applies a mission-claim response to the snapshot already on screen.
 *
 * The response carries the authoritative wallet AND the refreshed tile, so
 * both are adopted wholesale and nothing is added to the old balance -
 * `awardedPoints` is reported to the viewer as what just happened, never used
 * as an operand. On a replay the server sends `awardedPoints: 0` and the same
 * wallet back, so an already-claimed mission is a visible no-op.
 *
 * A tile the server refreshed into a type this build cannot render is DROPPED
 * rather than left stale: the old row would keep offering a claim against
 * state that no longer exists.
 */
export function applyMissionClaimResponse(
  snapshot: RewardsSnapshot,
  response: MissionClaimResponseDto,
  t: Translate
): RewardsSnapshot {
  const refreshed = mapTask(response.task, t, 'claimed');

  return {
    ...snapshot,
    wallet: mapWallet(response.wallet),
    tasks: snapshot.tasks.flatMap((task) => {
      if (task.id !== response.missionId) {
        return [task];
      }

      return refreshed ? [refreshed] : [];
    }),
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
  // The V1 earn-and-spend reasons. `EXTERNAL_SOCIAL_ACTION` is named for what
  // the server recorded and NOT for a follow it cannot see, and the history
  // row must keep that name rather than translate it into a verification the
  // ledger never claimed.
  'EXTERNAL_SOCIAL_ACTION',
  'WATCH_MILESTONE',
  'AD_PERK_REDEMPTION',
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
