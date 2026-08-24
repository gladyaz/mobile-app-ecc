import { ensureAdsConsent } from '@/services/ads/consent-gate';
import { createInterstitialPresenter } from '@/services/ads/interstitial-adapter';

/**
 * Exercises the NATIVE adapter's behaviour, which `interstitial-adapter.test.ts`
 * deliberately does not: that file only proves the web early-return happens
 * BEFORE the SDK is required. Everything below is on the other side of that
 * return, so `react-native-google-mobile-ads` has to be stood in for.
 *
 * The stub models only what the adapter touches: `createForAdRequest`, the
 * four `AdEventType`s it listens for, `load()`, and `show()`. Ad events are
 * driven by invoking the captured listeners directly, which is exactly how
 * the native module delivers them.
 */
type AdEventListener = (payload?: unknown) => void;

const mockLoad = jest.fn();
const mockShow = jest.fn();
const mockListeners = new Map<string, AdEventListener>();
let mockCreatedAdCount = 0;
/** Set by a test to make the NEXT `createForAdRequest` throw. */
let mockCreateAdError: Error | null = null;

jest.mock('react-native-google-mobile-ads', () => ({
  AdEventType: {
    LOADED: 'loaded',
    ERROR: 'error',
    OPENED: 'opened',
    CLOSED: 'closed',
  },
  TestIds: { INTERSTITIAL: 'test-interstitial-id' },
  InterstitialAd: {
    createForAdRequest: () => {
      if (mockCreateAdError) {
        const error = mockCreateAdError;
        mockCreateAdError = null;
        throw error;
      }

      mockCreatedAdCount += 1;

      return {
        addAdEventListener: (type: string, listener: AdEventListener) => {
          // Last writer wins, which is what we want: a CLOSED event swaps in
          // a fresh instance, and the tests below drive the newest one.
          mockListeners.set(type, listener);
        },
        load: mockLoad,
        show: mockShow,
      };
    },
  },
}));

jest.mock('@/services/ads/consent-gate', () => ({
  ensureAdsConsent: jest.fn(),
  __resetConsentGateForTests: jest.fn(),
}));

const mockedEnsureAdsConsent = ensureAdsConsent as jest.MockedFunction<typeof ensureAdsConsent>;

function emit(type: string, payload?: unknown): void {
  const listener = mockListeners.get(type);

  if (!listener) {
    throw new Error(`No listener registered for "${type}" - the adapter stopped subscribing to it.`);
  }

  listener(payload);
}

function makeCallbacks() {
  return {
    onOpened: jest.fn(),
    onClosed: jest.fn(),
    onError: jest.fn(),
  };
}

beforeEach(() => {
  mockListeners.clear();
  mockCreatedAdCount = 0;
  mockCreateAdError = null;
  mockShow.mockReturnValue(Promise.resolve());
  mockedEnsureAdsConsent.mockResolvedValue(true);
});

describe('interstitial adapter — consent gates every ad request', () => {
  it('requests NO ad before the consent sequence has settled', async () => {
    // The pin for requirement 1: an ad request that outruns UMP is a policy
    // violation, so the load must not merely be reordered - it must not
    // happen at all while consent is still pending.
    let settleConsent: ((canRequestAds: boolean) => void) | undefined;
    mockedEnsureAdsConsent.mockReturnValue(
      new Promise<boolean>((resolve) => {
        settleConsent = resolve;
      })
    );

    const presenter = createInterstitialPresenter(makeCallbacks());
    presenter?.loadIfNeeded();

    expect(mockedEnsureAdsConsent).toHaveBeenCalledTimes(1);
    expect(mockLoad).not.toHaveBeenCalled();

    settleConsent?.(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it('never requests an ad when consent resolves to "not allowed"', async () => {
    mockedEnsureAdsConsent.mockResolvedValue(false);

    const presenter = createInterstitialPresenter(makeCallbacks());
    presenter?.loadIfNeeded();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLoad).not.toHaveBeenCalled();
    expect(presenter?.isReady()).toBe(false);
  });

  it('retries the consent gate on a later call after it refused', async () => {
    mockedEnsureAdsConsent.mockResolvedValue(false);

    const presenter = createInterstitialPresenter(makeCallbacks());
    presenter?.loadIfNeeded();
    await Promise.resolve();
    await Promise.resolve();

    mockedEnsureAdsConsent.mockResolvedValue(true);
    presenter?.loadIfNeeded();
    await Promise.resolve();
    await Promise.resolve();

    expect(mockLoad).toHaveBeenCalledTimes(1);
  });
});

describe('interstitial adapter — a rejected show() must not wedge monetization', () => {
  it('reports a REJECTED show() promise through onError', async () => {
    // The native module rejects with "null-activity" and emits no ad event
    // at all, so this rejection is the only signal the caller will ever get
    // that its show-in-flight guard needs releasing.
    const callbacks = makeCallbacks();
    const presenter = createInterstitialPresenter(callbacks);

    emit('loaded');
    mockShow.mockReturnValue(Promise.reject(new Error('null-activity')));

    presenter?.show();
    await Promise.resolve();
    await Promise.resolve();

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect((callbacks.onError.mock.calls[0][0] as Error).message).toBe('null-activity');
  });

  it('reports a SYNCHRONOUSLY thrown show() through onError', () => {
    const callbacks = makeCallbacks();
    const presenter = createInterstitialPresenter(callbacks);

    emit('loaded');
    mockShow.mockImplementation(() => {
      throw new Error('has not loaded and could not be shown');
    });

    expect(() => presenter?.show()).not.toThrow();
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
  });
});

describe('interstitial adapter — adVisible must always be released', () => {
  it('emits onClosed for an ERROR that arrives after OPENED', () => {
    // iOS emits OPENED from `adWillPresentFullScreenContent` and can then
    // emit ERROR from `ad:didFailToPresentFullScreenContentWithError:`. The
    // caller suppresses video playback on onOpened; with no onClosed the
    // feed stays paused and silent for the rest of the session.
    const callbacks = makeCallbacks();
    createInterstitialPresenter(callbacks);

    emit('loaded');
    emit('opened');
    expect(callbacks.onOpened).toHaveBeenCalledTimes(1);

    emit('error', new Error('failed to present'));

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onClosed).toHaveBeenCalledTimes(1);
  });

  it('does not emit onClosed for a plain LOAD error, where nothing was on screen', () => {
    const callbacks = makeCallbacks();
    createInterstitialPresenter(callbacks);

    emit('error', new Error('no-fill'));

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onClosed).not.toHaveBeenCalled();
  });

  it('emits onClosed exactly once when CLOSED follows an ERROR that already ended the show', () => {
    const callbacks = makeCallbacks();
    createInterstitialPresenter(callbacks);

    emit('loaded');
    emit('opened');
    emit('error', new Error('failed to present'));
    emit('closed');

    expect(callbacks.onClosed).toHaveBeenCalledTimes(1);
  });

  it('still emits onClosed when rebuilding the next ad instance throws', () => {
    // Losing the next ad is recoverable; a permanently paused feed is not.
    const callbacks = makeCallbacks();
    createInterstitialPresenter(callbacks);

    emit('loaded');
    emit('opened');
    mockCreateAdError = new Error("'adUnitId' expected an string value");

    expect(() => emit('closed')).not.toThrow();

    expect(callbacks.onClosed).toHaveBeenCalledTimes(1);
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
  });

  it('swaps in a fresh ad instance on a normal close', () => {
    const callbacks = makeCallbacks();
    createInterstitialPresenter(callbacks);

    expect(mockCreatedAdCount).toBe(1);

    emit('loaded');
    emit('opened');
    emit('closed');

    expect(mockCreatedAdCount).toBe(2);
    expect(callbacks.onClosed).toHaveBeenCalledTimes(1);
  });
});
