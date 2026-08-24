import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import WhatsAppLoginScreen from '@/app/login-whatsapp';
import { ApiError } from '@/services/api/client';
import { startWhatsAppOtp } from '@/services/auth/provider-auth-service';
import type { OtpChallenge } from '@/types/auth';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  // The screen redirects rather than rendering when WhatsApp sign-in is not
  // offered, so the mock has to provide a real component for that path.
  Redirect: ({ href }: { href: string }) => {
    const { Text } = jest.requireActual('react-native') as typeof import('react-native');

    return <Text testID="whatsapp-redirect">{href}</Text>;
  },
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
  // No challenge id: the canonical contract makes the PHONE NUMBER the
  // handle, because at most one challenge is live per number.
  return {
    expiresInSeconds: 300,
    resendAvailableInSeconds: 30,
    ...overrides,
  };
}

// The WhatsApp entry point is gated OFF by default for V1 - the backend cannot
// serve it - and the screen itself redirects when it is not offered, so a deep
// link cannot reach the form. Every case here is about the form's behaviour
// once the method IS offered, so the flag is on for the suite; the dedicated
// case below pins the default.
const ORIGINAL_WHATSAPP_FLAG = process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED;

afterAll(() => {
  if (ORIGINAL_WHATSAPP_FLAG === undefined) {
    delete process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED;
  } else {
    process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = ORIGINAL_WHATSAPP_FLAG;
  }
});

beforeEach(() => {
  process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED = 'true';
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

  it('treats the per-number resend cooldown as a rate limit too', async () => {
    // Two different limiters can answer 429 on the START route: the per-IP
    // route throttle (generic `HTTP_ERROR`) and the per-number cooldown
    // (`OTP_RESEND_COOLDOWN`). Status is checked before code so both land
    // on the same honest advice.
    mockedStartWhatsAppOtp.mockRejectedValueOnce(
      new ApiError(429, 'OTP_RESEND_COOLDOWN', 'Cooling down.')
    );

    const { getByTestId } = await render(<WhatsAppLoginScreen />);

    await fireEvent.changeText(getByTestId('whatsapp-phone-input'), '81234567890');
    await fireEvent.press(getByTestId('whatsapp-send-code'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-error')).toHaveTextContent(/Terlalu banyak permintaan/)
    );
  });

  it('reports a server with WhatsApp switched off when starting a challenge', async () => {
    mockedStartWhatsAppOtp.mockRejectedValueOnce(
      new ApiError(503, 'WHATSAPP_AUTH_DISABLED', 'Off.')
    );

    const { getByTestId } = await render(<WhatsAppLoginScreen />);

    await fireEvent.changeText(getByTestId('whatsapp-phone-input'), '81234567890');
    await fireEvent.press(getByTestId('whatsapp-send-code'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-error')).toHaveTextContent(/belum aktif di server/)
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

  it('verifies the code against the PHONE NUMBER and enters the session', async () => {
    const { getByTestId } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '123456');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    // The normalized E.164 number is the challenge handle - the same value
    // the challenge was started with.
    await waitFor(() =>
      expect(mockLoginWithWhatsApp).toHaveBeenCalledWith('+6281234567890', '123456')
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

  it('reports one generic message for a rejected code, whatever the cause', async () => {
    // The backend answers a SINGLE `INVALID_OTP` for wrong / expired /
    // attempts-exhausted / already-used / no-such-challenge. The message
    // must cover all of them without implying which - splitting it would
    // report an attacker's guessing progress and would turn verification
    // into a phone-number enumeration oracle.
    mockLoginWithWhatsApp.mockRejectedValueOnce(new ApiError(401, 'INVALID_OTP', 'Nope.'));

    const { getByTestId } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '000000');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-error')).toHaveTextContent(
        'Kode salah atau sudah kedaluwarsa. Minta kode baru.'
      )
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('leaks no challenge or account state in the rejected-code message', async () => {
    mockLoginWithWhatsApp.mockRejectedValueOnce(new ApiError(401, 'INVALID_OTP', 'Nope.'));

    const { getByTestId, queryByText } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '000000');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    await waitFor(() => expect(getByTestId('whatsapp-error')).toBeTruthy());
    // Nothing that would distinguish "expired" from "too many attempts"
    // from "no challenge exists for this number".
    expect(
      queryByText(/percobaan|belum terdaftar|tidak ditemukan|not registered|attempts/i)
    ).toBeNull();
  });

  it('keeps a distinct message for the per-IP verify throttle', async () => {
    // NOT the same condition as a rejected code, and NOT the resend
    // cooldown (that one is a 429 on the START route). The framework
    // throttler emits the generic `HTTP_ERROR` code, so status is the only
    // reliable signal here.
    mockLoginWithWhatsApp.mockRejectedValueOnce(new ApiError(429, 'HTTP_ERROR', 'Slow down.'));

    const { getByTestId } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '123456');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-error')).toHaveTextContent(/Terlalu banyak percobaan/)
    );
  });

  it('reports a server with WhatsApp switched off as exactly that', async () => {
    mockLoginWithWhatsApp.mockRejectedValueOnce(
      new ApiError(503, 'WHATSAPP_AUTH_DISABLED', 'Off.')
    );

    const { getByTestId } = await reachOtpStep();

    await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '123456');
    await fireEvent.press(getByTestId('whatsapp-verify'));

    await waitFor(() =>
      expect(getByTestId('whatsapp-error')).toHaveTextContent(/belum aktif di server/)
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
        buildChallenge({ resendAvailableInSeconds: 45 })
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

  it('still verifies against the same number after a resend', async () => {
    // A resend retires the old code and issues a new one for the SAME
    // number, so the handle never changes - which is exactly why a
    // challenge id would have been a second key for one row.
    jest.useFakeTimers();

    try {
      const { getByTestId } = await reachOtpStep();
      mockedStartWhatsAppOtp.mockResolvedValueOnce(buildChallenge());

      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      await fireEvent.press(getByTestId('whatsapp-resend'));
      await waitFor(() => expect(mockedStartWhatsAppOtp).toHaveBeenCalledTimes(2));

      await fireEvent.changeText(getByTestId('whatsapp-otp-input'), '654321');
      await fireEvent.press(getByTestId('whatsapp-verify'));

      await waitFor(() =>
        expect(mockLoginWithWhatsApp).toHaveBeenCalledWith('+6281234567890', '654321')
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

describe('WhatsApp screen is unreachable when the method is not offered', () => {
  it('redirects to /login instead of rendering the form', async () => {
    // `_layout.tsx` registers this as a real route and app.json declares the
    // mobileappecc scheme, so mobileappecc://login-whatsapp reaches this screen
    // whatever the login screen rendered. Without this guard a store build
    // would show a working phone-number form for a method whose backend
    // answers every request with 503.
    delete process.env.EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED;

    const { getByTestId, queryByTestId } = await render(<WhatsAppLoginScreen />);

    expect(getByTestId('whatsapp-redirect')).toHaveTextContent('/login');
    expect(queryByTestId('whatsapp-phone-input')).toBeNull();
    expect(queryByTestId('whatsapp-send-code')).toBeNull();
  });
});
