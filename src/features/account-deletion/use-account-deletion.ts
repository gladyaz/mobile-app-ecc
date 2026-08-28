import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import {
  DELETION_METHODS_LOAD_ERROR,
  describeDeleteAccountError,
  describeDeletionOtpRequestError,
  describeGoogleReauthOutcome,
  shouldRefreshMethodsAfter,
} from '@/features/account-deletion/deletion-copy';
import { useOtpResendCountdown } from '@/features/auth/use-otp-resend-countdown';
import {
  deleteMyAccount,
  fetchDeletionMethods,
  requestWhatsAppDeletionOtp,
  type DeletionProof,
  type DeletionProofMethod,
} from '@/services/auth/account-deletion-service';
import { signInWithGoogle } from '@/services/auth/google-sign-in';
import { useAuth } from '@/stores/auth';
import { clearPersistedProgressForIdentity } from '@/stores/series-progress';
import { clearPersistedInteractionsForIdentity } from '@/stores/video-interactions';

/** The backend issues six-digit deletion codes, same as the login challenge. */
export const DELETION_OTP_CODE_LENGTH = 6;

/**
 * Everything the "Hapus Akun" card does that is not rendering.
 *
 * IT LIVES OUTSIDE THE COMPONENT ON PURPOSE, following the same split
 * `features/rewards/use-rewards-center.ts` established: the card stays
 * presentational and this hook owns the three-route conversation with the
 * backend, the per-method proof state, and the post-deletion cleanup. That
 * makes the cleanup ORDER - the part that is genuinely hard to get right and
 * impossible to eyeball in JSX - testable on its own.
 *
 * ===================== THE STATE MACHINE, IN ONE PLACE =====================
 *
 *   load methods -> pick one -> produce that method's proof -> confirm -> delete
 *
 * A PROOF IS ALWAYS FOR THE CURRENTLY SELECTED METHOD. Switching methods
 * clears every other method's half-finished proof (a typed password, a Google
 * token, a requested code), so it is not possible to verify with Google,
 * switch to WhatsApp, and submit something stale. The `DeletionProof` union
 * already makes a mixed body unrepresentable on the wire; this makes the
 * SCREEN's own state match, which is what stops a viewer seeing
 * "Terverifikasi" next to a method they did not verify.
 */

type GoogleProofState =
  | { readonly status: 'idle' }
  | { readonly status: 'authenticating' }
  | { readonly status: 'ready'; readonly idToken: string };

export type AccountDeletionState = {
  readonly isLoadingMethods: boolean;
  readonly methodsError: string | null;
  /** `null` until the first load settles. Empty array = no usable method. */
  readonly methods: readonly DeletionProofMethod[] | null;
  readonly selectedMethod: DeletionProofMethod | null;
  readonly password: string;
  readonly code: string;
  readonly isGoogleAuthenticating: boolean;
  readonly isGoogleVerified: boolean;
  readonly hasRequestedCode: boolean;
  readonly isRequestingCode: boolean;
  readonly secondsUntilResend: number;
  readonly canResendCode: boolean;
  /** A failure while PRODUCING the proof (Google sheet, OTP delivery). */
  readonly proofError: string | null;
  /** A validation message for the empty password/code field, if submitted. */
  readonly fieldError: string | null;
  readonly isConfirmVisible: boolean;
  readonly isDeleting: boolean;
  /** A failure from `POST /users/me/deletion` itself. */
  readonly deleteError: string | null;
};

export type AccountDeletionActions = {
  readonly retryLoadMethods: () => void;
  readonly selectMethod: (method: DeletionProofMethod) => void;
  readonly setPassword: (next: string) => void;
  readonly setCode: (next: string) => void;
  readonly authenticateWithGoogle: () => void;
  readonly requestDeletionCode: () => void;
  readonly requestDelete: () => void;
  readonly cancelDelete: () => void;
  readonly confirmDelete: () => void;
};

export function useAccountDeletion(): AccountDeletionState & AccountDeletionActions {
  const { logout, user } = useAuth();

  const [methods, setMethods] = useState<readonly DeletionProofMethod[] | null>(null);
  const [isLoadingMethods, setIsLoadingMethods] = useState(true);
  const [methodsError, setMethodsError] = useState<string | null>(null);
  const [selectedMethod, setSelectedMethod] = useState<DeletionProofMethod | null>(null);

  const [password, setPasswordState] = useState('');
  const [code, setCodeState] = useState('');
  const [google, setGoogle] = useState<GoogleProofState>({ status: 'idle' });
  const [hasRequestedCode, setHasRequestedCode] = useState(false);
  const [isRequestingCode, setIsRequestingCode] = useState(false);

  const [proofError, setProofError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [isConfirmVisible, setIsConfirmVisible] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { secondsRemaining, canResend, start: startResendCountdown } = useOtpResendCountdown();

  /**
   * Loads the method list and selects a default.
   *
   * THE DEFAULT IS THE FIRST ENTRY, and that is only meaningful because the
   * backend returns the list in a fixed order (password, google, whatsapp) so
   * the same account always lands on the same panel. Selection is preserved
   * across a REFRESH when the method survives it - a viewer who was halfway
   * through the WhatsApp panel when the list was refetched must not be
   * silently moved to the password panel.
   *
   * Only settles state inside the promise continuations, never synchronously,
   * matching the precedent `account-security.tsx`'s `loadSessions` documents.
   */
  const loadMethods = useCallback(() => {
    return fetchDeletionMethods()
      .then((available) => {
        setMethods(available);
        setMethodsError(null);
        setSelectedMethod((current) =>
          current && available.includes(current) ? current : (available[0] ?? null)
        );
        setIsLoadingMethods(false);
      })
      .catch(() => {
        // FAIL HONESTLY, NOT CLOSED AND NOT OPEN. The old screen guessed from
        // `GET /auth/identities` and, when that failed, showed a password form
        // on an assumption - so a Google-only account was told its password
        // was wrong. There is nothing to guess from any more: this is a real
        // error state with a real retry, and no proof panel is rendered on a
        // list the app does not have.
        setMethodsError(DELETION_METHODS_LOAD_ERROR);
        setIsLoadingMethods(false);
      });
  }, []);

  useEffect(() => {
    void loadMethods();
  }, [loadMethods]);

  const retryLoadMethods = useCallback(() => {
    setIsLoadingMethods(true);
    setMethodsError(null);
    void loadMethods();
  }, [loadMethods]);

  /**
   * Drops every half-finished proof. Called when the viewer switches method,
   * and after a refusal that invalidated what they had.
   *
   * The Google token and the WhatsApp code are both single-use credentials the
   * server has already seen; keeping either around after it was rejected would
   * only let the viewer resubmit something known not to work.
   */
  const clearProofState = useCallback(() => {
    setPasswordState('');
    setCodeState('');
    setGoogle({ status: 'idle' });
    setHasRequestedCode(false);
    setProofError(null);
    setIsSubmitted(false);
  }, []);

  const selectMethod = useCallback(
    (method: DeletionProofMethod) => {
      // A tap on the ALREADY-selected chip is a no-op, not a reset. Clearing
      // unconditionally would wipe a half-typed password or a code the viewer
      // is mid-way through entering, for a press that changed nothing.
      if (method === selectedMethod) {
        return;
      }

      setSelectedMethod(method);
      clearProofState();
      setDeleteError(null);
    },
    [clearProofState, selectedMethod]
  );

  const setPassword = useCallback((next: string) => {
    setPasswordState(next);
    setDeleteError(null);
  }, []);

  const setCode = useCallback((next: string) => {
    setCodeState(next);
    setDeleteError(null);
  }, []);

  /**
   * Obtains a FRESH Google credential to prove this deletion - and nothing
   * else.
   *
   * IT MUST NOT SIGN ANYBODY IN, and the way it guarantees that is by calling
   * `signInWithGoogle()` (the native adapter, which only ever returns an ID
   * token) and NEVER `useAuth().loginWithGoogle()` or
   * `provider-auth-service.loginWithGoogleIdToken()`. Those two exchange the
   * token at `POST /auth/google`, which mints a session for whichever account
   * owns that Google identity - so if the viewer picked the wrong account in
   * the sheet, the app would silently sign them OUT of the account they were
   * trying to delete and INTO another one, with the destructive button still
   * on screen. The token gathered here goes to exactly one place:
   * `POST /users/me/deletion`, as a proof.
   *
   * THIS CLIENT NEVER COMPARES GOOGLE EMAILS. Ownership is established
   * server-side by comparing the verified token's `sub` against this account's
   * own `AuthIdentity.providerSubject`; a mismatch comes back as
   * `ACCOUNT_DELETION_PROOF_MISMATCH`. An email comparison here would be a
   * second, weaker copy of that rule - an email can be unverified or
   * reassigned, and a client-side check is not evidence of anything.
   */
  const authenticateWithGoogle = useCallback(() => {
    setProofError(null);
    setDeleteError(null);
    setGoogle({ status: 'authenticating' });

    void (async () => {
      const result = await signInWithGoogle();

      if (result.status === 'success') {
        setGoogle({ status: 'ready', idToken: result.idToken });
        return;
      }

      setGoogle({ status: 'idle' });

      const message = describeGoogleReauthOutcome(result.status);

      // An empty message is the `cancelled` branch: the viewer closed the
      // sheet themselves, which is not a failure to report back at them.
      if (message) {
        setProofError(message);
      }
    })();
  }, []);

  /**
   * Asks the backend to send an ACCOUNT-DELETION code to the number this
   * account already has linked.
   *
   * `requestWhatsAppDeletionOtp` - never `startWhatsAppOtp`. The login route
   * issues a code in a namespace that can mint a session; this one issues a
   * code that can only ever authorize deleting this account. See that
   * function's doc comment.
   */
  const requestDeletionCode = useCallback(() => {
    setIsRequestingCode(true);
    setProofError(null);
    setDeleteError(null);

    void (async () => {
      try {
        const challenge = await requestWhatsAppDeletionOtp();

        setHasRequestedCode(true);
        setCodeState('');
        startResendCountdown(challenge.resendAvailableInSeconds);
      } catch (error) {
        // A DELIVERY failure leaves no challenge behind on the server, so the
        // resend control stays live: only a 429 means waiting actually helps,
        // and that path never reached the countdown start above. Matches the
        // login screen's existing behaviour.
        setProofError(describeDeletionOtpRequestError(error));
      } finally {
        setIsRequestingCode(false);
      }
    })();
  }, [startResendCountdown]);

  /**
   * The proof for the selected method, or `null` when it is not complete.
   * Building it in ONE place is what keeps the confirm gate, the button's
   * enabled state and the request body reading the same condition.
   */
  const buildProof = useCallback((): DeletionProof | null => {
    switch (selectedMethod) {
      case 'password':
        return password ? { method: 'password', currentPassword: password } : null;
      case 'google':
        return google.status === 'ready' ? { method: 'google', idToken: google.idToken } : null;
      case 'whatsapp':
        return code.length === DELETION_OTP_CODE_LENGTH ? { method: 'whatsapp', code } : null;
      default:
        return null;
    }
  }, [code, google, password, selectedMethod]);

  const proof = buildProof();

  const requestDelete = useCallback(() => {
    setIsSubmitted(true);

    if (!buildProof()) {
      return;
    }

    setDeleteError(null);
    setIsConfirmVisible(true);
  }, [buildProof]);

  const cancelDelete = useCallback(() => {
    setIsConfirmVisible(false);
    setDeleteError(null);
  }, []);

  /**
   * The point of no return, and the full post-deletion cleanup.
   *
   * ORDER MATTERS, and it is the same order the password-only flow
   * established (`account-data.tsx`, work unit 12C-M1), now shared by all
   * three methods:
   *
   *   1. capture the identity BEFORE anything mutates it - `logout()` clears
   *      `user`, so a read taken afterwards would purge nothing, or purge the
   *      wrong namespace;
   *   2. delete server-side. Everything below runs ONLY if this succeeded;
   *   3. purge that identity's account-bound local caches - likes/saves and
   *      watch progress, both identity-scoped in AsyncStorage. Deliberately
   *      MORE aggressive than an ordinary logout, which leaves them for a
   *      possible later login as the same account; a deleted account has no
   *      "later";
   *   4. `logout()`, which clears BOTH halves of the session - the
   *      Keystore-backed token pair via `session-secret-store` and the
   *      persisted account metadata via `persisted-account` (see
   *      `session-store.ts`'s `clearSession`) - and signs the Google SDK out,
   *      so the next sign-in shows the account chooser instead of silently
   *      reusing the deleted one;
   *   5. leave for `/login`, which is the logged-out app state.
   *
   * REWARDS NEEDS NO STEP OF ITS OWN, and that is a property worth stating
   * rather than a gap: `features/rewards/use-rewards-center.ts` holds the
   * balance, ledger and redemptions in React state only, re-read from
   * `GET /rewards/snapshot` each session and never written to AsyncStorage
   * (that hook and `services/rewards/rewards-service.ts` contain no storage
   * call at all). Step 4 flips `isAuthenticated` to false, which drops that
   * state with the tree. The ads store DOES persist, but only device-scoped
   * ad-pacing counters - no account-bound value and no perk, by its own
   * `partialize` - so it is correctly left alone.
   *
   * NOTHING LOCAL IS CLEARED WHEN THE REQUEST FAILS. Step 2 throwing skips
   * every step after it, so a network error or a rejected proof leaves the
   * viewer signed in with their data intact and a message they can act on -
   * the alternative being an app that signs somebody out and wipes their
   * cache because a request timed out.
   */
  const confirmDelete = useCallback(() => {
    const currentProof = buildProof();
    const currentMethod = selectedMethod;

    if (!currentProof || !currentMethod) {
      return;
    }

    setIsDeleting(true);
    setDeleteError(null);

    const deletedUserId = user?.id;

    void (async () => {
      try {
        await deleteMyAccount(currentProof);

        if (deletedUserId) {
          await Promise.all([
            clearPersistedInteractionsForIdentity(deletedUserId),
            clearPersistedProgressForIdentity(deletedUserId),
          ]);
        }

        setIsConfirmVisible(false);
        clearProofState();
        await logout();
        router.replace('/login');
      } catch (error) {
        setDeleteError(describeDeleteAccountError(error, currentMethod));

        if (shouldRefreshMethodsAfter(error)) {
          // The server just said this account cannot use the method the screen
          // offered, which means the list is stale. Re-read it and drop the
          // proof built against the old answer, so the viewer is looking at
          // what they can actually use rather than retrying something that
          // will refuse again.
          clearProofState();
          setIsConfirmVisible(false);
          void loadMethods();
        }
      } finally {
        setIsDeleting(false);
      }
    })();
  }, [buildProof, clearProofState, loadMethods, logout, selectedMethod, user]);

  const fieldError =
    isSubmitted && !proof && selectedMethod === 'password'
      ? 'Password saat ini wajib diisi'
      : isSubmitted && !proof && selectedMethod === 'whatsapp' && hasRequestedCode
        ? `Kode verifikasi harus ${DELETION_OTP_CODE_LENGTH} digit`
        : null;

  return {
    isLoadingMethods,
    methodsError,
    methods,
    selectedMethod,
    password,
    code,
    isGoogleAuthenticating: google.status === 'authenticating',
    isGoogleVerified: google.status === 'ready',
    hasRequestedCode,
    isRequestingCode,
    secondsUntilResend: secondsRemaining,
    canResendCode: canResend,
    proofError,
    fieldError,
    isConfirmVisible,
    isDeleting,
    deleteError,
    retryLoadMethods,
    selectMethod,
    setPassword,
    setCode,
    authenticateWithGoogle,
    requestDeletionCode,
    requestDelete,
    cancelDelete,
    confirmDelete,
  };
}
