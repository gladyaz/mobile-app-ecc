/**
 * Single switch for the offline showcase build - the APK handed to
 * founders and partners who have no access to the backend, the LAN, or an
 * account.
 *
 * Every behaviour demo mode changes is gated behind this one function, so
 * a normal build (the flag absent or "false", which is the default
 * everywhere including CI and QA) behaves exactly as it always has. The
 * flag is read from the environment rather than a constant so the same
 * source tree produces both builds.
 *
 * What demo mode turns on, and where:
 * - bundled clips instead of the backend feed (services/videos/video-service.ts)
 * - local login that accepts anything (stores/auth.tsx, services/demo/demo-auth.ts)
 * - ads suppressed (services/ads/ads-config-service.ts)
 * - like/save stay local, sync queue never flushes (stores/video-interactions.tsx)
 */
export function isDemoMode(): boolean {
  return process.env.EXPO_PUBLIC_DEMO_MODE === 'true';
}
