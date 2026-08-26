/**
 * THE V1 PRODUCT SCOPE, as one switch the whole app reads.
 *
 * Red Panda V1 is FREE CONTENT + ADS + REWARDS. There is no paywall, no
 * subscription, no payment, no coin purchase and no premium tier a viewer can
 * buy, redeem or wait for. The backend ships the matching half of that
 * decision as `CONTENT_ACCESS_MODE=free`, which makes every episode free at
 * the source.
 *
 * WHY A FLAG AND NOT A DELETION. The premium/entitlement architecture is real,
 * working code - `stores/entitlement.tsx`, the `accessTier` parsing in
 * `services/videos/video-mapper.ts`, `services/entitlement/entitlement-service.ts`,
 * the reward-redemption catalog - and V1.1/V2 are expected to want it back.
 * Deleting it would mean rebuilding it from a git archaeology exercise; leaving
 * it reachable would mean a first-time viewer meets a "Premium" chip, an
 * episode lock, and an "Activate Premium" dead end in an app where nothing can
 * be activated. So the DATA and the SERVICES stay exactly as they are, and this
 * module gates only what a viewer can SEE.
 *
 * Re-enabling the premium experience is therefore a configuration change and a
 * rebuild - not a code change, not a revert. Same shape as
 * `services/auth/provider-availability.ts` and `services/videos/hls-playback-flag.ts`.
 *
 * WHAT IT GATES, and where (this list is the whole of it):
 *   - the Discover "Premium" poster badge      (features/discover/discover-catalog.ts)
 *   - the per-episode access chip              (components/series-episode-row.tsx)
 *   - the Series Detail episode lock + modal   (app/series/[id].tsx)
 *   - the feed next-episode lock + modal       (components/drama-feed-item.tsx)
 *   - the "Activate Premium / open Rewards" playback gate
 *                                              (components/drama-feed-item.tsx)
 *   - premium-granting reward redemptions      (features/rewards/rewards-mapper.ts)
 *
 * WHAT IT DELIBERATELY DOES NOT GATE. Playback authorization is still the
 * backend's alone: nothing here grants access, widens a scope, or converts a
 * refusal into a grant. A V1 build that somehow met a real entitlement refusal
 * still does not play the episode - it just says so without naming a purchase
 * the app cannot sell. Ad suppression on `isPremium` also stays wired
 * (`services/ads/ad-gate.ts`), because that is the perk boundary a future
 * "Skip Next Ad" reward plugs into.
 */
export function isPremiumExperienceEnabled(): boolean {
  return process.env.EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED === 'true';
}
