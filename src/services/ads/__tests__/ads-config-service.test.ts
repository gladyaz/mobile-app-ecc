import { DEFAULT_ADS_CONFIG } from '@/services/ads/ad-gate';
import { fetchAdsConfig } from '@/services/ads/ads-config-service';
import { ApiError, request } from '@/services/api/client';

/**
 * Only `request` is faked. `ApiError` comes through untouched, because the
 * fail-closed branch under test narrows on a REAL `instanceof ApiError` -
 * a hand-rolled stand-in would pass the test while the production check
 * silently never matched.
 */
jest.mock('@/services/api/client', () => ({
  ...jest.requireActual('@/services/api/client'),
  request: jest.fn(),
}));

const mockedRequest = request as jest.MockedFunction<typeof request>;

afterEach(() => {
  jest.clearAllMocks();
});

describe('fetchAdsConfig', () => {
  it('calls GET /config/ads without requiresAuth', async () => {
    mockedRequest.mockResolvedValue({
      enabled: true,
      minVideosBetweenAds: 3,
      maxVideosBetweenAds: 6,
      minSecondsBetweenAds: 120,
      graceVideos: 5,
    });

    await fetchAdsConfig();

    expect(mockedRequest).toHaveBeenCalledWith('config/ads');
  });

  it('returns the parsed config for a valid payload', async () => {
    const payload = {
      enabled: false,
      minVideosBetweenAds: 2,
      maxVideosBetweenAds: 8,
      minSecondsBetweenAds: 90,
      graceVideos: 1,
    };
    mockedRequest.mockResolvedValue(payload);

    await expect(fetchAdsConfig()).resolves.toEqual(payload);
  });

  it('falls back to DEFAULT_ADS_CONFIG when the request rejects (network/API error)', async () => {
    mockedRequest.mockRejectedValue(new Error('network down'));

    await expect(fetchAdsConfig()).resolves.toEqual(DEFAULT_ADS_CONFIG);
  });

  it('falls back to DEFAULT_ADS_CONFIG for a malformed payload (missing field)', async () => {
    mockedRequest.mockResolvedValue({
      enabled: true,
      minVideosBetweenAds: 3,
      // maxVideosBetweenAds missing
      minSecondsBetweenAds: 120,
      graceVideos: 5,
    });

    await expect(fetchAdsConfig()).resolves.toEqual(DEFAULT_ADS_CONFIG);
  });

  it('falls back to DEFAULT_ADS_CONFIG for a malformed payload (wrong type)', async () => {
    mockedRequest.mockResolvedValue({
      enabled: 'yes',
      minVideosBetweenAds: 3,
      maxVideosBetweenAds: 6,
      minSecondsBetweenAds: 120,
      graceVideos: 5,
    });

    await expect(fetchAdsConfig()).resolves.toEqual(DEFAULT_ADS_CONFIG);
  });

  it('falls back to DEFAULT_ADS_CONFIG for a non-object payload', async () => {
    mockedRequest.mockResolvedValue(null);

    await expect(fetchAdsConfig()).resolves.toEqual(DEFAULT_ADS_CONFIG);
  });
});

describe('fetchAdsConfig — failing closed on a permanently broken build', () => {
  it('turns ads OFF for a MISSING_BASE_URL error', () => {
    // `EXPO_PUBLIC_API_BASE_URL` is inlined at build time, so this artifact
    // can never reach its backend on any screen. Serving interstitials over
    // a feed that cannot load is monetizing a broken product.
    mockedRequest.mockRejectedValue(
      new ApiError(0, 'MISSING_BASE_URL', 'EXPO_PUBLIC_API_BASE_URL is not set.')
    );

    return expect(fetchAdsConfig()).resolves.toEqual({ ...DEFAULT_ADS_CONFIG, enabled: false });
  });

  it('keeps the enabled fallback for a transient NETWORK_ERROR', () => {
    mockedRequest.mockRejectedValue(new ApiError(0, 'NETWORK_ERROR', 'Network request failed.'));

    return expect(fetchAdsConfig()).resolves.toEqual(DEFAULT_ADS_CONFIG);
  });

  it('keeps the enabled fallback for a transient TIMEOUT', () => {
    // Same `status: 0` as MISSING_BASE_URL, so the distinction has to be
    // made on `code` - not on status.
    mockedRequest.mockRejectedValue(new ApiError(0, 'TIMEOUT', 'Request timed out after 20000ms.'));

    return expect(fetchAdsConfig()).resolves.toEqual(DEFAULT_ADS_CONFIG);
  });

  it('keeps the enabled fallback for a backend 500', () => {
    mockedRequest.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Something broke.'));

    return expect(fetchAdsConfig()).resolves.toEqual(DEFAULT_ADS_CONFIG);
  });
});
