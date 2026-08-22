import { request } from '@/services/api/client';
import { createRedemptionIdempotencyKey } from '@/services/rewards/idempotency-key';
import {
  claimDailyCheckIn,
  fetchRewardsLedger,
  fetchRewardsSnapshot,
  redeemReward,
} from '@/services/rewards/rewards-service';

/**
 * The `/rewards/*` client, asserted at the WIRE.
 *
 * This is the layer where "the client never fabricates an economic value"
 * stops being a design intention and becomes an observable fact: these cases
 * read the exact path, method and body handed to the HTTP client, so a
 * future edit that starts sending a points figure, a date, or a payout key
 * fails here rather than at a code review that might not happen.
 *
 * They also pin the canonical ROUTES. The backend's paths are contract, not
 * preference - a typo that silently 404s would surface in the UI as a
 * generic error, and a test on the mapper or the hook would never see it.
 */

jest.mock('@/services/api/client', () => ({
  request: jest.fn(),
  ApiError: class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

const mockRequest = request as jest.MockedFunction<typeof request>;

beforeEach(() => {
  mockRequest.mockResolvedValue({} as never);
});

describe('rewards service - routes and auth', () => {
  it('reads the whole centre from the canonical snapshot route, authenticated', async () => {
    await fetchRewardsSnapshot();

    expect(mockRequest).toHaveBeenCalledWith(
      'rewards/snapshot',
      { method: 'GET' },
      { requiresAuth: true }
    );
  });

  it('claims the check-in on the canonical route, authenticated', async () => {
    await claimDailyCheckIn();

    expect(mockRequest).toHaveBeenCalledWith(
      'rewards/check-in',
      { method: 'POST' },
      { requiresAuth: true }
    );
  });

  it('reads history from the canonical ledger route, authenticated', async () => {
    await fetchRewardsLedger();

    expect(mockRequest).toHaveBeenCalledWith(
      'rewards/ledger',
      { method: 'GET' },
      { requiresAuth: true }
    );
  });

  it('redeems on the canonical redemptions route, authenticated', async () => {
    await redeemReward({ offerId: 'redeem_vip_1d', idempotencyKey: 'rdm-abcdefgh' });

    const [path, init, config] = mockRequest.mock.calls[0];

    expect(path).toBe('rewards/redemptions');
    expect(init?.method).toBe('POST');
    expect(config).toEqual({ requiresAuth: true });
  });

  it('sends every rewards call authenticated - there is no anonymous surface', async () => {
    await fetchRewardsSnapshot();
    await claimDailyCheckIn();
    await fetchRewardsLedger();
    await redeemReward({ offerId: 'redeem_vip_1d', idempotencyKey: 'rdm-abcdefgh' });

    for (const call of mockRequest.mock.calls) {
      expect(call[2]).toEqual({ requiresAuth: true });
    }
  });
});

describe('rewards service - the client supplies no economics', () => {
  it('sends NO BODY AT ALL on check-in', async () => {
    // The strongest form of "the mobile does not supply the amount": there is
    // no payload for it to travel in. The date, the points and the
    // idempotency key are all derived server-side, so a client cannot vary
    // the outcome however it repeats the request.
    await claimDailyCheckIn();

    const [, init] = mockRequest.mock.calls[0];

    expect(init).not.toHaveProperty('body');
    expect(JSON.stringify(init)).not.toMatch(/points|amount|date|reward|periodKey/i);
  });

  it('sends only an offer id and an idempotency key when redeeming', async () => {
    await redeemReward({ offerId: 'redeem_vip_1d', idempotencyKey: 'rdm-abcdefgh' });

    const [, init] = mockRequest.mock.calls[0];
    const body = JSON.parse(String(init?.body));

    // Exactly these two keys. Note what is absent: no cost, no points, no
    // duration, no balance. The backend validates with
    // `forbidNonWhitelisted`, so an invented economic field would be
    // rejected outright rather than ignored - adding one here would break
    // redemption, not cheat it.
    expect(Object.keys(body).sort()).toEqual(['idempotencyKey', 'offerId']);
    expect(body.offerId).toBe('redeem_vip_1d');
  });

  it('never sends a balance or a points figure on any route', async () => {
    await fetchRewardsSnapshot();
    await claimDailyCheckIn();
    await fetchRewardsLedger({ limit: 20 });
    await redeemReward({ offerId: 'redeem_vip_1d', idempotencyKey: 'rdm-abcdefgh' });

    for (const [, init] of mockRequest.mock.calls) {
      const body = init?.body ? String(init.body) : '';

      expect(body).not.toMatch(/balancePoints|costPoints|awardedPoints|deltaPoints|grantsDays/);
    }
  });

  it('exposes no dev-tools grant route to the app', async () => {
    // `POST /dev/rewards/grant` exists on the backend behind
    // DEV_TOOLS_ENABLED, and preparing a demo balance is done with
    // `scripts/dev-grant-reward-points.sh` against a local server. Shipping
    // the ability to credit a wallet inside every build - even behind a dev
    // flag - is what this asserts has not happened.
    const serviceModule: Record<string, unknown> = jest.requireActual(
      '@/services/rewards/rewards-service'
    );

    for (const exportName of Object.keys(serviceModule)) {
      expect(exportName).not.toMatch(/grant|devGrant|reconcile/i);
    }

    // Repo-wide, not just this module: the guarantee is that NO file in the
    // app can address a `/dev/rewards/*` route. The pattern matches a quoted
    // path (which is what a real call looks like) rather than the bare
    // substring, so the prose above - which names the route in order to
    // explain why it is absent - does not trip it.
    // Structurally typed rather than `typeof import('fs')`: this project has
    // no `@types/node`, and adding it to satisfy one test would put Node
    // globals in scope for the whole app.
    type DirEntry = { readonly name: string; readonly isDirectory: () => boolean };
    type FsLike = {
      readonly readdirSync: (dir: string, options: { withFileTypes: true }) => DirEntry[];
      readonly readFileSync: (file: string, encoding: string) => string;
    };

    const fs = jest.requireActual('fs') as FsLike;
    const QUOTED_DEV_REWARDS_PATH = /['"`]\/?dev\/rewards/;
    const offenders: string[] = [];
    let scannedFiles = 0;

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;

        // Test files are excluded: the guarantee is about SHIPPED app code,
        // and this very file has to name the pattern in order to look for it.
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') {
            walk(full);
          }
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          scannedFiles += 1;

          if (QUOTED_DEV_REWARDS_PATH.test(fs.readFileSync(full, 'utf8'))) {
            offenders.push(full);
          }
        }
      }
    };

    // Jest runs from the package root, so `src` resolves relative to it.
    walk('src');

    // Guards the guard: a scan that silently visited nothing would pass this
    // case while proving absolutely nothing about the codebase.
    expect(scannedFiles).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});

describe('rewards service - ledger pagination is cursor-based', () => {
  it('omits the query string entirely when no options are given', async () => {
    await fetchRewardsLedger();

    expect(mockRequest.mock.calls[0][0]).toBe('rewards/ledger');
  });

  it('passes the opaque cursor back verbatim', async () => {
    // The cursor is the server's; it is never parsed, decoded or rebuilt.
    // An offset would shift entries between pages of an append-only table
    // that grows while the user reads it.
    const cursor = 'eyJpZCI6ImFiYyIsImNyZWF0ZWRBdCI6MTIzfQ';

    await fetchRewardsLedger({ limit: 20, cursor });

    const path = String(mockRequest.mock.calls[0][0]);

    expect(path.startsWith('rewards/ledger?')).toBe(true);
    expect(new URLSearchParams(path.split('?')[1]).get('cursor')).toBe(cursor);
    expect(new URLSearchParams(path.split('?')[1]).get('limit')).toBe('20');
  });

  it('drops a null cursor rather than sending "null" as a page token', async () => {
    // `nextCursor: null` means the history is exhausted. Forwarding the
    // string "null" would ask the server to page from a token it never
    // issued.
    await fetchRewardsLedger({ limit: 20, cursor: null });

    expect(mockRequest.mock.calls[0][0]).toBe('rewards/ledger?limit=20');
  });
});

describe('redemption idempotency keys', () => {
  it('matches the character set and length the server enforces', () => {
    // The server constrains the key to [A-Za-z0-9_:-]{8,128} because it is
    // stored in a unique index and echoed into a ledger key.
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const key = createRedemptionIdempotencyKey();

      expect(key).toMatch(/^[A-Za-z0-9_:-]{8,128}$/);
    }
  });

  it('never repeats a key within one app run', () => {
    // A collision would REPLAY an earlier receipt instead of making the
    // purchase the user just asked for, so uniqueness here is a correctness
    // property, not a nicety.
    const keys = new Set<string>();

    for (let attempt = 0; attempt < 1000; attempt += 1) {
      keys.add(createRedemptionIdempotencyKey());
    }

    expect(keys.size).toBe(1000);
  });
});
