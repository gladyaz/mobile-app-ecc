import { fireEvent, render } from '@testing-library/react-native';

import HelpScreen from '@/app/help';

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

const SUPPORT_KEYS = [
  'EXPO_PUBLIC_SUPPORT_URL',
  'EXPO_PUBLIC_SUPPORT_EMAIL',
  'EXPO_PUBLIC_SUPPORT_WHATSAPP',
] as const;

const saved = new Map<string, string | undefined>();

/**
 * Deliberately NOT the real support number. A checked-in fixture number is
 * forever, and `contract-boundary.test.ts` already treats an unmasked +62
 * number as something that must not appear in committed test data.
 */
const TEST_WHATSAPP = '+6281234567890';

beforeEach(() => {
  for (const key of SUPPORT_KEYS) {
    saved.set(key, process.env[key]);
    delete process.env[key];
  }

  mockOpenExternalUrl.mockResolvedValue(true);
});

afterEach(() => {
  for (const key of SUPPORT_KEYS) {
    const value = saved.get(key);

    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

/**
 * HELP & FEEDBACK.
 *
 * Three real channels, each rendered only when this build is configured with
 * one. These cases pin both directions - the row appears for a configured
 * channel and is absent otherwise - plus the two things that must never
 * regress: no raw contact detail is rendered, and every row goes through the
 * app's single cross-platform link mechanism.
 */
describe('HelpScreen channels', () => {
  it('opens the configured Help Center page', async () => {
    process.env.EXPO_PUBLIC_SUPPORT_URL = 'https://redpandadrama.online/support';

    const { getByTestId } = await render(<HelpScreen />);

    fireEvent.press(getByTestId('help-center'));

    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://redpandadrama.online/support');
  });

  it('opens the configured support mailbox as a mailto: link', async () => {
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'support@redpandadrama.invalid';

    const { getByTestId } = await render(<HelpScreen />);

    fireEvent.press(getByTestId('help-email'));

    expect(mockOpenExternalUrl).toHaveBeenCalledWith('mailto:support@redpandadrama.invalid');
  });

  it('opens WhatsApp through wa.me, normalising the configured number', async () => {
    // Configured in readable E.164; wa.me wants bare digits. Normalising here
    // means whoever writes the env file does not have to know that.
    process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP = TEST_WHATSAPP;

    const { getByTestId } = await render(<HelpScreen />);

    fireEvent.press(getByTestId('help-whatsapp'));

    expect(mockOpenExternalUrl).toHaveBeenCalledWith('https://wa.me/6281234567890');
  });

  it('renders all three channels when all three are configured', async () => {
    process.env.EXPO_PUBLIC_SUPPORT_URL = 'https://redpandadrama.online/support';
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'support@redpandadrama.invalid';
    process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP = TEST_WHATSAPP;

    const { getByTestId } = await render(<HelpScreen />);

    expect(getByTestId('help-center')).toBeTruthy();
    expect(getByTestId('help-email')).toBeTruthy();
    expect(getByTestId('help-whatsapp')).toBeTruthy();
  });
});

describe('HelpScreen renders only what the build actually has', () => {
  it('shows only the configured channel, not the other two', async () => {
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'support@redpandadrama.invalid';

    const { getByTestId, queryByTestId } = await render(<HelpScreen />);

    expect(getByTestId('help-email')).toBeTruthy();
    expect(queryByTestId('help-center')).toBeNull();
    expect(queryByTestId('help-whatsapp')).toBeNull();
  });

  it('says so plainly when no channel is configured', async () => {
    const { queryByTestId, getByText } = await render(<HelpScreen />);

    expect(queryByTestId('help-center')).toBeNull();
    expect(queryByTestId('help-email')).toBeNull();
    expect(queryByTestId('help-whatsapp')).toBeNull();
    expect(getByText('Saluran dukungan belum tersedia di build ini.')).toBeTruthy();
  });

  it('rejects a non-https support URL rather than linking to it', async () => {
    process.env.EXPO_PUBLIC_SUPPORT_URL = 'http://redpandadrama.online/support';

    const { queryByTestId } = await render(<HelpScreen />);

    expect(queryByTestId('help-center')).toBeNull();
  });

  it('rejects a national-format WhatsApp number rather than dialling the wrong country', async () => {
    // A leading zero is a national number. Resolved on wa.me it would reach
    // somebody else entirely, so it is refused outright.
    process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP = '085884022823';

    const { queryByTestId } = await render(<HelpScreen />);

    expect(queryByTestId('help-whatsapp')).toBeNull();
  });

  it('rejects a malformed email rather than opening a broken mailto:', async () => {
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'not-an-address';

    const { queryByTestId } = await render(<HelpScreen />);

    expect(queryByTestId('help-email')).toBeNull();
  });
});

describe('HelpScreen never exposes raw contact details', () => {
  it('renders labels only - no URL, address or phone number', async () => {
    // The destination lives in configuration; the screen shows a plain label.
    process.env.EXPO_PUBLIC_SUPPORT_URL = 'https://redpandadrama.online/support';
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'support@redpandadrama.invalid';
    process.env.EXPO_PUBLIC_SUPPORT_WHATSAPP = TEST_WHATSAPP;

    const { queryByText } = await render(<HelpScreen />);

    expect(queryByText(/https?:|@|wa\.me|\+62|mailto:/)).toBeNull();
  });
});

describe('HelpScreen access and failure handling', () => {
  it('is reachable with no session - it reads no auth state at all', async () => {
    process.env.EXPO_PUBLIC_SUPPORT_URL = 'https://redpandadrama.online/support';

    const { getByTestId } = await render(<HelpScreen />);

    expect(getByTestId('help-title')).toBeTruthy();
  });

  it('tells the viewer when a channel cannot be opened', async () => {
    // Failing silently would leave the row looking broken - the same rule the
    // legal rows follow.
    process.env.EXPO_PUBLIC_SUPPORT_URL = 'https://redpandadrama.online/support';
    mockOpenExternalUrl.mockResolvedValue(false);

    const { getByTestId } = await render(<HelpScreen />);

    fireEvent.press(getByTestId('help-center'));
    await Promise.resolve();

    expect(mockShowToast).toHaveBeenCalledWith('Tautan tidak bisa dibuka di perangkat ini.');
  });
});
