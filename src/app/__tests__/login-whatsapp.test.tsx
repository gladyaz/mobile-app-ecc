import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import WhatsAppLoginScreen from '@/app/login-whatsapp';
import { ApiError } from '@/services/api/client';
import { startWhatsAppOtp } from '@/services/auth/provider-auth-service';
import type { OtpChallenge } from '@/types/auth';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const mockLoginWithWhatsApp = jest.fn();

jest.mock('@/stores/auth', () => ({
  useAuth: () => ({
    loginWithWhatsApp: mockLoginWithWhatsApp,
    isAuthenticated: false,
    isHydrated: true,
    user: null,
  }),
}));

const mockShowToast = jest.fn();

jest.mock('@/stores/toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

// Mocked at the provider-auth service boundary: WhatsApp DELIVERY is never
// exercised here, and these tests claim nothing about it.
jest.mock('@/services/auth/provider-auth-service');

const mockedStartWhatsAppOtp = startWhatsAppOtp as jest.MockedFunction<typeof startWhatsAppOtp>;

function buildChallenge(overrides?: Partial<OtpChallenge>): OtpChallenge {
  return {
    challengeId: 'challenge_1',
    expiresInSeconds: 300,
    resendAvailableInSeconds: 30,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedStartWhatsAppOtp.mockResolvedValue(buildChallenge());
  mockLoginWithWhatsApp.mockResolvedValue(undefined);
});

async function reachOtpStep(national = '81234567890') {
  const screen = await render(<WhatsAppLoginScreen />);

  await fireEvent.changeText(screen.getByTestId('whatsapp-phone-input'), national);
  await fireEvent.press(screen.getByTestId('whatsapp-send-code'));
  await waitFor(() => expect(screen.getByTestId('whatsapp-otp-input')).toBeTruthy());

  return screen;
}

describe('WhatsApp phone step', () => {
  it('exposes the stable identifiers automation depends on', async () => {
    const { getByTestId } = await render(<WhatsAppLoginScreen />);

    expect(getByTestId('whatsapp-phone-input')).toBeTruthy();
    expect(getByTestId('whatsapp-send-code')).toBeTruthy();
  });

  it('sends the number normalized to E.164, whichever way it was typed', async () => {
    const { getByTestId } = await render(<WhatsAppLoginScreen />);

    await fireEvent.changeText(getByTestId('whatsapp-phone-input'), '0812-3456-7890');
    await fireEvent.press(getByTestId('whatsapp-send-code'));

    await waitFor(() => expect(mockedStartWhatsAppOtp).toHaveBeenCalledWith('+6281234567890'));
  });

  it('requires a number before calling the backend', async () => {
    const { getByTestId } = await render(<WhatsAppLoginScreen />);

    await fireEvent.press(getByTestId('whatsapp-send-code'));

    await waitFor(() => expect(getByTestId('whatsapp-phone-input-error')).toBeTruthy());
    expect(mockedStartWhatsAppOtp).not.toHaveBeenCalled();
  });

  it('rejects an invalid number before calling the backend', async () => {
    const { getByTestId } = await render(<WhatsAppLoginScreen />);

    await fireEvent.changeText(getByTestId('whatsapp-phone-input'), '12345');
    await fireEvent.press(getByTestId('whatsapp-send-code'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-phone-input-error')).toHaveTextContent(
        'Nomor WhatsApp tidak valid'
      )
    );
    expect(mockedStartWhatsAppOtp).not.toHaveBeenCalled();
  });

  it('shows a rate-limit message instead of a generic failure on 429', async () => {
    mockedStartWhatsAppOtp.mockRejectedValueOnce(new ApiError(429, 'HTTP_ERROR', 'Slow down.'));

    const { getByTestId } = await render(<WhatsAppLoginScreen />);

    await fireEvent.changeText(getByTestId('whatsapp-phone-input'), '81234567890');
    await fireEvent.press(getByTestId('whatsapp-send-code'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-error')).toHaveTextContent(/Terlalu banyak permintaan/)
    );
  });

  it('stays on the phone step when the code could not be sent', async () => {
    mockedStartWhatsAppOtp.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'));

    const { getByTestId, queryByTestId } = await render(<WhatsAppLoginScreen />);

    await fireEvent.changeText(getByTestId('whatsapp-phone-input'), '81234567890');
    await fireEvent.press(getByTestId('whatsapp-send-code'));

    await waitFor(() => expect(getByTestId('whatsapp-error')).toBeTruthy());
    expect(queryByTestId('whatsapp-otp-input')).toBeNull();
  });

  it('advances to the code step for any number, revealing nothing about accounts', async () => {
    // ANTI-ENUMERATION: an unregistered number and a registered one must be
    // indistinguishable here. The screen has no branch that could differ,
    // and this test pins that: same call, same next step, either way.
    const { getByTestId, queryByText } = await reachOtpStep('81100000000');

    expect(getByTestId('whatsapp-verify')).toBeTruthy();
    expect(queryByText(/belum terdaftar|sudah terdaftar|not registered/i)).toBeNull();
  });
});

describe('WhatsApp OTP step', () => {
  it('exposes the stable identifiers automation depends on', async () => {
    const { getByTestId } = await reachOtpStep();

    expect(getByTestId('whatsapp-otp-input')).toBeTruthy();
    expect(getByTestId('whatsapp-verify')).toBeTruthy();
    expect(getByTestId('whatsapp-resend')).toBeTruthy();
    expect(getByTestId('whatsapp-change-number')).toBeTruthy();
  });

  it('shows the masked destination number, not the raw one', async () => {
    const { getByText, queryByText } = await reachOtpStep();

    expect(getByText(/\+6281\*+7890/)).toBeTruthy();
    expect(queryByText(/\+6281234567890/)).toBeNull();
  });

  it('verifies the code against the challenge and enters the session', async () => {
    const { getByTestId } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '123456');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    await waitFor(() =>
      expect(mockLoginWithWhatsApp).toHaveBeenCalledWith('challenge_1', '123456')
    );
    expect(router.replace).toHaveBeenCalledWith('/profile');
    expect(mockShowToast).toHaveBeenCalledWith('Selamat datang!');
  });

  it('requires a complete code before calling the backend', async () => {
    const { getByTestId } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '123');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-otp-input-error')).toHaveTextContent('Kode terdiri dari 6 digit')
    );
    expect(mockLoginWithWhatsApp).not.toHaveBeenCalled();
  });

  it('reports a wrong code distinctly from an expired one', async () => {
    mockLoginWithWhatsApp.mockRejectedValueOnce(new ApiError(401, 'OTP_INVALID', 'Nope.'));

    const { getByTestId } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '000000');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    await waitFor(() => expect(getByTestId('whatsapp-error')).toHaveTextContent(/Kode salah/));
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('tells the viewer to request a new code when this one expired', async () => {
    mockLoginWithWhatsApp.mockRejectedValueOnce(new ApiError(410, 'OTP_EXPIRED', 'Gone.'));

    const { getByTestId } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '123456');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-error')).toHaveTextContent(/kedaluwarsa/)
    );
  });

  it('reports the per-challenge attempt cap', async () => {
    mockLoginWithWhatsApp.mockRejectedValueOnce(
      new ApiError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Too many.')
    );

    const { getByTestId } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '123456');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-error')).toHaveTextContent(/Terlalu banyak percobaan/)
    );
  });

  it('reports an unexpected failure generically', async () => {
    mockLoginWithWhatsApp.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'));

    const { getByTestId } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '123456');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-error')).toHaveTextContent(/Verifikasi gagal/)
    );
  });
});

describe('resend countdown', () => {
  it('locks resend for the number of seconds the backend asked for', async () => {
    const { getByTestId } = await reachOtpStep();

    // The countdown comes from `resendAvailableInSeconds` (30 above), not a
    // client-side constant.
    expect(getByTestId('whatsapp-resend')).toHaveTextContent('Kirim ulang kode dalam 30s');
    expect(getByTestId('whatsapp-resend').props.accessibilityState.disabled).toBe(true);
  });

  it('unlocks resend once the countdown reaches zero', async () => {
    jest.useFakeTimers();

    try {
      const { getByTestId } = await reachOtpStep();

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });

      await waitFor(() =>
        expect(getByTestId('whatsapp-resend')).toHaveTextContent('Kirim ulang kode')
      );
      expect(getByTestId('whatsapp-resend').props.accessibilityState.disabled).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('requests a fresh challenge on resend and confirms it to the viewer', async () => {
    jest.useFakeTimers();

    try {
      const { getByTestId } = await reachOtpStep();
      mockedStartWhatsAppOtp.mockResolvedValueOnce(
        buildChallenge({ challengeId: 'challenge_2', resendAvailableInSeconds: 45 })
      );

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      await fireEvent.press(getByTestId('whatsapp-resend'));

      await waitFor(() => expect(mockedStartWhatsAppOtp).toHaveBeenCalledTimes(2));
      // Same number, no re-entry required.
      expect(mockedStartWhatsAppOtp).toHaveBeenLastCalledWith('+6281234567890');
      expect(mockShowToast).toHaveBeenCalledWith('Kode baru sudah dikirim.');
    } finally {
      jest.useRealTimers();
    }
  });

  it('verifies against the NEW challenge after a resend', async () => {
    jest.useFakeTimers();

    try {
      const { getByTestId } = await reachOtpStep();
      mockedStartWhatsAppOtp.mockResolvedValueOnce(buildChallenge({ challengeId: 'challenge_2' }));

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      await fireEvent.press(getByTestId('whatsapp-resend'));
      await waitFor(() => expect(mockedStartWhatsAppOtp).toHaveBeenCalledTimes(2));

      await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '654321');
      await fireEvent.press(getByTestId('whatsapp-verify'));

      await waitFor(() =>
        expect(mockLoginWithWhatsApp).toHaveBeenCalledWith('challenge_2', '654321')
      );
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('resend failure handling', () => {
  it('keeps an already-typed code when the resend fails', async () => {
    jest.useFakeTimers();

    try {
      const { getByTestId } = await reachOtpStep();

      // The viewer typed the code from the FIRST message before pressing
      // resend. A failed resend must not throw it away - the original
      // challenge is still the valid one.
      await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '123456');
      mockedStartWhatsAppOtp.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'));

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      await fireEvent.press(getByTestId('whatsapp-resend'));

      await waitFor(() => expect(getByTestId('whatsapp-error')).toBeTruthy());
      expect(getByTestId('whatsapp-otp-input').props.value).toBe('123456');
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-locks resend after a rate-limited resend instead of inviting another 429', async () => {
    jest.useFakeTimers();

    try {
      const { getByTestId } = await reachOtpStep();
      mockedStartWhatsAppOtp.mockRejectedValueOnce(
        new ApiError(429, 'HTTP_ERROR', 'Slow down.')
      );

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      expect(getByTestId('whatsapp-resend').props.accessibilityState.disabled).toBe(false);

      await fireEvent.press(getByTestId('whatsapp-resend'));

      await waitFor(() =>
        expect(getByTestId('whatsapp-error')).toHaveTextContent(/Terlalu banyak permintaan/)
      );
      // Re-locked using the still-active challenge's own countdown.
      expect(getByTestId('whatsapp-resend').props.accessibilityState.disabled).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not clear the code when the resend is only rate-limited', async () => {
    jest.useFakeTimers();

    try {
      const { getByTestId } = await reachOtpStep();

      await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '654321');
      mockedStartWhatsAppOtp.mockRejectedValueOnce(
        new ApiError(429, 'HTTP_ERROR', 'Slow down.')
      );

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      await fireEvent.press(getByTestId('whatsapp-resend'));

      await waitFor(() => expect(getByTestId('whatsapp-error')).toBeTruthy());
      expect(getByTestId('whatsapp-otp-input').props.value).toBe('654321');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('malformed challenge payloads', () => {
  it('stays on the phone step and reports a failure when the challenge is unusable', async () => {
    // `startWhatsAppOtp` validates the payload and throws, so the screen
    // never reaches a code step backed by a challenge it cannot use.
    mockedStartWhatsAppOtp.mockRejectedValueOnce(
      new ApiError(0, 'INVALID_RESPONSE', 'Bad shape.')
    );

    const { getByTestId, queryByTestId } = await render(<WhatsAppLoginScreen />);

    await fireEvent.changeText(getByTestId('whatsapp-phone-input'), '81234567890');
    await fireEvent.press(getByTestId('whatsapp-send-code'));

    await waitFor(() => expect(getByTestId('whatsapp-error')).toBeTruthy());
    expect(queryByTestId('whatsapp-otp-input')).toBeNull();
  });

  it('never renders a NaN countdown, even for a zero-second resend window', async () => {
    // Regression guard for the countdown: anything non-finite reaching the
    // hook used to render "Kirim ulang kode dalam NaNs" and disable resend
    // permanently.
    mockedStartWhatsAppOtp.mockResolvedValueOnce(
      buildChallenge({ resendAvailableInSeconds: 0 })
    );

    const { getByTestId } = await reachOtpStep();

    expect(getByTestId('whatsapp-resend')).toHaveTextContent('Kirim ulang kode');
    expect(getByTestId('whatsapp-resend').props.accessibilityState.disabled).toBe(false);
  });
});

describe('changing the number', () => {
  it('returns to the phone step without keeping the old challenge', async () => {
    const { getByTestId, queryByTestId } = await reachOtpStep();

    await fireEvent.press(getByTestId('whatsapp-change-number'));

    await waitFor(() => expect(getByTestId('whatsapp-phone-input')).toBeTruthy());
    expect(queryByTestId('whatsapp-otp-input')).toBeNull();
  });
});
