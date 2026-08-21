import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { LinkedMethodsCard } from '@/features/auth/linked-methods-card';
import { ApiError } from '@/services/api/client';
import { signInWithGoogle } from '@/services/auth/google-sign-in';
import {
  linkGoogleIdentity,
  linkWhatsAppIdentity,
  listAuthIdentities,
  unlinkAuthIdentity,
} from '@/services/auth/provider-auth-service';
import type { AuthIdentitySummary } from '@/types/auth';

jest.mock('@/services/auth/provider-auth-service');
// The native Google sheet is mocked at its own adapter boundary. Nothing
// here exercises real Google sign-in or a real WhatsApp message.
jest.mock('@/services/auth/google-sign-in');

const mockShowToast = jest.fn();

jest.mock('@/stores/toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockedList = listAuthIdentities as jest.MockedFunction<typeof listAuthIdentities>;
const mockedUnlink = unlinkAuthIdentity as jest.MockedFunction<typeof unlinkAuthIdentity>;
const mockedLinkGoogle = linkGoogleIdentity as jest.MockedFunction<typeof linkGoogleIdentity>;
const mockedLinkWhatsApp = linkWhatsAppIdentity as jest.MockedFunction<
  typeof linkWhatsAppIdentity
>;
const mockedSignInWithGoogle = signInWithGoogle as jest.MockedFunction<typeof signInWithGoogle>;

function identity(
  provider: AuthIdentitySummary['provider'],
  overrides?: Partial<AuthIdentitySummary>
): AuthIdentitySummary {
  return {
    provider,
    identifier: null,
    usable: true,
    canBeUnlinked: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    verifiedAt: null,
    ...overrides,
  };
}

/** The account's only identity: nothing is removable. */
const SOLO_EMAIL = [identity('email', { identifier: 'j***@example.com', canBeUnlinked: false })];

beforeEach(() => {
  jest.clearAllMocks();
  mockedList.mockResolvedValue(SOLO_EMAIL);
  mockedUnlink.mockResolvedValue(SOLO_EMAIL);
  mockedLinkGoogle.mockResolvedValue(SOLO_EMAIL);
  mockedLinkWhatsApp.mockResolvedValue(SOLO_EMAIL);
  mockedSignInWithGoogle.mockResolvedValue({ status: 'success', idToken: 'google-id-token' });
});

describe('LinkedMethodsCard listing', () => {
  it('reads the canonical identities route on mount', async () => {
    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-email')).toBeTruthy());
    expect(mockedList).toHaveBeenCalledTimes(1);
  });

  it('renders a row for every supported login method', async () => {
    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-email')).toBeTruthy());
    expect(getByTestId('auth-method-google')).toBeTruthy();
    expect(getByTestId('auth-method-whatsapp')).toBeTruthy();
  });

  it('shows the masked identifier the backend returned', async () => {
    mockedList.mockResolvedValueOnce([
      identity('email', { identifier: 'j***@example.com', canBeUnlinked: false }),
      identity('whatsapp', { identifier: '+*********7890' }),
    ]);

    const { getByText } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByText('+*********7890')).toBeTruthy());
  });

  it('labels a linked identity with no displayable identifier without inventing one', async () => {
    mockedList.mockResolvedValueOnce([
      identity('email', { identifier: 'j***@example.com', canBeUnlinked: false }),
      identity('google', { identifier: null }),
    ]);

    const { getByText } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByText(/tanpa identitas yang bisa ditampilkan/)).toBeTruthy());
  });

  it('reports a real error instead of inventing linked methods when the call fails', async () => {
    mockedList.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'));

    const { getByTestId, queryByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-methods-error')).toBeTruthy());
    expect(queryByTestId('auth-method-email')).toBeNull();
  });

  it('retries the load on demand', async () => {
    mockedList.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'));
    mockedList.mockResolvedValueOnce([identity('email'), identity('whatsapp')]);

    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-methods-retry')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-methods-retry'));

    await waitFor(() => expect(getByTestId('auth-method-whatsapp')).toBeTruthy());
  });
});

describe('LinkedMethodsCard unlink', () => {
  it('offers no unlink control for the account only login method', async () => {
    // The lockout guard, as the viewer experiences it: there is no button to
    // press, and the row says why.
    const { getByTestId, queryByTestId, getByText } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-email')).toBeTruthy());

    expect(queryByTestId('auth-method-unlink-email')).toBeNull();
    expect(getByText(/satu-satunya cara kamu masuk/)).toBeTruthy();
  });

  it('respects a SERVER canBeUnlinked: false even with two methods linked', async () => {
    // The server flag is authoritative. The local count would say "two
    // methods, both removable"; the server says no, and the server wins.
    mockedList.mockResolvedValueOnce([
      identity('email', { canBeUnlinked: false }),
      identity('google', { canBeUnlinked: false }),
    ]);

    const { getByTestId, queryByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-google')).toBeTruthy());
    expect(queryByTestId('auth-method-unlink-google')).toBeNull();
  });

  it('offers unlink controls once a second method exists', async () => {
    mockedList.mockResolvedValueOnce([identity('email'), identity('google')]);

    const { getByTestId, queryByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-unlink-google')).toBeTruthy());
    // Email is never unlinkable from this surface: the backend rejects that
    // provider on the identity routes outright.
    expect(queryByTestId('auth-method-unlink-email')).toBeNull();
  });

  it('adopts the list the unlink call returned instead of re-fetching', async () => {
    // DELETE answers 200 with the caller's full updated identity list
    // precisely so the card does not need a second round trip - and so no
    // window exists in which the rendered canBeUnlinked flags are stale.
    mockedList.mockResolvedValueOnce([identity('email'), identity('google')]);
    mockedUnlink.mockResolvedValueOnce(SOLO_EMAIL);

    const { getByTestId, queryByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-unlink-google')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-unlink-google'));

    await waitFor(() => expect(mockedUnlink).toHaveBeenCalledWith('google'));
    await waitFor(() => expect(queryByTestId('auth-method-unlink-google')).toBeNull());
    // Exactly one GET, on mount. The unlink response replaced the list.
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalled();
  });

  it('reports AUTH_LAST_IDENTITY truthfully when a stale list submits anyway', async () => {
    mockedList.mockResolvedValueOnce([identity('email'), identity('google')]);
    mockedUnlink.mockRejectedValueOnce(
      new ApiError(409, 'AUTH_LAST_IDENTITY', 'Refused.')
    );

    const { getByTestId, getAllByText } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-unlink-google')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-unlink-google'));

    await waitFor(() => expect(getByTestId('auth-methods-unlink-error')).toBeTruthy());
    expect(getAllByText(/satu-satunya cara kamu masuk/).length).toBeGreaterThan(0);
    expect(mockShowToast).not.toHaveBeenCalled();
    // The row is still there: nothing was removed.
    expect(getByTestId('auth-method-google')).toBeTruthy();
  });

  it('reports AUTH_IDENTITY_NOT_FOUND distinctly from a generic failure', async () => {
    mockedList.mockResolvedValueOnce([identity('email'), identity('google')]);
    mockedUnlink.mockRejectedValueOnce(
      new ApiError(404, 'AUTH_IDENTITY_NOT_FOUND', 'Gone.')
    );

    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-unlink-google')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-unlink-google'));

    await waitFor(() =>
      expect(getByTestId('auth-methods-unlink-error')).toHaveTextContent(
        /sudah tidak terhubung/
      )
    );
  });
});

describe('LinkedMethodsCard Google linking', () => {
  it('offers a link control for every unlinked provider - the AUTH_ACCOUNT_LINK_REQUIRED recovery path', async () => {
    const { getByTestId, queryByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-link-google')).toBeTruthy());
    expect(getByTestId('auth-method-link-whatsapp')).toBeTruthy();
    // No link control for email: registration is the only thing that
    // creates an email identity.
    expect(queryByTestId('auth-method-link-email')).toBeNull();
  });

  it('runs the native sheet and exchanges the token at the LINK route, not the sign-in route', async () => {
    const linked = [
      identity('email', { canBeUnlinked: false }),
      identity('google', { identifier: 'j***@example.com' }),
    ];
    mockedLinkGoogle.mockResolvedValueOnce(linked);

    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-link-google')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-link-google'));

    await waitFor(() => expect(mockedLinkGoogle).toHaveBeenCalledWith('google-id-token'));
    // Adopts the returned list rather than re-reading.
    await waitFor(() => expect(getByTestId('auth-method-unlink-google')).toBeTruthy());
    expect(mockedList).toHaveBeenCalledTimes(1);
    expect(mockShowToast).toHaveBeenCalled();
  });

  it('says nothing when the viewer dismisses the Google sheet', async () => {
    mockedSignInWithGoogle.mockResolvedValueOnce({ status: 'cancelled' });

    const { getByTestId, queryByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-link-google')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-link-google'));

    await waitFor(() => expect(mockedSignInWithGoogle).toHaveBeenCalled());
    expect(mockedLinkGoogle).not.toHaveBeenCalled();
    expect(queryByTestId('auth-methods-unlink-error')).toBeNull();
  });

  it('reports AUTH_IDENTITY_ALREADY_LINKED as "that identity belongs to another account"', async () => {
    // The security-relevant refusal: the backend never transfers an
    // identity, so the resolution is on the OTHER account.
    mockedLinkGoogle.mockRejectedValueOnce(
      new ApiError(409, 'AUTH_IDENTITY_ALREADY_LINKED', 'Owned elsewhere.')
    );

    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-link-google')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-link-google'));

    await waitFor(() =>
      expect(getByTestId('auth-methods-unlink-error')).toHaveTextContent(
        /sudah dipakai akun Red Panda lain/
      )
    );
  });

  it('reports AUTH_PROVIDER_ALREADY_LINKED as a DIFFERENT message', async () => {
    mockedLinkGoogle.mockRejectedValueOnce(
      new ApiError(409, 'AUTH_PROVIDER_ALREADY_LINKED', 'Already have one.')
    );

    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-link-google')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-link-google'));

    await waitFor(() =>
      expect(getByTestId('auth-methods-unlink-error')).toHaveTextContent(
        /sudah punya metode login tersebut/
      )
    );
  });

  it('reports a server with Google switched off as exactly that', async () => {
    mockedLinkGoogle.mockRejectedValueOnce(
      new ApiError(503, 'GOOGLE_AUTH_DISABLED', 'Off.')
    );

    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-link-google')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-link-google'));

    await waitFor(() =>
      expect(getByTestId('auth-methods-unlink-error')).toHaveTextContent(/belum aktif di server/)
    );
  });
});

describe('LinkedMethodsCard WhatsApp linking', () => {
  it('opens a bounded link form rather than the sign-in flow', async () => {
    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-link-whatsapp')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-link-whatsapp'));

    await waitFor(() => expect(getByTestId('auth-method-link-whatsapp-form')).toBeTruthy());
    expect(getByTestId('auth-method-link-whatsapp-phone')).toBeTruthy();
  });

  it('closes the form on cancel without touching the account', async () => {
    const { getByTestId, queryByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-link-whatsapp')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-link-whatsapp'));
    await waitFor(() => expect(getByTestId('auth-method-link-whatsapp-form')).toBeTruthy());

    await fireEvent.press(getByTestId('auth-method-link-whatsapp-cancel'));

    await waitFor(() => expect(queryByTestId('auth-method-link-whatsapp-form')).toBeNull());
    expect(mockedLinkWhatsApp).not.toHaveBeenCalled();
  });
});
