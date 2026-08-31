#!/usr/bin/env node
//
// Local development API host preflight.
//
// WHY THIS EXISTS
// ---------------
// `EXPO_PUBLIC_API_BASE_URL` and `EXPO_PUBLIC_MEDIA_BASE_URL` are INLINED into
// the bundle by Metro at build time. A value that was correct when the bundler
// started stays baked into the running app even after the machine's address has
// changed underneath it - and when it does, every request fails at the network
// layer with `net::ERR_ADDRESS_UNREACHABLE`, before any of the app's own error
// handling can say anything useful. What the user sees is "Video gagal dimuat"
// on Home and "Katalog gagal dimuat" on Discover, with a healthy backend and a
// `curl` that succeeds - because `curl` is testing a different address than the
// bundle is.
//
// That is not hypothetical. A LAN address written into `.env` went stale twice
// in one debugging session (a DHCP lease moved the Mac between two subnets),
// and both times the whole guest experience looked broken while the backend was
// fine. Chasing the new address is not a fix: it goes stale again on the next
// lease. This check makes the drift VISIBLE and names the stable alternative,
// instead of leaving it to be rediscovered from a blank screen.
//
// It reads only. It never writes a file, never contacts a network, and never
// invents a value: every finding names the thing to fix and stops. In
// particular it does NOT probe the host - reachability is a property of the
// moment, and a check that fails because a backend is not running yet would be
// switched off within a week. What it proves is narrower and durable: the
// address you configured is one this machine can actually be.
//
// SHAPE: `evaluateDevApiHost` below is PURE - every fact it judges is handed to
// it. `readDevApiHostFacts` is the only part that touches the environment and
// the network interfaces. That split is what lets
// `scripts/__tests__/dev-api-host.test.js` prove each rule against a
// constructed world rather than against whichever Wi-Fi the machine is on.

const os = require('os');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');

const API_BASE_URL_KEY = 'EXPO_PUBLIC_API_BASE_URL';
const MEDIA_BASE_URL_KEY = 'EXPO_PUBLIC_MEDIA_BASE_URL';

/** The scheme set a browser `fetch` and a `<video src>` can both use. */
const SUPPORTED_PROTOCOLS = ['http:', 'https:'];

/**
 * RFC 1918 private ranges plus RFC 3927 link-local. These are the addresses a
 * LAN dev backend is reached on, and the only ones this check second-guesses:
 * a public hostname is somebody's deliberate deployment and none of our
 * business, and loopback cannot go stale.
 */
const PRIVATE_IPV4_PATTERNS = [
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
];

function isIpv4Literal(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

function isPrivateIpv4(host) {
  return isIpv4Literal(host) && PRIVATE_IPV4_PATTERNS.some((p) => p.test(host));
}

function isLoopbackHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

/** Returns the parsed URL, or `null` when the value is not a usable absolute URL. */
function parseBaseUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

/**
 * PURE. `facts.env` is the environment as the bundler would see it;
 * `facts.localAddresses` is every IPv4 address currently assigned to this
 * machine. Returns blockers (this build cannot reach its backend) and warnings
 * (it can today, but the value is not durable).
 */
function evaluateDevApiHost(facts) {
  const { env, localAddresses } = facts;

  const blockers = [];
  const warnings = [];

  function blocker(title, detail) {
    blockers.push({ title, detail });
  }

  function warning(title, detail) {
    warnings.push({ title, detail });
  }

  // `EXPO_PUBLIC_MEDIA_BASE_URL` is optional in a build that plays bundled or
  // CDN media, so only the API URL is required outright.
  const checks = [
    { key: API_BASE_URL_KEY, value: env[API_BASE_URL_KEY], required: true },
    { key: MEDIA_BASE_URL_KEY, value: env[MEDIA_BASE_URL_KEY], required: false },
  ];

  for (const { key, value, required } of checks) {
    const hasValue = typeof value === 'string' && value.trim().length > 0;

    if (!hasValue) {
      if (required) {
        blocker(
          `${key} is not set`,
          'Copy .env.example to .env and set it to your backend URL, then restart ' +
            'with `npx expo start -c`. Without it every request fails before it is sent.'
        );
      }
      continue;
    }

    const url = parseBaseUrl(value);

    if (url === null) {
      blocker(`${key} is not a valid URL`, `Got "${value}". Expected an absolute URL, e.g. http://localhost:3000.`);
      continue;
    }

    // `new URL('localhost:3000')` PARSES - as scheme "localhost:" with an empty
    // host. That is the classic "forgot the http://" typo, and reporting it as an
    // unsupported scheme would send the reader looking in the wrong place.
    if (url.hostname.length === 0) {
      blocker(
        `${key} is not a valid URL`,
        `Got "${value}". Expected an absolute URL with a host, e.g. http://localhost:3000.`
      );
      continue;
    }

    if (!SUPPORTED_PROTOCOLS.includes(url.protocol)) {
      blocker(
        `${key} uses an unsupported scheme`,
        `Got "${url.protocol}//" in "${value}". Use http:// or https:// - a browser ` +
          'fetch and a <video src> can use nothing else.'
      );
      continue;
    }

    const host = url.hostname;

    if (isLoopbackHost(host) || !isPrivateIpv4(host)) {
      // Loopback cannot drift, and a public host is a deliberate deployment.
      continue;
    }

    // A private LAN literal. THE regression this check exists for: it is only
    // correct while this machine still holds that address.
    if (!localAddresses.includes(host)) {
      blocker(
        `${key} points at a LAN address this machine does not have`,
        `Configured "${host}", but this machine currently has ` +
          `${localAddresses.length > 0 ? localAddresses.join(', ') : 'no LAN address at all'}. ` +
          'Every request from the bundle will fail with ERR_ADDRESS_UNREACHABLE while the ' +
          'backend itself looks healthy. For Expo Web use http://localhost:3000 (the browser ' +
          'and the backend share this machine); for a physical device use the address above ' +
          'and restart with `npx expo start -c` so the new value is inlined.'
      );
      continue;
    }

    warning(
      `${key} is pinned to a LAN address that DHCP can reassign`,
      `"${host}" is assigned right now, but it is inlined into the bundle at build ` +
        'time and will not follow the machine to a new lease or network. For Expo Web, ' +
        'http://localhost:3000 is stable; keep the LAN address only while testing on a ' +
        'physical device.'
    );
  }

  return { blockers, warnings };
}

/**
 * Every IPv4 address this machine currently answers on, loopback excluded -
 * loopback is checked by name, and including it would let a stale `127.0.0.1`
 * masquerade as a LAN address.
 */
function readLocalIpv4Addresses(interfaces) {
  const addresses = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      // Node <18 reports `family` as the string 'IPv4'; newer versions use 4.
      const isIpv4 = entry.family === 'IPv4' || entry.family === 4;

      if (isIpv4 && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return addresses;
}

function readDevApiHostFacts() {
  // `@expo/env` is the loader Expo CLI itself uses, so this check reads the
  // same values Metro would inline rather than a restatement of them.
  require('@expo/env').load(projectRoot);

  return {
    env: process.env,
    localAddresses: readLocalIpv4Addresses(os.networkInterfaces()),
  };
}

function report(label, findings) {
  if (findings.length === 0) {
    return;
  }

  console.log(`\n${label}\n`);

  for (const { title, detail } of findings) {
    console.log(`  - ${title}`);
    console.log(`    ${detail}`);
  }
}

function main() {
  const { blockers, warnings } = evaluateDevApiHost(readDevApiHostFacts());

  report('Blockers', blockers);
  report('Warnings', warnings);

  if (blockers.length > 0) {
    console.error('\nThe app cannot reach its backend with this configuration.\n');
    process.exit(1);
  }

  console.log(
    warnings.length > 0
      ? '\nNo blockers. Review the warnings above.\n'
      : '\nNo blockers and no warnings.\n'
  );
}

module.exports = {
  evaluateDevApiHost,
  readLocalIpv4Addresses,
  parseBaseUrl,
  isPrivateIpv4,
  isLoopbackHost,
  API_BASE_URL_KEY,
  MEDIA_BASE_URL_KEY,
  SUPPORTED_PROTOCOLS,
};

// Only runs the checks when invoked as a command, so the pure evaluator above
// can be imported by tests without loading `.env` into the test process.
if (require.main === module) {
  main();
}
