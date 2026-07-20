import AsyncStorage from '@react-native-async-storage/async-storage';

import { getItem, removeItem, resetAllPersistedState, setItem, STORAGE_KEYS } from '@/services/storage/local-storage';

describe('local-storage', () => {
  afterEach(async () => {
    await AsyncStorage.clear();
  });

  it('round-trips a value through setItem and getItem', async () => {
    await setItem('test-key', 1, { hello: 'world' });

    const result = await getItem<{ hello: string }>('test-key', 1);

    expect(result).toEqual({ hello: 'world' });
  });

  it('returns undefined for a missing key', async () => {
    const result = await getItem('does-not-exist', 1);

    expect(result).toBeUndefined();
  });

  it('returns undefined for malformed JSON instead of throwing', async () => {
    await AsyncStorage.setItem('bad-key', 'not valid json{{{');

    const result = await getItem('bad-key', 1);

    expect(result).toBeUndefined();
  });

  it('returns undefined when the stored version does not match', async () => {
    await setItem('versioned-key', 1, { value: 42 });

    const result = await getItem('versioned-key', 2);

    expect(result).toBeUndefined();
  });

  it('removeItem clears a previously set value', async () => {
    await setItem('removable-key', 1, { value: true });
    await removeItem('removable-key');

    const result = await getItem('removable-key', 1);

    expect(result).toBeUndefined();
  });

  it('resetAllPersistedState clears every known storage key', async () => {
    await setItem(STORAGE_KEYS.auth, 1, { user: null });
    await setItem(STORAGE_KEYS.videoInteractions, 1, { interactions: {} });
    await setItem(STORAGE_KEYS.seriesProgress, 1, { progressBySeriesId: {} });

    await resetAllPersistedState();

    expect(await getItem(STORAGE_KEYS.auth, 1)).toBeUndefined();
    expect(await getItem(STORAGE_KEYS.videoInteractions, 1)).toBeUndefined();
    expect(await getItem(STORAGE_KEYS.seriesProgress, 1)).toBeUndefined();
  });
});
