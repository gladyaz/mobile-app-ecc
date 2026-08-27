/**
 * This file reads the repository from disk, which application code never does.
 * The Node surface it needs is declared HERE rather than by widening
 * `tsconfig.json`'s `types`, which is deliberately `["jest"]`: app code must
 * not see Node globals, or a stray `Buffer`/`process` would typecheck happily
 * and then fail on a device.
 */
declare const __dirname: string;

type DirectoryEntry = { readonly name: string; isDirectory(): boolean };

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs') as {
  readFileSync(file: string, encoding: 'utf8'): string;
  readdirSync(directory: string, options: { withFileTypes: true }): DirectoryEntry[];
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('path') as {
  join(...segments: string[]): string;
  relative(from: string, to: string): string;
  resolve(...segments: string[]): string;
};

/**
 * V1 is FREE CONTENT + ADS + REWARDS. No money changes hands anywhere in this
 * app, and no paywall is presented to a viewer.
 *
 * TWO DIFFERENT GUARANTEES LIVE HERE, and they are enforced differently on
 * purpose.
 *
 * 1. NO WAY TO SPEND MONEY - a structural, permanent boundary. A checkout, a
 *    subscription purchase, an in-app-purchase SDK, a card form: the app has
 *    none, and one cannot re-enter by adding a dependency or a route, because
 *    doing either fails the cases below. This is a static, grep-style guard,
 *    the way `services/demo/__tests__/production-boundary.test.ts` guards the
 *    demo/mock boundary.
 *
 * 2. NO PREMIUM/PAYWALL EXPERIENCE IN V1 - a product-scope decision
 *    (2026-08-26), enforced by configuration rather than by deletion. Premium
 *    remains an ACCESS TIER the backend models and the client parses, and the
 *    entitlement service, the reward-redemption catalog and every gate that
 *    consumes them are preserved intact for V1.1/V2. What V1 turns off is what
 *    a VIEWER can see: the access badges, the episode locks, the "activate
 *    Premium" playback gate and the coin-priced VIP redemptions. That switch
 *    is `services/config/v1-scope.ts`, its default is pinned by that module's
 *    own test, and each gated surface is pinned where it renders.
 *
 * The distinction matters when reading the patterns below: they hunt for
 * PAYMENT RAILS, which must never exist, not for the word "premium", which
 * legitimately does.
 */
const projectRoot = path.resolve(__dirname, '../../../..');

/**
 * Payment rails, card processors and store-billing bridges. Deliberately does
 * NOT include the word "premium" or "subscribe": premium is an access tier
 * this app legitimately models, and `rewards.ctaSubscribe` is the label on a
 * task that asks a viewer to subscribe to a YouTube channel.
 */
const PAYMENT_SDK_PATTERN =
  /midtrans|xendit|stripe|braintree|paypal|adyen|revenuecat|in-?app-?purchase|\biap\b|play-?billing|google-?pay|expo-in-app|react-native-purchases/i;

/** A user-facing place where money would be spent. */
const PAYMENT_ROUTE_PATTERN =
  /checkout|payment|billing|purchase|subscribe|subscription|upgrade|pay/i;

function collectFiles(directory: string, extension: string): string[] {
  const found: string[] = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '__tests__') {
        continue;
      }

      found.push(...collectFiles(entryPath, extension));
      continue;
    }

    if (entry.name.endsWith(extension)) {
      found.push(entryPath);
    }
  }

  return found;
}

describe('V1 monetization boundary (free + ads, no payment)', () => {
  it('declares no payment, card-processing, or in-app-purchase SDK', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

    const installed = Object.keys({
      ...manifest.dependencies,
      ...manifest.devDependencies,
    });

    expect(installed.filter((name) => PAYMENT_SDK_PATTERN.test(name))).toEqual([]);
  });

  it('exposes no checkout, payment, or subscription route', () => {
    // expo-router derives every navigable screen from this directory, so a
    // route file is the whole of "can a viewer reach this surface".
    const routes = collectFiles(path.join(projectRoot, 'src', 'app'), '.tsx').map((file) =>
      path.relative(path.join(projectRoot, 'src', 'app'), file)
    );

    expect(routes.filter((route) => PAYMENT_ROUTE_PATTERN.test(route))).toEqual([]);
  });

  it('imports no payment SDK anywhere in application code', () => {
    // Catches the case a route does not: a purchase flow wired into an
    // existing screen rather than a new one.
    const offenders: string[] = [];

    for (const file of [
      ...collectFiles(path.join(projectRoot, 'src'), '.ts'),
      ...collectFiles(path.join(projectRoot, 'src'), '.tsx'),
    ]) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        const importMatch = line.match(/(?:from\s+|require\()\s*['"]([^'"]+)['"]/);

        if (importMatch && PAYMENT_SDK_PATTERN.test(importMatch[1])) {
          offenders.push(`${path.relative(projectRoot, file)}: ${importMatch[1]}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('ships with the premium experience OFF, so no committed env file restores the paywall', () => {
    // The V1 scope switch defaults off in code (pinned by
    // `services/config/__tests__/v1-scope.test.ts`), and neither committed env
    // template may quietly turn it back on - `.env.production.example` is
    // copied verbatim by whoever cuts a release build.
    for (const file of ['.env.example', '.env.production.example']) {
      const contents = fs.readFileSync(path.join(projectRoot, file), 'utf8');

      expect(`${file}: ${contents}`).not.toMatch(
        /^\s*EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED\s*=\s*true/m
      );
    }
  });

  it('blocks a release build that enables the premium experience', () => {
    // The preflight is the last gate before an external build, so the V1 scope
    // decision has to be enforceable there and not only in code review.
    const preflight = fs.readFileSync(
      path.join(projectRoot, 'scripts', 'check-release-android.js'),
      'utf8'
    );

    expect(preflight).toContain('EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED');
    expect(preflight).toMatch(
      /blocker\(\s*\n?\s*'EXPO_PUBLIC_PREMIUM_EXPERIENCE_ENABLED=true'/
    );
  });

  it('keeps premium acquisition on the points path: the entitlement service asks, never charges', () => {
    // The entitlement service is the app's whole premium surface area. It has
    // exactly one operation, and that operation is a READ.
    const source = fs.readFileSync(
      path.join(projectRoot, 'src', 'services', 'entitlement', 'entitlement-service.ts'),
      'utf8'
    );

    expect(source).toContain("'users/me/entitlement'");
    expect(source).toContain("method: 'GET'");
    expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH)'/);
    expect(source).not.toMatch(PAYMENT_SDK_PATTERN);
  });
});
