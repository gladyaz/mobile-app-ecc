import { RewardsCenterScreen } from '@/features/rewards/rewards-center-screen';

/**
 * Rewards tab route.
 *
 * Deliberately a thin adapter. `RewardsCenterScreen` and every component
 * under it are navigation-agnostic by contract - `rewards-economics-
 * boundary.test.ts` fails if any of them imports `expo-router` - so the
 * route file is the only place allowed to know it is a tab.
 *
 * No `onClose` is passed: a bottom-tab root has no back affordance, and
 * supplying one would render a chevron that navigates nowhere. No `state`
 * is passed either, so the screen falls back to its own clearly-labelled
 * preview snapshot; when a real rewards service exists, this file is where
 * it gets fetched and threaded in.
 *
 * PREVIEW ONLY. There is no reward engine behind this tab: no points are
 * issued, no check-in is recorded, no streak is persisted, no follow is
 * verified, no ad credit is granted, no watch time is banked, no points are
 * redeemed, and no entitlement is ever mutated. The screen's own
 * PRATINJAU/PREVIEW badge and per-card notices say so to the user.
 */
export default function RewardsRoute() {
  return <RewardsCenterScreen />;
}
