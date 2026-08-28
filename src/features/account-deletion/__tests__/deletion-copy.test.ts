import {
  describeDeleteAccountError,
  describeDeletionOtpRequestError,
  describeGoogleReauthOutcome,
  shouldRefreshMethodsAfter,
} from '@/features/account-deletion/deletion-copy';
import { ApiError } from '@/services/api/client';

/**
 * The mapping from the backend's error vocabulary to what a person is told.
 *
 * Tested without rendering anything, for the same reason
 * `provider-error-messages.test.ts` is: a wrong message here is a viewer sent
 * to do the wrong thing about an irreversible action, and that failure has
 * nothing to do with layout.
 */

describe('describeDeleteAccountError - the codes that must stay distinct', () => {
  it('names the password for a wrong password, with no hedging about other providers', () => {
    // The old screen had to hedge ("if you signed in with Google, this
    // account has no password...") because it was GUESSING which methods the
    // account had. The method list is authoritative now, so this code can
    // only mean one thing.
    const message = describeDeleteAccountError(
      new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid credentials.'),
      'password'
    );

    expect(message).toBe('Password saat ini salah.');
    expect(message).not.toMatch(/Google|WhatsApp/);
  });

  it('tells a Google user they picked the WRONG ACCOUNT, not that their credential was bad', () => {
    // ACCOUNT_DELETION_PROOF_MISMATCH exists as a code of its own precisely
    // so this can be said plainly. Collapsing it into "verification failed"
    // would leave somebody retrying the same wrong account forever.
    const message = describeDeleteAccountError(
      new ApiError(401, 'ACCOUNT_DELETION_PROOF_MISMATCH', 'Not the linked account.'),
      'google'
    );

    expect(message).toMatch(/bukan akun yang tertaut/);
    expect(message).not.toMatch(/Password saat ini salah/);
  });

  it('distinguishes a REJECTED Google credential from the wrong Google account', () => {
    const rejected = describeDeleteAccountError(
      new ApiError(401, 'INVALID_GOOGLE_TOKEN', 'Invalid Google token'),
      'google'
    );
    const mismatched = describeDeleteAccountError(
      new ApiError(401, 'ACCOUNT_DELETION_PROOF_MISMATCH', 'Not the linked account.'),
      'google'
    );

    expect(rejected).not.toBe(mismatched);
  });

  it('gives ONE message for every INVALID_OTP cause, and offers the action that fixes all of them', () => {
    // Wrong / expired / already-used / attempts-exhausted are one code by
    // backend design. Splitting them client-side would report a distinction
    // the server deliberately refuses to make.
    const message = describeDeleteAccountError(
      new ApiError(401, 'INVALID_OTP', 'Invalid or expired verification code'),
      'whatsapp'
    );

    expect(message).toMatch(/salah atau sudah kedaluwarsa/);
    expect(message).toMatch(/Minta kode baru/);
  });

  it('names the unusable method and points at re-picking for a 409', () => {
    expect(
      describeDeleteAccountError(
        new ApiError(409, 'ACCOUNT_DELETION_METHOD_UNAVAILABLE', 'Cannot use "whatsapp".'),
        'whatsapp'
      )
    ).toMatch(/Metode WhatsApp tidak bisa dipakai/);
  });

  it('checks STATUS before code for 429, because the throttle carries a generic code', () => {
    // The deletion route's 5-per-15-minutes limit is a framework throttle
    // emitting HTTP_ERROR, so a code-only branch would fall through to the
    // generic "check your connection" message and give useless advice.
    expect(
      describeDeleteAccountError(new ApiError(429, 'HTTP_ERROR', 'ThrottlerException'), 'password')
    ).toMatch(/coba lagi dalam 15 menit/);
  });

  it('keeps the privileged-account refusal distinct from the generic failure', () => {
    const forbidden = describeDeleteAccountError(
      new ApiError(403, 'ACCOUNT_DELETION_FORBIDDEN', 'Not available for this account type'),
      'password'
    );

    expect(forbidden).toMatch(/tidak bisa dihapus sendiri/);
    expect(forbidden).not.toMatch(/Periksa koneksi/);
  });

  it('falls back to a generic, honest message for an unknown failure', () => {
    expect(describeDeleteAccountError(new Error('network down'), 'password')).toBe(
      'Gagal menghapus akun. Periksa koneksi kamu dan coba lagi.'
    );
  });
});

describe('describeDeletionOtpRequestError', () => {
  it('treats BOTH 429 limiters the same: the per-number cooldown and the per-IP throttle', () => {
    const cooldown = describeDeletionOtpRequestError(
      new ApiError(429, 'OTP_RESEND_COOLDOWN', 'Wait before requesting another.')
    );
    const routeThrottle = describeDeletionOtpRequestError(
      new ApiError(429, 'HTTP_ERROR', 'ThrottlerException')
    );

    expect(cooldown).toBe(routeThrottle);
    expect(cooldown).toMatch(/Tunggu sebentar/);
  });

  it('gives provider-unavailable its own copy, because "try again" is TRUE there', () => {
    // No challenge survives a delivery failure, so no cooldown was spent -
    // unlike a 429, where "try again" would be a lie.
    const unavailable = describeDeletionOtpRequestError(
      new ApiError(503, 'WHATSAPP_PROVIDER_UNAVAILABLE', 'Could not send.')
    );

    expect(unavailable).toMatch(/Coba lagi sebentar lagi/);
    expect(unavailable).not.toMatch(/Tunggu sebentar sebelum meminta kode lagi/);
  });

  it('reports a disabled provider truthfully rather than as a network problem', () => {
    expect(
      describeDeletionOtpRequestError(
        new ApiError(503, 'WHATSAPP_AUTH_DISABLED', 'WhatsApp auth disabled')
      )
    ).toMatch(/tidak aktif di server ini/);
  });

  it('falls back to a generic send failure for anything else', () => {
    expect(describeDeletionOtpRequestError(new Error('offline'))).toMatch(
      /Gagal mengirim kode verifikasi/
    );
  });
});

describe('describeGoogleReauthOutcome', () => {
  it('says NOTHING when the viewer cancelled - a closed sheet is not an error', () => {
    expect(describeGoogleReauthOutcome('cancelled')).toBe('');
  });

  it.each(['unsupported', 'unconfigured', 'failed'] as const)(
    'gives %s a real, non-empty message',
    (status) => {
      expect(describeGoogleReauthOutcome(status).length).toBeGreaterThan(0);
    }
  );

  it('never leaks the developer-facing config message into UI copy', () => {
    // `describeMissingGoogleConfig` names EXPO_PUBLIC_* env keys and is for
    // developers; it must never reach a viewer.
    expect(describeGoogleReauthOutcome('unconfigured')).not.toMatch(/EXPO_PUBLIC|\.env/);
  });
});

describe('shouldRefreshMethodsAfter', () => {
  it('refreshes only when the server said the method itself is unavailable', () => {
    expect(
      shouldRefreshMethodsAfter(
        new ApiError(409, 'ACCOUNT_DELETION_METHOD_UNAVAILABLE', 'Cannot use that.')
      )
    ).toBe(true);
  });

  it.each([
    ['a wrong password', new ApiError(401, 'INVALID_CREDENTIALS', 'nope')],
    ['a rejected code', new ApiError(401, 'INVALID_OTP', 'nope')],
    ['a rate limit', new ApiError(429, 'HTTP_ERROR', 'slow down')],
    ['a network error', new Error('offline')],
  ])('does NOT spend a request refreshing after %s', (_label, error) => {
    expect(shouldRefreshMethodsAfter(error)).toBe(false);
  });
});
