import { buildAuthMethodRows, canUnlinkAuthMethod } from '@/features/auth/linked-methods';
import type { LinkedAuthMethod } from '@/types/auth';

function method(provider: LinkedAuthMethod['provider'], label: string | null = null): LinkedAuthMethod {
  return { provider, label, linkedAt: '2026-08-01T00:00:00.000Z' };
}

describe('canUnlinkAuthMethod', () => {
  it('refuses to unlink the only remaining login method', () => {
    // THE rule this module exists for: removing the last method would leave
    // the account with no way to sign in at all.
    const methods = [method('email', 'j***@example.com')];

    expect(canUnlinkAuthMethod(methods, 'email')).toBe(false);
  });

  it('allows unlinking when another method would still remain', () => {
    const methods = [method('email'), method('google')];

    expect(canUnlinkAuthMethod(methods, 'email')).toBe(true);
    expect(canUnlinkAuthMethod(methods, 'google')).toBe(true);
  });

  it('refuses to unlink a method that is not linked in the first place', () => {
    const methods = [method('email'), method('google')];

    expect(canUnlinkAuthMethod(methods, 'whatsapp')).toBe(false);
  });

  it('refuses everything when the account somehow reports no methods', () => {
    expect(canUnlinkAuthMethod([], 'email')).toBe(false);
  });

  it('does not let an unknown provider prop up the "more than one left" count', () => {
    // A provider this client cannot render must not make the last usable
    // method look safe to remove.
    const methods = [
      method('email'),
      { provider: 'apple', label: null, linkedAt: null } as unknown as LinkedAuthMethod,
    ];

    expect(canUnlinkAuthMethod(methods, 'email')).toBe(false);
  });
});

describe('buildAuthMethodRows', () => {
  it('returns one row per supported provider, linked or not', () => {
    const rows = buildAuthMethodRows([method('email', 'j***@example.com')]);

    expect(rows.map((row) => row.provider)).toEqual(['email', 'google', 'whatsapp']);
    expect(rows.map((row) => row.isLinked)).toEqual([true, false, false]);
  });

  it('carries the backend label for a linked method and null otherwise', () => {
    const rows = buildAuthMethodRows([method('whatsapp', '+6281*****7890')]);

    expect(rows.find((row) => row.provider === 'whatsapp')?.label).toBe('+6281*****7890');
    expect(rows.find((row) => row.provider === 'google')?.label).toBeNull();
  });

  it('marks the last remaining method as not unlinkable', () => {
    const rows = buildAuthMethodRows([method('google')]);

    expect(rows.find((row) => row.provider === 'google')?.canUnlink).toBe(false);
  });

  it('marks each method unlinkable once there are two', () => {
    const rows = buildAuthMethodRows([method('google'), method('whatsapp')]);

    expect(rows.filter((row) => row.canUnlink).map((row) => row.provider)).toEqual([
      'google',
      'whatsapp',
    ]);
  });

  it('drops a provider the app does not support instead of rendering an unknown row', () => {
    const rows = buildAuthMethodRows([
      method('email'),
      { provider: 'apple', label: 'a***@icloud.com', linkedAt: null } as unknown as LinkedAuthMethod,
    ]);

    expect(rows.map((row) => row.provider)).toEqual(['email', 'google', 'whatsapp']);
  });
});
