jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// The Keystore-backed half of session persistence. Mocked globally, beside
// AsyncStorage, because the two are now read together on every launch: a suite
// that renders AuthProvider hydrates from BOTH, and jest-expo's built-in
// ExpoSecureStore stub stores nothing (so a restored session would silently
// vanish) and cannot be made to fail (so no failure path could be tested at
// all). See jest/expo-secure-store-mock.js.
jest.mock('expo-secure-store', () => require('./jest/expo-secure-store-mock'));

// `useFeedBottomAnchor` reads safe-area insets, which have no value outside a
// native SafeAreaProvider. This is the mock the library ships for exactly that
// case; tests that need a specific inset override `useSafeAreaInsets` locally.
// The shipped mock is a default export, so it has to be unwrapped - requiring
// the module directly yields { default: ... } and every named import (notably
// useSafeAreaInsets) comes back undefined.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);
