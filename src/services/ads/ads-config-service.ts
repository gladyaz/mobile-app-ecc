import { request } from '@/services/api/client';
import { DEFAULT_ADS_CONFIG, type AdsConfig } from '@/services/ads/ad-gate';
import { isDemoMode } from '@/services/demo/demo-mode';

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
 * Fetches the ads pacing config from the backend. No auth guard (per the
 * frozen contract), top-level JSON, no envelope. Falls back to
 * `DEFAULT_ADS_CONFIG` - silently in production, logged via `console.warn`
 * gated by `__DEV__` - on ANY failure: network error, non-2xx, or a
 * malformed/incomplete payload. Ads pacing is never worth breaking the app
 * over.
 */
export async function fetchAdsConfig(): Promise<AdsConfig> {
  if (isDemoMode()) {
    // Without this, a demo build shows ads rather than hiding them: the
    // fetch below fails (no backend) and falls back to DEFAULT_ADS_CONFIG,
    // whose `enabled` is true. Someone trying the app for the first time
    // should not be interrupted by an interstitial labelled "Test Ad".
    return { ...DEFAULT_ADS_CONFIG, enabled: false };
  }

  try {
    const payload = await request<unknown>('config/ads');

    return parseAdsConfig(payload);
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[ads-config-service] Failed to fetch /config/ads; falling back to DEFAULT_ADS_CONFIG.',
        error
      );
    }

    return DEFAULT_ADS_CONFIG;
  }
}
