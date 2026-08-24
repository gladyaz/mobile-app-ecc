import { ApiError, request } from '@/services/api/client';
import { DEFAULT_ADS_CONFIG, type AdsConfig } from '@/services/ads/ad-gate';
import { isDemoMode } from '@/services/demo/demo-mode';

/**
 * The fallback used when the app cannot reach its own backend AT ALL - as
 * opposed to reaching it and failing. Same pacing numbers, ads off.
 */
const ADS_OFF_CONFIG: AdsConfig = { ...DEFAULT_ADS_CONFIG, enabled: false };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Validates an unknown payload against the frozen `GET /config/ads` shape.
 * Throws (caught by `fetchAdsConfig` below) on any missing/wrong-typed
 * field - there is no per-field coercion here, matching the "on ANY failure
 * return DEFAULT_ADS_CONFIG" contract for the whole object, not a
 * field-by-field one (that per-field fallback behavior belongs to the
 * backend, per the frozen contract, not to this client-side parser).
 */
function parseAdsConfig(payload: unknown): AdsConfig {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('[ads-config-service] /config/ads payload is not an object.');
  }

  const record = payload as Record<string, unknown>;
  const { enabled, minVideosBetweenAds, maxVideosBetweenAds, minSecondsBetweenAds, graceVideos } =
    record;

  if (
    typeof enabled !== 'boolean' ||
    !isFiniteNumber(minVideosBetweenAds) ||
    !isFiniteNumber(maxVideosBetweenAds) ||
    !isFiniteNumber(minSecondsBetweenAds) ||
    !isFiniteNumber(graceVideos)
  ) {
    throw new Error('[ads-config-service] /config/ads payload has an invalid shape.');
  }

  return { enabled, minVideosBetweenAds, maxVideosBetweenAds, minSecondsBetweenAds, graceVideos };
}

/**
 * A `MISSING_BASE_URL` failure is the ONE failure that is not a blip.
 *
 * `EXPO_PUBLIC_API_BASE_URL` is inlined at build time, so if it is absent
 * it is absent for the entire life of that artifact: this build can never
 * reach its own backend, on any screen, for any user. A network error or a
 * timeout says "not right now"; this says "not ever". Falling back to
 * `DEFAULT_ADS_CONFIG` (whose `enabled` is `true`) would put full-screen
 * interstitials in front of a viewer whose feed, login and progress sync
 * are all permanently broken - monetizing an app that cannot work.
 */
function isPermanentBackendMisconfiguration(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'MISSING_BASE_URL';
}

/**
 * Fetches the ads pacing config from the backend. No auth guard (per the
 * frozen contract), top-level JSON, no envelope.
 *
 * Falls back to `DEFAULT_ADS_CONFIG` - silently in production, logged via
 * `console.warn` gated by `__DEV__` - on any TRANSIENT failure: a
 * `NETWORK_ERROR` or `TIMEOUT` from the client (both `status: 0`, see
 * `src/services/api/client.ts`), a non-2xx, or a malformed/incomplete
 * payload. Ads pacing is never worth breaking the app over, and a backend
 * that is merely unreachable right now may well answer on the next launch.
 *
 * The single exception is a permanently misconfigured build, which fails
 * CLOSED to `ADS_OFF_CONFIG` - see above.
 */
export async function fetchAdsConfig(): Promise<AdsConfig> {
  if (isDemoMode()) {
    // Without this, a demo build shows ads rather than hiding them: the
    // fetch below fails (no backend) and falls back to DEFAULT_ADS_CONFIG,
    // whose `enabled` is true. Someone trying the app for the first time
    // should not be interrupted by an interstitial labelled "Test Ad".
    return ADS_OFF_CONFIG;
  }

  try {
    const payload = await request<unknown>('config/ads');

    return parseAdsConfig(payload);
  } catch (error) {
    if (isPermanentBackendMisconfiguration(error)) {
      if (__DEV__) {
        console.warn(
          '[ads-config-service] EXPO_PUBLIC_API_BASE_URL is not set; ads stay OFF for this build.',
          error
        );
      }

      return ADS_OFF_CONFIG;
    }

    if (__DEV__) {
      console.warn(
        '[ads-config-service] Failed to fetch /config/ads; falling back to DEFAULT_ADS_CONFIG.',
        error
      );
    }

    return DEFAULT_ADS_CONFIG;
  }
}
