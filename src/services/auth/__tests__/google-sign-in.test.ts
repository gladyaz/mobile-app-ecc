import {
  describeMissingGoogleConfig,
  resolveGoogleConfig,
} from '@/services/auth/google-sign-in-contract';
import {
  isGoogleSignInConfigured,
  isGoogleSignInSupported,
  signInWithGoogle,
  signOutFromGoogle,
} from '@/services/auth/google-sign-in';

/**
 * The external provider is mocked at ITS OWN BOUNDARY - the one module that
 * is allowed to import it - and nowhere else. These tests therefore prove
 * how this app reacts to each Google outcome; they prove NOTHING about
 * whether real Google sign-in works on a device, which needs real client
 * IDs, a development build, and a manual run.
 */
const mockConfigure = jest.fn();
const mockHasPlayServices = jest.fn();
const mockSignIn = jest.fn();
const mockSignOut = jest.fn();

jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: (...args: unknown[]) => mockConfigure(...args),
    hasPlayServices: (...args: unknown[]) => mockHasPlayServices(...args),
    signIn: (...args: unknown[]) => mockSignIn(...args),
    signOut: (...args: unknown[]) => mockSignOut(...args),
  },
  isSuccessResponse: (response: { type: string }) => response?.type === 'success',
  isCancelledResponse: (response: { type: string }) => response?.type === 'cancelled',
}));

const WEB_CLIENT_ID_KEY = 'EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID';
const IOS_CLIENT_ID_KEY = 'EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID';

// Restores the two keys individually rather than reassigning `process.env`
// wholesale: replacing that object detaches it from the one the module under
// test reads, and every later assignment silently stops taking effect. Same
// per-key restore convention `hls-playback-flag.test.ts` already uses.
const ORIGINAL_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const ORIGINAL_IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;

function setGoogleEnv(webClientId?: string, iosClientId?: string): void {
  if (webClientId === undefined) {
    delete process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  } else {
    process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = webClientId;
  }

  if (iosClientId === undefined) {
    delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  } else {
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = iosClientId;
  }
}

beforeEach(() => {
  mockHasPlayServices.mockResolvedValue(true);
  mockSignOut.mockResolvedValue(null);
  setGoogleEnv(undefined, undefined);
});

afterEach(() => {
  setGoogleEnv(ORIGINAL_WEB_CLIENT_ID, ORIGINAL_IOS_CLIENT_ID);
});

describe('resolveGoogleConfig', () => {
  // This suite runs as Platform.OS === 'ios' under jest-expo, which is the
  // stricter of the two native platforms: both client IDs are required
  // there, because this app ships no GoogleService-Info.plist for the SDK
  // to read the iOS ID from.
  it('names every key a completely unconfigured iOS build is missing', () => {
    setGoogleEnv(undefined, undefined);

    expect(resolveGoogleConfig()).toEqual({
      status: 'missing',
      missingKeys: [WEB_CLIENT_ID_KEY, IOS_CLIENT_ID_KEY],
    });
  });

  it('still reports the iOS client ID as missing when only the web one is set', () => {
    setGoogleEnv('web-client-id');

    expect(resolveGoogleConfig()).toEqual({
      status: 'missing',
      missingKeys: [IOS_CLIENT_ID_KEY],
    });
  });

  it('resolves ready once both client IDs are present', () => {
    setGoogleEnv('web-client-id', 'ios-client-id');

    expect(resolveGoogleConfig()).toEqual({
      status: 'ready',
      config: { webClientId: 'web-client-id', iosClientId: 'ios-client-id' },
    });
  });
});

describe('describeMissingGoogleConfig', () => {
  it('names the exact env key a developer has to set', () => {
    const message = describeMissingGoogleConfig([WEB_CLIENT_ID_KEY]);

    expect(message).toContain(WEB_CLIENT_ID_KEY);
    expect(message).toContain('.env.example');
  });
});

describe('signInWithGoogle', () => {
  it('reports "unconfigured" and never touches the SDK when client IDs are absent', async () => {
    setGoogleEnv(undefined);
    // The adapter warns once in dev with the same message. Spied rather than
    // left to print, so the assertion below proves the developer actually
    // gets told instead of the warning just cluttering the test output.
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await signInWithGoogle();

    expect(warn).toHaveBeenCalledWith(expect.stringContaining(WEB_CLIENT_ID_KEY));
    warn.mockRestore();
    expect(result.status).toBe('unconfigured');
    expect(result.status === 'unconfigured' && result.developerMessage).toContain(
      WEB_CLIENT_ID_KEY
    );
    // The point of the guard: no half-configured call reaches Google.
    expect(mockConfigure).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('returns the ID token on a successful sign-in', async () => {
    setGoogleEnv('web-client-id', 'ios-client-id');
    mockSignIn.mockResolvedValueOnce({
      type: 'success',
      data: { idToken: 'google-id-token', user: { id: 'g1', email: 'jane@example.com' } },
    });

    const result = await signInWithGoogle();

    expect(result).toEqual({ status: 'success', idToken: 'google-id-token' });
    expect(mockConfigure).toHaveBeenCalledWith(
      expect.objectContaining({ webClientId: 'web-client-id', offlineAccess: false })
    );
    expect(mockHasPlayServices).toHaveBeenCalled();
  });

  it('passes the iOS client ID through to configure when present', async () => {
    setGoogleEnv('web-client-id', 'ios-client-id');
    mockSignIn.mockResolvedValueOnce({ type: 'success', data: { idToken: 'token' } });

    await signInWithGoogle();

    expect(mockConfigure).toHaveBeenCalledWith(
      expect.objectContaining({ iosClientId: 'ios-client-id' })
    );
  });

  it('reports a dismissed sheet as "cancelled", not as a failure', async () => {
    setGoogleEnv('web-client-id', 'ios-client-id');
    mockSignIn.mockResolvedValueOnce({ type: 'cancelled', data: null });

    await expect(signInWithGoogle()).resolves.toEqual({ status: 'cancelled' });
  });

  it('fails clearly when Google returns no ID token', async () => {
    setGoogleEnv('web-client-id', 'ios-client-id');
    mockSignIn.mockResolvedValueOnce({ type: 'success', data: { idToken: null } });

    const result = await signInWithGoogle();

    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toContain('web client ID');
  });

  it('turns a native throw into a failed result instead of propagating it', async () => {
    setGoogleEnv('web-client-id', 'ios-client-id');
    mockSignIn.mockRejectedValueOnce(new Error('PLAY_SERVICES_NOT_AVAILABLE'));

    const result = await signInWithGoogle();

    expect(result).toEqual({
      status: 'failed',
      reason: 'PLAY_SERVICES_NOT_AVAILABLE',
    });
  });

  it('fails when Play Services is unavailable, without attempting a sign-in', async () => {
    setGoogleEnv('web-client-id', 'ios-client-id');
    mockHasPlayServices.mockRejectedValueOnce(new Error('Play Services not available'));

    const result = await signInWithGoogle();

    expect(result.status).toBe('failed');
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});

describe('signOutFromGoogle', () => {
  it('clears the SDK account so the next sign-in asks which account to use', async () => {
    setGoogleEnv('web-client-id', 'ios-client-id');

    await signOutFromGoogle();

    expect(mockSignOut).toHaveBeenCalled();
  });

  it('does nothing when Google was never configured', async () => {
    setGoogleEnv(undefined);

    await signOutFromGoogle();

    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it('never throws when the SDK sign-out fails: the app session is already gone', async () => {
    setGoogleEnv('web-client-id', 'ios-client-id');
    mockSignOut.mockRejectedValueOnce(new Error('native failure'));

    await expect(signOutFromGoogle()).resolves.toBeUndefined();
  });
});

describe('platform support', () => {
  it('reports native platforms as supported (this suite runs as native)', () => {
    expect(isGoogleSignInSupported()).toBe(true);
  });

  it('reports configured state from the environment', () => {
    setGoogleEnv(undefined);
    expect(isGoogleSignInConfigured()).toBe(false);

    setGoogleEnv('web-client-id', 'ios-client-id');
    expect(isGoogleSignInConfigured()).toBe(true);
  });
});
