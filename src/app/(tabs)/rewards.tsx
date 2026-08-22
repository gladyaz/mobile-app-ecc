import { useCallback } from 'react';
import { router } from 'expo-router';

import { RewardsCenterScreen } from '@/features/rewards/rewards-center-screen';
import { useRewardsCenter } from '@/features/rewards/use-rewards-center';

/**
 * Rewards tab route.
 *
 * The composition seam, and the only file in this feature allowed to know
 * two things: that this surface is a tab, and how to navigate. Every
 * component beneath it is navigation-agnostic by contract -
 * `rewards-economics-boundary.test.ts` fails if any of them imports
 * `expo-router`.
 *
 * It wires `useRewardsCenter()` (which talks to `/rewards/*`) to
 * `RewardsCenterScreen` (which only renders). That split is what keeps the
 * guarantee structural: the screen cannot fetch, and the container cannot
 * render, so no component can pay itself points.
 *
 * NO `onClose` IS PASSED: a bottom-tab root has no back affordance, and
 * supplying one would render a chevron that navigates nowhere.
 *
 * THIS IS NO LONGER A PREVIEW. Points, streaks, redemptions and the
 * transaction history are real, server-owned state read from the backend
 * ledger. What the client still never does is decide any of it: it issues no
 * points, sets no streak, grants no entitlement, and computes no balance. A
 * signed-out viewer gets the sign-in affordance rather than a zeroed wallet,
 * and a deployment with `REWARDS_ENABLED=false` gets a bounded unavailable
 * state rather than a fallback to invented numbers.
 */
export default function RewardsRoute() {
  const rewards = useRewardsCenter();

  const handleSignIn = useCallback(() => {
    // `push`, not `replace`: the viewer came from a tab and should be able to
    // come back to it if they change their mind about signing in.
    router.push('/login');
  }, []);

  return (
    <RewardsCenterScreen
      ledger={rewards.ledger}
      notice={rewards.notice}
      onCheckIn={rewards.checkIn}
      onDismissNotice={rewards.dismissNotice}
      onLoadMoreLedger={rewards.loadMoreLedger}
      onRedeem={rewards.redeem}
      onRetry={rewards.reload}
      onRetryLedger={rewards.retryLedger}
      onSignIn={handleSignIn}
      pendingActionId={rewards.pendingActionId}
      state={rewards.view}
    />
  );
}
