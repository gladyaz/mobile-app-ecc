/**
 * Proves that the local dev configuration CANNOT silently point the bundle at
 * an address this machine does not have.
 *
 * WHY THIS TEST EXISTS. `EXPO_PUBLIC_API_BASE_URL` is inlined by Metro at build
 * time. When the machine's LAN address changed underneath a running bundler,
 * every request from the app failed with `net::ERR_ADDRESS_UNREACHABLE` - Home
 * showed "Video gagal dimuat", Discover showed "Katalog gagal dimuat" - while
 * the backend was healthy and `curl` against the NEW address succeeded. The
 * whole failure lived in the gap between the address that was inlined and the
 * address the machine actually had, and nothing in the repo could see that gap.
 *
 * WHY THESE ARE UNIT TESTS AND NOT A SUBPROCESS RUN OF THE CHECK. The real
 * script reads `.env` through `@expo/env` and the machine's live network
 * interfaces. Shelling out to it would test whichever Wi-Fi the machine running
 * the suite happens to be on - green on a laptop, red in CI, for reasons that
 * have nothing to do with the rule. So the script exposes `evaluateDevApiHost`,
 * which is PURE, and every case below hands it a world it fully controls.
 *
 * Each case perturbs exactly ONE fact away from a configuration that passes, so
 * a failure names the rule that broke rather than "something is wrong".
 *
 * Every address below is either loopback or an RFC 1918 literal, and every
 * hostname points at `.invalid` - the reserved name that can never resolve.
 */
const {
  evaluateDevApiHost,
  readLocalIpv4Addresses,
  API_BASE_URL_KEY,
  MEDIA_BASE_URL_KEY,
} = require('../check-dev-api-host.js');

/** This machine, for every case below. */
const LOCAL_ADDRESSES = ['192.168.111.234'];

/** A configuration that is correct AND durable: loopback cannot drift. */
function passingFacts(overrides = {}) {
  return {
    env: {
      [API_BASE_URL_KEY]: 'http://localhost:3000',
      [MEDIA_BASE_URL_KEY]: 'http://localhost:3000',
      ...overrides,
    },
    localAddresses: LOCAL_ADDRESSES,
  };
}

function titles(findings) {
  return findings.map((finding) => finding.title);
}

describe('evaluateDevApiHost', () => {
  it('accepts a loopback backend with no blockers and no warnings', () => {
    const { blockers, warnings } = evaluateDevApiHost(passingFacts());

    expect(blockers).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('blocks when the API base URL is missing entirely', () => {
    const { blockers } = evaluateDevApiHost(passingFacts({ [API_BASE_URL_KEY]: undefined }));

    expect(titles(blockers)).toEqual([`${API_BASE_URL_KEY} is not set`]);
  });

  it('blocks when the API base URL is set to an empty string', () => {
    const { blockers } = evaluateDevApiHost(passingFacts({ [API_BASE_URL_KEY]: '   ' }));

    expect(titles(blockers)).toEqual([`${API_BASE_URL_KEY} is not set`]);
  });

  it('blocks when the API base URL is not an absolute URL', () => {
    const { blockers } = evaluateDevApiHost(passingFacts({ [API_BASE_URL_KEY]: 'localhost:3000' }));

    expect(titles(blockers)).toEqual([`${API_BASE_URL_KEY} is not a valid URL`]);
  });

  it('blocks a scheme a browser fetch cannot use', () => {
    const { blockers } = evaluateDevApiHost(
      passingFacts({ [API_BASE_URL_KEY]: 'ftp://192.168.111.234:3000' })
    );

    expect(titles(blockers)).toEqual([`${API_BASE_URL_KEY} uses an unsupported scheme`]);
  });

  // --- The regression this file exists for --------------------------------
  it('blocks a LAN address this machine no longer holds, naming both addresses', () => {
    const { blockers } = evaluateDevApiHost(
      passingFacts({ [API_BASE_URL_KEY]: 'http://192.168.1.4:3000' })
    );

    expect(titles(blockers)).toEqual([
      `${API_BASE_URL_KEY} points at a LAN address this machine does not have`,
    ]);
    // The detail has to carry BOTH the stale value and the real one, because
    // the whole cost of this bug was not knowing which was which.
    expect(blockers[0].detail).toContain('192.168.1.4');
    expect(blockers[0].detail).toContain('192.168.111.234');
  });

  it('blocks a stale LAN address even when the machine has no LAN address at all', () => {
    const { blockers } = evaluateDevApiHost({
      env: { [API_BASE_URL_KEY]: 'http://192.168.1.4:3000' },
      localAddresses: [],
    });

    expect(titles(blockers)).toEqual([
      `${API_BASE_URL_KEY} points at a LAN address this machine does not have`,
    ]);
    expect(blockers[0].detail).toContain('no LAN address at all');
  });

  it('allows a LAN address the machine currently holds, but warns that it can drift', () => {
    const { blockers, warnings } = evaluateDevApiHost(
      passingFacts({
        [API_BASE_URL_KEY]: 'http://192.168.111.234:3000',
        [MEDIA_BASE_URL_KEY]: 'http://192.168.111.234:3000',
      })
    );

    expect(blockers).toEqual([]);
    expect(titles(warnings)).toEqual([
      `${API_BASE_URL_KEY} is pinned to a LAN address that DHCP can reassign`,
      `${MEDIA_BASE_URL_KEY} is pinned to a LAN address that DHCP can reassign`,
    ]);
  });

  it('holds the media base URL to the same rule as the API base URL', () => {
    const { blockers } = evaluateDevApiHost(
      passingFacts({ [MEDIA_BASE_URL_KEY]: 'http://10.0.0.7:3000' })
    );

    expect(titles(blockers)).toEqual([
      `${MEDIA_BASE_URL_KEY} points at a LAN address this machine does not have`,
    ]);
  });

  it('treats the media base URL as optional, unlike the API base URL', () => {
    const { blockers, warnings } = evaluateDevApiHost(
      passingFacts({ [MEDIA_BASE_URL_KEY]: undefined })
    );

    expect(blockers).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('leaves a public host alone - a deployment is not this check’s business', () => {
    const { blockers, warnings } = evaluateDevApiHost(
      passingFacts({
        [API_BASE_URL_KEY]: 'https://api.redpanda.invalid',
        [MEDIA_BASE_URL_KEY]: 'https://media.redpanda.invalid',
      })
    );

    expect(blockers).toEqual([]);
    expect(warnings).toEqual([]);
  });
});

describe('readLocalIpv4Addresses', () => {
  it('collects external IPv4 addresses and drops loopback and IPv6', () => {
    const addresses = readLocalIpv4Addresses({
      lo0: [
        { address: '127.0.0.1', family: 'IPv4', internal: true },
        { address: '::1', family: 'IPv6', internal: true },
      ],
      en0: [
        { address: '192.168.111.234', family: 'IPv4', internal: false },
        { address: 'fe80::1', family: 'IPv6', internal: false },
      ],
    });

    expect(addresses).toEqual(['192.168.111.234']);
  });

  it('understands the numeric `family` newer Node versions report', () => {
    const addresses = readLocalIpv4Addresses({
      en0: [{ address: '10.1.2.3', family: 4, internal: false }],
    });

    expect(addresses).toEqual(['10.1.2.3']);
  });
});
