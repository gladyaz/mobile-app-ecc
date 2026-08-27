/**
 * An in-memory stand-in for `expo-secure-store`, with fault injection.
 *
 * WHY NOT jest-expo's BUILT-IN MOCK. jest-expo auto-mocks `ExpoSecureStore`
 * (see jest-expo/src/preset/moduleMocks/expoModules.js) as a set of bare
 * `jest.fn()`s: they store nothing, so a write followed by a read returns
 * `undefined`, and there is no way to make a write fail. Both of those are
 * exactly what the secure-session tests are about - `writeTokens` verifies by
 * reading back, and the migration's whole contract is what it does when a
 * write fails - so the tests need a store that actually stores and can be told
 * to break.
 *
 * PLAIN FUNCTIONS, NOT `jest.fn()`. The Jest config sets `clearMocks: true`,
 * which calls `mockClear()` on every mock before each test. That does not
 * remove implementations today, but a future switch to `resetMocks` would - and
 * a mock storage layer that silently becomes a no-op mid-suite is a very
 * expensive thing to debug. Closures over a module-level Map cannot be cleared
 * out from under the suite.
 *
 * NO REAL CREDENTIALS EVER GO THROUGH THIS. Tests write synthetic strings.
 */

const store = new Map();

let isAvailable = true;

/**
 * Queued faults per operation. Each entry is `{ mode, remaining }`:
 *
 *  - `throw` makes the call reject, modelling a Keystore that refuses.
 *  - `drop`  makes the call resolve while doing nothing, modelling a write
 *            that reports success and stores nothing. This is the case
 *            `writeTokens`' read-back verification exists to catch, and it is
 *            invisible to any test that can only make calls reject.
 */
const faults = { read: [], write: [], delete: [] };

function takeFault(operation) {
  const queue = faults[operation];
  const next = queue[0];

  if (!next) {
    return null;
  }

  next.remaining -= 1;

  if (next.remaining <= 0) {
    queue.shift();
  }

  return next.mode;
}

function assertAvailable(operation) {
  if (!isAvailable) {
    // Mirrors the real failure shape on a platform with no native module: on
    // web `ExpoSecureStore` is `{}`, so calling through it is a TypeError
    // rather than a polite rejection.
    throw new TypeError(`ExpoSecureStore.${operation} is not a function`);
  }
}

async function isAvailableAsync() {
  return isAvailable;
}

async function getItemAsync(key) {
  assertAvailable('getValueWithKeyAsync');

  if (takeFault('read') === 'throw') {
    throw new Error('secure-store mock: read failed');
  }

  return store.has(key) ? store.get(key) : null;
}

async function setItemAsync(key, value) {
  assertAvailable('setValueWithKeyAsync');

  const fault = takeFault('write');

  if (fault === 'throw') {
    throw new Error('secure-store mock: write failed');
  }

  if (fault === 'drop') {
    return;
  }

  store.set(key, value);
}

async function deleteItemAsync(key) {
  assertAvailable('deleteValueWithKeyAsync');

  if (takeFault('delete') === 'throw') {
    throw new Error('secure-store mock: delete failed');
  }

  store.delete(key);
}

/** Clears stored values, faults and availability. Call in `beforeEach`. */
function __resetSecureStoreMock() {
  store.clear();
  isAvailable = true;
  faults.read = [];
  faults.write = [];
  faults.delete = [];
}

/** Models a platform with no secure storage at all (web). */
function __setSecureStoreAvailable(available) {
  isAvailable = available;
}

/**
 * Queues a fault.
 *
 * @param {'read'|'write'|'delete'} operation
 * @param {'throw'|'drop'} mode
 * @param {number|'always'} times how many calls it applies to; one by default,
 *   which is what a "fails once, then the retry succeeds" test needs.
 */
function __failSecureStore(operation, mode = 'throw', times = 1) {
  faults[operation].push({
    mode,
    remaining: times === 'always' ? Number.POSITIVE_INFINITY : times,
  });
}

/**
 * Reads the raw stored string, bypassing every fault.
 *
 * This is how a test asserts what is ACTUALLY at rest - as opposed to what the
 * module under test reports - which is the only way to prove a token really did
 * leave AsyncStorage and really did land here.
 */
function __peekSecureStore(key) {
  return store.has(key) ? store.get(key) : null;
}

/** Every key currently held, for "nothing was left behind" assertions. */
function __secureStoreKeys() {
  return Array.from(store.keys());
}

module.exports = {
  isAvailableAsync,
  getItemAsync,
  setItemAsync,
  deleteItemAsync,
  __resetSecureStoreMock,
  __setSecureStoreAvailable,
  __failSecureStore,
  __peekSecureStore,
  __secureStoreKeys,
};
