import {
  INDONESIA_DIAL_PREFIX,
  maskPhoneNumber,
  normalizePhoneNumber,
} from '@/services/auth/phone-number';

describe('normalizePhoneNumber', () => {
  it('accepts the 00 international access prefix, which the backend also accepts', () => {
    // The backend's `normalizePhoneToE164` treats `00` exactly like `+`. This
    // client used to reject it: the `00` fell into the Indonesian national
    // branch and came out as a "national number" starting 62. The same human
    // number, written two legitimate ways, must not be accepted one way and
    // refused the other.
    expect(normalizePhoneNumber('006281234567890')).toEqual({
      status: 'valid',
      e164: '+6281234567890',
    });
  });

  it('resolves every accepted Indonesian spelling to ONE identity', () => {
    // Uniqueness of the E.164 value is what guarantees one phone number maps
    // to at most one account. Four spellings, one identity.
    const forms = ['081234567890', '81234567890', '6281234567890', '+62 812-3456-7890'];
    const results = forms.map((form) => normalizePhoneNumber(form));

    for (const result of results) {
      expect(result).toEqual({ status: 'valid', e164: '+6281234567890' });
    }
  });

  it('accepts another country written with 00, not only with +', () => {
    expect(normalizePhoneNumber('001234567890')).toEqual({
      status: 'valid',
      e164: '+1234567890',
    });
  });

  it('refuses a leading zero after the international prefix rather than trimming it', () => {
    // A country calling code never begins with 0. Silently dropping the digit
    // is how two different inputs quietly collapse onto one identity.
    expect(normalizePhoneNumber('+01234567890').status).toBe('invalid');
    expect(normalizePhoneNumber('0001234567890').status).toBe('invalid');
  });

  it('normalizes every Indonesian form of the same number to one E.164 value', () => {
    // Arrange: the four ways a real person types the same phone number.
    const inputs = ['081234567890', '81234567890', '6281234567890', '+6281234567890'];

    // Act
    const results = inputs.map(normalizePhoneNumber);

    // Assert
    for (const result of results) {
      expect(result).toEqual({ status: 'valid', e164: '+6281234567890' });
    }
  });

  it('ignores spaces, dashes, dots and parentheses', () => {
    expect(normalizePhoneNumber('+62 812-3456.7890')).toEqual({
      status: 'valid',
      e164: '+6281234567890',
    });
    expect(normalizePhoneNumber('(0812) 3456 7890')).toEqual({
      status: 'valid',
      e164: '+6281234567890',
    });
  });

  it('reports empty input as empty rather than invalid', () => {
    expect(normalizePhoneNumber('')).toEqual({ status: 'empty' });
    expect(normalizePhoneNumber('   ')).toEqual({ status: 'empty' });
    expect(normalizePhoneNumber('+')).toEqual({ status: 'empty' });
  });

  it('rejects an Indonesian number that does not start with 8', () => {
    // Landline/service prefixes are not WhatsApp-reachable mobile numbers.
    expect(normalizePhoneNumber('02112345678')).toEqual({ status: 'invalid' });
    expect(normalizePhoneNumber('+622112345678')).toEqual({ status: 'invalid' });
  });

  it('rejects an Indonesian number that is too short or too long', () => {
    expect(normalizePhoneNumber('0812345')).toEqual({ status: 'invalid' });
    expect(normalizePhoneNumber('081234567890123')).toEqual({ status: 'invalid' });
  });

  it('accepts an explicitly-typed number from another country as written', () => {
    // Indonesia-first, not Indonesia-only: an expat's own number must not be
    // rejected just because the default country is +62.
    expect(normalizePhoneNumber('+6591234567')).toEqual({
      status: 'valid',
      e164: '+6591234567',
    });
  });

  it('rejects a foreign number that cannot be a valid E.164 length', () => {
    expect(normalizePhoneNumber('+651')).toEqual({ status: 'invalid' });
    expect(normalizePhoneNumber('+6512345678901234567')).toEqual({ status: 'invalid' });
  });

  it('exposes the Indonesian dial prefix the phone field renders', () => {
    expect(INDONESIA_DIAL_PREFIX).toBe('+62');
  });
});

describe('maskPhoneNumber', () => {
  it('keeps the country code and the last four digits visible', () => {
    expect(maskPhoneNumber('+6281234567890')).toBe('+6281*****7890');
  });

  it('always masks part of the middle, even for the shortest valid number', () => {
    // Regression: the head was capped only at 5 characters, so a short
    // E.164 number had its head and visible tail consume the whole string
    // and nothing was masked at all. `+12345678` is 8 digits - exactly the
    // minimum `normalizePhoneNumber` accepts - so it really can reach here.
    const masked = maskPhoneNumber('+12345678');

    expect(masked).toContain('*');
    expect(masked).not.toBe('+12345678');
    expect(masked).toHaveLength('+12345678'.length);
  });

  it('never lets the mask change the length or the last four digits', () => {
    for (const e164 of ['+6281234567890', '+6591234567', '+12345678', '+628123456']) {
      const masked = maskPhoneNumber(e164);

      expect(masked).toHaveLength(e164.length);
      expect(masked.slice(-4)).toBe(e164.slice(-4));
    }
  });

  it('returns very short input unchanged rather than producing nonsense', () => {
    expect(maskPhoneNumber('+62')).toBe('+62');
  });
});
