/**
 * The app's public support channels.
 *
 * Mirrors `constants/legal.ts` deliberately, and for the same reason: these are
 * CONFIGURATION, not literals in a component. A build gets the channels it is
 * configured with, every surface renders only the ones that exist, and
 * publishing or changing a channel is an env change rather than a code change.
 *
 * These are EXPO_PUBLIC_* values, so they are inlined into the bundle at build
 * time and are fixed properties of an artifact. That is correct here - a
 * support address and a support number are printed on the website and meant to
 * be found - but it also means nothing secret may ever be added to this file.
 */

/**
 * Accepts only an absolute https URL - same rule, same rationale as
 * `legal.ts`: a relative path or an http URL produces a row that opens nothing
 * (or opens over cleartext, which Android blocks by default anyway), so the row
 * is absent rather than broken.
 */
function readHttpsUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** The published help centre / support page. */
export function getSupportUrl(): string | undefined {
  // Static member access, matching the rule `expo/no-dynamic-env-var` enforces
  // across src/: Expo can only inline a literal `process.env.EXPO_PUBLIC_X`.
  return readHttpsUrl(process.env.EXPO_PUBLIC_SUPPORT_URL);
}

/**
 * The support mailbox, as a raw address.
 *
 * Validated rather than trusted: a value with no `@`, with whitespace, or with
 * a newline could turn a `mailto:` into something other than one recipient.
 * Deliberately conservative - one `@`, no spaces, a dot in the domain - because
 * the only thing this needs to accept is an ordinary mailbox.
 */
export function getSupportEmail(): string | undefined {
  const value = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim();

  if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
    return undefined;
  }

  return value;
}

/** The `mailto:` target the Help screen actually opens. */
export function getSupportEmailUrl(): string | undefined {
  const email = getSupportEmail();

  return email ? `mailto:${email}` : undefined;
}

/**
 * The support WhatsApp number, normalised to the digits `wa.me` expects.
 *
 * Configured in the readable E.164 form (`+62858...`); `wa.me` takes the same
 * number with no `+`, spaces or dashes, so the normalisation happens HERE
 * rather than asking whoever writes the env file to know that. A value that is
 * not a plausible international number is rejected outright, so a typo becomes
 * a missing row rather than a link to somebody else's number.
 */
export function getSupportWhatsAppUrl(): string | undefined {
  const raw = process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP?.trim();

  if (!raw) {
    return undefined;
  }

  const digits = raw.replace(/[\s()+-]/g, '');

  // 8-15 digits is the E.164 range, and rejecting a leading zero keeps a
  // national-format number (which would resolve to the wrong country on
  // wa.me) out.
  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return undefined;
  }

  // wa.me is WhatsApp's own official click-to-chat host, and it is an https
  // page - so it opens through the app's ordinary external-link path on web
  // AND hands off to the installed WhatsApp app on Android, with no
  // platform-specific branching and no `whatsapp://` scheme that would simply
  // fail on a device without it installed.
  return `https://wa.me/${digits}`;
}

/** Whether there is any support channel at all to present. */
export function hasAnySupportChannel(): boolean {
  return Boolean(getSupportUrl() ?? getSupportEmailUrl() ?? getSupportWhatsAppUrl());
}
