import { trackEvent } from '@/services/analytics/analytics-queue';
import {
  __resetErrorReportingForTests,
  installGlobalErrorReporting,
} from '@/services/analytics/error-reporting';

jest.mock('@/services/analytics/analytics-queue', () => ({
  trackEvent: jest.fn(),
}));

const mockedTrackEvent = trackEvent as jest.MockedFunction<typeof trackEvent>;

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

type MutableGlobal = {
  ErrorUtils?: {
    getGlobalHandler: () => GlobalErrorHandler | undefined;
    setGlobalHandler: (handler: GlobalErrorHandler) => void;
  };
};

describe('error-reporting', () => {
  let installedHandler: GlobalErrorHandler | undefined;
  let previousHandler: jest.Mock;
  let originalErrorUtils: MutableGlobal['ErrorUtils'];

  beforeEach(() => {
    previousHandler = jest.fn();
    installedHandler = previousHandler;
    originalErrorUtils = (globalThis as MutableGlobal).ErrorUtils;

    (globalThis as MutableGlobal).ErrorUtils = {
      getGlobalHandler: () => installedHandler,
      setGlobalHandler: (handler) => {
        installedHandler = handler;
      },
    };
  });

  afterEach(() => {
    (globalThis as MutableGlobal).ErrorUtils = originalErrorUtils;
    __resetErrorReportingForTests();
    jest.clearAllMocks();
  });

  it('reports a fatal error as app_error and still chains to the previous handler', () => {
    installGlobalErrorReporting();

    const crash = new Error('boom');
    installedHandler?.(crash, true);

    expect(mockedTrackEvent).toHaveBeenCalledWith('app_error', {
      message: 'boom',
      stack: expect.stringContaining('boom'),
      isFatal: true,
      source: 'global-handler',
    });
    // RN's own fatal-error behavior (redbox/crash) must be preserved.
    expect(previousHandler).toHaveBeenCalledWith(crash, true);
  });

  it('truncates oversized message/stack to the backend cap (2000 chars)', () => {
    installGlobalErrorReporting();

    installedHandler?.(new Error('y'.repeat(5000)), false);

    const [, properties] = mockedTrackEvent.mock.calls[0] as [
      string,
      { message: string; stack: string },
    ];
    expect(properties.message).toHaveLength(2000);
    expect(properties.stack.length).toBeLessThanOrEqual(2000);
  });

  it('normalizes non-Error values instead of throwing', () => {
    installGlobalErrorReporting();

    expect(() =>
      installedHandler?.('plain string failure', false)
    ).not.toThrow();

    expect(mockedTrackEvent).toHaveBeenCalledWith(
      'app_error',
      expect.objectContaining({
        message: 'plain string failure',
        isFatal: false,
      })
    );
  });

  it('installs at most once', () => {
    installGlobalErrorReporting();
    const firstInstalled = installedHandler;

    installGlobalErrorReporting();

    expect(installedHandler).toBe(firstInstalled);
  });

  it('never throws out of the reporting path even if trackEvent itself throws', () => {
    mockedTrackEvent.mockImplementation(() => {
      throw new Error('queue exploded');
    });

    installGlobalErrorReporting();

    expect(() => installedHandler?.(new Error('boom'), true)).not.toThrow();
    // The chained previous handler still runs.
    expect(previousHandler).toHaveBeenCalled();
  });
});
