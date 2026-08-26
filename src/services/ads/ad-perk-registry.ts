/**
 * The seam between the ad gate and the rewards backend, shaped exactly like
 * `ad-presenter-registry.ts` and for the same reason.
 *
 * `ad-controller.ts` has to be able to say "that skip was actually spent"
 * without importing the `/rewards/*` client: the ads layer decides ad
 * PRESENTATION and must stay independent of how a perk was bought, exactly as
 * it stays independent of which SDK renders the ad. So the controller calls
 * whatever is registered here, and `hooks/use-reward-ad-perks.ts` registers
 * the implementation that talks to the backend.
 *
 * NOTHING IS REGISTERED IN A BUILD WITHOUT REWARDS, and that is a working
 * state rather than a broken one: with no consumer, no perk is ever reported
 * as spent - and with no perk state mirrored into the store either, the gate
 * never suppresses an ad in the first place. The two are absent together.
 */

export type PerkConsumer = {
  /**
   * Records that a single-use ad skip was spent. Called at most once per
   * suppressed interstitial, and only after the ad gate has already cleared
   * the local flag - so a slow or failed call can never produce a second
   * suppression from the same perk.
   *
   * Deliberately returns `void`: the ad path must not await a network call
   * before deciding what to do with a video transition. Reconciling what the
   * server says afterwards is the implementation's job.
   */
  readonly consumeSkip: (perkId: string) => void;
};

let consumer: PerkConsumer | null = null;

export function registerPerkConsumer(next: PerkConsumer): void {
  consumer = next;
}

/** Idempotent, and identity-checked so a late teardown cannot unregister a newer consumer. */
export function unregisterPerkConsumer(previous: PerkConsumer): void {
  if (consumer === previous) {
    consumer = null;
  }
}

export function getPerkConsumer(): PerkConsumer | null {
  return consumer;
}

/** Test-only: clears the module-level singleton so suites cannot leak into each other. */
export function __resetPerkRegistryForTests(): void {
  consumer = null;
}
