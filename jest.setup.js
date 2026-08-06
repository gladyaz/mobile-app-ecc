jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// `useFeedBottomAnchor` reads safe-area insets, which have no value outside a
// native SafeAreaProvider. This is the mock the library ships for exactly that
// case; tests that need a specific inset override `useSafeAreaInsets` locally.
// The shipped mock is a default export, so it has to be unwrapped - requiring
// the module directly yields { default: ... } and every named import (notably
// useSafeAreaInsets) comes back undefined.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default
);
