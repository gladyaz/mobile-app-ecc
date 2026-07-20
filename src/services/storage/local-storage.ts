import AsyncStorage from '@react-native-async-storage/async-storage';

type StorageEnvelope<T> = {
  readonly version: number;
  readonly data: T;
};

export const STORAGE_KEYS = {
  auth: '@mobile-app-ecc/auth',
  videoInteractions: '@mobile-app-ecc/video-interactions',
  seriesProgress: '@mobile-app-ecc/series-progress',
} as const;

/**
 * Reads and JSON-parses a versioned value from AsyncStorage. Returns
 * undefined for anything that isn't safely usable - missing key, malformed
 * JSON, a version mismatch, or a storage read failure - so callers can
 * always fall back to their existing in-memory default instead of crashing
 * or needing their own try/catch.
 */
export async function getItem<T>(key: string, expectedVersion: number): Promise<T | undefined> {
  try {
    const raw = await AsyncStorage.getItem(key);

    if (!raw) {
      return undefined;
    }

    const parsed = JSON.parse(raw) as StorageEnvelope<T>;

    if (parsed.version !== expectedVersion) {
      return undefined;
    }

    return parsed.data;
  } catch {
    return undefined;
  }
}

export async function setItem<T>(key: string, version: number, data: T): Promise<void> {
  const envelope: StorageEnvelope<T> = { version, data };

  try {
    await AsyncStorage.setItem(key, JSON.stringify(envelope));
  } catch {
    // Storage unavailable (e.g. private browsing blocking localStorage) -
    // the app keeps working in-memory for this session, just unpersisted.
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {
    // Same rationale as setItem: never let a storage failure crash the app.
  }
}

/** Development-only helper to clear every persisted key at once. */
export async function resetAllPersistedState(): Promise<void> {
  await Promise.all(Object.values(STORAGE_KEYS).map((key) => removeItem(key)));
}
