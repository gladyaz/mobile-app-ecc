import { trackEvent } from '@/services/analytics/analytics-queue';

/**
 * Phase 11, work unit 11-M1: self-hosted JS-level crash/error capture.
 * Fatal JS errors and unhandled promise rejections are reported into the
 * same analytics pipeline as product events (`app_error` in the backend's
 * allowlist) — queryable in the AnalyticsEvent table, zero external
 * egress. This is deliberately NOT a vendor crash SDK: that requires an
 * external account/DSN and native-level integration, explicitly deferred
 * by recorded decision (control workspace DECISIONS.md, "Phase 11
 * approved...", default decision 2). Native-level crashes (below JS) are
 * therefore NOT captured — a known, recorded gap, not an oversight.
 */

/** Mirrors the backend's per-property truncation cap. */
const MAX_FIELD_LENGTH = 2000;

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  getGlobalHandler: () => GlobalErrorHandler | undefined;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};

let isInstalled = false;

function reportError(error: unknown, isFatal: boolean, source: string): void {
  const normalized = error instanceof Error ? error : new Error(String(error));

  // trackEvent is already silent-failure and logged-out-safe; nothing here
  // may ever throw back into the crashing code path it's observing.
  try {
    trackEvent('app_error', {
      message: (normalized.message ?? '').slice(0, MAX_FIELD_LENGTH),
      stack: (normalized.stack ?? '').slice(0, MAX_FIELD_LENGTH),
      isFatal,
      source,
    });
  } catch {
    // Never let error reporting cause an error.
  }
}

/**
 * Installs the global handlers once. On native, wraps (and chains to) React
 * Native's existing `ErrorUtils` global handler — the previous handler is
 * always called afterwards, so RN's own fatal-error behavior (redbox in
 * dev, crash in release) is preserved, not swallowed. On web, listens for
 * `error` and `unhandledrejection` window events.
 */
export function installGlobalErrorReporting(): void {
  if (isInstalled) {
    return;
  }
  isInstalled = true;

  const errorUtils = (globalThis as { ErrorUtils?: ErrorUtilsLike })
    .ErrorUtils;

  if (errorUtils?.setGlobalHandler) {
    const previousHandler = errorUtils.getGlobalHandler?.();

    errorUtils.setGlobalHandler((error, isFatal) => {
      reportError(error, Boolean(isFatal), 'global-handler');
      previousHandler?.(error, isFatal);
    });
  }

  // `as unknown` first: on web `globalThis.window` is the full DOM Window,
  // on native it does not exist at all — this file only needs the minimal
  // listener surface below, without depending on DOM lib types.
  const globalWindow = (
    globalThis as unknown as {
      window?: {
        addEventListener?: (
          type: string,
          listener: (event: {
            error?: unknown;
            message?: string;
            reason?: unknown;
          }) => void
        ) => void;
      };
    }
  ).window;

  if (globalWindow?.addEventListener) {
    globalWindow.addEventListener('error', (event) => {
      reportError(event.error ?? event.message, true, 'global-handler');
    });
    globalWindow.addEventListener('unhandledrejection', (event) => {
      reportError(event.reason, false, 'unhandled-rejection');
    });
  }
}

export function __resetErrorReportingForTests(): void {
  isInstalled = false;
}
