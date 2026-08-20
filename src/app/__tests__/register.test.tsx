import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import RegisterScreen from '@/app/register';
import { ApiError } from '@/services/api/client';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
}));

const mockRegisterWithEmail = jest.fn();

jest.mock('@/stores/auth', () => ({
  useAuth: () => ({
    registerWithEmail: mockRegisterWithEmail,
    isAuthenticated: false,
    isHydrated: true,
    user: null,
  }),
}));

const mockShowToast = jest.fn();

jest.mock('@/stores/toast', () => ({
  useToast: () => ({ showToast: mockShowToast }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockRegisterWithEmail.mockResolvedValue(undefined);
});

async function fillForm(
  getByTestId: (id: string) => unknown,
  values: { email?: string; password?: string; confirm?: string }
) {
  const target = getByTestId as (id: string) => Parameters<typeof fireEvent.changeText>[0];

  if (values.email !== undefined) {
    await fireEvent.changeText(target('register-email-input'), values.email);
  }

  if (values.password !== undefined) {
    await fireEvent.changeText(target('register-password-input'), values.password);
  }

  if (values.confirm !== undefined) {
    await fireEvent.changeText(target('register-confirm-password-input'), values.confirm);
  }
}

describe('RegisterScreen semantics', () => {
  it('exposes stable identifiers for the whole registration form', async () => {
    const { getByTestId } = await render(<RegisterScreen />);

    expect(getByTestId('register-email-input')).toBeTruthy();
    expect(getByTestId('register-password-input')).toBeTruthy();
    expect(getByTestId('register-confirm-password-input')).toBeTruthy();
    expect(getByTestId('register-submit')).toBeTruthy();
    expect(getByTestId('register-back-to-login')).toBeTruthy();
  });
});

describe('explicit registration', () => {
  it('creates the account and signs straight in', async () => {
    const { getByTestId } = await render(<RegisterScreen />);

    await fillForm(getByTestId, {
      email: '  jane@example.com ',
      password: 'password123',
      confirm: 'password123',
    });
    await fireEvent.press(getByTestId('register-submit'));

    await waitFor(() =>
      expect(mockRegisterWithEmail).toHaveBeenCalledWith('jane@example.com', 'password123')
    );
    expect(router.replace).toHaveBeenCalledWith('/profile');
    expect(mockShowToast).toHaveBeenCalledWith('Akun kamu siap!');
  });

  it('tells the viewer to sign in instead when the email is already registered', async () => {
    mockRegisterWithEmail.mockRejectedValueOnce(
      new ApiError(409, 'EMAIL_ALREADY_REGISTERED', 'Taken.')
    );

    const { getByTestId } = await render(<RegisterScreen />);

    await fillForm(getByTestId, {
      email: 'jane@example.com',
      password: 'password123',
      confirm: 'password123',
    });
    await fireEvent.press(getByTestId('register-submit'));

    await waitFor(() =>
      expect(getByTestId('register-error')).toHaveTextContent(/sudah terdaftar/)
    );
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('reports any other failure generically', async () => {
    mockRegisterWithEmail.mockRejectedValueOnce(new ApiError(0, 'NETWORK_ERROR', 'Offline.'));

    const { getByTestId } = await render(<RegisterScreen />);

    await fillForm(getByTestId, {
      email: 'jane@example.com',
      password: 'password123',
      confirm: 'password123',
    });
    await fireEvent.press(getByTestId('register-submit'));

    await waitFor(() =>
      expect(getByTestId('register-error')).toHaveTextContent(/Pendaftaran gagal/)
    );
  });
});

describe('registration validation', () => {
  it('rejects a mismatched confirmation before calling the backend', async () => {
    const { getByTestId } = await render(<RegisterScreen />);

    await fillForm(getByTestId, {
      email: 'jane@example.com',
      password: 'password123',
      confirm: 'password124',
    });
    await fireEvent.press(getByTestId('register-submit'));

    await waitFor(() =>
      expect(getByTestId('register-confirm-password-input-error')).toHaveTextContent(
        'Password tidak sama'
      )
    );
    expect(mockRegisterWithEmail).not.toHaveBeenCalled();
  });

  it('enforces the backend minimum password length client-side', async () => {
    const { getByTestId } = await render(<RegisterScreen />);

    await fillForm(getByTestId, {
      email: 'jane@example.com',
      password: 'short',
      confirm: 'short',
    });
    await fireEvent.press(getByTestId('register-submit'));

    await waitFor(() =>
      expect(getByTestId('register-password-input-error')).toHaveTextContent(
        'Password minimal 8 karakter'
      )
    );
    expect(mockRegisterWithEmail).not.toHaveBeenCalled();
  });

  it('rejects a password beyond the backend maximum length', async () => {
    const { getByTestId } = await render(<RegisterScreen />);
    const tooLong = 'a'.repeat(129);

    await fillForm(getByTestId, {
      email: 'jane@example.com',
      password: tooLong,
      confirm: tooLong,
    });
    await fireEvent.press(getByTestId('register-submit'));

    await waitFor(() =>
      expect(getByTestId('register-password-input-error')).toHaveTextContent(
        'Password maksimal 128 karakter'
      )
    );
    expect(mockRegisterWithEmail).not.toHaveBeenCalled();
  });

  it('rejects a malformed email before calling the backend', async () => {
    const { getByTestId } = await render(<RegisterScreen />);

    await fillForm(getByTestId, {
      email: 'not-an-email',
      password: 'password123',
      confirm: 'password123',
    });
    await fireEvent.press(getByTestId('register-submit'));

    await waitFor(() => expect(getByTestId('register-email-input-error')).toBeTruthy());
    expect(mockRegisterWithEmail).not.toHaveBeenCalled();
  });
});

describe('navigation back to login', () => {
  it('goes back rather than stacking another login screen', async () => {
    const { getByTestId } = await render(<RegisterScreen />);

    await fireEvent.press(getByTestId('register-back-to-login'));

    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
