/**
 * A per-selection identity for "take me to this video in the feed".
 *
 * The feed route carries `videoId` as the canonical target, and that alone
 * cannot say whether a viewer has just picked an episode or whether the
 * param has simply survived on the route from an earlier pick. Both look
 * identical to the screen, and the two need opposite handling: the first must
 * re-align the feed, the second must NOT (a tab switch back to Home would
 * otherwise yank the viewer to the episode they had already left).
 *
 * Pairing the id with a fresh ordinal makes each selection addressable
 * without changing what identifies the video. It is a navigation nonce, not
 * content: it is never persisted, never sent anywhere, and a deep link that
 * omits it still works - the feed falls back to keying on the video id.
 */
let sequence = 0;

export function nextVideoRequestId(): string {
  sequence += 1;

  return `vr-${sequence}`;
}
