import { DEFAULT_ADS_CONFIG } from '@/services/ads/ad-gate';
import { fetchAdsConfig } from '@/services/ads/ads-config-service';
import { request } from '@/services/api/client';

jest.mock('@/services/api/client', () => ({
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
