/**
 * Phone-number normalization for the WhatsApp login flow.
 *
 * Pure and dependency-free on purpose: the phone step, its tests, and any
 * future caller all share one definition of "what did the user actually
 * type, and what should be sent to the backend". The backend receives E.164
 * only - never the raw keystrokes - so `08...`, `8...`, `62...` and
 * `+62 812-3456-7890` cannot become four different accounts for one person.
 *
 * Indonesia-first, not Indonesia-only: bare and `0`-prefixed input is read
 * as Indonesian (the default country experience), while an explicitly
 * `+`-prefixed number from any other country is accepted as typed. Only
 * Indonesian numbers get the stricter national-format check below, because
 * that is the only numbering plan this app can claim to validate.
 */

export const INDONESIA_COUNTRY_CODE = '62';

/** Rendered as a fixed affix on the phone field. */
export const INDONESIA_DIAL_PREFIX = `+${INDONESIA_COUNTRY_CODE}`;

/**
 * Indonesian mobile numbers are `8` followed by 8-12 more digits (national
 * significant number of 9-13 digits). Kept deliberately wide: operators add
 * prefixes often, and rejecting a real number is a worse failure here than
 * letting the backend reject an unreachable one.
 */
const MIN_ID_NATIONAL_LENGTH = 9;
const MAX_ID_NATIONAL_LENGTH = 13;

/** E.164 allows at most 15 digits including the country code. */
const MIN_E164_DIGITS = 8;
const MAX_E164_DIGITS = 15;

export type PhoneNormalizationResult =
  | { readonly status: 'valid'; readonly e164: string }
  | { readonly status: 'empty' }
  | { readonly status: 'invalid' };

/** Keeps digits, plus a single leading `+`. Spaces, dashes, dots, and
 * parentheses are how people actually write phone numbers; none of them
 * carry meaning here. */
function stripFormatting(input: string): string {
  const trimmed = input.trim();
  const hasPlusPrefix = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');

  return hasPlusPrefix ? `+${digits}` : digits;
}

function isIndonesianNationalNumberValid(national: string): boolean {
  return (
    national.startsWith('8') &&
    national.length >= MIN_ID_NATIONAL_LENGTH &&
    national.length <= MAX_ID_NATIONAL_LENGTH
  );
}

function buildIndonesianResult(national: string): PhoneNormalizationResult {
  if (!isIndonesianNationalNumberValid(national)) {
    return { status: 'invalid' };
  }

  return { status: 'valid', e164: `+${INDONESIA_COUNTRY_CODE}${national}` };
}

/**
 * An already-international digit string (the `+` or `00` prefix stripped),
 * resolved to E.164.
 *
 * Shared by BOTH international spellings so the two cannot diverge: before
 * this existed, `+62812...` was accepted and the identical number written
 * `0062812...` was rejected, because the `00` fell into the Indonesian
 * national branch below and came out as a "national number" starting `62`.
 */
function buildInternationalResult(digits: string): PhoneNormalizationResult {
  if (digits.startsWith(INDONESIA_COUNTRY_CODE)) {
    return buildIndonesianResult(digits.slice(INDONESIA_COUNTRY_CODE.length));
  }

  // Another country's number, typed deliberately with its own country
  // code. Length is all this app can honestly check.
  if (digits.length < MIN_E164_DIGITS || digits.length > MAX_E164_DIGITS) {
    return { status: 'invalid' };
  }

  // A country calling code never begins with 0, so `+0...` / `000...` is not
  // an international number however it was typed. Refused rather than
  // silently trimmed: dropping an unexpected leading digit is how two
  // different inputs quietly collapse onto one identity.
  if (digits.startsWith('0')) {
    return { status: 'invalid' };
  }

  return { status: 'valid', e164: `+${digits}` };
}

/**
 * Normalizes user-typed input to an E.164 number.
 *
 * Accepted, all resolving to the same `+62812...`:
 * `0812...`, `812...`, `62812...`, `+62812...`, `0062812...`, and any of
 * those with spaces, dashes or parentheses.
 *
 * AGREEING WITH THE BACKEND IS THE POINT, not matching it character for
 * character. The server's `normalizePhoneToE164` is the single source of
 * truth for what a number MEANS - it is what gets stored as the identity key
 * - and it accepts `+`, the `00` international access prefix, and a leading
 * `0` read as Indonesian. This function accepts all three and, additionally,
 * a bare `812...`/`62812...` because that is how people type their own number
 * into a field that already shows `+62`. That extra tolerance cannot
 * disagree with the server, because the value SENT is always the canonical
 * `+62812...` the server would itself have produced - the client resolves the
 * spelling, it never invents an identity.
 *
 * The one place this is deliberately STRICTER is the Indonesian
 * national-number check (`8` + 8-12 digits): a `+62` landline is a number
 * WhatsApp cannot deliver to, and refusing it here costs a viewer nothing
 * that the OTP round trip would not have refused a minute later.
 */
export function normalizePhoneNumber(input: string): PhoneNormalizationResult {
  const cleaned = stripFormatting(input);

  if (cleaned.length === 0 || cleaned === '+') {
    return { status: 'empty' };
  }

  if (cleaned.startsWith('+')) {
    return buildInternationalResult(cleaned.slice(1));
  }

  // `0062812...` - the ITU international access prefix written out. Checked
  // BEFORE the single-leading-zero branch below, which would otherwise read
  // it as an Indonesian national number and reject a form the backend
  // accepts.
  if (cleaned.startsWith('00')) {
    return buildInternationalResult(cleaned.slice(2));
  }

  if (cleaned.startsWith('0')) {
    return buildIndonesianResult(cleaned.slice(1));
  }

  if (cleaned.startsWith(INDONESIA_COUNTRY_CODE)) {
    return buildIndonesianResult(cleaned.slice(INDONESIA_COUNTRY_CODE.length));
  }

  return buildIndonesianResult(cleaned);
}

/**
 * Masks an E.164 number for display after the code is sent ("kode dikirim
 * ke +62812****7890"). Never used to decide anything - only to reassure the
 * viewer that the code went to the number they meant.
 */
export function maskPhoneNumber(e164: string): string {
  const visibleTailLength = 4;
  const maxHeadLength = 5;
  // The head used to be capped only at 5, so for a short E.164 number the
  // head and the visible tail could consume the whole string and mask
  // NOTHING: `+12345678` (8 digits, which `normalizePhoneNumber` accepts as
  // valid) came back completely unmasked. Reserving these characters
  // guarantees the middle is always hidden, for every length this can be
  // called with.
  const minMaskedLength = 2;

  if (e164.length <= visibleTailLength + minMaskedLength) {
    // Too short to mask meaningfully - there is no middle to hide.
    return e164;
  }

  const headLength = Math.min(maxHeadLength, e164.length - visibleTailLength - minMaskedLength);
  const head = e164.slice(0, headLength);
  const tail = e164.slice(-visibleTailLength);

  return `${head}${'*'.repeat(e164.length - headLength - visibleTailLength)}${tail}`;
}
