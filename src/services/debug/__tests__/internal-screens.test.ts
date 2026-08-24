import { isInternalScreenEnabled } from '@/services/debug/internal-screens';

type DevGlobal = { __DEV__: boolean };

const devGlobal = globalThis as unknown as DevGlobal;
const ORIGINAL_DEV = devGlobal.__DEV__;

afterEach(() => {
  devGlobal.__DEV__ = ORIGINAL_DEV;
});

describe('isInternalScreenEnabled', () => {
  // The whole point of the gate. `expo export`, Gradle `assembleRelease` and
  // every EAS build produce `__DEV__ === false`, so this is what a shippable
  // artifact evaluates - and `/processing` renders fabricated job rows carrying
  // the backend's internal storage paths, which must not reach an external
  // device.
  it('is disabled in a release build', () => {
    // Arrange
    devGlobal.__DEV__ = false;

    // Act / Assert
    expect(isInternalScreenEnabled()).toBe(false);
  });

  it('is enabled in a development build', () => {
    // Arrange
    devGlobal.__DEV__ = true;

    // Act / Assert
    expect(isInternalScreenEnabled()).toBe(true);
  });

  // Guards against the gate being widened back to "everything except a demo
  // build", which is what it replaced: that let a PRODUCTION release APK show
  // the screen while hiding it from the demo APK - exactly backwards.
  it('does not depend on demo mode', () => {
    // Arrange
    const ORIGINAL_DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE;

    devGlobal.__DEV__ = false;
    process.env.EXPO_PUBLIC_DEMO_MODE = 'false';

    try {
      // Act / Assert
      expect(isInternalScreenEnabled()).toBe(false);
    } finally {
      if (ORIGINAL_DEMO_MODE === undefined) {
        delete process.env.EXPO_PUBLIC_DEMO_MODE;
      } else {
        process.env.EXPO_PUBLIC_DEMO_MODE = ORIGINAL_DEMO_MODE;
      }
    }
  });
});
