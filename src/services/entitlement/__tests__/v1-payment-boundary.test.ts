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
 * V1 is FREE + ADS. No money changes hands anywhere in this app.
 *
 * Premium is not absent - it is an ACCESS TIER the backend decides, and the
 * only way a viewer obtains it today is by redeeming reward points
 * (`features/rewards/use-rewards-center.ts`, debited and granted server-side).
 * That is deliberately preserved: it is working, shipped functionality, not an
 * unfinished payment surface.
 *
 * What must never appear without a product decision is a way to SPEND MONEY: a
 * checkout, a subscription purchase, an in-app-purchase SDK, a card form. The
 * app has none, and the premium gate's only call to action opens Rewards (pinned
 * by `components/__tests__/drama-feed-item.test.tsx`, "F/K: routes the premium
 * CTA to the Rewards route by identity"), while `PremiumPreviewModal` has had
 * its "Segera Hadir" purchase promise removed (pinned by that component's own
 * test).
 *
 * Those tests each guard one surface. This one guards the BOUNDARY, the way
 * `services/demo/__tests__/production-boundary.test.ts` guards the demo/mock
 * boundary: a payment direction cannot re-enter V1 by adding a dependency or a
 * route, because doing either fails here. It is a static, grep-style guard -
 * the same idiom `video-service.test.ts` already uses to keep a hardcoded CDN
 * host out of the playback selector.
 */
const projectRoot = path.resolve(__dirname, '../../../..');

/**
 * Payment rails, card processors and store-billing bridges. Deliberately does
 * NOT include the word "premium" or "subscribe": premium is an access tier
 * this app legitimately models, and `rewards.ctaSubscribe` is the label on a
 * task that asks a viewer to subscribe to a YouTube channel.
 */
const PAYMENT_SDK_PATTERN =
  /midtrans|xendit|stripe|braintree|paypal|adyen|revenuecat|in-?app-?purchase|\biap\b|play-?billing|expo-in-app|react-native-purchases/i;

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
