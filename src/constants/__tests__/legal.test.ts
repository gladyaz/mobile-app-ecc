import {
  getAccountDeletionUrl,
  getPrivacyPolicyUrl,
  getTermsUrl,
  hasAnyLegalUrl,
} from '@/constants/legal';

const KEYS = [
  'EXPO_PUBLIC_PRIVACY_POLICY_URL',
  'EXPO_PUBLIC_TERMS_URL',
  'EXPO_PUBLIC_ACCOUNT_DELETION_URL',
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved.get(key);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe('legal URLs', () => {
  it('reports nothing when the URLs have not been configured', () => {
    // This is the state of every build today, and the reason the Profile rows
    // are conditional: a link to a page that does not exist is worse than the
    // absence of a link.
    expect(getPrivacyPolicyUrl()).toBeUndefined();
    expect(getTermsUrl()).toBeUndefined();
    expect(getAccountDeletionUrl()).toBeUndefined();
    expect(hasAnyLegalUrl()).toBe(false);
  });

  it('returns a configured https URL', () => {
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = 'https://example.com/privacy';

    expect(getPrivacyPolicyUrl()).toBe('https://example.com/privacy');
    expect(hasAnyLegalUrl()).toBe(true);
  });

  it.each(['http://example.com/privacy', '/privacy', 'example.com/privacy', 'not a url', ''])(
    'rejects %p rather than rendering a row that opens nothing',
    (value) => {
      process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = value;

      expect(getPrivacyPolicyUrl()).toBeUndefined();
    }
  );
});
