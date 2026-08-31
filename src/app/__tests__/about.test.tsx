import { fireEvent, render } from '@testing-library/react-native';

import AboutScreen from '@/app/about';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const mockShowToast = jest.fn();

jest.mock('@/stores/toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockOpenExternalUrl = jest.fn<Promise<boolean>, [string]>();

jest.mock('@/services/links/open-external-url', () => ({
  openExternalUrl: (url: string) => mockOpenExternalUrl(url),
}));

/**
 * The UMP consent gate is stubbed rather than exercised: whether Google
 * reports the privacy-options control as required is settled in
 * `services/ads/__tests__/consent-gate.test.ts`. What is under test HERE is
 * the other half of that contract - that About renders the required entry
 * point and wires it to the SDK's own form.
 */
const mockIsAdPrivacyOptionsRequired = jest.fn<boolean, []>();
const mockShowAdPrivacyOptionsForm = jest.fn<Promise<boolean>, []>();

jest.mock('@/services/ads/consent-gate', () => ({
  ensureAdsConsent: () => Promise.resolve(false),
  isAdPrivacyOptionsRequired: () => mockIsAdPrivacyOptionsRequired(),
  showAdPrivacyOptionsForm: () => mockShowAdPrivacyOptionsForm(),
}));

jest.mock('expo-constants', () => ({ expoConfig: { version: '1.0.0' } }));

const URL_KEYS = [
  'EXPO_PUBLIC_PRIVACY_POLICY_URL',
  'EXPO_PUBLIC_TERMS_URL',
  'EXPO_PUBLIC_ACCOUNT_DELETION_URL',
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of URL_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }

  mockIsAdPrivacyOptionsRequired.mockReturnValue(false);
  mockShowAdPrivacyOptionsForm.mockResolvedValue(true);
  mockOpenExternalUrl.mockResolvedValue(true);
});

afterEach(() => {
  for (const key of URL_KEYS) {
    const value = saved.get(key);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

/**
 * ABOUT.
 *
 * Every row here is conditional on something REAL, and that is the whole
 * design: a link that 404s is worse than no link, so a build without a
 * published page has no row for it. These cases pin both directions - the row
 * appears when the URL exists, and is absent when it does not.
 */
describe('AboutScreen legal rows', () => {
  it('renders the Privacy Policy row when the URL is configured', async () => {
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = 'https://redpandadrama.online/privacy';

    const { getByTestId } = await render(<AboutScreen />);

    expect(getByTestId('about-privacy')).toBeTruthy();
  });

  it('renders the Account Deletion row when the URL is configured', async () => {
    process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL =
      'https://redpandadrama.online/delete-account';

    const { getByTestId } = await render(<AboutScreen />);

    expect(getByTestId('about-deletion')).toBeTruthy();
  });

  it('opens a legal page through the app\'s shared external-link path', async () => {
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = 'https://redpandadrama.online/privacy';

    const { getByTestId } = await render(<AboutScreen />);

    fireEvent.press(getByTestId('about-privacy'));

    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://redpandadrama.online/privacy');
  });

  it('tells the viewer when a link cannot be opened at all', async () => {
    // Failing silently would leave a legally-required row looking broken.
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = 'https://redpandadrama.online/privacy';
    mockOpenExternalUrl.mockResolvedValue(false);

    const { getByTestId } = await render(<AboutScreen />);

    fireEvent.press(getByTestId('about-privacy'));
    await Promise.resolve();

    expect(mockShowToast).toHaveBeenCalledWith('Tautan tidak bisa dibuka di perangkat ini.');
  });
});

describe('AboutScreen never invents a page', () => {
  it('shows NO Terms of Service row while EXPO_PUBLIC_TERMS_URL is unset', async () => {
    // This is the build's actual state - release preflight warns about it. The
    // row must be absent rather than rendered as a dead or fabricated link.
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = 'https://redpandadrama.online/privacy';

    const { queryByTestId, queryByText } = await render(<AboutScreen />);

    expect(queryByTestId('about-terms')).toBeNull();
    expect(queryByText('Syarat & Ketentuan')).toBeNull();
  });

  it('shows the Terms row by itself once a real URL is configured', async () => {
    // No code change should be needed to publish it - only configuration.
    process.env.EXPO_PUBLIC_TERMS_URL = 'https://redpandadrama.online/terms';

    const { getByTestId } = await render(<AboutScreen />);

    expect(getByTestId('about-terms')).toBeTruthy();
  });

  it('rejects a non-https terms URL rather than linking to it', async () => {
    process.env.EXPO_PUBLIC_TERMS_URL = 'http://redpandadrama.online/terms';

    const { queryByTestId } = await render(<AboutScreen />);

    expect(queryByTestId('about-terms')).toBeNull();
  });

  it('offers no Open Source Licenses or Community Guidelines row', async () => {
    // Neither is implemented: there is no licence manifest and no published
    // guidelines URL. A row opening an empty screen would be a worse claim
    // than silence.
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = 'https://redpandadrama.online/privacy';

    const { queryByText } = await render(<AboutScreen />);

    expect(queryByText(/Open Source|Lisensi|Community Guidelines|Pedoman/i)).toBeNull();
  });
});

describe('AboutScreen version', () => {
  it('renders the version from the real Expo config, not a literal', async () => {
    const { getByTestId } = await render(<AboutScreen />);

    expect(getByTestId('about-version')).toHaveTextContent('Versi 1.0.0');
  });
});

/**
 * Google's US state regulations message - like the EEA/UK one - is only
 * satisfied if the app ALSO exposes a persistent control that reopens the
 * privacy form, so a viewer can change or withdraw an ad-consent choice made
 * earlier. The SDK decides WHETHER that control is required; About is now the
 * only place that renders it, so the requirement is only met if these hold.
 */
describe('AboutScreen ad privacy options', () => {
  it('renders no privacy options row where the SDK does not require one', async () => {
    // Outside a covered region the form opens nothing, so a row offering it
    // would be a dead end.
    const { queryByTestId } = await render(<AboutScreen />);

    expect(queryByTestId('about-ad-privacy-options')).toBeNull();
  });

  it('renders the privacy options row when the SDK requires one', async () => {
    // Asserted with NO legal URL configured, so this proves the control
    // appears on the strength of the SDK requirement alone - it did not simply
    // inherit visibility from a legal section.
    mockIsAdPrivacyOptionsRequired.mockReturnValue(true);

    const { getByTestId } = await render(<AboutScreen />);

    expect(getByTestId('about-ad-privacy-options')).toBeTruthy();
  });

  it("opens Google's own privacy options form when the row is pressed", async () => {
    // The entry point has to reach the SDK's form; a custom consent screen or
    // a locally-stored toggle would not satisfy the requirement.
    mockIsAdPrivacyOptionsRequired.mockReturnValue(true);

    const { getByTestId } = await render(<AboutScreen />);

    fireEvent.press(getByTestId('about-ad-privacy-options'));

    expect(mockShowAdPrivacyOptionsForm).toHaveBeenCalledTimes(1);
  });

  it('tells the viewer when the form cannot be opened', async () => {
    mockIsAdPrivacyOptionsRequired.mockReturnValue(true);
    mockShowAdPrivacyOptionsForm.mockResolvedValue(false);

    const { getByTestId } = await render(<AboutScreen />);

    fireEvent.press(getByTestId('about-ad-privacy-options'));
    await Promise.resolve();

    expect(mockShowToast).toHaveBeenCalledWith(
      'Pengaturan privasi iklan belum bisa dibuka. Coba lagi nanti.'
    );
  });
});

describe('AboutScreen is reachable without a session', () => {
  it('reads no auth state at all', async () => {
    // The legal pages and the deletion route are exactly what somebody who has
    // NOT signed in is most likely to need. The screen imports no auth store,
    // so there is nothing here that could gate it.
    process.env.EXPO_PUBLIC_PRIVACY_POLICY_URL = 'https://redpandadrama.online/privacy';

    const { getByTestId } = await render(<AboutScreen />);

    expect(getByTestId('about-privacy')).toBeTruthy();
  });
});
