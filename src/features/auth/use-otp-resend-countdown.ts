import { useCallback, useEffect, useRef, useState } from 'react';

const ONE_SECOND_MS = 1000;

/**
 * Counts down the seconds until a new WhatsApp code may be requested.
 *
 * The initial value comes from the backend's own `resendAvailableInSeconds`
 * rather than a client-side constant, so the button unlocks when the server
 * says it will - not when the app guesses.
 *
 * The interval is cleared on unmount and whenever the countdown restarts,
 * so leaving the OTP step never leaves a timer running behind it.
 */
export function useOtpResendCountdown(): {
  readonly secondsRemaining: number;
  readonly canResend: boolean;
  readonly start: (seconds: number) => void;
} {
  const [secondsRemaining, setSecondsRemaining] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const clear = useCallback(() => {
    if (intervalRef.current !== undefined) {
      clearInterval(intervalRef.current);
      intervalRef.current = undefined;
    }
  }, []);

  const start = useCallback(
    (seconds: number) => {
      clear();

      // `seconds` comes straight off a network payload. A non-finite value
      // (a backend that omits `resendAvailableInSeconds`, so this receives
      // `undefined`) used to produce NaN, and NaN fails every comparison
      // below: the countdown never reached zero, the interval was never
      // cleared, the button stayed disabled for the whole session, and the
      // label rendered the literal "Kirim ulang kode dalam NaNs". Treated as
      // "resend immediately available" instead, which is the safe direction
      // - the backend still enforces its own rate limit.
      const initial = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
      setSecondsRemaining(initial);

      if (initial === 0) {
        return;
      }

      // The updater below is PURE: no `clearInterval`, no ref mutation.
      // React 19 StrictMode double-invokes updaters and the React Compiler
      // (enabled in app.json) assumes purity, so the teardown lives in the
      // effect underneath instead.
      intervalRef.current = setInterval(() => {
        setSecondsRemaining((previous) => Math.max(0, previous - 1));
      }, ONE_SECOND_MS);
    },
    [clear]
  );

  // Stops the interval once it has counted down, and on unmount. Both are
  // the same operation, so they share one effect.
  useEffect(() => {
    if (secondsRemaining === 0) {
      clear();
    }
  }, [clear, secondsRemaining]);

  useEffect(() => clear, [clear]);

  return { secondsRemaining, canResend: secondsRemaining === 0, start };
}
