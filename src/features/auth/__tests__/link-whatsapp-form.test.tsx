import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { LinkWhatsAppForm } from '@/features/auth/link-whatsapp-form';
import { ApiError } from '@/services/api/client';
import {
  linkWhatsAppIdentity,
  startWhatsAppOtp,
  verifyWhatsAppOtp,
} from '@/services/auth/provider-auth-service';
import type { AuthIdentitySummary } from '@/types/auth';

// Mocked at the provider-auth boundary: no WhatsApp message is ever sent
// here, and these tests claim nothing about delivery.
jest.mock('@/services/auth/provider-auth-service');

const mockedStart = startWhatsAppOtp as jest.MockedFunction<typeof startWhatsAppOtp>;
const mockedLink = linkWhatsAppIdentity as jest.MockedFunction<typeof linkWhatsAppIdentity>;
const mockedVerify = verifyWhatsAppOtp as jest.MockedFunction<typeof verifyWhatsAppOtp>;

const LINKED: readonly AuthIdentitySummary[] = [
  {
    provider: 'whatsapp',
    identifier: '+*********7890',
    usable: true,
    canBeUnlinked: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    verifiedAt: '2026-08-01T00:00:00.000Z',
  },
];

async function renderForm() {
  const onLinked = jest.fn();
  const onCancel = jest.fn();
  const screen = await render(<LinkWhatsAppForm onCancel={onCancel} onLinked={onLinked} />);

  return { ...screen, onLinked, onCancel };
}

async function reachCodeStep() {
  const screen = await renderForm();

  await fireEvent.changeText(screen.getByTestId('auth-method-link-whatsapp-phone'), '81234567890');
  await fireEvent.press(screen.getByTestId('auth-method-link-whatsapp-send'));
  await waitFor(() => expect(screen.getByTestId('auth-method-link-whatsapp-code')).toBeTruthy());

  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedStart.mockResolvedValue({ expiresInSeconds: 300, resendAvailableInSeconds: 30 });
  mockedLink.mockResolvedValue(LINKED);
});

describe('LinkWhatsAppForm', () => {
  it('starts the challenge with the number normalized to E.164', async () => {
    const { getByTestId } = await renderForm();

    await fireEvent.changeText(getByTestId('auth-method-link-whatsapp-phone'), '0812-3456-7890');
    await fireEvent.press(getByTestId('auth-method-link-whatsapp-send'));

    await waitFor(() => expect(mockedStart).toHaveBeenCalledWith('+6281234567890'));
  });

  it('rejects an invalid number before calling the backend', async () => {
    const { getByTestId } = await renderForm();

    await fireEvent.changeText(getByTestId('auth-method-link-whatsapp-phone'), '12345');
    await fireEvent.press(getByTestId('auth-method-link-whatsapp-send'));

    await waitFor(() =>
      expect(getByTestId('auth-method-link-whatsapp-phone-error')).toBeTruthy()
    );
    expect(mockedStart).not.toHaveBeenCalled();
  });

  it('finishes at the LINK route and NEVER at the sign-in verify route', async () => {
    // THE rule this component exists for. Both consume the same challenge,
    // so calling verify here would sign the viewer out of the account they
    // are extending and into the phone's own account instead.
    const { getByTestId, onLinked } = await reachCodeStep();

    await fireEvent.changeText(getByTestId('auth-method-link-whatsapp-code'), '123456');
    await fireEvent.press(getByTestId('auth-method-link-whatsapp-confirm'));

    await waitFor(() => expect(mockedLink).toHaveBeenCalledWith('+6281234567890', '123456'));
    expect(mockedVerify).not.toHaveBeenCalled();
    expect(onLinked).toHaveBeenCalledWith(LINKED);
  });

  it('will not submit an incomplete code', async () => {
    const { getByTestId } = await reachCodeStep();

    await fireEvent.changeText(getByTestId('auth-method-link-whatsapp-code'), '123');
    await fireEvent.press(getByTestId('auth-method-link-whatsapp-confirm'));

    await waitFor(() => expect(mockedLink).not.toHaveBeenCalled());
  });

  it('reports a number already owned by another account as exactly that', async () => {
    mockedLink.mockRejectedValueOnce(
      new ApiError(409, 'AUTH_IDENTITY_ALREADY_LINKED', 'Owned elsewhere.')
    );

    const { getByTestId, onLinked } = await reachCodeStep();

    await fireEvent.changeText(getByTestId('auth-method-link-whatsapp-code'), '123456');
    await fireEvent.press(getByTestId('auth-method-link-whatsapp-confirm'));

    await waitFor(() =>
      expect(getByTestId('auth-method-link-whatsapp-error')).toHaveTextContent(
        /sudah dipakai akun Red Panda lain/
      )
    );
    expect(onLinked).not.toHaveBeenCalled();
  });

  it('reports a rejected code with the one generic OTP message', async () => {
    mockedLink.mockRejectedValueOnce(new ApiError(401, 'INVALID_OTP', 'No.'));

    const { getByTestId } = await reachCodeStep();

    await fireEvent.changeText(getByTestId('auth-method-link-whatsapp-code'), '000000');
    await fireEvent.press(getByTestId('auth-method-link-whatsapp-confirm'));

    await waitFor(() =>
      expect(getByTestId('auth-method-link-whatsapp-error')).toHaveTextContent(
        'Kode salah atau sudah kedaluwarsa. Minta kode baru.'
      )
    );
  });

  it('stays on the phone step and reports a rate limit rather than advancing', async () => {
    mockedStart.mockRejectedValueOnce(new ApiError(429, 'HTTP_ERROR', 'Slow down.'));

    const { getByTestId, queryByTestId } = await renderForm();

    await fireEvent.changeText(getByTestId('auth-method-link-whatsapp-phone'), '81234567890');
    await fireEvent.press(getByTestId('auth-method-link-whatsapp-send'));

    await waitFor(() =>
      expect(getByTestId('auth-method-link-whatsapp-error')).toHaveTextContent(
        /Terlalu banyak permintaan/
      )
    );
    expect(queryByTestId('auth-method-link-whatsapp-code')).toBeNull();
  });

  it('locks resend for the countdown the backend asked for', async () => {
    const { getByTestId } = await reachCodeStep();

    expect(
      getByTestId('auth-method-link-whatsapp-resend').props.accessibilityState.disabled
    ).toBe(true);
  });

  it('cancels without touching the account', async () => {
    const { getByTestId, onCancel } = await renderForm();

    await fireEvent.press(getByTestId('auth-method-link-whatsapp-cancel'));

    expect(onCancel).toHaveBeenCalled();
    expect(mockedStart).not.toHaveBeenCalled();
    expect(mockedLink).not.toHaveBeenCalled();
  });
});
