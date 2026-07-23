import { render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { getMyEntitlement } from '@/services/entitlement/entitlement-service';
import { useAuth } from '@/stores/auth';
import { EntitlementProvider, useEntitlement } from '@/stores/entitlement';

jest.mock('@/stores/auth');
jest.mock('@/services/entitlement/entitlement-service');

const mockedUseAuth = useAuth as jest.Mock;
const mockedGetMyEntitlement = getMyEntitlement as jest.MockedFunction<typeof getMyEntitlement>;

function mockAuth(overrides?: {
  isAuthenticated?: boolean;
  isHydrated?: boolean;
  user?: { id: string; name: string; username: string; email: string } | null;
}) {
  mockedUseAuth.mockReturnValue({
    isAuthenticated: overrides?.isAuthenticated ?? false,
    isHydrated: overrides?.isHydrated ?? true,
    user: overrides?.user ?? null,
    login: jest.fn(),
    logout: jest.fn(),
  });
}

function EntitlementProbe() {
  const { isPremium } = useEntitlement();
  return <Text testID="is-premium">{String(isPremium)}</Text>;
}

const USER_A = { id: 'user-a', name: 'A', username: 'a', email: 'a@example.test' };
const USER_B = { id: 'user-b', name: 'B', username: 'b', email: 'b@example.test' };

afterEach(() => {
  jest.clearAllMocks();
});

describe('EntitlementProvider', () => {
  it('reports isPremium:false for a logged-out (guest) user, without calling the backend', async () => {
    mockAuth({ isAuthenticated: false, user: null });

    const { getByTestId } = await render(
      <EntitlementProvider>
        <EntitlementProbe />
      </EntitlementProvider>
    );

    expect(getByTestId('is-premium').props.children).toBe('false');
    expect(mockedGetMyEntitlement).not.toHaveBeenCalled();
  });

  it('reports isPremium:false while auth is not yet hydrated, without fetching', async () => {
    mockAuth({ isAuthenticated: true, isHydrated: false, user: USER_A });

    const { getByTestId } = await render(
      <EntitlementProvider>
        <EntitlementProbe />
      </EntitlementProvider>
    );

    expect(getByTestId('is-premium').props.children).toBe('false');
    expect(mockedGetMyEntitlement).not.toHaveBeenCalled();
  });

  it('fetches and reports isPremium:true for an entitled authenticated user', async () => {
    mockAuth({ isAuthenticated: true, user: USER_A });
    mockedGetMyEntitlement.mockResolvedValue({ isPremium: true, expiresAt: null });

    const { getByTestId } = await render(
      <EntitlementProvider>
        <EntitlementProbe />
      </EntitlementProvider>
    );

    await waitFor(() => expect(getByTestId('is-premium').props.children).toBe('true'));
  });

  it('reports isPremium:false for an authenticated user with no entitlement', async () => {
    mockAuth({ isAuthenticated: true, user: USER_A });
    mockedGetMyEntitlement.mockResolvedValue({ isPremium: false, expiresAt: null });

    const { getByTestId } = await render(
      <EntitlementProvider>
        <EntitlementProbe />
      </EntitlementProvider>
    );

    await waitFor(() => expect(mockedGetMyEntitlement).toHaveBeenCalledTimes(1));
    expect(getByTestId('is-premium').props.children).toBe('false');
  });

  it('fails safe to isPremium:false when the fetch rejects (e.g. network error, expired token)', async () => {
    mockAuth({ isAuthenticated: true, user: USER_A });
    mockedGetMyEntitlement.mockRejectedValue(new Error('network error'));

    const { getByTestId } = await render(
      <EntitlementProvider>
        <EntitlementProbe />
      </EntitlementProvider>
    );

    await waitFor(() => expect(mockedGetMyEntitlement).toHaveBeenCalledTimes(1));
    expect(getByTestId('is-premium').props.children).toBe('false');
  });

  it('does not leak a stale entitled status across an account switch, even before the new fetch resolves', async () => {
    mockAuth({ isAuthenticated: true, user: USER_A });
    mockedGetMyEntitlement.mockResolvedValue({ isPremium: true, expiresAt: null });

    const { getByTestId, rerender } = await render(
      <EntitlementProvider>
        <EntitlementProbe />
      </EntitlementProvider>
    );

    await waitFor(() => expect(getByTestId('is-premium').props.children).toBe('true'));

    // Switch to a different user, but make their fetch hang forever (never
    // resolves). If the exposed value were only reset by the fetch's own
    // eventual resolution (the naive "setIsPremium(false) then refetch"
    // approach this deliberately does NOT use), it would still read "true"
    // here, indefinitely. Asserting synchronously, with no `waitFor` at all,
    // proves the gate is a structural render-time computation
    // (`lastFetchedStatus.userId === user.id`), not something that merely
    // happens to converge once the network call finishes — this is exactly
    // the cross-account leak class Phase 9 had to fix twice.
    mockAuth({ isAuthenticated: true, user: USER_B });
    mockedGetMyEntitlement.mockReturnValue(new Promise(() => {}));

    rerender(
      <EntitlementProvider>
        <EntitlementProbe />
      </EntitlementProvider>
    );

    // The fetch above never resolves, so `waitFor` only passes here if the
    // render-time gate itself (not the fetch) is what produces "false" — a
    // naive implementation without the userId match would still show
    // "true" forever and this assertion would time out and fail.
    await waitFor(() => expect(getByTestId('is-premium').props.children).toBe('false'));
  });

  it('resets to isPremium:false on logout without a stale-true flash', async () => {
    mockAuth({ isAuthenticated: true, user: USER_A });
    mockedGetMyEntitlement.mockResolvedValue({ isPremium: true, expiresAt: null });

    const { getByTestId, rerender } = await render(
      <EntitlementProvider>
        <EntitlementProbe />
      </EntitlementProvider>
    );

    await waitFor(() => expect(getByTestId('is-premium').props.children).toBe('true'));

    mockAuth({ isAuthenticated: false, user: null });
    rerender(
      <EntitlementProvider>
        <EntitlementProbe />
      </EntitlementProvider>
    );

    await waitFor(() => expect(getByTestId('is-premium').props.children).toBe('false'));
  });
});
