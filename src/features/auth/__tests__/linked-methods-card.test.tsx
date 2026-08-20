import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { LinkedMethodsCard } from '@/features/auth/linked-methods-card';
import { ApiError } from '@/services/api/client';
import {
  listLinkedAuthMethods,
  unlinkAuthMethod,
} from '@/services/auth/provider-auth-service';
import type { LinkedAuthMethod } from '@/types/auth';

jest.mock('@/services/auth/provider-auth-service');

const mockShowToast = jest.fn();

jest.mock('@/stores/toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

const mockedList = listLinkedAuthMethods as jest.MockedFunction<typeof listLinkedAuthMethods>;
const mockedUnlink = unlinkAuthMethod as jest.MockedFunction<typeof unlinkAuthMethod>;

function method(
  provider: LinkedAuthMethod['provider'],
  label: string | null = null
): LinkedAuthMethod {
  return { provider, label, linkedAt: '2026-08-01T00:00:00.000Z' };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedList.mockResolvedValue([method('email', 'j***@example.com')]);
  mockedUnlink.mockResolvedValue(undefined);
});

describe('LinkedMethodsCard', () => {
  it('renders a row for every supported login method', async () => {
    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-email')).toBeTruthy());
    expect(getByTestId('auth-method-google')).toBeTruthy();
    expect(getByTestId('auth-method-whatsapp')).toBeTruthy();
  });

  it('offers no unlink control for the account only login method', async () => {
    // The lockout guard, as the viewer experiences it: there is no button to
    // press, and the row says why.
    const { getByTestId, queryByTestId, getByText } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-email')).toBeTruthy());

    expect(queryByTestId('auth-method-unlink-email')).toBeNull();
    expect(getByText(/satu-satunya cara kamu masuk/)).toBeTruthy();
  });

  it('offers unlink controls once a second method exists', async () => {
    mockedList.mockResolvedValueOnce([method('email'), method('google')]);

    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-unlink-email')).toBeTruthy());
    expect(getByTestId('auth-method-unlink-google')).toBeTruthy();
  });

  it('unlinks through the provider service and re-reads the authoritative list', async () => {
    mockedList.mockResolvedValueOnce([method('email'), method('google')]);
    mockedList.mockResolvedValueOnce([method('email')]);

    const { getByTestId, queryByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-unlink-google')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-unlink-google'));

    await waitFor(() => expect(mockedUnlink).toHaveBeenCalledWith('google'));
    // Re-read, not a local mutation: removing one method can change what
    // else may be unlinked, and only the server knows.
    await waitFor(() => expect(mockedList).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(queryByTestId('auth-method-unlink-email')).toBeNull());
    expect(mockShowToast).toHaveBeenCalled();
  });

  it('reports a real error instead of inventing linked methods when the call fails', async () => {
    // The backend contract is not landed yet. A failure has to look like a
    // failure - never like an account with no methods, and never like a
    // fabricated list.
    mockedList.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'));

    const { getByTestId, queryByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-methods-error')).toBeTruthy());
    expect(queryByTestId('auth-method-email')).toBeNull();
  });

  it('retries the load on demand', async () => {
    mockedList.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'));
    mockedList.mockResolvedValueOnce([method('email'), method('whatsapp')]);

    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-methods-retry')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-methods-retry'));

    await waitFor(() => expect(getByTestId('auth-method-whatsapp')).toBeTruthy());
  });

  it('reports a failed unlink without pretending it succeeded', async () => {
    mockedList.mockResolvedValueOnce([method('email'), method('google')]);
    mockedUnlink.mockRejectedValueOnce(new ApiError(409, 'LAST_AUTH_METHOD', 'Refused.'));

    const { getByTestId } = await render(<LinkedMethodsCard />);

    await waitFor(() => expect(getByTestId('auth-method-unlink-google')).toBeTruthy());
    await fireEvent.press(getByTestId('auth-method-unlink-google'));

    await waitFor(() => expect(getByTestId('auth-methods-unlink-error')).toBeTruthy());
    expect(mockShowToast).not.toHaveBeenCalled();
    // The row is still there: nothing was removed.
    expect(getByTestId('auth-method-google')).toBeTruthy();
  });
});
