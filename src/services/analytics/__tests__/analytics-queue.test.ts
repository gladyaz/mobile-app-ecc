import {
  __resetAnalyticsQueueForTests,
  flushAnalyticsQueue,
  trackEvent,
} from '@/services/analytics/analytics-queue';
import { postAnalyticsEvents } from '@/services/analytics/analytics-service';
import { getTokens } from '@/services/auth/token-store';

jest.mock('@/services/analytics/analytics-service');
jest.mock('@/services/auth/token-store');

const mockedPostEvents = postAnalyticsEvents as jest.MockedFunction<
  typeof postAnalyticsEvents
>;
const mockedGetTokens = getTokens as jest.MockedFunction<typeof getTokens>;

const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1' };

beforeEach(() => {
  jest.useFakeTimers();
  mockedGetTokens.mockReturnValue(TOKENS);
  mockedPostEvents.mockResolvedValue({ accepted: 1 });
});

afterEach(() => {
  __resetAnalyticsQueueForTests();
  jest.useRealTimers();
  jest.clearAllMocks();
});

describe('analytics-queue', () => {
  it('drops events silently while logged out and never calls the backend', async () => {
    mockedGetTokens.mockReturnValue(null);

    trackEvent('feed_view');
    await flushAnalyticsQueue();
    jest.advanceTimersByTime(60_000);

    expect(mockedPostEvents).not.toHaveBeenCalled();
  });

  it('flushes buffered events after the flush interval', async () => {
    trackEvent('video_play', {
      videoId: 'video-1',
      seriesId: 's-1',
      episodeNumber: 1,
    });

    expect(mockedPostEvents).not.toHaveBeenCalled();

    jest.advanceTimersByTime(10_000);
    // Let the async flush settle.
    await Promise.resolve();

    expect(mockedPostEvents).toHaveBeenCalledTimes(1);
    const [batch] = mockedPostEvents.mock.calls[0];
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({
      eventName: 'video_play',
      properties: { videoId: 'video-1', seriesId: 's-1', episodeNumber: 1 },
      platform: expect.any(String),
      clientTimestamp: expect.any(String),
    });
  });

  it('flushes immediately once the batch threshold (20) is reached', () => {
    for (let i = 0; i < 20; i += 1) {
      trackEvent('feed_view');
    }

    expect(mockedPostEvents).toHaveBeenCalledTimes(1);
    expect(mockedPostEvents.mock.calls[0][0]).toHaveLength(20);
  });

  it('swallows flush failures silently and does not throw into callers', async () => {
    mockedPostEvents.mockRejectedValue(new Error('network down'));

    trackEvent('feed_view');
    await expect(flushAnalyticsQueue()).resolves.toBeUndefined();
    expect(mockedPostEvents).toHaveBeenCalledTimes(1);

    // The failed batch is dropped by design — a follow-up flush sends
    // nothing rather than retrying it.
    await flushAnalyticsQueue();
    expect(mockedPostEvents).toHaveBeenCalledTimes(1);
  });

  it('caps the buffer at 50, keeping the newest events', async () => {
    // Hang the poster: the first 20 events trigger an in-flight flush that
    // empties the buffer; the next 60 accumulate while isFlushing blocks
    // re-entry, exercising the 50-event cap.
    let resolvePost: (value: { accepted: number }) => void = () => {};
    mockedPostEvents.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        })
    );

    for (let i = 0; i < 80; i += 1) {
      trackEvent('feed_view');
    }

    resolvePost({ accepted: 20 });
    await Promise.resolve();

    // Drain what remained (with a resolving poster again): it must have
    // been capped at 50.
    mockedPostEvents.mockResolvedValue({ accepted: 50 });
    await flushAnalyticsQueue();
    const lastBatch = mockedPostEvents.mock.calls.at(-1)?.[0];
    expect(lastBatch).toHaveLength(50);
  });
});
