/**
 * WHERE THE CONTRACT FIXTURES CAME FROM.
 *
 * Every fixture in this directory is a canonical wire payload copied, field
 * for field, out of a specific commit of the Red Panda backend. This module
 * records WHICH commit, so a future reader can re-derive them instead of
 * guessing which of two disagreeing shapes is current.
 *
 * ## This is a citation, not a dependency
 *
 * Nothing here is a path this repository reads. The strings below are
 * evidence for a human and for a `git log` in the OTHER repository; the
 * fixtures themselves are plain checked-in data, so this app builds, tests
 * and ships with no backend checkout anywhere on the machine. That is a hard
 * requirement of the contract-lock design (docs/v1-contract-lock.md) - a test
 * suite that reached across the filesystem would pass on the author's laptop
 * and fail in CI, which is the opposite of a regression layer.
 */

export const BACKEND_REFERENCE = {
  repository: 'short-drama-backend',
  branch: 'feat/v1-release-gate',
  commit: '01e8caa',
  /** The date the fixtures below were reconciled against that commit. */
  reconciledOn: '2026-08-27',
  /**
   * The backend modules each family of fixtures mirrors. Named so a drift
   * investigation starts at the right file rather than at a repo-wide grep.
   */
  sources: {
    auth: [
      'src/auth/auth.types.ts (AuthResponseDto, AuthUserDto)',
      'src/auth/identity/auth-identity.types.ts (WhatsAppOtpRequestResponseDto, AuthIdentitySummaryDto)',
      'src/common/errors/app-error-code.ts (AppErrorCode)',
    ],
    rewards: [
      'src/rewards/rewards.types.ts (RewardsSnapshotDto and friends)',
      'src/rewards/rewards.constants.ts (REWARD_REDEMPTION_OFFERS, WATCH_MISSION_DEFINITIONS, CHECK_IN_REWARD_CURVE)',
      'src/rewards/social-missions.constants.ts (SOCIAL_MISSION_DEFINITIONS)',
    ],
    playback: [
      'src/videos/video.types.ts (HlsPlaybackResponseDto, VideoPlaybackResponseDto, HlsRenditionPlaybackDto)',
      'src/transcode/hls/hls-profile.constants.ts (RUNG_PROFILES)',
    ],
    productContract: ['src/common/release-gate/v1-feature-contract.ts (V1_FEATURE_CONTRACT)'],
  },
} as const;

/**
 * NO REAL CREDENTIAL APPEARS IN ANY FIXTURE.
 *
 * Every token-shaped string below is a visibly fake placeholder, and
 * `contract-boundary.test.ts` greps the fixture modules for anything that
 * could be mistaken for a real one. A fixture is checked into git forever; a
 * real Google ID token, refresh token or OTP checked in beside it would be a
 * credential leak that no later deletion undoes.
 */
export const FIXTURE_ACCESS_TOKEN = 'fixture.access.token.not-a-real-jwt';
export const FIXTURE_REFRESH_TOKEN = 'fixture-refresh-token-not-a-real-secret';
export const FIXTURE_USER_ID = 'usr_contract_fixture';
