import {
  __resetTokenStoreForTests,
  clearTokensAndNotify,
  getTokens,
  onTokensChanged,
  setTokens,
  setTokensAndNotify,
} from '@/services/auth/token-store';
import type { AuthTokens } from '@/types/auth';

const TOKENS_A: AuthTokens = { accessToken: 'access-a', refreshToken: 'refresh-a' };
const TOKENS_B: AuthTokens = { accessToken: 'access-b', refreshToken: 'refresh-b' };

afterEach(() => {
  __resetTokenStoreForTests();
});

describe('getTokens / setTokens', () => {
  it('returns null before any tokens are set', () => {
    expect(getTokens()).toBeNull();
  });

  it('returns the tokens most recently written by setTokens', () => {
    setTokens(TOKENS_A);

    expect(getTokens()).toEqual(TOKENS_A);
  });

  it('setTokens does not notify subscribers', () => {
    const listener = jest.fn();
    onTokensChanged(listener);

    setTokens(TOKENS_A);

    expect(listener).not.toHaveBeenCalled();
    expect(getTokens()).toEqual(TOKENS_A);
  });

  it('setTokens(null) clears the stored tokens', () => {
    setTokens(TOKENS_A);
    setTokens(null);

    expect(getTokens()).toBeNull();
  });
});

describe('setTokensAndNotify', () => {
  it('updates the stored tokens', () => {
    setTokensAndNotify(TOKENS_A);

    expect(getTokens()).toEqual(TOKENS_A);
  });

  it('notifies every subscribed listener with the new tokens', () => {
    const listenerOne = jest.fn();
    const listenerTwo = jest.fn();
    onTokensChanged(listenerOne);
    onTokensChanged(listenerTwo);

    setTokensAndNotify(TOKENS_B);

    expect(listenerOne).toHaveBeenCalledWith(TOKENS_B);
    expect(listenerTwo).toHaveBeenCalledWith(TOKENS_B);
  });
});

describe('clearTokensAndNotify', () => {
  it('clears the stored tokens', () => {
    setTokens(TOKENS_A);

    clearTokensAndNotify();

    expect(getTokens()).toBeNull();
  });

  it('notifies subscribed listeners with null', () => {
    const listener = jest.fn();
    onTokensChanged(listener);
    setTokens(TOKENS_A);

    clearTokensAndNotify();

    expect(listener).toHaveBeenCalledWith(null);
  });
});

describe('onTokensChanged', () => {
  it('stops notifying a listener once unsubscribed', () => {
    const listener = jest.fn();
    const unsubscribe = onTokensChanged(listener);

    unsubscribe();
    setTokensAndNotify(TOKENS_A);

    expect(listener).not.toHaveBeenCalled();
  });

  it('supports multiple independent subscriptions', () => {
    const listenerOne = jest.fn();
    const listenerTwo = jest.fn();
    const unsubscribeOne = onTokensChanged(listenerOne);
    onTokensChanged(listenerTwo);

    unsubscribeOne();
    setTokensAndNotify(TOKENS_A);

    expect(listenerOne).not.toHaveBeenCalled();
    expect(listenerTwo).toHaveBeenCalledWith(TOKENS_A);
  });
});
