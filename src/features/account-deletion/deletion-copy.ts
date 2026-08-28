import { ApiError } from '@/services/api/client';
import type { DeletionProofMethod } from '@/services/auth/account-deletion-service';

/**
 * Every sentence the account-deletion flow can say, in one pure module.
 *
 * WHY PLAIN STRINGS AND NOT `TranslationKey`. `features/auth/provider-error-messages.ts`
 * maps the same backend vocabulary to i18n keys, because the surfaces it
 * serves (login, WhatsApp login, the Metode Login card) are wired to
 * `stores/language`. The "Data & Privasi" screen is not: `app/account-data.tsx`
 * and `app/account-security.tsx` render literal Indonesian throughout and
 * import no translator. Emitting keys here would either strand them
 * unresolved or force an unrelated i18n migration of two screens into a work
 * unit about account deletion. So this module follows the convention of the
 * screen it serves, and stays a pure function so the mapping is testable
 * without rendering anything.
 *
 * THE TWO RULES INHERITED FROM `provider-error-messages.ts`, unchanged:
 *
 * 1. A code the backend was SPECIFIC about gets a specific message. The
 *    server distinguishes "that Google account is not the one linked to this
 *    account" (`ACCOUNT_DELETION_PROOF_MISMATCH`) from "that credential did
 *    not verify" (`INVALID_GOOGLE_TOKEN`) precisely so a person can tell them
 *    apart; collapsing either into "gagal" turns a correct, actionable
 *    refusal into an unexplained dead end.
 *
 * 2. A code the backend was deliberately VAGUE about stays vague.
 *    `INVALID_OTP` covers a wrong code, an expired one, an already-used one
 *    AND an exhausted attempt budget, and the server refuses to say which.
 *    This module must not guess: it names the causes a person can act on and
 *    offers the one action that resolves all four - ask for a new code.
 *
 * STATUS IS CHECKED BEFORE CODE for 429, for the same reason: the per-IP
 * route throttles are applied by the framework and carry the generic
 * `HTTP_ERROR` code rather than `OTP_RESEND_COOLDOWN`, so status is the only
 * reliable signal there.
 */

const HTTP_TOO_MANY_REQUESTS = 429;

function isRateLimited(error: unknown): boolean {
  return error instanceof ApiError && error.status === HTTP_TOO_MANY_REQUESTS;
}

function codeOf(error: unknown): string | null {
  return error instanceof ApiError ? error.code : null;
}

/** The human name of a proof method, for the method picker and its copy. */
export const DELETION_METHOD_LABELS: Readonly<Record<DeletionProofMethod, string>> = {
  password: 'Password',
  google: 'Google',
  whatsapp: 'WhatsApp',
};

/**
 * What the viewer is asked to do for each method, in one line, before they
 * are asked to do it. A first-time user meeting a "Hapus Akun" card should
 * know what the next step wants of them without pressing anything.
 */
export const DELETION_METHOD_HINTS: Readonly<Record<DeletionProofMethod, string>> = {
  password: 'Masukkan password akunmu untuk mengonfirmasi penghapusan.',
  google: 'Konfirmasi ulang lewat akun Google yang tertaut ke akun ini.',
  whatsapp: 'Kami kirim kode verifikasi ke nomor WhatsApp yang tertaut ke akun ini.',
};

/**
 * `GET /users/me/deletion/methods` failed. Distinct from "the account has no
 * method", which is not an error at all - see `NO_DELETION_METHOD_MESSAGE`.
 */
export const DELETION_METHODS_LOAD_ERROR =
  'Gagal memuat metode konfirmasi. Periksa koneksi kamu lalu coba lagi.';

/**
 * The account genuinely has no verifiable proof on this server - an empty
 * `methods` list, which the backend documents as a truthful, reachable answer
 * rather than a bug.
 *
 * It must NOT read as a failure the viewer can retry away, and it must give
 * them somewhere to go: the support route stays the fallback for exactly this
 * case (and for somebody who has lost access to their sign-in factor
 * entirely).
 */
export const NO_DELETION_METHOD_MESSAGE =
  'Akun ini belum punya metode konfirmasi yang bisa dipakai di aplikasi. Hubungi dukungan ' +
  'lewat alamat email di halaman Kebijakan Privasi untuk meminta penghapusan akun.';

/**
 * `POST /users/me/deletion/whatsapp/otp` failures.
 *
 * The 429 branch comes first and covers BOTH limiters that produce one: the
 * per-number cooldown (`OTP_RESEND_COOLDOWN`) and the per-IP route throttle
 * (generic `HTTP_ERROR`), which is the one an ordinary person actually
 * reaches after a send and two resends. Same copy for both, because the
 * honest advice is identical and a "next acceptance" estimate would require
 * reading the number's recent request history back to the caller.
 *
 * `WHATSAPP_PROVIDER_UNAVAILABLE` gets its own copy because the ADVICE
 * differs: no challenge survives that response, so no cooldown is spent and
 * "try again shortly" is true - where for a 429 it would be a lie.
 */
export function describeDeletionOtpRequestError(error: unknown): string {
  if (isRateLimited(error)) {
    return 'Kode verifikasi baru saja diminta. Tunggu sebentar sebelum meminta kode lagi.';
  }

  switch (codeOf(error)) {
    case 'WHATSAPP_PROVIDER_UNAVAILABLE':
      return 'Kode tidak bisa dikirim saat ini. Coba lagi sebentar lagi.';
    case 'WHATSAPP_AUTH_DISABLED':
      return 'Verifikasi WhatsApp sedang tidak aktif di server ini. Coba metode lain atau hubungi dukungan.';
    case 'ACCOUNT_DELETION_METHOD_UNAVAILABLE':
      return 'Nomor WhatsApp tidak lagi bisa dipakai untuk mengonfirmasi penghapusan akun ini. Pilih metode lain.';
    case 'INVALID_ACCESS_TOKEN':
      return 'Sesi kamu sudah tidak valid. Silakan login ulang.';
    default:
      return 'Gagal mengirim kode verifikasi. Periksa koneksi kamu lalu coba lagi.';
  }
}

/**
 * What a Google re-authentication attempt produced, when it did not produce a
 * token. Mirrors the non-`success` branches of `GoogleSignInResult`.
 *
 * `unconfigured` deliberately does NOT surface `developerMessage`: that
 * string names environment variables and is for developers, never for UI.
 *
 * `cancelled` maps to the EMPTY string, because it is not an error at all -
 * the viewer closed the sheet on purpose, and the card simply returns to its
 * "not verified yet" state without accusing them of anything.
 */
export function describeGoogleReauthOutcome(
  status: 'cancelled' | 'unsupported' | 'unconfigured' | 'failed'
): string {
  switch (status) {
    case 'cancelled':
      return '';
    case 'unsupported':
      return 'Konfirmasi lewat Google tidak tersedia di perangkat ini. Hubungi dukungan untuk menghapus akun.';
    case 'unconfigured':
      return 'Konfirmasi lewat Google belum tersedia di versi aplikasi ini. Hubungi dukungan untuk menghapus akun.';
    case 'failed':
      return 'Verifikasi Google gagal. Coba lagi, atau hubungi dukungan jika terus gagal.';
  }
}

/**
 * `POST /users/me/deletion` failures, per method.
 *
 * `method` is passed in because some codes mean genuinely different things
 * depending on which proof was presented, and a person acting on the message
 * needs the one that matches what they just did:
 *
 * - `ACCOUNT_DELETION_METHOD_UNAVAILABLE` names the method that stopped being
 *   usable, and points at re-picking - which the card does automatically by
 *   refreshing the method list.
 * - `ACCOUNT_DELETION_PROOF_MISMATCH` is, in practice, "you signed in with
 *   the wrong Google account". Saying that plainly is the whole reason the
 *   backend gave it a code of its own instead of reusing
 *   `INVALID_GOOGLE_TOKEN`.
 * - `INVALID_CREDENTIALS` can only ever mean a wrong password here, because
 *   the method list already established that this account HAS one - the
 *   ambiguity the old screen had to hedge about ("if you signed in with
 *   Google, this account has no password...") no longer exists.
 */
export function describeDeleteAccountError(error: unknown, method: DeletionProofMethod): string {
  // Status before code: the deletion route's own 5-per-15-minutes limit is a
  // framework throttle carrying the generic `HTTP_ERROR` code.
  if (isRateLimited(error)) {
    return 'Terlalu banyak percobaan. Untuk keamanan akunmu, coba lagi dalam 15 menit.';
  }

  switch (codeOf(error)) {
    case 'INVALID_CREDENTIALS':
      return 'Password saat ini salah.';

    case 'INVALID_GOOGLE_TOKEN':
      return 'Verifikasi Google gagal. Coba konfirmasi ulang lewat Google.';

    /**
     * ONE MESSAGE FOR FOUR CAUSES, deliberately. The backend answers
     * `INVALID_OTP` for a wrong code, an expired one, an already-used one and
     * an exhausted attempt budget alike, and must not be second-guessed: a
     * client that split them would be reporting a distinction the server
     * refuses to make. So the copy names the two causes a person can do
     * something about and offers the action that fixes all four.
     */
    case 'INVALID_OTP':
      return 'Kode verifikasi salah atau sudah kedaluwarsa. Minta kode baru lalu coba lagi.';

    case 'ACCOUNT_DELETION_PROOF_MISMATCH':
      return method === 'google'
        ? 'Akun Google yang kamu pilih bukan akun yang tertaut ke akun ini. Coba lagi dan pilih akun Google yang benar.'
        : 'Konfirmasi yang kamu berikan bukan milik akun ini. Coba lagi dengan metode yang tertaut ke akun ini.';

    case 'ACCOUNT_DELETION_METHOD_UNAVAILABLE':
      return `Metode ${DELETION_METHOD_LABELS[method]} tidak bisa dipakai untuk menghapus akun ini. Pilih metode konfirmasi lain di bawah.`;

    case 'ACCOUNT_DELETION_FORBIDDEN':
      return 'Akun ini tidak bisa dihapus sendiri. Jenis akun ini memerlukan proses penghapusan khusus.';

    case 'INVALID_ACCESS_TOKEN':
      return 'Sesi kamu sudah tidak valid. Silakan login ulang lalu coba lagi.';

    default:
      return 'Gagal menghapus akun. Periksa koneksi kamu dan coba lagi.';
  }
}

/**
 * Whether a failed deletion attempt means the method list this card is
 * holding is stale.
 *
 * Only `ACCOUNT_DELETION_METHOD_UNAVAILABLE` does: it is the server saying
 * "the proof you named is not one this account can produce", which is exactly
 * the statement the method list is supposed to answer. Every other failure -
 * a wrong password, a rejected code, a rate limit - leaves the list correct,
 * and refetching on those would spend a request per typo.
 */
export function shouldRefreshMethodsAfter(error: unknown): boolean {
  return codeOf(error) === 'ACCOUNT_DELETION_METHOD_UNAVAILABLE';
}
