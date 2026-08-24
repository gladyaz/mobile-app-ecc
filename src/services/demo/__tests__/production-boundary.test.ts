/**
 * Pins the PRODUCTION side of every switch that can make this app serve
 * fabricated data.
 *
 * The suite already pins the demo direction thoroughly - what demo mode turns
 * on, and where. Almost nothing pinned the other direction: that a build which
 * sets none of these flags gets none of these behaviours. That asymmetry is
 * what lets a boundary rot silently, because the tests that would notice only
 * ever run with the flag ON.
 *
 * Every case below is written as "the flag is absent" rather than
 * "the flag is 'false'", because absent is what a release build actually has:
 * `babel-preset-expo`'s inline-env-vars plugin replaces each
 * `process.env.EXPO_PUBLIC_*` read with the literal value at bundle time, and
 * an unset variable inlines as `undefined`.
 */
import { isDemoMode } from '@/services/demo/demo-mode';

const DEMO_FLAGS = [
  'EXPO_PUBLIC_DEMO_MODE',
  'EXPO_PUBLIC_USE_MOCK_DATA',
  'EXPO_PUBLIC_INCLUDE_QA_FIXTURES',
] as const;

function withoutDemoFlags(run: () => void): void {
  const saved = DEMO_FLAGS.map((key) => [key, process.env[key]] as const);

  for (const [key] of saved) {
    delete process.env[key];
  }

  try {
    run();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

describe('production demo/mock boundary', () => {
  it('is not a demo build when EXPO_PUBLIC_DEMO_MODE is absent', () => {
    withoutDemoFlags(() => {
      expect(isDemoMode()).toBe(false);
    });
  });

  it.each(['false', 'FALSE', '0', '1', 'yes', 'True', ''])(
    'is not a demo build for the near-miss value %p',
    (value) => {
      withoutDemoFlags(() => {
        process.env.EXPO_PUBLIC_DEMO_MODE = value;

        expect(isDemoMode()).toBe(false);
      });
    }
  );

  it('serves the real catalog when no mock flag is set', () => {
    withoutDemoFlags(() => {
      // Required inside the callback: `shouldUseMockData` reads the
      // environment at call time, but `jest.isolateModules` is what guarantees
      // no earlier import cached a decision made under a different env.
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { shouldUseMockData } = require('@/services/videos/video-service');

        expect(shouldUseMockData()).toBe(false);
      });
    });
  });

  it('excludes the synthetic QA fixture card when no fixture flag is set', () => {
    withoutDemoFlags(() => {
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { shouldIncludeQaFixtures } = require('@/data/qa-fixture-videos');

        expect(shouldIncludeQaFixtures()).toBe(false);
      });
    });
  });

  it('keeps the QA fixture out of the catalog even when mock data is on', () => {
    withoutDemoFlags(() => {
      process.env.EXPO_PUBLIC_USE_MOCK_DATA = 'true';

      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { mockDramaVideos } = require('@/data/mock-drama-videos');

        expect(
          (mockDramaVideos as { id: string }[]).some((video) => video.id.startsWith('qa-'))
        ).toBe(false);
      });
    });
  });
});
