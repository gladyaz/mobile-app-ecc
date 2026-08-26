/**
 * This file reads the repository from disk, which application code never does.
 * See `services/entitlement/__tests__/v1-payment-boundary.test.ts` for why the
 * Node surface is declared here rather than by widening `tsconfig.json`.
 */
declare const __dirname: string;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as { readFileSync(file: string, encoding: 'utf8'): string };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path') as {
  join(...segments: string[]): string;
  resolve(...segments: string[]): string;
};

const projectRoot = path.resolve(__dirname, '../../../..');

function read(...segments: string[]): string {
  return fs.readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

/**
 * THE V1 FEATURE SET, stated once as something that fails when it stops being
 * true.
 *
 * The per-surface tests elsewhere each pin one behaviour in detail. This file
 * is the shorter, blunter question a release engineer asks: is the app still
 * the product that was signed off?
 *
 * V1 = free drama content, ads, rewards (with social-follow missions), Google
 * Login, WhatsApp Login, and HLS Auto/manual quality. NOT premium, NOT
 * subscription, NOT payment, NOT coin purchase.
 *
 * The cases below are deliberately structural - they read the modules that
 * DECIDE each thing, not a rendered tree - so they keep holding when a screen
 * is redesigned, and they fail when a capability is removed or a gate's default
 * is flipped. Rendering behaviour is covered by the screen suites.
 */
describe('V1 feature set is present', () => {
  it('offers WhatsApp Login by default - it is in the V1 scope', () => {
    const source = read('src', 'services', 'auth', 'provider-availability.ts');

    // Offered unless a build explicitly withdraws it. An opt-IN default
    // (`=== 'true'`) is what this used to be, and it is what would silently
    // drop a confirmed V1 feature out of a store build.
    expect(source).toMatch(
      /isWhatsAppLoginOffered[\s\S]*?EXPO_PUBLIC_WHATSAPP_AUTH_ENABLED\s*!==\s*'false'/
    );
  });

  it('keeps the WhatsApp OTP flow real: request, verify, and a session from the server', () => {
    const source = read('src', 'services', 'auth', 'provider-auth-service.ts');

    expect(source).toContain("'auth/whatsapp/otp/request'");
    expect(source).toContain("'auth/whatsapp/otp/verify'");

    // NO FAKE SUCCESS. The client must never mint a session, accept a
    // hardcoded code, or shortcut verification while the parallel backend is
    // being built - the button being visible is not a licence to pretend.
    expect(source).not.toMatch(/['"]?\b(123456|000000|111111)\b['"]?/);
    expect(source).not.toMatch(/fake|stub|mockSession|bypass/i);
  });

  it('keeps Google Login, and never fakes a success for an unconfigured build', () => {
    const source = read('src', 'services', 'auth', 'google-sign-in-contract.ts');

    // A build with no client ID resolves to a distinct, truthful state. It
    // must not be collapsed into 'success' or silently retried.
    expect(source).toContain("status: 'missing'");
    expect(source).toContain("status: 'unconfigured'");
    expect(read('src', 'services', 'auth', 'provider-auth-service.ts')).toContain("'auth/google'");
  });

  it('keeps the Rewards Center reachable as a real tab route', () => {
    expect(read('src', 'app', '(tabs)', '_layout.tsx')).toContain("name: 'rewards'");
  });

  it('keeps every V1 social mission platform mapped to copy', () => {
    const mapper = read('src', 'features', 'rewards', 'rewards-mapper.ts');

    // Instagram, TikTok and YouTube are the named V1 missions; Facebook is
    // already carried alongside them.
    for (const platform of ['INSTAGRAM', 'TIKTOK', 'YOUTUBE']) {
      expect(`rewards-mapper: ${mapper}`).toContain(platform);
    }
  });

  it('grants no reward on the client: claims and redemptions stay server-side', () => {
    const mapper = read('src', 'features', 'rewards', 'rewards-mapper.ts');

    // A client-side balance mutation is the fake-success failure mode for
    // rewards, and it is what `rewards-economics-boundary.test.ts` guards in
    // depth. Named here too because "no fake reward success" is a V1 term.
    expect(mapper).not.toMatch(/balancePoints\s*[+-]=|balancePoints:\s*\w+\s*[+-]/);
  });

  it('keeps HLS Auto and manual rendition selection available', () => {
    const quality = read('src', 'constants', 'playback-quality.ts');

    expect(quality).toContain('AUTO');
    // The flag that can switch HLS off is a kill switch, and it must stay
    // default-ON: V1 ships HLS quality selection.
    expect(read('src', 'services', 'videos', 'hls-playback-flag.ts')).toMatch(
      /EXPO_PUBLIC_HLS_PLAYBACK_ENABLED\s*!==\s*'false'/
    );
  });
});

/**
 * The other half: the V1 scope switch reaches every surface it claims to, and
 * no gated surface is left reading the environment directly.
 *
 * A surface that grew its own `process.env.EXPO_PUBLIC_PREMIUM_*` check would
 * still work today and would drift tomorrow - which is exactly the "scattered
 * commented-out code" this single policy module exists to avoid.
 */
describe('V1 scope is enforced from one place', () => {
  const GATED_SURFACES = [
    ['src', 'features', 'discover', 'discover-catalog.ts'],
    ['src', 'components', 'series-episode-row.tsx'],
    ['src', 'app', 'series', '[id].tsx'],
    ['src', 'components', 'drama-feed-item.tsx'],
    ['src', 'features', 'rewards', 'rewards-mapper.ts'],
  ] as const;

  it.each(GATED_SURFACES.map((segments) => [segments.join('/'), segments] as const))(
    '%s reads the scope policy instead of the environment',
    (_label, segments) => {
      const source = read(...segments);

      expect(source).toContain('isPremiumExperienceEnabled');
      expect(source).not.toContain('EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED');
    }
  );

  it('resolves the premium experience in exactly one module', () => {
    const policy = read('src', 'services', 'config', 'v1-scope.ts');

    expect(policy).toContain('EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED');
  });
});
