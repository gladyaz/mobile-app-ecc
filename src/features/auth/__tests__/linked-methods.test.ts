import { buildAuthMethodRows, canUnlinkAuthMethod } from '@/features/auth/linked-methods';
import type { AuthIdentitySummary } from '@/types/auth';

function identity(
  provider: AuthIdentitySummary['provider'],
  overrides?: Partial<AuthIdentitySummary>
): AuthIdentitySummary {
  return {
    provider,
    identifier: null,
    usable: true,
    // Defaults to the server ALLOWING the unlink, so any `false` in a test
    // below is the local guard talking, not the fixture.
    canBeUnlinked: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    verifiedAt: null,
    ...overrides,
  };
}

describe('canUnlinkAuthMethod (local fallback guard)', () => {
  it('refuses to unlink the only remaining login method', () => {
    // THE rule this module exists for: removing the last method would leave
    // the account with no way to sign in at all.
    const identities = [identity('email', { identifier: 'j***@example.com' })];

    expect(canUnlinkAuthMethod(identities, 'email')).toBe(false);
  });

  it('allows unlinking when another method would still remain', () => {
    const identities = [identity('email'), identity('google')];

    expect(canUnlinkAuthMethod(identities, 'email')).toBe(true);
    expect(canUnlinkAuthMethod(identities, 'google')).toBe(true);
  });

  it('refuses to unlink a method that is not linked in the first place', () => {
    const identities = [identity('email'), identity('google')];

    expect(canUnlinkAuthMethod(identities, 'whatsapp')).toBe(false);
  });

  it('refuses everything when the account somehow reports no methods', () => {
    expect(canUnlinkAuthMethod([], 'email')).toBe(false);
  });

  it('does not let an unknown provider prop up the "more than one left" count', () => {
    // A provider this client cannot render must not make the last usable
    // method look safe to remove.
    const identities = [
      identity('email'),
      identity('apple' as AuthIdentitySummary['provider']),
    ];

    expect(canUnlinkAuthMethod(identities, 'email')).toBe(false);
  });
});

describe('buildAuthMethodRows', () => {
  it('returns one row per supported provider, linked or not', () => {
    const rows = buildAuthMethodRows([identity('email', { identifier: 'j***@example.com' })]);

    expect(rows.map((row) => row.provider)).toEqual(['email', 'google', 'whatsapp']);
    expect(rows.map((row) => row.isLinked)).toEqual([true, false, false]);
  });

  it('carries the backend identifier for a linked method and null otherwise', () => {
    const rows = buildAuthMethodRows([identity('whatsapp', { identifier: '+*********7890' })]);

    expect(rows.find((row) => row.provider === 'whatsapp')?.identifier).toBe('+*********7890');
    expect(rows.find((row) => row.provider === 'google')?.identifier).toBeNull();
  });

  it('keeps a null identifier as null rather than inventing a label', () => {
    // A Google account whose email was not verified has nothing safely
    // displayable. The card renders its own neutral label; this module must
    // not fabricate one.
    const rows = buildAuthMethodRows([identity('email'), identity('google', { identifier: null })]);

    expect(rows.find((row) => row.provider === 'google')?.identifier).toBeNull();
  });

  it('marks the last remaining method as not unlinkable', () => {
    const rows = buildAuthMethodRows([identity('google')]);

    expect(rows.find((row) => row.provider === 'google')?.canUnlink).toBe(false);
  });

  it('marks each method unlinkable once there are two', () => {
    const rows = buildAuthMethodRows([identity('google'), identity('whatsapp')]);

    expect(rows.filter((row) => row.canUnlink).map((row) => row.provider)).toEqual([
      'google',
      'whatsapp',
    ]);
  });

  it('honours a SERVER refusal even when the local guard would allow it', () => {
    // The authoritative rule: `canBeUnlinked` is computed by the exact rule
    // DELETE enforces. A client that could turn a server "no" back into an
    // offer would present an action guaranteed to fail.
    const rows = buildAuthMethodRows([
      identity('email'),
      identity('google', { canBeUnlinked: false }),
    ]);

    expect(rows.find((row) => row.provider === 'google')?.canUnlink).toBe(false);
    expect(canUnlinkAuthMethod(
      [identity('email'), identity('google', { canBeUnlinked: false })],
      'google'
    )).toBe(true);
  });

  it('never offers to unlink email, which the backend refuses outright', () => {
    // An email identity is inseparable from User.email/passwordHash, so
    // DELETE /auth/identities/email answers 400. Offering the control would
    // be offering an action that cannot succeed.
    const rows = buildAuthMethodRows([identity('email'), identity('google')]);

    expect(rows.find((row) => row.provider === 'email')?.canUnlink).toBe(false);
  });

  it('offers a link control for every unlinked provider except email', () => {
    const rows = buildAuthMethodRows([identity('email')]);

    expect(rows.filter((row) => row.canLink).map((row) => row.provider)).toEqual([
      'google',
      'whatsapp',
    ]);
  });

  it('offers no link control for a provider already linked', () => {
    const rows = buildAuthMethodRows([identity('email'), identity('google')]);

    expect(rows.find((row) => row.provider === 'google')?.canLink).toBe(false);
  });

  it('flags the account only method as such, and never a merely-unlinkable one', () => {
    // `isOnlyMethod` is what justifies "this is the only way you can sign
    // in". `canUnlink` is false for email on ANY account, which is a
    // lifecycle rule, not a lockout - saying so on a three-method account
    // would be untrue.
    const solo = buildAuthMethodRows([identity('email')]);
    expect(solo.find((row) => row.provider === 'email')?.isOnlyMethod).toBe(true);

    const pair = buildAuthMethodRows([identity('email'), identity('google')]);
    expect(pair.find((row) => row.provider === 'email')?.isOnlyMethod).toBe(false);
    expect(pair.find((row) => row.provider === 'email')?.canUnlink).toBe(false);
    expect(pair.find((row) => row.provider === 'google')?.isOnlyMethod).toBe(false);
  });

  it('carries the server usable flag through', () => {
    const rows = buildAuthMethodRows([identity('email', { usable: false }), identity('google')]);

    expect(rows.find((row) => row.provider === 'email')?.usable).toBe(false);
    // Nothing linked defaults to usable rather than rendering a scary note.
    expect(rows.find((row) => row.provider === 'whatsapp')?.usable).toBe(true);
  });

  it('drops a provider the app does not support instead of rendering an unknown row', () => {
    const rows = buildAuthMethodRows([
      identity('email'),
      identity('apple' as AuthIdentitySummary['provider'], { identifier: 'a***@icloud.com' }),
    ]);

    expect(rows.map((row) => row.provider)).toEqual(['email', 'google', 'whatsapp']);
  });
});
